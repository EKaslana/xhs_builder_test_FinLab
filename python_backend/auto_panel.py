"""
智能面板数据识别与方案生成。

核心能力：
1. 检测表头偏移（中文标题/单位行）
2. 识别每张表的实体列（id）和时间列（year）
3. 区分长表/宽表（年份是列名 vs 年份是行值）
4. 识别静态表（只有 id 没有 year）
5. 推断每张表的合并角色，生成统一到 (id, year) 的方案
"""
from __future__ import annotations
import re
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


# ─────────────────────────────────────────────────────────────────────────────
# 字段名启发式
# ─────────────────────────────────────────────────────────────────────────────

ID_KEYWORDS = [
    # 公司/股票
    "stkcd", "stock", "ticker", "symbol", "secucode", "secucd", "secid",
    "证券代码", "股票代码", "公司代码", "上市公司代码", "wind代码",
    # 通用 id
    "code", "_id", "id", "证券", "公司", "company",
    # 银行/机构
    "bank", "bank_id", "bank_code", "机构代码", "金融机构代码", "银行代码",
    # 地区
    "province", "city", "region", "省份", "省", "地区", "城市",
    "country", "国家",
]

YEAR_KEYWORDS = [
    "year", "yr", "年份", "年度", "年", "report_year", "reportyear",
    "fiscal_year", "fy", "ann_year",
]

DATE_KEYWORDS = [
    "date", "datetime", "report_date", "reportdate", "publish_date",
    "ann_date", "公告日期", "报告日期", "披露日期", "日期", "时间",
]


def _norm(s: Any) -> str:
    return str(s).strip().lower().replace(" ", "")


def _looks_like_year(val: Any) -> bool:
    """判断单个值是否像年份。"""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return False
    try:
        x = int(float(val))
        return 1900 <= x <= 2100
    except (ValueError, TypeError):
        return False


def _column_is_year_like(s: pd.Series) -> bool:
    """整列是否像年份。"""
    s = s.dropna()
    if len(s) == 0:
        return False
    sample = s.head(50)
    matches = sum(1 for v in sample if _looks_like_year(v))
    return matches / len(sample) >= 0.8


def _column_name_is_year(name: Any) -> bool:
    """列名本身是不是年份。"""
    return _looks_like_year(name)


# ─────────────────────────────────────────────────────────────────────────────
# 表头偏移检测
# ─────────────────────────────────────────────────────────────────────────────

def detect_header_offset(df: pd.DataFrame, max_skip: int = 5) -> int:
    """
    判断前几行是不是说明性的表头（中文标题、单位行）。
    返回应跳过的行数。
    """
    if len(df) <= 2:
        return 0

    # 当前列名都是 "Unnamed: x" → 真表头肯定在数据里
    cur_unnamed = sum(1 for c in df.columns if str(c).startswith("Unnamed"))
    cur_unnamed_ratio = cur_unnamed / max(1, len(df.columns))

    best_skip = 0
    best_score = _score_as_header(df.columns, df.iloc[: min(20, len(df))])

    for skip in range(1, max_skip + 1):
        if skip >= len(df):
            break
        candidate_header = df.iloc[skip - 1].tolist()
        candidate_data = df.iloc[skip:].head(20)
        score = _score_as_header(candidate_header, candidate_data)
        if score > best_score + 0.05:  # 必须显著更好
            best_score = score
            best_skip = skip

    # Unnamed 多 → 倾向于跳过
    if cur_unnamed_ratio > 0.5 and best_skip == 0:
        return 1

    # 即便表头没问题，也要检测：前几行数据是不是"垃圾说明行"
    # （列名已经合理，但数据前 1-2 行是空/单位/说明）
    if best_skip == 0:
        garbage_rows = _detect_garbage_data_rows(df, max_check=3)
        if garbage_rows > 0:
            return garbage_rows

    return best_skip


