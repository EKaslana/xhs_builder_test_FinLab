"""
金融实证研究模板库。

参考来源：
- 人大经济论坛《1990-2024年实证论文常用控制变量》https://bbs.pinggu.org/thread-15729004-1-1.html
- 连享会《聚类标准误的纠结》《Stata：调节中介效应检验》https://www.lianxh.cn
- 经济学实证研究结构（hanspub, 2020）

提供：
1. 控制变量公式库 VAR_FORMULAS
2. 样本筛选规则库 SAMPLE_FILTERS
3. 实证设计模板库 RESEARCH_TEMPLATES（DID / Mediation / Baseline / EventStudy）
4. 一键应用模板：apply_variable_constructions / apply_sample_filters
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
import pandas as pd
import numpy as np


# ─────────────────────────────────────────────────────────────────────────────
# 1. 标准控制变量公式库（中文实证论文最常用 ~30 个）
# ─────────────────────────────────────────────────────────────────────────────
# 每个条目：
#   key: 变量缩写
#   inputs: 需要的源列名（候选名列表，自动匹配）
#   formula: 计算函数 (df) -> Series
#   label / category / explain
VAR_FORMULAS: List[Dict[str, Any]] = [
    # 规模与杠杆
    {
        "key": "Size",
        "label": "公司规模",
        "category": "规模",
        "inputs": ["年末总资产", "总资产", "TotalAsset", "total_asset", "Asset"],
        "formula": "ln(总资产)",
        "explain": "对总资产取自然对数，用于控制规模效应。最常用的控制变量之一。",
    },
    {
        "key": "Size_rev",
        "label": "公司规模（营收口径）",
        "category": "规模",
        "inputs": ["营业收入", "Revenue", "Sales"],
        "formula": "ln(营业收入)",
        "explain": "营收口径的规模度量，与 Size 互为稳健性替代。",
    },
    {
        "key": "Lev",
        "label": "资产负债率",
        "category": "杠杆",
        "inputs": ["年末总负债", "总负债", "TotalLiability", "Liability"],
        "inputs2": ["年末总资产", "总资产", "TotalAsset"],
        "formula": "总负债 / 总资产",
        "explain": "财务杠杆，反映公司债务融资比例。",
    },
    # 盈利能力
    {
        "key": "ROA",
        "label": "总资产收益率",
        "category": "盈利",
        "inputs": ["净利润", "NetProfit", "NI"],
        "inputs2": ["年末总资产", "总资产", "TotalAsset"],
        "formula": "净利润 / 总资产",
        "explain": "衡量公司资产盈利能力。注意：标准做法是用平均资产，简化为期末资产也可。",
    },
    {
        "key": "ROE",
        "label": "净资产收益率",
        "category": "盈利",
        "inputs": ["净利润", "NetProfit"],
        "inputs2": ["股东权益", "所有者权益", "Equity"],
        "formula": "净利润 / 股东权益",
        "explain": "衡量股东资本的回报率。",
    },
    {
        "key": "Cashflow",
        "label": "经营性现金流",
        "category": "现金流",
        "inputs": ["经营活动现金流量净额", "经营现金流", "OCF"],
        "inputs2": ["年末总资产", "总资产", "TotalAsset"],
        "formula": "经营现金流 / 总资产",
        "explain": "标准化的经营现金流，控制公司现金创造能力。",
    },
    # 成长性
    {
        "key": "Growth",
        "label": "营业收入增长率",
        "category": "成长",
        "inputs": ["营业收入", "Revenue", "Sales"],
        "formula": "(本年营收 - 上年营收) / 上年营收",
        "needs_lag": True,
        "explain": "需要按 (id, year) 计算上一期。常作为成长性度量。",
    },
    # 公司年龄
    {
        "key": "ListAge",
        "label": "上市年限",
        "category": "年龄",
        "inputs": ["上市年份", "ListYear"],
        "inputs2": ["year", "Year", "年份"],
        "formula": "ln(当年 - 上市年份 + 1)",
        "explain": "控制公司处在上市生命周期的不同阶段。",
    },
    # 估值
    {
        "key": "TobinQ",
        "label": "托宾Q",
        "category": "估值",
        "inputs": ["总市值", "MarketValue", "MV"],
        "inputs2": ["年末总资产", "总资产", "TotalAsset"],
        "formula": "总市值 / 总资产（简化）",
        "explain": "托宾Q 简化版，公式：(流通市值+非流通股×每股净资产+负债)/总资产 时使用完整版。",
    },
    {
        "key": "BM",
        "label": "账面市值比",
        "category": "估值",
        "inputs": ["股东权益", "净资产", "Equity"],
        "inputs2": ["总市值", "MarketValue", "MV"],
        "formula": "净资产 / 总市值",
        "explain": "Fama-French 价值因子的核心度量。",
    },
    # 治理
    {
        "key": "Top1",
        "label": "第一大股东持股比例",
        "category": "治理",
        "inputs": ["第一大股东持股比例", "Top1Holding"],
        "formula": "直接使用",
        "passthrough": True,
        "explain": "股权集中度的核心度量，0-1 区间。",
    },
    {
        "key": "Indep",
        "label": "独立董事比例",
        "category": "治理",
        "inputs": ["独立董事人数"],
        "inputs2": ["董事人数", "董事会规模"],
        "formula": "独立董事 / 董事总数",
        "explain": "公司治理变量，反映董事会独立性。",
    },
    {
        "key": "Dual",
        "label": "两职合一",
        "category": "治理",
        "inputs": ["董事长是否兼任总经理", "Dual"],
        "formula": "0/1 哑变量",
        "passthrough": True,
        "explain": "若董事长兼任总经理为 1，否则为 0。",
    },
    {
        "key": "Board",
        "label": "董事会规模",
        "category": "治理",
        "inputs": ["董事会人数", "董事人数"],
        "formula": "ln(董事会人数)",
        "explain": "对董事会人数取对数。",
    },
    {
        "key": "SOE",
        "label": "是否国企",
        "category": "产权",
        "inputs": ["产权性质", "实际控制人性质", "SOE"],
        "formula": "0/1 哑变量",
        "passthrough": True,
        "explain": "若实际控制人为国资为 1，民营/外资为 0。",
    },
    {
        "key": "Big4",
        "label": "是否四大",
        "category": "审计",
        "inputs": ["会计师事务所", "审计机构", "Big4"],
        "formula": "0/1 哑变量",
        "passthrough": True,
        "explain": "若聘请普华永道、德勤、安永、毕马威则为 1。",
    },
    # 现金持有
    {
        "key": "Cash",
        "label": "现金持有比例",
        "category": "流动性",
        "inputs": ["货币资金", "Cash"],
        "inputs2": ["年末总资产", "总资产"],
        "formula": "货币资金 / 总资产",
        "explain": "公司现金储备水平。",
    },
    # 固定资产
    {
        "key": "Fixed",
        "label": "固定资产占比",
        "category": "资产结构",
        "inputs": ["固定资产净额", "固定资产", "FixedAsset"],
        "inputs2": ["年末总资产", "总资产"],
        "formula": "固定资产 / 总资产",
        "explain": "资本密集度度量。",
    },
    # 是否亏损
    {
        "key": "Loss",
        "label": "是否亏损",
        "category": "盈利",
        "inputs": ["净利润", "NetProfit"],
        "formula": "净利润 < 0 取 1",
        "binary_neg": True,
        "explain": "二元变量：当年净利润为负为 1，否则为 0。",
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# 2. 标准样本筛选规则
# ─────────────────────────────────────────────────────────────────────────────
SAMPLE_FILTERS: List[Dict[str, Any]] = [
    {
        "key": "drop_financial",
        "label": "剔除金融业",
        "explain": "金融业（银行/证券/保险/信托）的资产负债结构与实体行业差异极大，研究公司金融决策时通常剔除。",
        "rule": "industry in [J, J66-J69] 或 行业代码以 J 开头",
    },
    {
        "key": "drop_st",
        "label": "剔除 ST/*ST/PT",
        "explain": "ST 公司财务异常，会污染样本。",
        "rule": "公司状态 == ST 或 *ST 或 PT 时剔除",
    },
    {
        "key": "drop_lev_outlier",
        "label": "剔除 资产负债率>1",
        "explain": "Lev > 1 表示资不抵债，通常视为异常值剔除。",
        "rule": "Lev <= 1",
    },
    {
        "key": "drop_pre_listing",
        "label": "剔除上市前数据",
        "explain": "上市前的财务数据未经审计，质量不可比。",
        "rule": "year >= 上市年份",
    },
    {
        "key": "drop_delisted",
        "label": "剔除已退市公司",
        "explain": "退市公司的最后几年数据通常异常。",
        "rule": "退市状态 == 0",
    },
    {
        "key": "winsorize_1_99",
        "label": "1%/99% 缩尾",
        "explain": "对所有连续变量在 1% 和 99% 分位数处缩尾，处理离群值。是论文绝对的标配。",
        "rule": "winsorize(p_low=0.01, p_high=0.99)",
    },
    {
        "key": "drop_missing_main",
        "label": "剔除主变量缺失",
        "explain": "主要变量（被解释/解释变量）缺失的样本无法进入回归。",
        "rule": "dropna(subset=[Y, X])",
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# 3. 实证设计模板
# ─────────────────────────────────────────────────────────────────────────────
RESEARCH_TEMPLATES: List[Dict[str, Any]] = [
    {
        "key": "baseline_panel",
        "label": "经典面板回归",
        "scenario": "研究 X 对 Y 的因果效应，已有面板数据。",
        "modules": ["数据清洗", "描述性统计", "相关性矩阵", "VIF", "基准回归（双向FE+公司聚类）", "异质性分析", "稳健性"],
        "model": "Y_it = α + β·X_it + γ·Controls_it + μ_i + λ_t + ε_it",
        "tips": [
            "标准做法：双向固定效应（公司+年份），公司层面聚类标准误。",
            "VIF 检查多重共线性：>10 警惕，>5 关注。",
            "稳健性：替换 Y 度量、子样本、滞后/前置 X、Heckman/PSM。",
        ],
        "references": [
            {"label": "聚类标准误指南", "url": "https://www.lianxh.cn/details/786.html"},
        ],
    },
    {
        "key": "did_classic",
        "label": "DID 双重差分（政策评估）",
        "scenario": "评估某项政策/事件对处理组的因果效应。",
        "modules": [
            "构造 Treat 与 Post",
            "基准 DID（Y = α + β1·Treat + β2·Post + β3·Treat×Post + 控制 + FE）",
            "平行趋势检验（事件研究法估计）",
            "安慰剂检验（虚构政策时间或处理组）",
            "PSM-DID",
            "异质性 / 机制",
        ],
        "model": "Y_it = α + β·Treat_i × Post_t + γ·Controls + μ_i + λ_t + ε_it",
        "tips": [
            "核心识别假设：平行趋势（处理组与对照组在政策前趋势一致）。",
            "如政策错时（多期 DID），考虑 Goodman-Bacon 分解或 Callaway-Sant'Anna 估计量。",
            "安慰剂方法：(a) 虚构时间提前 (b) 虚构处理组 (c) 替换 Y 为不应受影响的变量。",
        ],
        "references": [
            {"label": "DID 平行趋势及安慰剂检验", "url": "https://bbs.pinggu.org/thread-11211646-1-1.html"},
        ],
    },
    {
        "key": "mediation",
        "label": "中介效应（机制分析）",
        "scenario": "研究 X 通过中介 M 影响 Y 的传导渠道。",
        "modules": [
            "Step1：Y = c·X + 控制（总效应）",
            "Step2：M = a·X + 控制（X→M）",
            "Step3：Y = c'·X + b·M + 控制（控制 M 后 X→Y）",
            "Bootstrap 置信区间检验 a×b",
        ],
        "model": "三步法 + Bootstrap (a*b 的 95% CI 不含 0)",
        "tips": [
            "三步法：c 显著 → a、b 都显著则中介存在。c 不显著也可继续做（遮掩效应）。",
            "现代做法首选 Bootstrap：1000-5000 次抽样，看 a*b 的 95% CI 是否含 0。",
            "区分完全中介（c' 不显著）vs 部分中介（c' 仍显著）。",
        ],
        "references": [
            {"label": "中介效应检验原理（人大经济论坛）", "url": "https://bbs.pinggu.org/thread-10722705-1-1.html"},
        ],
    },
    {
        "key": "moderation",
        "label": "调节效应（异质性）",
        "scenario": "研究 Z 如何影响 X 对 Y 的作用强度。",
        "modules": [
            "中心化 X 与 Z（去均值）",
            "构造交乘项 X×Z",
            "回归 Y = α + β1·X + β2·Z + β3·X×Z + 控制",
            "若 β3 显著则存在调节",
            "进一步分组回归（Z 高 vs Z 低）",
        ],
        "model": "Y = α + β1·X + β2·Z + β3·(X×Z) + γ·Controls + ε",
        "tips": [
            "中心化能减轻多重共线性，但不改变 β3 的显著性。",
            "对二元 Z 通常直接分组回归更直观。",
            "经济意义：β3 的符号说明调节方向（增强/削弱）。",
        ],
    },
    {
        "key": "event_study",
        "label": "事件研究法（短期市场反应）",
        "scenario": "研究某事件（财报披露、政策、并购等）对股价的短期影响。",
        "modules": [
            "确定事件日 t=0",
            "估计窗口（如 [-200, -30]）拟合市场模型",
            "事件窗口（如 [-5, +5]）计算异常收益 AR",
            "累积异常收益 CAR、平均异常收益 AAR",
            "t 检验或符号检验异常收益是否显著",
        ],
        "model": "AR_it = R_it - (α_i + β_i·R_mt)；CAR_i = ΣAR_it",
        "tips": [
            "估计窗口与事件窗口不能重叠。",
            "市场模型要求至少 60-100 个交易日的估计样本。",
            "中国 A 股有涨跌停板，需用更长窗口（[-5, +5] 或 [-10, +10]）。",
        ],
        "references": [
            {"label": "事件研究法教程", "url": "https://www.lianxh.cn/news/90de95e42e8ff.html"},
        ],
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# 4. 应用工具函数
# ─────────────────────────────────────────────────────────────────────────────

def _find_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    """在 df 列里找候选名（不区分大小写、中英文匹配）。"""
    cols_lower = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        if cand in df.columns:
            return cand
        if cand.lower() in cols_lower:
            return cols_lower[cand.lower()]
    # 部分包含
    for cand in candidates:
        for col_lower, original in cols_lower.items():
            if cand.lower() in col_lower:
                return original
    return None


def construct_variable(df: pd.DataFrame, var_key: str,
                       overrides: Optional[Dict[str, str]] = None,
                       id_col: str = "id", year_col: str = "year") -> Dict[str, Any]:
    """
    构造一个变量。返回 {success, message, df_with_var}。
    overrides: {"input": "实际列名", "input2": "实际列名"}
    """
    spec = next((v for v in VAR_FORMULAS if v["key"] == var_key), None)
    if spec is None:
        return {"success": False, "message": f"未知变量：{var_key}"}

    overrides = overrides or {}
    out = df.copy()
    key = spec["key"]

    # 找输入列
    in1 = overrides.get("input") or _find_col(df, spec["inputs"])
    in2 = overrides.get("input2") or (_find_col(df, spec.get("inputs2", [])) if spec.get("inputs2") else None)

    if in1 is None:
        return {"success": False, "message": f"找不到 {key} 的源列：{spec['inputs']}"}

    # 转数值
    s1 = pd.to_numeric(out[in1].astype(str).str.replace(",", ""), errors="coerce")
    s2 = pd.to_numeric(out[in2].astype(str).str.replace(",", ""), errors="coerce") if in2 else None

    # 构造
    if spec.get("passthrough"):
        out[key] = s1
    elif spec.get("binary_neg"):
        out[key] = (s1 < 0).astype(int)
    elif key == "Size":
        out[key] = np.log(s1.where(s1 > 0))
    elif key == "Size_rev":
        out[key] = np.log(s1.where(s1 > 0))
    elif key == "Lev":
        out[key] = s1 / s2.replace(0, np.nan)
    elif key == "ROA":
        out[key] = s1 / s2.replace(0, np.nan)
    elif key == "ROE":
        out[key] = s1 / s2.replace(0, np.nan)
    elif key == "Cashflow":
        out[key] = s1 / s2.replace(0, np.nan)
    elif key == "Cash":
        out[key] = s1 / s2.replace(0, np.nan)
    elif key == "Fixed":
        out[key] = s1 / s2.replace(0, np.nan)
    elif key == "TobinQ":
        out[key] = s1 / s2.replace(0, np.nan)
    elif key == "BM":
        out[key] = s1 / s2.replace(0, np.nan)
    elif key == "Indep":
        out[key] = s1 / s2.replace(0, np.nan)
    elif key == "Board":
        out[key] = np.log(s1.where(s1 > 0))
    elif key == "ListAge":
        # in1 = 上市年份, in2 = 当年年份
        if s2 is None:
            return {"success": False, "message": "ListAge 需要 year 列"}
        out[key] = np.log((s2 - s1 + 1).where((s2 - s1 + 1) > 0))
    elif key == "Growth":
        # 需要按 id 排序计算 lag
        if id_col not in out.columns or year_col not in out.columns:
            return {"success": False, "message": f"Growth 需要 {id_col} 和 {year_col} 列"}
        out_sorted = out.sort_values([id_col, year_col]).copy()
        prev = out_sorted.groupby(id_col)[in1].shift(1)
        prev = pd.to_numeric(prev.astype(str).str.replace(",", ""), errors="coerce")
        out_sorted[key] = (s1.loc[out_sorted.index] - prev) / prev.replace(0, np.nan)
        out = out_sorted.sort_index()
    else:
        return {"success": False, "message": f"未实现 {key} 的计算"}

    n_valid = int(out[key].notna().sum())
    n_total = len(out)
    return {
        "success": True,
        "message": f"已生成 {key}（有效值 {n_valid}/{n_total}）",
        "df": out,
        "var": key,
        "label": spec["label"],
        "formula": spec["formula"],
    }


def winsorize_columns(df: pd.DataFrame, cols: List[str],
                      p_low: float = 0.01, p_high: float = 0.99) -> pd.DataFrame:
    """对指定列做 1%/99% 缩尾。"""
    out = df.copy()
    for c in cols:
        if c not in out.columns:
            continue
        s = pd.to_numeric(out[c], errors="coerce")
        lo, hi = s.quantile(p_low), s.quantile(p_high)
        out[c] = s.clip(lower=lo, upper=hi)
    return out


def get_template_index() -> Dict[str, Any]:
    """返回所有模板的索引（前端用）。"""
    return {
        "variables": [
            {
                "key": v["key"], "label": v["label"], "category": v["category"],
                "formula": v["formula"], "explain": v["explain"],
                "needs_lag": v.get("needs_lag", False),
                "inputs": v.get("inputs", []),
                "inputs2": v.get("inputs2"),
            }
            for v in VAR_FORMULAS
        ],
        "filters": SAMPLE_FILTERS,
        "research_templates": RESEARCH_TEMPLATES,
    }
