"""FastAPI 后端：金融实证分析计算引擎
处理 Excel 上传、面板数据合并/清洗、描述统计、检验、回归、机制分析。
"""
from __future__ import annotations
import io
import json
import math
import os
import traceback
import uuid
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scipy import stats as sp_stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.stats.outliers_influence import variance_inflation_factor

try:
    from linearmodels.panel import PanelOLS, RandomEffects, compare
    HAS_LINEARMODELS = True
except Exception:
    HAS_LINEARMODELS = False

from auto_panel import analyze_table, build_merge_plan, execute_plan
from templates import get_template_index, construct_variable, winsorize_columns, VAR_FORMULAS

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="FinLab Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory dataset store (filename -> DataFrame). Persist to parquet on disk for restart safety.
DATASETS: Dict[str, pd.DataFrame] = {}


def _safe_num(x: Any) -> Any:
    """JSON-safe number: NaN/Inf -> None."""
    if x is None:
        return None
    if isinstance(x, (int, np.integer)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        if math.isnan(float(x)) or math.isinf(float(x)):
            return None
        return float(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    return x


def _df_records(df: pd.DataFrame, max_rows: int = 200) -> Dict[str, Any]:
    df = df.head(max_rows)
    cols = list(df.columns)
    rows = []
    for _, r in df.iterrows():
        rows.append({c: _safe_num(r[c]) for c in cols})
    return {"columns": cols, "rows": rows, "total": int(len(df))}


def _save_dataset(df: pd.DataFrame, name: str) -> str:
    ds_id = uuid.uuid4().hex[:12]
    DATASETS[ds_id] = df
    df.to_pickle(os.path.join(UPLOAD_DIR, f"{ds_id}.pkl"))
    meta = {"id": ds_id, "name": name, "rows": int(len(df)), "cols": list(df.columns)}
    with open(os.path.join(UPLOAD_DIR, f"{ds_id}.json"), "w") as f:
        json.dump(meta, f)
    return ds_id


def _load_dataset(ds_id: str) -> pd.DataFrame:
    if ds_id in DATASETS:
        return DATASETS[ds_id]
    p = os.path.join(UPLOAD_DIR, f"{ds_id}.pkl")
    if os.path.exists(p):
        df = pd.read_pickle(p)
        DATASETS[ds_id] = df
        return df
    raise HTTPException(404, f"dataset {ds_id} not found")


@app.on_event("startup")
def _restore() -> None:
    for fn in os.listdir(UPLOAD_DIR):
        if fn.endswith(".pkl"):
            ds_id = fn.replace(".pkl", "")
            try:
                DATASETS[ds_id] = pd.read_pickle(os.path.join(UPLOAD_DIR, fn))
            except Exception:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/py/health")
def health():
    return {"ok": True, "datasets": len(DATASETS), "linearmodels": HAS_LINEARMODELS}


# ─────────────────────────────────────────────────────────────────────────────
# Upload Excel (one or multiple sheets)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/py/upload")
async def upload(file: UploadFile = File(...)):
    content = await file.read()
    name = file.filename or "uploaded.xlsx"
    out: List[Dict[str, Any]] = []
    try:
        if name.lower().endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
            ds_id = _save_dataset(df, name)
            out.append({"id": ds_id, "name": name, "sheet": None,
                        "rows": int(len(df)), "cols": list(df.columns),
                        "preview": _df_records(df, 50)})
        else:
            xls = pd.ExcelFile(io.BytesIO(content))
            for sheet in xls.sheet_names:
                df = xls.parse(sheet)
                # drop fully empty rows/cols
                df = df.dropna(how="all").dropna(axis=1, how="all")
                ds_id = _save_dataset(df, f"{name}::{sheet}")
                out.append({"id": ds_id, "name": f"{name}::{sheet}", "sheet": sheet,
                            "rows": int(len(df)), "cols": list(df.columns),
                            "preview": _df_records(df, 50)})
    except Exception as e:
        raise HTTPException(400, f"读取文件失败: {e}")
    return {"datasets": out}


@app.get("/api/py/dataset/{ds_id}")
def get_dataset(ds_id: str, max_rows: int = 200):
    df = _load_dataset(ds_id)
    return {"id": ds_id, "rows": int(len(df)), "cols": list(df.columns),
            "dtypes": {c: str(df[c].dtype) for c in df.columns},
            "preview": _df_records(df, max_rows)}


@app.get("/api/py/datasets")
def list_datasets():
    items = []
    for ds_id, df in DATASETS.items():
        meta_path = os.path.join(UPLOAD_DIR, f"{ds_id}.json")
        name = ds_id
        if os.path.exists(meta_path):
            try:
                with open(meta_path) as f:
                    name = json.load(f).get("name", ds_id)
            except Exception:
                pass
        items.append({"id": ds_id, "name": name, "rows": int(len(df)),
                      "cols": list(df.columns)})
    return {"datasets": items}


@app.delete("/api/py/dataset/{ds_id}")
def delete_dataset(ds_id: str):
    DATASETS.pop(ds_id, None)
    for ext in (".pkl", ".parquet", ".json"):
        p = os.path.join(UPLOAD_DIR, f"{ds_id}{ext}")
        if os.path.exists(p):
            os.remove(p)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Merge multiple datasets
# ─────────────────────────────────────────────────────────────────────────────
class MergeReq(BaseModel):
    datasets: List[str]  # dataset ids in merge order
    on: List[str]        # join keys (e.g. ["id", "year"])
    how: str = "inner"   # inner | outer | left | right
    name: str = "merged"


@app.post("/api/py/merge")
def merge_datasets(req: MergeReq):
    if len(req.datasets) < 2:
        raise HTTPException(400, "至少需要 2 个数据集")
    dfs = [_load_dataset(d) for d in req.datasets]
    # Validate keys exist
    for i, df in enumerate(dfs):
        for k in req.on:
            if k not in df.columns:
                raise HTTPException(400, f"数据集 {i+1} 缺少键 '{k}'")
    out = dfs[0]
    for df in dfs[1:]:
        out = out.merge(df, on=req.on, how=req.how, suffixes=("", "_dup"))
        # drop duplicated columns from suffix collision
        out = out.loc[:, ~out.columns.str.endswith("_dup")]
    ds_id = _save_dataset(out, req.name)
    return {"id": ds_id, "rows": int(len(out)), "cols": list(out.columns),
            "preview": _df_records(out, 50)}


# ─────────────────────────────────────────────────────────────────────────────
# Auto-analyze & auto-merge: 智能识别 + 一键并表
# ─────────────────────────────────────────────────────────────────────────────
class AutoAnalyzeReq(BaseModel):
    datasets: List[str]
    id_alias: str = "id"
    year_alias: str = "year"


@app.post("/api/py/auto_analyze")
def auto_analyze(req: AutoAnalyzeReq):
    """分析每张表的结构，给出推断结果与合并方案。不写入新数据集。"""
    if not req.datasets:
        raise HTTPException(400, "至少需要一个数据集")
    analyses = []
    for ds_id in req.datasets:
        df = _load_dataset(ds_id)
        meta_path = os.path.join(UPLOAD_DIR, f"{ds_id}.json")
        name = ds_id
        if os.path.exists(meta_path):
            try:
                with open(meta_path) as f:
                    name = json.load(f).get("name", ds_id)
            except Exception:
                pass
        ta = analyze_table(df, name)
        ta["dataset_id"] = ds_id
        analyses.append(ta)
    plan = build_merge_plan(analyses, id_alias=req.id_alias, year_alias=req.year_alias)
    return {"analyses": analyses, "plan": plan}


class AutoExecuteReq(BaseModel):
    plan: Dict[str, Any]
    dataset_map: Dict[str, str]  # table_name -> dataset_id
    name: str = "auto_panel"


@app.post("/api/py/auto_execute")
def auto_execute(req: AutoExecuteReq):
    """按方案执行清洗+合并，返回最终面板数据集。"""
    raw_dfs = {}
    for tname, ds_id in req.dataset_map.items():
        try:
            raw_dfs[tname] = _load_dataset(ds_id)
        except Exception as e:
            raise HTTPException(400, f"加载 {tname} 失败: {e}")
    try:
        merged, report = execute_plan(raw_dfs, req.plan)
    except Exception as e:
        raise HTTPException(400, f"执行失败: {e}\n{traceback.format_exc()}")
    ds_id = _save_dataset(merged, req.name)
    return {
        "id": ds_id,
        "rows": int(len(merged)),
        "cols": list(merged.columns),
        "preview": _df_records(merged, 100),
        "report": report,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 实证模板库
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/py/templates")
def list_templates():
    """返回变量公式库 + 样本筛选规则 + 研究设计模板。"""
    return get_template_index()


class ConstructVarReq(BaseModel):
    dataset: str
    variables: List[str]  # 要构造的变量键列表
    overrides: Optional[Dict[str, Dict[str, str]]] = None  # {var_key: {input: col, input2: col}}
    name: str  # 输出数据集名
    id_col: str = "id"
    year_col: str = "year"


@app.post("/api/py/construct_variables")
def construct_variables_api(req: ConstructVarReq):
    """依顺构造多个变量，返回新数据集。"""
    df = _load_dataset(req.dataset)
    overrides = req.overrides or {}
    log: List[Dict[str, Any]] = []
    for vkey in req.variables:
        r = construct_variable(df, vkey,
                                overrides=overrides.get(vkey),
                                id_col=req.id_col, year_col=req.year_col)
        log.append({
            "var": vkey,
            "success": r["success"],
            "message": r["message"],
            "label": r.get("label"),
        })
        if r["success"]:
            df = r["df"]
    ds_id = _save_dataset(df, req.name)
    return {
        "id": ds_id,
        "rows": int(len(df)),
        "cols": list(df.columns),
        "preview": _df_records(df, 50),
        "log": log,
    }


class WinsorizeReq(BaseModel):
    dataset: str
    columns: List[str]
    p_low: float = 0.01
    p_high: float = 0.99
    name: str


@app.post("/api/py/winsorize")
def winsorize_api(req: WinsorizeReq):
    """对多列一次性缩尾，生成新数据集。"""
    df = _load_dataset(req.dataset)
    out = winsorize_columns(df, req.columns, p_low=req.p_low, p_high=req.p_high)
    ds_id = _save_dataset(out, req.name)
    return {
        "id": ds_id,
        "rows": int(len(out)),
        "cols": list(out.columns),
        "preview": _df_records(out, 50),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Cleaning operations
# ─────────────────────────────────────────────────────────────────────────────
class CleanReq(BaseModel):
    dataset: str
    operations: List[Dict[str, Any]]  # ordered list of ops
    name: str = "cleaned"


def _apply_op(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
    kind = op.get("type")
    cols = op.get("columns") or []
    # keep only numeric columns from the requested list when relevant
    if kind == "dropna":
        subset = cols if cols else None
        return df.dropna(subset=subset)
    if kind == "fillna":
        method = op.get("method", "mean")
        for c in cols or df.select_dtypes(include="number").columns:
            if c not in df.columns:
                continue
            if method == "mean":
                df[c] = df[c].fillna(df[c].mean())
            elif method == "median":
                df[c] = df[c].fillna(df[c].median())
            elif method == "ffill":
                df[c] = df[c].ffill()
            elif method == "bfill":
                df[c] = df[c].bfill()
            elif method == "zero":
                df[c] = df[c].fillna(0)
            elif method == "value":
                df[c] = df[c].fillna(op.get("value", 0))
        return df
    if kind == "winsorize":
        lower = float(op.get("lower", 0.01))
        upper = float(op.get("upper", 0.99))
        for c in cols or df.select_dtypes(include="number").columns:
            if c not in df.columns:
                continue
            lo = df[c].quantile(lower)
            hi = df[c].quantile(upper)
            df[c] = df[c].clip(lower=lo, upper=hi)
        return df
    if kind == "truncate":
        lower = float(op.get("lower", 0.01))
        upper = float(op.get("upper", 0.99))
        for c in cols or df.select_dtypes(include="number").columns:
            if c not in df.columns:
                continue
            lo = df[c].quantile(lower)
            hi = df[c].quantile(upper)
            df = df[(df[c] >= lo) & (df[c] <= hi)]
        return df
    if kind == "log":
        for c in cols:
            if c not in df.columns:
                continue
            df[f"ln_{c}"] = np.log(df[c].where(df[c] > 0))
        return df
    if kind == "log1p":
        for c in cols:
            if c not in df.columns:
                continue
            df[f"ln1p_{c}"] = np.log1p(df[c].clip(lower=0))
        return df
    if kind == "standardize":
        for c in cols or df.select_dtypes(include="number").columns:
            if c not in df.columns:
                continue
            mu = df[c].mean()
            sd = df[c].std()
            if sd and sd > 0:
                df[f"z_{c}"] = (df[c] - mu) / sd
        return df
    if kind == "lag":
        group = op.get("group")
        time = op.get("time")
        periods = int(op.get("periods", 1))
        if group and time and group in df.columns and time in df.columns:
            df = df.sort_values([group, time])
            for c in cols:
                if c in df.columns:
                    df[f"L{periods}_{c}"] = df.groupby(group)[c].shift(periods)
        return df
    if kind == "diff":
        group = op.get("group")
        time = op.get("time")
        if group and time and group in df.columns and time in df.columns:
            df = df.sort_values([group, time])
            for c in cols:
                if c in df.columns:
                    df[f"D_{c}"] = df.groupby(group)[c].diff()
        return df
    if kind == "dummies":
        for c in cols:
            if c in df.columns:
                d = pd.get_dummies(df[c], prefix=c, drop_first=True, dtype=int)
                df = pd.concat([df, d], axis=1)
        return df
    if kind == "rename":
        m = op.get("mapping") or {}
        return df.rename(columns=m)
    if kind == "drop_columns":
        return df.drop(columns=[c for c in cols if c in df.columns])
    if kind == "filter":
        # simple filter: column op value
        c = op.get("column")
        comp = op.get("op")
        v = op.get("value")
        if c not in df.columns:
            return df
        # try numeric coercion of v if column is numeric
        try:
            if pd.api.types.is_numeric_dtype(df[c]):
                v = float(v)
        except Exception:
            pass
        if comp == ">": return df[df[c] > v]
        if comp == ">=": return df[df[c] >= v]
        if comp == "<": return df[df[c] < v]
        if comp == "<=": return df[df[c] <= v]
        if comp == "==": return df[df[c].astype(str) == str(v)]
        if comp == "!=": return df[df[c].astype(str) != str(v)]
    if kind == "drop_rows":
        # delete first n rows or last n rows (for header/unit lines)
        n = int(op.get("n", 1))
        where = op.get("where", "top")  # "top" or "bottom"
        if where == "bottom":
            return df.iloc[:-n].reset_index(drop=True) if n > 0 else df
        return df.iloc[n:].reset_index(drop=True) if n > 0 else df
    if kind == "to_numeric":
        # convert string columns to numeric (with errors=coerce)
        scale = float(op.get("scale", 1.0))  # e.g., 0.0001 to convert 万元 -> 亿元
        for c in cols:
            if c not in df.columns:
                continue
            df[c] = pd.to_numeric(df[c], errors="coerce")
            if scale != 1.0:
                df[c] = df[c] * scale
        return df
    if kind == "extract_year":
        # extract year from a date-like column into a new column (default name: year)
        src = op.get("source") or (cols[0] if cols else None)
        out = op.get("output", "year")
        if src and src in df.columns:
            s = pd.to_datetime(df[src], errors="coerce")
            df[out] = s.dt.year
        return df
    if kind == "wide_to_long":
        # SAS-style unpivot: e.g., columns 2015..2024 -> (year, value)
        id_vars = op.get("id_vars") or []
        value_vars = op.get("value_vars") or cols
        var_name = op.get("var_name", "year")
        value_name = op.get("value_name", "value")
        try_numeric = bool(op.get("var_numeric", True))
        # keep only vars that exist
        id_vars = [c for c in id_vars if c in df.columns]
        value_vars = [c for c in value_vars if c in df.columns]
        if not value_vars:
            return df
        out = df.melt(id_vars=id_vars, value_vars=value_vars,
                      var_name=var_name, value_name=value_name)
        if try_numeric:
            # convert var column (e.g. "2015") to int when possible
            out[var_name] = pd.to_numeric(out[var_name], errors="ignore")
            out[value_name] = pd.to_numeric(out[value_name], errors="coerce")
        # drop rows with missing value
        if op.get("dropna", True):
            out = out.dropna(subset=[value_name])
        return out.reset_index(drop=True)
    if kind == "keep_columns":
        keep = [c for c in cols if c in df.columns]
        return df[keep] if keep else df
    return df


@app.post("/api/py/clean")
def clean(req: CleanReq):
    df = _load_dataset(req.dataset).copy()
    initial = len(df)
    log = []
    for op in req.operations:
        before = len(df)
        try:
            df = _apply_op(df, op)
        except Exception as e:
            log.append({"op": op, "error": str(e)})
            continue
        log.append({"op": op, "rows_before": before, "rows_after": int(len(df))})
    ds_id = _save_dataset(df, req.name)
    return {"id": ds_id, "initial_rows": initial, "final_rows": int(len(df)),
            "cols": list(df.columns), "log": log,
            "preview": _df_records(df, 50)}


# ─────────────────────────────────────────────────────────────────────────────
# Descriptive statistics
# ─────────────────────────────────────────────────────────────────────────────
class DescReq(BaseModel):
    dataset: str
    variables: List[str]
    standardize: bool = False
    by: Optional[str] = None  # group column for split stats


@app.post("/api/py/describe")
def describe(req: DescReq):
    df = _load_dataset(req.dataset)
    cols = [c for c in req.variables if c in df.columns]
    if not cols:
        raise HTTPException(400, "未找到任何指定变量")
    sub = df[cols].copy()
    sub = sub.apply(pd.to_numeric, errors="coerce")
    if req.standardize:
        sub = (sub - sub.mean()) / sub.std()

    def _row(s: pd.Series) -> Dict[str, Any]:
        s = s.dropna()
        return {
            "N": int(len(s)),
            "mean": _safe_num(s.mean()),
            "sd": _safe_num(s.std()),
            "min": _safe_num(s.min()),
            "p25": _safe_num(s.quantile(0.25)),
            "median": _safe_num(s.median()),
            "p75": _safe_num(s.quantile(0.75)),
            "max": _safe_num(s.max()),
            "skew": _safe_num(s.skew()),
            "kurtosis": _safe_num(s.kurtosis()),
        }

    overall = {c: _row(sub[c]) for c in cols}

    grouped = None
    if req.by and req.by in df.columns:
        grouped = {}
        for k, g in df.groupby(req.by):
            gsub = g[cols].apply(pd.to_numeric, errors="coerce")
            if req.standardize:
                gsub = (gsub - gsub.mean()) / gsub.std()
            grouped[str(k)] = {c: _row(gsub[c]) for c in cols}
    return {"overall": overall, "grouped": grouped, "columns": cols}


class CorrReq(BaseModel):
    dataset: str
    variables: List[str]
    method: str = "pearson"  # pearson | spearman | kendall


@app.post("/api/py/corr")
def correlation(req: CorrReq):
    df = _load_dataset(req.dataset)
    cols = [c for c in req.variables if c in df.columns]
    sub = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    n = len(sub)
    if n < 3:
        raise HTTPException(400, "样本量过小，无法计算相关系数")
    corr = sub.corr(method=req.method)
    # p-values
    pvals = pd.DataFrame(np.zeros_like(corr), index=corr.index, columns=corr.columns)
    for i, a in enumerate(cols):
        for j, b in enumerate(cols):
            if i == j:
                pvals.loc[a, b] = 0.0
                continue
            x = sub[a]; y = sub[b]
            if req.method == "pearson":
                _, p = sp_stats.pearsonr(x, y)
            elif req.method == "spearman":
                _, p = sp_stats.spearmanr(x, y)
            else:
                _, p = sp_stats.kendalltau(x, y)
            pvals.loc[a, b] = p
    return {
        "columns": cols,
        "corr": [[_safe_num(corr.loc[a, b]) for b in cols] for a in cols],
        "p": [[_safe_num(pvals.loc[a, b]) for b in cols] for a in cols],
        "n": n,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Hypothesis tests
# ─────────────────────────────────────────────────────────────────────────────
class TTestReq(BaseModel):
    dataset: str
    variable: str
    group: Optional[str] = None     # for two-sample
    mu: Optional[float] = None      # for one-sample
    equal_var: bool = False


@app.post("/api/py/ttest")
def ttest(req: TTestReq):
    df = _load_dataset(req.dataset)
    if req.variable not in df.columns:
        raise HTTPException(400, "变量不存在")
    x = pd.to_numeric(df[req.variable], errors="coerce").dropna()
    if req.group:
        if req.group not in df.columns:
            raise HTTPException(400, "分组变量不存在")
        groups = df[[req.variable, req.group]].dropna()
        groups[req.variable] = pd.to_numeric(groups[req.variable], errors="coerce")
        groups = groups.dropna()
        levels = groups[req.group].unique()
        if len(levels) != 2:
            raise HTTPException(400, "分组变量必须恰好有 2 个水平")
        a = groups[groups[req.group] == levels[0]][req.variable]
        b = groups[groups[req.group] == levels[1]][req.variable]
        t, p = sp_stats.ttest_ind(a, b, equal_var=req.equal_var)
        return {"type": "two-sample", "groups": [str(levels[0]), str(levels[1])],
                "n1": int(len(a)), "n2": int(len(b)),
                "mean1": _safe_num(a.mean()), "mean2": _safe_num(b.mean()),
                "diff": _safe_num(a.mean() - b.mean()),
                "t": _safe_num(t), "p": _safe_num(p)}
    mu = req.mu if req.mu is not None else 0.0
    t, p = sp_stats.ttest_1samp(x, mu)
    return {"type": "one-sample", "n": int(len(x)),
            "mean": _safe_num(x.mean()), "mu": mu,
            "t": _safe_num(t), "p": _safe_num(p)}


class VIFReq(BaseModel):
    dataset: str
    variables: List[str]


@app.post("/api/py/vif")
def vif(req: VIFReq):
    df = _load_dataset(req.dataset)
    cols = [c for c in req.variables if c in df.columns]
    sub = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if sub.shape[1] < 2 or sub.shape[0] < sub.shape[1] + 1:
        raise HTTPException(400, "样本量或变量数不足")
    X = sm.add_constant(sub.values)
    out = []
    for i, c in enumerate(cols):
        v = variance_inflation_factor(X, i + 1)
        out.append({"variable": c, "vif": _safe_num(v)})
    return {"vif": out, "n": int(len(sub))}


# ─────────────────────────────────────────────────────────────────────────────
# Regression engine
# ─────────────────────────────────────────────────────────────────────────────
class RegReq(BaseModel):
    dataset: str
    y: str
    x: List[str]                    # main + control variables
    controls: List[str] = []
    model: str = "ols"              # ols | fe | re | fe_time | fe_two
    entity: Optional[str] = None    # entity id column (for panel)
    time: Optional[str] = None      # time column (for panel)
    cluster: Optional[str] = None   # cluster variable for SE
    cov_type: str = "HC1"           # HC0/HC1/HC2/HC3 or 'cluster'
    name: Optional[str] = None      # column label for results


def _model_summary_dict(res, names: List[str], extra: Dict[str, Any] | None = None) -> Dict[str, Any]:
    coefs = []
    for n in names:
        try:
            b = float(res.params[n])
            se = float(res.bse[n])
            t = float(res.tvalues[n])
            p = float(res.pvalues[n])
        except Exception:
            continue
        # significance stars
        star = "***" if p < 0.01 else ("**" if p < 0.05 else ("*" if p < 0.10 else ""))
        coefs.append({"name": n, "coef": _safe_num(b), "se": _safe_num(se),
                      "t": _safe_num(t), "p": _safe_num(p), "star": star})
    out = {
        "coefficients": coefs,
        "n": int(getattr(res, "nobs", float("nan"))),
        "r2": _safe_num(getattr(res, "rsquared", None)),
        "adj_r2": _safe_num(getattr(res, "rsquared_adj", None)),
        "f_stat": _safe_num(getattr(res, "fvalue", None)),
        "f_pvalue": _safe_num(getattr(res, "f_pvalue", None)),
    }
    if extra:
        out.update(extra)
    return out


def _panel_summary(res, extra: Dict[str, Any] | None = None) -> Dict[str, Any]:
    coefs = []
    for n in res.params.index:
        b = float(res.params[n])
        se = float(res.std_errors[n])
        t = float(res.tstats[n])
        p = float(res.pvalues[n])
        star = "***" if p < 0.01 else ("**" if p < 0.05 else ("*" if p < 0.10 else ""))
        coefs.append({"name": n, "coef": _safe_num(b), "se": _safe_num(se),
                      "t": _safe_num(t), "p": _safe_num(p), "star": star})
    out = {
        "coefficients": coefs,
        "n": int(res.nobs),
        "r2": _safe_num(getattr(res, "rsquared", None)),
        "r2_within": _safe_num(getattr(res, "rsquared_within", None)),
        "r2_between": _safe_num(getattr(res, "rsquared_between", None)),
        "r2_overall": _safe_num(getattr(res, "rsquared_overall", None)),
        "f_stat": _safe_num(getattr(res.f_statistic, "stat", None)) if hasattr(res, "f_statistic") else None,
        "f_pvalue": _safe_num(getattr(res.f_statistic, "pval", None)) if hasattr(res, "f_statistic") else None,
    }
    if extra:
        out.update(extra)
    return out


def _run_regression(req: RegReq) -> Dict[str, Any]:
    df = _load_dataset(req.dataset)
    all_x = list(req.x) + [c for c in (req.controls or []) if c not in req.x]
    needed_raw = [req.y] + all_x + [c for c in [req.entity, req.time, req.cluster] if c]
    needed = []
    seen = set()
    for c in needed_raw:
        if c and c in df.columns and c not in seen:
            needed.append(c); seen.add(c)
    sub = df[needed].copy()
    # coerce numerics
    for c in [req.y] + all_x:
        if c in sub.columns:
            sub[c] = pd.to_numeric(sub[c], errors="coerce")
    sub = sub.dropna(subset=[req.y] + all_x)
    if len(sub) < len(all_x) + 2:
        raise HTTPException(400, f"样本量过小（{len(sub)}），无法回归")

    if req.model == "ols":
        X = sm.add_constant(sub[all_x])
        kw = {}
        if req.cov_type == "cluster" and req.cluster and req.cluster in sub.columns:
            kw = {"cov_type": "cluster", "cov_kwds": {"groups": sub[req.cluster]}}
        else:
            kw = {"cov_type": req.cov_type or "HC1"}
        res = sm.OLS(sub[req.y], X).fit(**kw)
        return _model_summary_dict(res, ["const"] + all_x,
                                   extra={"model": "OLS", "label": req.name or "OLS",
                                          "fe_entity": False, "fe_time": False,
                                          "se_type": kw.get("cov_type", "HC1")})

    # Panel models
    if not HAS_LINEARMODELS:
        raise HTTPException(500, "linearmodels 未安装")
    if not (req.entity and req.time):
        raise HTTPException(400, "面板模型需指定 entity 与 time 列")
    if req.entity not in sub.columns or req.time not in sub.columns:
        raise HTTPException(400, "entity 或 time 列不存在")
    pdf = sub.copy()
    ent = np.asarray(sub[req.entity]).reshape(-1)
    tim = np.asarray(sub[req.time]).reshape(-1)
    pdf.index = pd.MultiIndex.from_arrays([ent, tim], names=[req.entity, req.time])
    pdf = pdf.drop(columns=[req.entity, req.time])
    Y = pdf[req.y]
    X = sm.add_constant(pdf[all_x])
    fe_entity = req.model in ("fe", "fe_two")
    fe_time = req.model in ("fe_time", "fe_two")
    if req.model == "re":
        mod = RandomEffects(Y, X)
    else:
        mod = PanelOLS(Y, X, entity_effects=fe_entity, time_effects=fe_time, drop_absorbed=True)
    if req.cov_type == "cluster" and req.cluster and req.cluster in sub.columns:
        # linearmodels needs 1-d non-categorical clusters as a Series with same index
        cl_vals = pd.Categorical(sub[req.cluster].values).codes if str(sub[req.cluster].dtype) == "category" else sub[req.cluster].values
        groups = pd.DataFrame({req.cluster: np.asarray(cl_vals).astype(np.int64) if pd.api.types.is_numeric_dtype(pd.Series(cl_vals)) else cl_vals}, index=pdf.index)
        res = mod.fit(cov_type="clustered", clusters=groups)
        se_label = f"cluster({req.cluster})"
    elif req.model == "re":
        res = mod.fit()
        se_label = "default"
    else:
        res = mod.fit(cov_type="robust")
        se_label = "robust"
    label = req.name or {"fe": "FE", "re": "RE", "fe_time": "FE-Time", "fe_two": "FE-Two"}.get(req.model, req.model)
    return _panel_summary(res, extra={"model": label, "label": label,
                                      "fe_entity": fe_entity, "fe_time": fe_time,
                                      "se_type": se_label})


@app.post("/api/py/regression")
def regression(req: RegReq):
    try:
        return _run_regression(req)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"回归失败: {e}")


class MultiRegReq(BaseModel):
    """Run several regressions and return as table columns (basis for paper-style table)."""
    specs: List[RegReq]


@app.post("/api/py/regression_table")
def regression_table(req: MultiRegReq):
    cols = []
    for spec in req.specs:
        try:
            cols.append(_run_regression(spec))
        except HTTPException as e:
            cols.append({"error": e.detail, "label": spec.name or "(error)"})
        except Exception as e:
            cols.append({"error": str(e), "label": spec.name or "(error)"})
    return {"columns": cols}


# ─────────────────────────────────────────────────────────────────────────────
# Wald / F joint significance test on existing OLS spec
# ─────────────────────────────────────────────────────────────────────────────
class WaldReq(BaseModel):
    dataset: str
    y: str
    x: List[str]
    test: List[str]                # variables to jointly test = 0
    cov_type: str = "HC1"


@app.post("/api/py/wald")
def wald(req: WaldReq):
    df = _load_dataset(req.dataset)
    needed = [req.y] + req.x
    sub = df[needed].apply(pd.to_numeric, errors="coerce").dropna()
    X = sm.add_constant(sub[req.x])
    res = sm.OLS(sub[req.y], X).fit(cov_type=req.cov_type or "HC1")
    # build R matrix: each row = one tested variable
    hyp = " = 0, ".join(req.test) + " = 0"
    try:
        wt = res.wald_test(hyp, use_f=True, scalar=True)
    except TypeError:
        wt = res.wald_test(hyp, use_f=True)
    return {
        "F": _safe_num(float(wt.statistic)),
        "p": _safe_num(float(wt.pvalue)),
        "df_num": int(len(req.test)),
        "df_den": int(res.df_resid),
        "tested": req.test,
        "hypothesis": hyp,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Hausman test (FE vs RE)
# ─────────────────────────────────────────────────────────────────────────────
class HausmanReq(BaseModel):
    dataset: str
    y: str
    x: List[str]
    entity: str
    time: str


@app.post("/api/py/hausman")
def hausman(req: HausmanReq):
    if not HAS_LINEARMODELS:
        raise HTTPException(500, "linearmodels 未安装")
    df = _load_dataset(req.dataset)
    needed = [req.y] + req.x + [req.entity, req.time]
    sub = df[needed].copy()
    for c in [req.y] + req.x:
        sub[c] = pd.to_numeric(sub[c], errors="coerce")
    sub = sub.dropna(subset=[req.y] + req.x)
    pdf = sub.copy()
    ent = np.asarray(sub[req.entity]).reshape(-1)
    tim = np.asarray(sub[req.time]).reshape(-1)
    pdf.index = pd.MultiIndex.from_arrays([ent, tim], names=[req.entity, req.time])
    pdf = pdf.drop(columns=[req.entity, req.time])
    Y = pdf[req.y]
    X = sm.add_constant(pdf[req.x])
    fe = PanelOLS(Y, X, entity_effects=True, drop_absorbed=True).fit()
    re = RandomEffects(Y, X).fit()
    # Hausman: H = (b_fe - b_re)' [V_fe - V_re]^{-1} (b_fe - b_re)
    common = [n for n in fe.params.index if n in re.params.index and n != "const"]
    b_diff = (fe.params[common] - re.params[common]).values
    v_diff = fe.cov.loc[common, common].values - re.cov.loc[common, common].values
    try:
        H = float(b_diff @ np.linalg.pinv(v_diff) @ b_diff.T)
    except Exception as e:
        raise HTTPException(400, f"Hausman 计算失败: {e}")
    dof = len(common)
    p = float(1 - sp_stats.chi2.cdf(H, dof))
    return {"H": _safe_num(H), "df": dof, "p": _safe_num(p),
            "decision": "拒绝原假设 → 选择固定效应 (FE)" if p < 0.05 else "不拒绝原假设 → 可使用随机效应 (RE)"}


# ─────────────────────────────────────────────────────────────────────────────
# Mediation analysis (Baron-Kenny + Sobel + bootstrap)
# ─────────────────────────────────────────────────────────────────────────────
class MediationReq(BaseModel):
    dataset: str
    y: str
    x: str
    m: str
    controls: List[str] = []
    bootstrap: int = 1000
    seed: int = 42


@app.post("/api/py/mediation")
def mediation(req: MediationReq):
    df = _load_dataset(req.dataset)
    cols = [req.y, req.x, req.m] + req.controls
    sub = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if len(sub) < 30:
        raise HTTPException(400, "样本量过小")
    Xc = sub[[req.x] + req.controls]
    # Step 1: Y ~ X
    r1 = sm.OLS(sub[req.y], sm.add_constant(Xc)).fit(cov_type="HC1")
    c = float(r1.params[req.x]); c_se = float(r1.bse[req.x]); c_p = float(r1.pvalues[req.x])
    # Step 2: M ~ X
    r2 = sm.OLS(sub[req.m], sm.add_constant(Xc)).fit(cov_type="HC1")
    a = float(r2.params[req.x]); a_se = float(r2.bse[req.x]); a_p = float(r2.pvalues[req.x])
    # Step 3: Y ~ X + M
    XcM = sub[[req.x, req.m] + req.controls]
    r3 = sm.OLS(sub[req.y], sm.add_constant(XcM)).fit(cov_type="HC1")
    cprime = float(r3.params[req.x]); cprime_se = float(r3.bse[req.x]); cprime_p = float(r3.pvalues[req.x])
    b = float(r3.params[req.m]); b_se = float(r3.bse[req.m]); b_p = float(r3.pvalues[req.m])

    indirect = a * b
    # Sobel
    sobel_se = math.sqrt((b ** 2) * (a_se ** 2) + (a ** 2) * (b_se ** 2))
    sobel_z = indirect / sobel_se if sobel_se > 0 else float("nan")
    sobel_p = float(2 * (1 - sp_stats.norm.cdf(abs(sobel_z)))) if sobel_se > 0 else None

    # Bootstrap
    rng = np.random.default_rng(req.seed)
    n = len(sub)
    boots = []
    B = max(0, min(int(req.bootstrap), 5000))
    for _ in range(B):
        idx = rng.integers(0, n, n)
        s = sub.iloc[idx]
        try:
            ra = sm.OLS(s[req.m], sm.add_constant(s[[req.x] + req.controls])).fit()
            rb = sm.OLS(s[req.y], sm.add_constant(s[[req.x, req.m] + req.controls])).fit()
            boots.append(float(ra.params[req.x]) * float(rb.params[req.m]))
        except Exception:
            continue
    ci_low = ci_high = None
    if boots:
        ci_low = float(np.percentile(boots, 2.5))
        ci_high = float(np.percentile(boots, 97.5))

    if abs(cprime) < 1e-9:
        med_type = "完全中介 (Full mediation)"
    elif (a_p < 0.05 and b_p < 0.05) and abs(cprime) < abs(c):
        med_type = "部分中介 (Partial mediation)"
    elif a_p < 0.05 and b_p < 0.05:
        med_type = "存在中介效应"
    else:
        med_type = "中介效应不显著"

    return {
        "step1_total": {"label": "Y ~ X (总效应 c)", "coef": _safe_num(c), "se": _safe_num(c_se), "p": _safe_num(c_p)},
        "step2_a":    {"label": "M ~ X (a)", "coef": _safe_num(a), "se": _safe_num(a_se), "p": _safe_num(a_p)},
        "step3_b":    {"label": "Y ~ X+M (b)", "coef": _safe_num(b), "se": _safe_num(b_se), "p": _safe_num(b_p)},
        "step3_cprime": {"label": "Y ~ X+M (直接效应 c')", "coef": _safe_num(cprime), "se": _safe_num(cprime_se), "p": _safe_num(cprime_p)},
        "indirect": _safe_num(indirect),
        "sobel": {"z": _safe_num(sobel_z), "p": _safe_num(sobel_p)},
        "bootstrap": {"B": len(boots), "ci_low": _safe_num(ci_low), "ci_high": _safe_num(ci_high),
                      "significant": bool(ci_low is not None and ci_high is not None and (ci_low * ci_high > 0))},
        "type": med_type,
        "n": int(n),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Moderation (interaction term)
# ─────────────────────────────────────────────────────────────────────────────
class ModerationReq(BaseModel):
    dataset: str
    y: str
    x: str
    w: str  # moderator
    controls: List[str] = []
    center: bool = True


@app.post("/api/py/moderation")
def moderation(req: ModerationReq):
    df = _load_dataset(req.dataset)
    cols = [req.y, req.x, req.w] + req.controls
    sub = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if req.center:
        sub[req.x] = sub[req.x] - sub[req.x].mean()
        sub[req.w] = sub[req.w] - sub[req.w].mean()
    sub["__interact__"] = sub[req.x] * sub[req.w]
    Xc = sub[[req.x, req.w, "__interact__"] + req.controls]
    res = sm.OLS(sub[req.y], sm.add_constant(Xc)).fit(cov_type="HC1")
    # Simple slopes at W = mean ± SD
    w_sd = sub[req.w].std() if not req.center else sub[req.w].std()
    bx = float(res.params[req.x])
    bxw = float(res.params["__interact__"])
    slope_low = bx + bxw * (-w_sd)
    slope_high = bx + bxw * (w_sd)
    coefs = []
    for n in ["const", req.x, req.w, "__interact__"] + req.controls:
        if n not in res.params.index:
            continue
        b = float(res.params[n]); se = float(res.bse[n]); t = float(res.tvalues[n]); p = float(res.pvalues[n])
        star = "***" if p < 0.01 else ("**" if p < 0.05 else ("*" if p < 0.10 else ""))
        coefs.append({"name": "X×W" if n == "__interact__" else n,
                      "coef": _safe_num(b), "se": _safe_num(se), "t": _safe_num(t),
                      "p": _safe_num(p), "star": star})
    return {
        "coefficients": coefs,
        "n": int(res.nobs),
        "r2": _safe_num(res.rsquared),
        "interaction": {
            "coef": _safe_num(bxw),
            "p": _safe_num(float(res.pvalues["__interact__"])),
            "significant": bool(res.pvalues["__interact__"] < 0.05),
        },
        "simple_slopes": {
            "low_W (mean-SD)": _safe_num(slope_low),
            "high_W (mean+SD)": _safe_num(slope_high),
        },
        "centered": req.center,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Group regression (heterogeneity analysis)
# ─────────────────────────────────────────────────────────────────────────────
class GroupRegReq(BaseModel):
    dataset: str
    y: str
    x: List[str]
    group: str
    cov_type: str = "HC1"


@app.post("/api/py/group_regression")
def group_regression(req: GroupRegReq):
    df = _load_dataset(req.dataset)
    if req.group not in df.columns:
        raise HTTPException(400, "分组变量不存在")
    cols = [req.y] + req.x
    out = []
    for k, g in df.groupby(req.group):
        sub = g[cols].apply(pd.to_numeric, errors="coerce").dropna()
        if len(sub) < len(req.x) + 2:
            out.append({"group": str(k), "n": int(len(sub)), "error": "样本量不足"})
            continue
        X = sm.add_constant(sub[req.x])
        res = sm.OLS(sub[req.y], X).fit(cov_type=req.cov_type)
        out.append({
            "group": str(k),
            "n": int(len(sub)),
            "r2": _safe_num(res.rsquared),
            "coefficients": [
                {"name": n, "coef": _safe_num(float(res.params[n])),
                 "se": _safe_num(float(res.bse[n])),
                 "t": _safe_num(float(res.tvalues[n])),
                 "p": _safe_num(float(res.pvalues[n])),
                 "star": "***" if res.pvalues[n] < 0.01 else ("**" if res.pvalues[n] < 0.05 else ("*" if res.pvalues[n] < 0.10 else ""))}
                for n in (["const"] + req.x)
            ]
        })
    return {"groups": out, "by": req.group}


# ─────────────────────────────────────────────────────────────────────────────
# Export regression table to LaTeX / CSV
# ─────────────────────────────────────────────────────────────────────────────
class ExportReq(BaseModel):
    columns: List[Dict[str, Any]]   # output of /regression_table
    fmt: str = "latex"               # latex | csv | text
    digits: int = 3


@app.post("/api/py/export_table")
def export_table(req: ExportReq):
    cols = req.columns
    var_set: List[str] = []
    for c in cols:
        for coef in c.get("coefficients", []):
            if coef["name"] not in var_set:
                var_set.append(coef["name"])
    digits = req.digits
    rows = []
    for v in var_set:
        coef_row = [v]
        se_row = [""]
        for c in cols:
            found = next((x for x in c.get("coefficients", []) if x["name"] == v), None)
            if not found:
                coef_row.append(""); se_row.append("")
            else:
                coef_row.append(f"{found['coef']:.{digits}f}{found['star']}" if found['coef'] is not None else "")
                se_row.append(f"({found['se']:.{digits}f})" if found['se'] is not None else "")
        rows.append(coef_row); rows.append(se_row)
    # stats footer
    n_row = ["N"] + [str(c.get("n", "")) for c in cols]
    r2_row = ["R²"] + [f"{c.get('r2', 0):.{digits}f}" if c.get("r2") is not None else "" for c in cols]
    rows.append(n_row); rows.append(r2_row)
    headers = ["变量"] + [c.get("label", c.get("model", f"({i+1})")) for i, c in enumerate(cols)]

    if req.fmt == "csv":
        import csv as _csv
        buf = io.StringIO()
        w = _csv.writer(buf)
        w.writerow(headers)
        for r in rows:
            w.writerow(r)
        return {"content": buf.getvalue(), "fmt": "csv"}
    if req.fmt == "latex":
        ncol = len(cols)
        s = "\\begin{table}[!htbp]\\centering\n\\caption{回归结果}\n"
        s += "\\begin{tabular}{l" + "c" * ncol + "}\n\\hline\\hline\n"
        s += " & ".join(headers) + " \\\\\n\\hline\n"
        for r in rows[:-2]:
            s += " & ".join([str(x) for x in r]) + " \\\\\n"
        s += "\\hline\n"
        for r in rows[-2:]:
            s += " & ".join([str(x) for x in r]) + " \\\\\n"
        s += "\\hline\\hline\n\\end{tabular}\n"
        s += "\\begin{tablenotes}\\footnotesize\n\\item Robust 标准误见括号；*** p<0.01, ** p<0.05, * p<0.1\n\\end{tablenotes}\n\\end{table}"
        return {"content": s, "fmt": "latex"}
    # text/markdown fallback
    md = "| " + " | ".join(headers) + " |\n|" + "|".join(["---"] * len(headers)) + "|\n"
    for r in rows:
        md += "| " + " | ".join([str(x) for x in r]) + " |\n"
    return {"content": md, "fmt": "markdown"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=False)