def _detect_garbage_data_rows(df: pd.DataFrame, max_check: int = 3) -> int:
    """
    在表头已合理的情况下，检测数据头部是否有"说明行/单位行/空行"。
    返回应当从顶部丢弃的数据行数（注意：drop_rows where='top' 行为是
    『把第 n 行当新表头』，所以这里返回 0 表示不动；返回 N 表示
    需要把第 N+1 行当新表头并丢前 N 行）。
    判断：某一行的所有非空值都是空字符串/纯文本/在数值列的位置出现非数字。
    """
    if len(df) <= 1:
        return 0
    n_check = min(max_check, len(df) - 1)

    # 数据后段判断每列的真实类型
    tail = df.iloc[max_check:].head(50) if len(df) > max_check + 1 else df.tail(max(1, len(df) - 1))
    numeric_cols = []
    for c in df.columns:
        s = tail[c].dropna()
        if len(s) == 0:
            continue
        try:
            pd.to_numeric(s.astype(str).str.replace(",", ""), errors="raise")
            numeric_cols.append(c)
        except Exception:
            pass

    if not numeric_cols:
        return 0

    bad_rows = 0
    for i in range(n_check):
        row = df.iloc[i]
        bad_in_num_cols = 0
        for c in numeric_cols:
            val = row[c]
            if pd.isna(val):
                bad_in_num_cols += 1
                continue
            sval = str(val).strip()
            if sval == "":
                bad_in_num_cols += 1
                continue
            try:
                float(sval.replace(",", ""))
            except (ValueError, TypeError):
                bad_in_num_cols += 1
        # 如果数值列有 >70% 出现空/非数字 → 这是垃圾行
        if bad_in_num_cols / max(1, len(numeric_cols)) > 0.7:
            bad_rows = i + 1
        else:
            break
    return bad_rows


def _score_as_header(header: List[Any], data: pd.DataFrame) -> float:
    """对一组候选表头打分。"""
    if len(header) == 0:
        return 0.0
    score = 0.0
    # 唯一性
    str_header = [str(h).strip() for h in header]
    if len(set(str_header)) == len(str_header):
        score += 0.3
    # 不是空 / Unnamed
    valid = sum(1 for h in str_header if h and not h.startswith("Unnamed") and h.lower() != "nan")
    score += 0.4 * valid / len(header)
    # 不是纯数字（数字通常是数据，不是列名）
    non_numeric = sum(1 for h in str_header if not _looks_like_year(h) and not _is_pure_number(h))
    score += 0.2 * non_numeric / len(header)
    # 数据行数值列占比
    if len(data) > 0:
        num_cols = 0
        for c in data.columns:
            try:
                pd.to_numeric(data[c], errors="raise")
                num_cols += 1
            except Exception:
                pass
        score += 0.1 * num_cols / max(1, len(data.columns))
    return score


def _is_pure_number(s: str) -> bool:
    try:
        float(s)
        return True
    except (ValueError, TypeError):
        return False


def reapply_header(df: pd.DataFrame, skip: int) -> pd.DataFrame:
    """按检测到的偏移重新应用表头。"""
    if skip <= 0:
        return df.copy()
    new_header = df.iloc[skip - 1].tolist()
    new_df = df.iloc[skip:].copy()
    new_df.columns = [str(c).strip() if pd.notna(c) else f"col_{i}"
                      for i, c in enumerate(new_header)]
    new_df = new_df.reset_index(drop=True)
    return new_df


# ─────────────────────────────────────────────────────────────────────────────
# 列角色识别
# ─────────────────────────────────────────────────────────────────────────────

def _get_col(df: pd.DataFrame, col: Any) -> pd.Series:
    """安全取列，同名列取第一个。"""
    s = df[col]
    if isinstance(s, pd.DataFrame):
        s = s.iloc[:, 0]
    return s


def identify_id_column(df: pd.DataFrame) -> Optional[str]:
    """识别实体列。返回列名，没找到返回 None。"""
    candidates: List[Tuple[str, float]] = []
    seen = set()
    for col in df.columns:
        if col in seen:
            continue
        seen.add(col)
        col_str = _norm(col)
        score = 0.0
        # 名字命中
        for kw in ID_KEYWORDS:
            if kw in col_str:
                score += 1.0
                break
        # 唯一性高（实体列通常重复但不全唯一，每个 id 出现多次）
        try:
            s_full = _get_col(df, col)
            s = s_full.dropna()
            if len(s) > 0:
                uniq_ratio = float(s.nunique()) / float(len(s))
                if uniq_ratio > 0.001:
                    score += 0.3
                if uniq_ratio < 0.001:
                    score -= 1.0
            # 不应该是年份
            if _column_is_year_like(s_full):
                score -= 1.5
            # 字符串列加分
            if s_full.dtype == object:
                score += 0.2
        except Exception:
            pass
        if score > 0.5:
            candidates.append((col, score))

    if not candidates:
        return None
    candidates.sort(key=lambda x: -x[1])
    return candidates[0][0]


