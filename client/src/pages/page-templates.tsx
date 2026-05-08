import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  BookMarked,
  Calculator,
  Filter,
  Workflow,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { TeachButton } from "@/components/teach";
import { DatasetBar } from "@/components/dataset-bar";
import { DataPreview } from "@/components/data-preview";
import { VarMultiPicker } from "@/components/var-picker";
import { pyPost } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";

type VarFormula = {
  key: string;
  label: string;
  category: string;
  inputs: string[];
  inputs2?: string[];
  formula: string;
  explain: string;
  needs_lag?: boolean;
};

type FilterRule = {
  key: string;
  label: string;
  scope: string;
  rule: string;
  explain: string;
};

type ResearchTpl = {
  key: string;
  name: string;
  scenario: string;
  modules: string[];
  model: string;
  tips: string[];
  references?: string[];
};

type TemplateIndex = {
  variables: VarFormula[];
  filters: FilterRule[];
  research_templates: ResearchTpl[];
};

type Tab = "vars" | "filters" | "designs";

export function PageTemplates() {
  const { datasets, activeId, refresh } = useStore();
  const { toast } = useToast();
  const ds = datasets.find((d) => d.id === activeId);

  const [tab, setTab] = useState<Tab>("vars");
  const [tpl, setTpl] = useState<TemplateIndex | null>(null);
  const [loading, setLoading] = useState(true);

  // 变量构造状态
  const [selVars, setSelVars] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<
    Record<string, { input?: string; input2?: string }>
  >({});
  const [idCol, setIdCol] = useState("id");
  const [yearCol, setYearCol] = useState("year");
  const [outName, setOutName] = useState("with_vars");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<any[] | null>(null);

  // 缩尾状态
  const [winCols, setWinCols] = useState<string[]>([]);
  const [pLow, setPLow] = useState(0.01);
  const [pHigh, setPHigh] = useState(0.99);
  const [winName, setWinName] = useState("winsorized");
  const [winRunning, setWinRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiRequest("GET", "/api/py/templates");
        setTpl(await r.json());
      } catch (e: any) {
        toast({ title: "模板加载失败", description: e?.message || "", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  // 自动猜测 id / year 列
  useEffect(() => {
    if (!ds) return;
    const cols = ds.cols || [];
    const guessId = cols.find((c) =>
      ["id", "stkcd", "stockcode", "code", "证券代码", "股票代码", "公司代码"].includes(
        c.toLowerCase()
      )
    );
    const guessYear = cols.find((c) => ["year", "年份", "年度"].includes(c.toLowerCase()));
    if (guessId) setIdCol(guessId);
    if (guessYear) setYearCol(guessYear);
  }, [ds?.id]);

  // 自动猜测每个变量的 input 列
  useEffect(() => {
    if (!ds || !tpl) return;
    const cols = ds.cols || [];
    const next: typeof overrides = { ...overrides };
    selVars.forEach((vk) => {
      const v = tpl.variables.find((x) => x.key === vk);
      if (!v) return;
      if (!next[vk]) next[vk] = {};
      if (!next[vk].input) {
        const hit = v.inputs.find((cand) =>
          cols.some((c) => c.toLowerCase() === cand.toLowerCase() || c.includes(cand))
        );
        if (hit) {
          const real = cols.find(
            (c) => c.toLowerCase() === hit.toLowerCase() || c.includes(hit)
          );
          if (real) next[vk].input = real;
        }
      }
      if (v.inputs2 && !next[vk].input2) {
        const hit = v.inputs2.find((cand) =>
          cols.some((c) => c.toLowerCase() === cand.toLowerCase() || c.includes(cand))
        );
        if (hit) {
          const real = cols.find(
            (c) => c.toLowerCase() === hit.toLowerCase() || c.includes(hit)
          );
          if (real) next[vk].input2 = real;
        }
      }
    });
    setOverrides(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selVars, ds?.id, tpl]);

  const varsByCategory = useMemo(() => {
    if (!tpl) return {};
    const out: Record<string, VarFormula[]> = {};
    for (const v of tpl.variables) {
      (out[v.category] ||= []).push(v);
    }
    return out;
  }, [tpl]);

  const numericColsForWin = useMemo(() => ds?.cols || [], [ds]);

  const runConstruct = async () => {
    if (!ds) return;
    if (selVars.length === 0) {
      toast({ title: "请先选择变量" });
      return;
    }
    setRunning(true);
    setLog(null);
    try {
      const res = await pyPost<any>("construct_variables", {
        dataset: ds.id,
        variables: selVars,
        overrides,
        name: outName,
        id_col: idCol,
        year_col: yearCol,
      });
      setLog(res.log || []);
      await refresh();
      const okN = (res.log || []).filter((x: any) => x.success).length;
      toast({
        title: `已生成 ${okN}/${selVars.length} 个变量`,
        description: `新数据集：${outName}（${res.rows} 行）`,
      });
    } catch (e: any) {
      toast({ title: "构造失败", description: e?.message || "", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const runWinsorize = async () => {
    if (!ds) return;
    if (winCols.length === 0) {
      toast({ title: "请先选择需要缩尾的列" });
      return;
    }
    setWinRunning(true);
    try {
      const res = await pyPost<any>("winsorize", {
        dataset: ds.id,
        columns: winCols,
        p_low: pLow,
        p_high: pHigh,
        name: winName,
      });
      await refresh();
      toast({ title: "缩尾完成", description: `新数据集：${winName}（${res.rows} 行）` });
    } catch (e: any) {
      toast({ title: "缩尾失败", description: e?.message || "", variant: "destructive" });
    } finally {
      setWinRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载模板库...
      </div>
    );
  }
  if (!tpl) return null;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-primary" /> 实证模板库
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            常用控制变量公式 · 样本筛选规则 · 研究设计套路 — 一键套用，省去翻 SAS 和 Stata 代码
          </p>
        </div>
        <TeachButton
          topic="实证模板库的用法"
          def={{
            what: (
              <>
                <p>
                  收录金融/会计实证论文中最常出现的内容：
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><b>控制变量公式库</b>：Size/Lev/ROA/TobinQ 等 19 个标准变量。</li>
                  <li><b>样本筛选规则</b>：剔除金融业、ST 公司、上市前数据等。</li>
                  <li><b>研究设计模板</b>：基准面板回归、DID、中介、调节、事件研究 5 套设计。</li>
                </ul>
              </>
            ),
            why: (
              <>
                <p>
                  期刊论文有约定俗成的「标准动作」。新手最容易出错的就是变量定义和样本筛选不规范。
                  把这些约定打包成模板可以：
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>避免 ROA = 净利润/年初资产 还是年末资产这类反复纠结。</li>
                  <li>让审稿人一眼认出你「在按行规做事」。</li>
                  <li>在多个研究中复现一致的处理流程。</li>
                </ul>
              </>
            ),
            howToRead: (
              <>
                <p>建议工作流：</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>① 先在「数据导入」并表，得到面板数据。</li>
                  <li>② 在「变量公式库」勾选所需变量 → 一键构造。</li>
                  <li>③ 回到「数据清洗」做筛选，或在本页「缩尾工具」一键缩尾。</li>
                  <li>④ 在「研究设计模板」选定主回归方案，跳到对应模块。</li>
                </ol>
              </>
            ),
          }}
        />
      </header>

      <DatasetBar />

      <div className="flex gap-1 p-1 bg-muted/40 rounded-md w-fit">
        {[
          { k: "vars" as Tab, l: "变量公式库", icon: Calculator, n: tpl.variables.length },
          { k: "filters" as Tab, l: "样本筛选规则", icon: Filter, n: tpl.filters.length },
          { k: "designs" as Tab, l: "研究设计模板", icon: Workflow, n: tpl.research_templates.length },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors",
                tab === t.k
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`tab-${t.k}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.l}
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {t.n}
              </Badge>
            </button>
          );
        })}
      </div>

      {/* 变量公式库 */}
      {tab === "vars" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-4 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">常用控制变量（按类别）</h2>
              <span className="text-xs text-muted-foreground">
                已选 {selVars.length} / {tpl.variables.length}
              </span>
            </div>
            <div className="space-y-4">
              {Object.entries(varsByCategory).map(([cat, items]) => (
                <div key={cat}>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    {cat}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {items.map((v) => {
                      const checked = selVars.includes(v.key);
                      return (
                        <label
                          key={v.key}
                          className={cn(
                            "flex items-start gap-2 p-2.5 border rounded-md cursor-pointer hover-elevate",
                            checked && "border-primary bg-primary/5"
                          )}
                          data-testid={`var-${v.key}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelVars((s) =>
                                s.includes(v.key) ? s.filter((x) => x !== v.key) : [...s, v.key]
                              )
                            }
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium flex items-center gap-1.5">
                              {v.key}
                              <span className="text-xs text-muted-foreground font-normal">
                                {v.label}
                              </span>
                              {v.needs_lag && (
                                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                  需面板
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                              = {v.formula}
                            </div>
                            <div className="text-[11px] text-muted-foreground/80 mt-0.5 line-clamp-2">
                              {v.explain}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4 space-y-3 h-fit sticky top-4">
            <h2 className="text-sm font-semibold">一键构造选中变量</h2>
            {!ds ? (
              <p className="text-xs text-muted-foreground">请先在「数据导入」选择/上传数据集。</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1">id 列</div>
                    <Input
                      value={idCol}
                      onChange={(e) => setIdCol(e.target.value)}
                      className="h-8 text-xs"
                      data-testid="input-id-col"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1">year 列</div>
                    <Input
                      value={yearCol}
                      onChange={(e) => setYearCol(e.target.value)}
                      className="h-8 text-xs"
                      data-testid="input-year-col"
                    />
                  </div>
                </div>

                {selVars.length > 0 && (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1 -mr-1">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      为每个变量指定输入列
                    </div>
                    {selVars.map((vk) => {
                      const v = tpl.variables.find((x) => x.key === vk);
                      if (!v) return null;
                      const ov = overrides[vk] || {};
                      return (
                        <div
                          key={vk}
                          className="border rounded p-2 space-y-1 bg-muted/30"
                        >
                          <div className="text-xs font-medium">{vk}</div>
                          <select
                            value={ov.input || ""}
                            onChange={(e) =>
                              setOverrides((s) => ({
                                ...s,
                                [vk]: { ...s[vk], input: e.target.value },
                              }))
                            }
                            className="w-full h-7 text-xs rounded border bg-background px-1.5"
                            data-testid={`select-input-${vk}`}
                          >
                            <option value="">— 选择 {v.inputs[0]} —</option>
                            {(ds.cols || []).map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                          {v.inputs2 && (
                            <select
                              value={ov.input2 || ""}
                              onChange={(e) =>
                                setOverrides((s) => ({
                                  ...s,
                                  [vk]: { ...s[vk], input2: e.target.value },
                                }))
                              }
                              className="w-full h-7 text-xs rounded border bg-background px-1.5"
                              data-testid={`select-input2-${vk}`}
                            >
                              <option value="">— 选择 {v.inputs2[0]} —</option>
                              {(ds.cols || []).map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">输出数据集名</div>
                  <Input
                    value={outName}
                    onChange={(e) => setOutName(e.target.value)}
                    className="h-8 text-xs"
                    data-testid="input-out-name"
                  />
                </div>

                <Button
                  onClick={runConstruct}
                  disabled={running || selVars.length === 0}
                  className="w-full"
                  size="sm"
                  data-testid="button-construct"
                >
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Calculator className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  构造 {selVars.length} 个变量
                </Button>

                {log && (
                  <div className="text-xs space-y-0.5 max-h-40 overflow-y-auto border rounded p-2 bg-muted/30">
                    {log.map((l: any, i: number) => (
                      <div key={i} className="flex items-start gap-1.5">
                        {l.success ? (
                          <CheckCircle2 className="h-3 w-3 text-green-600 mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
                        )}
                        <span className="font-mono text-[10px] flex-1">
                          <b>{l.var}</b>: {l.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>

          {ds && (
            <Card className="p-4 lg:col-span-3">
              <h2 className="text-sm font-semibold mb-3">数据预览（当前数据集）</h2>
              <DataPreview datasetId={ds.id} max={20} />
            </Card>
          )}

          {/* 缩尾工具 */}
          <Card className="p-4 lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Filter className="h-4 w-4" /> 缩尾工具（Winsorize）
              </h2>
              <TeachButton
                topic="为什么要缩尾"
                def={{
                  what: (
                    <p>
                      缩尾（Winsorize）把变量小于第 1 百分位的值替换为第 1 百分位、
                      大于第 99 百分位的值替换为第 99 百分位。是「软」处理极端值的方法。
                    </p>
                  ),
                  why: (
                    <p>
                      会计指标（如 ROA、TobinQ）极易受到 outlier 影响——一两家公司的极端值
                      就能让 t 值改变。缩尾可以减少异常值对回归结果的扭曲，是金融实证论文的
                      <b> 标配步骤</b>。审稿人会问"是否做了缩尾"。
                    </p>
                  ),
                  howToRead: (
                    <>
                      <p>常见做法：</p>
                      <ul className="list-disc pl-5">
                        <li>主回归用 1% / 99%</li>
                        <li>稳健性可换用 5% / 95% 或不缩尾</li>
                        <li>报告时写「所有连续变量在 1% 和 99% 分位上做了缩尾处理」</li>
                      </ul>
                    </>
                  ),
                }}
              />
            </div>
            {!ds ? (
              <p className="text-xs text-muted-foreground">请先选择一个数据集。</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <div className="text-[11px] text-muted-foreground mb-1">选择需要缩尾的列</div>
                  <VarMultiPicker
                    options={numericColsForWin}
                    value={winCols}
                    onChange={setWinCols}
                    placeholder="搜索变量名..."
                    testIdPrefix="win"
                  />
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1">下分位 p_low</div>
                      <Input
                        type="number"
                        step={0.005}
                        value={pLow}
                        onChange={(e) => setPLow(parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs"
                        data-testid="input-p-low"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1">上分位 p_high</div>
                      <Input
                        type="number"
                        step={0.005}
                        value={pHigh}
                        onChange={(e) => setPHigh(parseFloat(e.target.value) || 1)}
                        className="h-8 text-xs"
                        data-testid="input-p-high"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1">输出数据集名</div>
                    <Input
                      value={winName}
                      onChange={(e) => setWinName(e.target.value)}
                      className="h-8 text-xs"
                      data-testid="input-win-name"
                    />
                  </div>
                  <Button
                    onClick={runWinsorize}
                    disabled={winRunning || winCols.length === 0}
                    className="w-full"
                    size="sm"
                    data-testid="button-winsorize"
                  >
                    {winRunning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Filter className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    一键缩尾 {winCols.length} 列
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 样本筛选规则 */}
      {tab === "filters" && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">期刊论文常见样本筛选规则</h2>
            <TeachButton
              topic="样本筛选与稳健性"
              def={{
                what: (
                  <p>
                    样本筛选指在做主回归前剔除某些观测样本，使样本更同质、更适合检验假设。
                  </p>
                ),
                why: (
                  <p>
                    例如金融业的资产负债表结构与实业差异巨大，混在一起回归会产生偏误；
                    ST 公司处于退市预警，财务数据异常，通常剔除。
                    <b>不规范的样本筛选是审稿被打回的主要原因之一。</b>
                  </p>
                ),
                howToRead: (
                  <>
                    <p>论文中通常这样描述：</p>
                    <p className="font-mono text-xs bg-muted p-2 rounded">
                      本文按以下标准筛选样本：(1) 剔除金融行业；(2) 剔除 ST、*ST 公司；
                      (3) 剔除资产负债率不在 [0,1] 之间的观测；(4) 剔除主要变量缺失的样本。
                      最终得到 12,345 个公司-年度观测。
                    </p>
                  </>
                ),
              }}
            />
          </div>
          <div className="space-y-2">
            {tpl.filters.map((f) => (
              <div
                key={f.key}
                className="flex items-start gap-3 p-3 border rounded-md hover-elevate"
                data-testid={`filter-${f.key}`}
              >
                <Filter className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{f.label}</span>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      {f.scope}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{f.rule}</div>
                  <div className="text-xs text-muted-foreground/80 mt-1">{f.explain}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-md bg-muted/40 border text-xs text-muted-foreground">
            <b className="text-foreground">如何应用：</b> 在「② 数据清洗」页用 <code>filter</code>{" "}
            或 <code>dropna</code> 等操作组合实现这些规则。
            后续版本将支持「一键应用筛选模板」。
          </div>
        </Card>
      )}

      {/* 研究设计模板 */}
      {tab === "designs" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tpl.research_templates.map((rt) => (
            <Card key={rt.key} className="p-4 space-y-3" data-testid={`design-${rt.key}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">{rt.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{rt.scenario}</p>
                </div>
                <Workflow className="h-5 w-5 text-primary shrink-0" />
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                  分析模块
                </div>
                <div className="space-y-1">
                  {rt.modules.map((m, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <ChevronRight className="h-3 w-3 mt-0.5 text-muted-foreground" />
                      <span>{m}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  主模型
                </div>
                <code className="block text-[11px] font-mono p-2 rounded bg-muted/60 break-words">
                  {rt.model}
                </code>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  关键 tips
                </div>
                <ul className="text-xs space-y-0.5 list-disc pl-4 text-muted-foreground">
                  {rt.tips.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>

              {rt.references && rt.references.length > 0 && (
                <div className="pt-2 border-t">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                    经典参考
                  </div>
                  <div className="text-[11px] text-muted-foreground/90 space-y-0.5">
                    {rt.references.map((r, i) => (
                      <div key={i}>· {r}</div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