def identify_year_column(df: pd.DataFrame) -> Optional[str]:
    """识别年份列。"""
    candidates: List[Tuple[str, float]] = []
    seen = set()
    for col in df.columns:
        if col in seen:
            continue
        seen.add(col)
        col_str = _norm(col)
        score = 0.0
        for kw in YEAR_KEYWORDS:
            if kw == col_str or col_str.endswith(kw):
                score += 2.0
                break
        try:
            if _column_is_year_like(_get_col(df, col)):
                score += 1.5
        except Exception:
            pass
        if score > 0:
            candidates.append((col, score))
    if not candidates:
        return None
    candidates.sort(key=lambda x: -x[1])
    return candidates[0][0]


def identify_date_column(df: pd.DataFrame) -> Optional[str]:
    """识别日期列（可从中提取年份）。"""
    seen = set()
    for col in df.columns:
        if col in seen:
            continue
        seen.add(col)
        col_str = _norm(col)
        for kw in DATE_KEYWORDS:
            if kw in col_str:
                try:
                    s = _get_col(df, col).dropna().head(20)
                    parsed = pd.to_datetime(s, errors="coerce")
                    if parsed.notna().sum() / max(1, len(s)) > 0.5:
                        return col
                except Exception:
                    pass
    # fallback: 任何能解析为日期的列
    seen.clear()
    for col in df.columns:
        if col in seen:
            continue
        seen.add(col)
        try:
            s_full = _get_col(df, col)
            if s_full.dtype == object:
                s = s_full.dropna().head(20)
                parsed = pd.to_datetime(s, errors="coerce")
                if parsed.notna().sum() / max(1, len(s)) > 0.7:
                    return col
        except Exception:
            pass
    return None


def detect_year_columns_in_header(df: pd.DataFrame) -> List[str]:
    """检测列名本身是年份的（宽表）。返回这些列名。"""
    return [c for c in df.columns if _column_name_is_year(c)]


# ─────────────────────────────────────────────────────────────────────────────
# 综合方案推断
# ─────────────────────────────────────────────────────────────────────────────

def analyze_table(df_raw: pd.DataFrame, name: str) -> Dict[str, Any]:
    """
    分析单张表，返回方案。
    """
    # 首先检查：原始列名里是不是年份（宽表场景）——这个决定了后续处理逻辑
    raw_year_cols = detect_year_columns_in_header(df_raw)

    if raw_year_cols and len(raw_year_cols) >= 2:
        # 宽表：列名已是年份。检测数据头部是否有垃圾行，但列名不变。
        skip = _detect_garbage_data_rows(df_raw, max_check=5)
        skip_mode = "drop"
        if skip > 0:
            df = df_raw.iloc[skip:].reset_index(drop=True)
        else:
            df = df_raw.copy()
        year_cols_in_header = raw_year_cols
    else:
        # 长表场景：先尝试原表头是否合理，只要丢几行垃圾
        garbage = _detect_garbage_data_rows(df_raw, max_check=5)
        if garbage > 0:
            # 原表头合理，只需要丢前 garbage 行
            skip = garbage
            skip_mode = "drop"
            df = df_raw.iloc[garbage:].reset_index(drop=True)
        else:
            # 原表头不太行，走 reheader 逻辑
            skip = detect_header_offset(df_raw)
            skip_mode = "reheader"
            df = reapply_header(df_raw, skip) if skip > 0 else df_raw.copy()
        year_cols_in_header = detect_year_columns_in_header(df)

    # 识别
    id_col = identify_id_column(df)
    year_col = identify_year_column(df)
    date_col = identify_date_column(df) if not year_col else None

    # 推断形态
    if year_cols_in_header and len(year_cols_in_header) >= 2:
        shape = "wide"
    elif year_col or date_col:
        shape = "long"
    else:
        shape = "static"

    # 检测看起来是数字的字符串列
    numeric_string_cols: List[str] = []
    seen_cols = set()
    for c in df.columns:
        if c in seen_cols:
            continue
        seen_cols.add(c)
        if c == id_col or c in year_cols_in_header:
            continue
        col_data = _get_col(df, c)
        if col_data.dtype == object:
            s = col_data.dropna().head(30).astype(str).str.strip()
            if len(s) == 0:
                continue
            ok = 0
            for v in s:
                try:
                    if v in ("", "NA", "N/A", "--", "-"):
                        continue
                    float(v.replace(",", ""))
                    ok += 1
                except Exception:
                    pass
            if ok / max(1, len(s)) > 0.7:
                numeric_string_cols.append(c)

    # 值列（用于宽转长 & 后续 merge 带过去的指标列）
    if shape == "wide":
        value_cols = year_cols_in_header
    else:
        exclude = {id_col, year_col, date_col} - {None}
        value_cols = [c for c in df.columns if c not in exclude]

    # 建议的值列名（中文友好）
    base = name.split("::")[-1].split(".")[0]
    base = re.sub(r"[\s\-\.]+", "_", base)[:20]
    suggested_value_name = f"{base}_value" if shape == "wide" else None

    issues = []
    if id_col is None and shape != "wide":
        issues.append("未能自动识别实体列（id），请手动指定")
    if shape == "wide" and id_col is None:
        # 宽表中除了年份列，剩下应该有 id
        non_year = [c for c in df.columns if c not in year_cols_in_header]
        if non_year:
            id_col = non_year[0]  # 第一非年份列大概率是 id
            issues.append(f"宽表场景：自动选取 '{id_col}' 作为实体列，可调整")

    return {
        "name": name,
        "header_skip": skip,
        "header_skip_mode": skip_mode,
        "original_cols": list(df_raw.columns),
        "after_header_cols": list(df.columns),
        "shape": shape,
        "id_col": id_col,
        "year_col": year_col,
        "date_col": date_col,
        "year_cols_in_header": year_cols_in_header,
        "value_cols": value_cols,
        "numeric_string_cols": numeric_string_cols,
        "suggested_value_name": suggested_value_name,
        "issues": issues,
        "preview_rows": int(len(df)),
    }


def build_merge_plan(
    table_analyses: List[Dict[str, Any]],
    id_alias: str = "id",
    year_alias: str = "year",
) -> Dict[str, Any]:
    """
    根据每张表的分析结果，生成统一到 (id, year) 长面板的合并方案。
    每张表的 step 列表是该表会执行的清洗操作序列。
    """
    plan_tables: List[Dict[str, Any]] = []
    for ta in table_analyses:
        steps: List[Dict[str, Any]] = []
        if ta["header_skip"] > 0:
            mode = ta.get("header_skip_mode", "reheader")
            note = (f"删除前 {ta['header_skip']} 行（说明/单位行）"
                    if mode == "drop"
                    else f"以第 {ta['header_skip']} 行为新表头，丢弃之前的行")
            steps.append({
                "op": "drop_rows",
                "n": ta["header_skip"],
                "where": "top",
                "mode": mode,
                "note": note,
            })
        # 重命名 id 列到统一
        rename_map: Dict[str, str] = {}
        if ta["id_col"] and ta["id_col"] != id_alias:
            rename_map[ta["id_col"]] = id_alias
        if ta["year_col"] and ta["year_col"] != year_alias:
            rename_map[ta["year_col"]] = year_alias
        if rename_map:
            steps.append({
                "op": "rename",
                "mapping": rename_map,
                "note": f"统一主键列名 → {id_alias}/{year_alias}",
            })

        # 字符串数值列转换
        if ta["numeric_string_cols"]:
            steps.append({
                "op": "to_numeric",
                "columns": ta["numeric_string_cols"],
                "scale": 1.0,
                "note": f"将 {len(ta['numeric_string_cols'])} 列字符串转为数值",
            })

        # 形态处理
        if ta["shape"] == "wide":
            # unpivot 年份列
            steps.append({
                "op": "wide_to_long",
                "id_vars": [id_alias] if ta["id_col"] else [c for c in ta["after_header_cols"]
                                                            if c not in ta["year_cols_in_header"]],
                "value_vars": ta["year_cols_in_header"],
                "var_name": year_alias,
                "value_name": ta["suggested_value_name"] or "value",
                "var_numeric": True,
                "dropna": False,
                "note": f"宽转长：{len(ta['year_cols_in_header'])} 个年份列展开",
            })
        elif ta["shape"] == "long":
            if ta["date_col"] and not ta["year_col"]:
                steps.append({
                    "op": "extract_year",
                    "source": ta["date_col"],
                    "output": year_alias,
                    "note": f"从日期列 '{ta['date_col']}' 提取年份",
                })
        elif ta["shape"] == "static":
            # 静态表暂不在此处展开；合并时按 id 合，再后续广播
            pass

        plan_tables.append({
            "name": ta["name"],
            "shape": ta["shape"],
            "steps": steps,
            "merge_role": _decide_merge_role(ta),
            "issues": ta["issues"],
        })

    # 合并顺序：长表/宽表先互相合并 → 静态表最后广播
    panel_tables = [p for p in plan_tables if p["merge_role"] == "panel"]
    static_tables = [p for p in plan_tables if p["merge_role"] == "static"]

    return {
        "tables": plan_tables,
        "id_alias": id_alias,
        "year_alias": year_alias,
        "merge_strategy": {
            "panel_tables": [p["name"] for p in panel_tables],
            "static_tables": [p["name"] for p in static_tables],
            "panel_join_keys": [id_alias, year_alias],
            "static_join_keys": [id_alias],
            "how": "outer",
            "note": "面板表先按 (id,year) outer 合并；静态表（只有 id）按 id 广播到全部年份。",
        },
    }


def _decide_merge_role(ta: Dict[str, Any]) -> str:
    if ta["shape"] in ("long", "wide"):
        return "panel"
    return "static"


# ─────────────────────────────────────────────────────────────────────────────
# 执行
# ─────────────────────────────────────────────────────────────────────────────

def execute_steps(df_raw: pd.DataFrame, steps: List[Dict[str, Any]]) -> pd.DataFrame:
    """对一张表按 steps 顺序执行操作。"""
    df = df_raw.copy()
    for step in steps:
        op = step.get("op")
        if op == "drop_rows":
            n = int(step.get("n", 0))
            where = step.get("where", "top")
            mode = step.get("mode", "reheader")  # reheader | drop
            if n > 0 and len(df) > n:
                if where == "top" and mode == "reheader":
                    # 把第 n 行作为新表头
                    new_header = df.iloc[n - 1].tolist()
                    df = df.iloc[n:].copy()
                    df.columns = [str(c).strip() if pd.notna(c) else f"col_{i}"
                                  for i, c in enumerate(new_header)]
                    df = df.reset_index(drop=True)
                elif where == "top":
                    df = df.iloc[n:].reset_index(drop=True)
                else:
                    df = df.iloc[:-n].reset_index(drop=True)
        elif op == "rename":
            mapping = step.get("mapping", {})
            df = df.rename(columns=mapping)
        elif op == "to_numeric":
            cols = step.get("columns", [])
            scale = float(step.get("scale", 1.0))
            for c in cols:
                if c in df.columns:
                    df[c] = pd.to_numeric(
                        df[c].astype(str).str.replace(",", "").str.strip(),
                        errors="coerce",
                    )
                    if scale != 1.0:
                        df[c] = df[c] * scale
        elif op == "extract_year":
            src = step.get("source")
            out = step.get("output", "year")
            if src in df.columns:
                df[out] = pd.to_datetime(df[src], errors="coerce").dt.year
        elif op == "wide_to_long":
            id_vars = [c for c in step.get("id_vars", []) if c in df.columns]
            value_vars = [c for c in step.get("value_vars", []) if c in df.columns]
            var_name = step.get("var_name", "year")
            value_name = step.get("value_name", "value")
            var_numeric = step.get("var_numeric", True)
            dropna = step.get("dropna", False)
            if value_vars:
                df = df.melt(
                    id_vars=id_vars,
                    value_vars=value_vars,
                    var_name=var_name,
                    value_name=value_name,
                )
                if var_numeric:
                    df[var_name] = pd.to_numeric(df[var_name], errors="coerce")
                df[value_name] = pd.to_numeric(
                    df[value_name].astype(str).str.replace(",", "").str.strip(),
                    errors="coerce",
                )
                if dropna:
                    df = df.dropna(subset=[value_name]).reset_index(drop=True)
        elif op == "filter":
            col = step.get("column")
            cond = step.get("op_cmp", "==")
            val = step.get("value")
            if col in df.columns:
                # 数值化比较
                try:
                    s_num = pd.to_numeric(df[col], errors="coerce")
                    v_num = float(val)
                    if cond == "==":
                        df = df[s_num == v_num]
                    elif cond == "!=":
                        df = df[s_num != v_num]
                    elif cond == ">":
                        df = df[s_num > v_num]
                    elif cond == "<":
                        df = df[s_num < v_num]
                    elif cond == ">=":
                        df = df[s_num >= v_num]
                    elif cond == "<=":
                        df = df[s_num <= v_num]
                except Exception:
                    if cond == "==":
                        df = df[df[col].astype(str) == str(val)]
                    elif cond == "!=":
                        df = df[df[col].astype(str) != str(val)]
                df = df.reset_index(drop=True)
        elif op == "keep_columns":
            cols = [c for c in step.get("columns", []) if c in df.columns]
            if cols:
                df = df[cols]
    return df


def execute_plan(
    raw_dfs: Dict[str, pd.DataFrame],
    plan: Dict[str, Any],
    static_broadcast: bool = True,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    根据 plan 执行：每张表先做 steps，再按角色合并。
    raw_dfs: {table_name: DataFrame}
    返回 (merged_df, report)
    """
    report: Dict[str, Any] = {"per_table": [], "merge_log": []}
    id_alias = plan["id_alias"]
    year_alias = plan["year_alias"]

    cleaned: Dict[str, pd.DataFrame] = {}
    for t in plan["tables"]:
        nm = t["name"]
        if nm not in raw_dfs:
            report["per_table"].append({"name": nm, "error": "原始数据缺失"})
            continue
        try:
            df = execute_steps(raw_dfs[nm], t["steps"])
            cleaned[nm] = df
            report["per_table"].append({
                "name": nm, "rows": int(len(df)),
                "cols": list(df.columns),
                "role": t["merge_role"],
            })
        except Exception as e:
            report["per_table"].append({"name": nm, "error": str(e)})

    panel_names = plan["merge_strategy"]["panel_tables"]
    static_names = plan["merge_strategy"]["static_tables"]
    how = plan["merge_strategy"].get("how", "outer")

    # 合并面板表
    merged: Optional[pd.DataFrame] = None
    for nm in panel_names:
        if nm not in cleaned:
            continue
        df = cleaned[nm]
        if id_alias not in df.columns or year_alias not in df.columns:
            report["merge_log"].append(f"跳过 {nm}：缺少 {id_alias} 或 {year_alias}")
            continue
        # 主键转字符串/数字统一
        df[id_alias] = df[id_alias].astype(str).str.strip()
        df[year_alias] = pd.to_numeric(df[year_alias], errors="coerce").astype("Int64")
        df = df.dropna(subset=[id_alias, year_alias])
        if merged is None:
            merged = df
            report["merge_log"].append(f"基础表：{nm}（{len(df)} 行）")
        else:
            before = len(merged)
            merged = merged.merge(df, on=[id_alias, year_alias], how=how, suffixes=("", f"_{nm[:6]}"))
            # 删除冲突重复列
            dup_cols = [c for c in merged.columns if c.endswith(f"_{nm[:6]}")]
            for dc in dup_cols:
                base = dc[: -len(f"_{nm[:6]}")]
                if base in merged.columns:
                    merged[base] = merged[base].combine_first(merged[dc])
                    merged = merged.drop(columns=[dc])
            report["merge_log"].append(f"合并 {nm}：{before} → {len(merged)} 行")

    # 合并静态表（按 id 广播）
    if merged is not None and static_broadcast:
        for nm in static_names:
            if nm not in cleaned:
                continue
            df = cleaned[nm]
            if id_alias not in df.columns:
                report["merge_log"].append(f"跳过静态表 {nm}：缺少 {id_alias}")
                continue
            df[id_alias] = df[id_alias].astype(str).str.strip()
            # 静态表按 id 去重，保留第一条
            df = df.drop_duplicates(subset=[id_alias], keep="first")
            before_cols = len(merged.columns)
            merged = merged.merge(df, on=[id_alias], how="left", suffixes=("", f"_{nm[:6]}"))
            report["merge_log"].append(
                f"广播静态表 {nm}：新增 {len(merged.columns) - before_cols} 列"
            )

    if merged is None:
        # 所有表都是静态？合并为单表
        if static_names:
            merged = cleaned[static_names[0]].copy()
            for nm in static_names[1:]:
                if nm in cleaned:
                    merged = merged.merge(cleaned[nm], on=id_alias, how="outer")
            report["merge_log"].append("仅静态表合并（无时间维度）")
        else:
            raise ValueError("没有可合并的数据")

    # 缺失值统计
    missing_summary = {
        c: int(merged[c].isna().sum()) for c in merged.columns
    }
    report["missing_per_col"] = missing_summary
    report["final_rows"] = int(len(merged))
    report["final_cols"] = list(merged.columns)

    # 排序
    if year_alias in merged.columns:
        merged = merged.sort_values([id_alias, year_alias]).reset_index(drop=True)

    return merged, report
