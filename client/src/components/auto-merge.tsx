import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Wand2 } from "lucide-react";
import { pyPost } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { TeachButton } from "@/components/teach";

type Step = {
  op: string;
  note?: string;
  n?: number;
  where?: string;
  mode?: string;
  mapping?: Record<string, string>;
  columns?: string[];
  scale?: number;
  source?: string;
  output?: string;
  id_vars?: string[];
  value_vars?: any[];
  var_name?: string;
  value_name?: string;
};

type TablePlan = {
  name: string;
  shape: "long" | "wide" | "static";
  steps: Step[];
  merge_role: "panel" | "static";
  issues: string[];
};

type Plan = {
  tables: TablePlan[];
  id_alias: string;
  year_alias: string;
  merge_strategy: {
    panel_tables: string[];
    static_tables: string[];
    panel_join_keys: string[];
    static_join_keys: string[];
    how: string;
    note: string;
  };
};

type Analysis = {
  name: string;
  dataset_id: string;
  shape: string;
  id_col: string | null;
  year_col: string | null;
  date_col: string | null;
  year_cols_in_header: string[];
  numeric_string_cols: string[];
  header_skip: number;
  header_skip_mode: string;
  issues: string[];
};

const SHAPE_LABEL: Record<string, { label: string; cls: string }> = {
  long: { label: "长表", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20" },
  wide: { label: "宽表", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" },
  static: { label: "静态表", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20" },
};

const ROLE_LABEL: Record<string, string> = {
  panel: "面板表（按 id+year 合并）",
  static: "静态表（按 id 广播到全部年份）",
};

export function AutoMerge() {
  const { datasets, refresh, setActiveId } = useStore();
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [outputName, setOutputName] = useState("auto_panel");
  const [report, setReport] = useState<any | null>(null);
  const [idAlias, setIdAlias] = useState("id");
  const [yearAlias, setYearAlias] = useState("year");
  const planRef = useRef<HTMLDivElement>(null);
  const [planJustArrived, setPlanJustArrived] = useState(false);

  // 方案返回后：滚动到预览区 + 闪烁高亮
  useEffect(() => {
    if (plan && planRef.current) {
      planRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      setPlanJustArrived(true);
      const t = setTimeout(() => setPlanJustArrived(false), 1800);
      return () => clearTimeout(t);
    }
  }, [plan]);

  const onSelectAll = () => {
    if (selectedIds.length === datasets.length) setSelectedIds([]);
    else setSelectedIds(datasets.map((d) => d.id));
  };

  const onAnalyze = async () => {
    if (selectedIds.length < 1) {
      toast({ title: "请至少勾选一个数据集", variant: "destructive" });
      return;
    }
    setAnalyzing(true);
    setPlan(null);
    setReport(null);
    try {
      const r = await pyPost("auto_analyze", {
        datasets: selectedIds,
        id_alias: idAlias,
        year_alias: yearAlias,
      });
      setAnalyses(r.analyses);
      setPlan(r.plan);
      // 默认展开有 issues 的表
      const exp: Record<string, boolean> = {};
      r.plan.tables.forEach((t: TablePlan) => {
        exp[t.name] = t.issues.length > 0;
      });
      setExpanded(exp);
      const issueN = r.plan.tables.reduce((s: number, t: TablePlan) => s + t.issues.length, 0);
      toast({
        title: "✓ 智能分析完成（已生成方案，请向下查看）",
        description: `识别 ${r.analyses.length} 张表 · ${r.plan.merge_strategy.panel_tables.length} 张面板表 + ${r.plan.merge_strategy.static_tables.length} 张静态表${issueN > 0 ? ` · ${issueN} 条提示` : ""}`,
      });
    } catch (e: any) {
      toast({ title: "分析失败", description: String(e), variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const onExecute = async () => {
    if (!plan) return;
    setExecuting(true);
    try {
      const dataset_map: Record<string, string> = {};
      analyses.forEach((a) => {
        dataset_map[a.name] = a.dataset_id;
      });
      const r = await pyPost("auto_execute", {
        plan,
        dataset_map,
        name: outputName,
      });
      setReport(r.report);
      await refresh();
      setActiveId(r.id);
      toast({
        title: "并表完成",
        description: `生成数据集 "${outputName}"：${r.rows} 行 × ${r.cols.length} 列`,
      });
    } catch (e: any) {
      toast({ title: "执行失败", description: String(e), variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  };

  const updateTableRole = (name: string, role: "panel" | "static") => {
    if (!plan) return;
    const next = {
      ...plan,
      tables: plan.tables.map((t) => (t.name === name ? { ...t, merge_role: role } : t)),
    };
    next.merge_strategy = {
      ...plan.merge_strategy,
      panel_tables: next.tables.filter((t) => t.merge_role === "panel").map((t) => t.name),
      static_tables: next.tables.filter((t) => t.merge_role === "static").map((t) => t.name),
    };
    setPlan(next);
  };

  return (
    <Card className="p-5 border-primary/30 bg-primary/[0.02]">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            ② 智能并表（推荐 · 自动识别 + 一键执行）
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            勾选所有上传的工作表 → 系统自动识别每张表的结构（宽/长/静态、id 列、年份列、单位行）→ 生成方案 → 你审核 → 一键执行得到 (id, year) 长面板。
          </p>
        </div>
        <TeachButton
          topic="智能并表的工作原理"
          def={{
            what: (
              <>
                <p>系统针对每张表执行 4 类自动识别：</p>
                <ol className="list-decimal pl-5 mt-2 space-y-1">
                  <li><b>表头偏移</b>：识别"标题/单位"等说明行，自动跳过。</li>
                  <li><b>列角色</b>：通过列名关键词 + 数据特征推断 id 列与 year/date 列。</li>
                  <li><b>形态判断</b>：年份是列名 → <b>宽表</b>（自动 unpivot）；年份是行值 → <b>长表</b>；只有 id → <b>静态表</b>。</li>
                  <li><b>数值列</b>：识别"看起来是数字的字符串"列，自动转换。</li>
                </ol>
              </>
            ),
            why: (
              <p>
                金融实证数据（CSMAR、Wind、统计年鉴）格式不统一：有的是宽表（年份做列名），有的有中文标题行，公司基础信息又是静态。手动清洗每张表非常耗时，自动化能在保留可控性的前提下减少 80% 的工作。
              </p>
            ),
            howToRead: (
              <>
                <p>
                  执行后看「合并日志」：每张表合并前后的行数变化能告诉你两件事：
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>行数<b>暴涨</b> → 主键不唯一（同一 id+year 多次出现，说明数据需先去重）</li>
                  <li>行数<b>大幅减少</b> → 主键覆盖度低（用 outer 改 inner 时常见）</li>
                </ul>
                <p className="mt-2">最终的「缺失值统计」会提示哪些列覆盖度低，决定是否丢弃或填充。</p>
              </>
            ),
          }}
        />
      </div>

      {/* 步骤 1：选数据集 + 配置 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">第 1 步 · 选择要参与并表的数据集</div>
          <button
            type="button"
            onClick={onSelectAll}
            className="text-xs text-primary hover:underline"
          >
            {selectedIds.length === datasets.length ? "全部取消" : "全选"}
          </button>
        </div>
        <div className="border rounded-md p-2 max-h-44 overflow-y-auto bg-background">
          {datasets.length === 0 && (
            <div className="text-xs text-muted-foreground py-2 text-center">请先在上方上传文件</div>
          )}
          {datasets.map((d) => (
            <label key={d.id} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-muted/40 px-2 rounded">
              <input
                type="checkbox"
                checked={selectedIds.includes(d.id)}
                onChange={(e) => {
                  if (e.target.checked) setSelectedIds([...selectedIds, d.id]);
                  else setSelectedIds(selectedIds.filter((x) => x !== d.id));
                }}
              />
              <span className="text-xs font-mono flex-1 truncate">{d.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {d.rows}×{d.cols.length}
              </span>
            </label>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">面板 id 列名（统一后）</label>
            <Input value={idAlias} onChange={(e) => setIdAlias(e.target.value)} className="h-8 text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">面板 year 列名（统一后）</label>
            <Input value={yearAlias} onChange={(e) => setYearAlias(e.target.value)} className="h-8 text-sm font-mono" />
          </div>
        </div>

        <Button onClick={onAnalyze} disabled={analyzing || selectedIds.length < 1} className="w-full" data-testid="button-auto-analyze">
          {analyzing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
          智能分析（不修改原数据）
        </Button>
      </div>

      {/* 步骤 2：方案预览 */}
      {plan && (
        <div
          ref={planRef}
          className={`mt-5 pt-5 border-t space-y-3 transition-all duration-700 rounded-md ${
            planJustArrived
              ? "ring-2 ring-primary/60 bg-primary/[0.04] -mx-2 px-2"
              : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              第 2 步 · 检查方案（已生成 · 可点击每张表查看/调整）
            </div>
            <Badge variant="outline" className="text-[10px]">
              {plan.tables.length} 张表 · {plan.tables.reduce((s, t) => s + t.steps.length, 0)} 步操作
            </Badge>
          </div>

          {/* 总体策略 */}
          <div className="bg-muted/40 rounded-md p-3 text-xs space-y-1.5">
            <div className="font-medium text-foreground">合并策略</div>
            <div className="text-muted-foreground">
              · 面板表（{plan.merge_strategy.panel_tables.length} 张）按 <code className="font-mono">[{idAlias}, {yearAlias}]</code> outer 合并
            </div>
            <div className="text-muted-foreground">
              · 静态表（{plan.merge_strategy.static_tables.length} 张）按 <code className="font-mono">{idAlias}</code> 广播到所有年份
            </div>
          </div>

          {/* 每张表 */}
          <div className="space-y-2">
            {plan.tables.map((t) => {
              const isOpen = !!expanded[t.name];
              const shape = SHAPE_LABEL[t.shape] || { label: t.shape, cls: "" };
              const ana = analyses.find((a) => a.name === t.name);
              return (
                <div key={t.name} className="border rounded-md bg-background">
                  <button
                    type="button"
                    onClick={() => setExpanded({ ...expanded, [t.name]: !isOpen })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <span className="font-mono text-xs flex-1 truncate">{t.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${shape.cls}`}>{shape.label}</Badge>
                    <Badge variant="outline" className="text-[10px]">{t.steps.length} 步</Badge>
                    {t.issues.length > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-700 border-yellow-500/30">
                        <AlertTriangle className="h-3 w-3 mr-0.5" /> {t.issues.length}
                      </Badge>
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 space-y-2 border-t bg-muted/10">
                      {ana && (
                        <div className="pt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div><span className="text-muted-foreground">id 列：</span><code className="font-mono">{ana.id_col || "—"}</code></div>
                          <div><span className="text-muted-foreground">year 列：</span><code className="font-mono">{ana.year_col || "—"}</code></div>
                          <div><span className="text-muted-foreground">date 列：</span><code className="font-mono">{ana.date_col || "—"}</code></div>
                          <div><span className="text-muted-foreground">宽表年份列数：</span><code className="font-mono">{ana.year_cols_in_header.length}</code></div>
                        </div>
                      )}
                      {t.issues.length > 0 && (
                        <div className="text-xs bg-yellow-500/10 border border-yellow-500/30 rounded px-2 py-1.5 space-y-1">
                          {t.issues.map((iss, i) => (
                            <div key={i} className="text-yellow-700 dark:text-yellow-400">⚠ {iss}</div>
                          ))}
                        </div>
                      )}
                      <div className="text-xs">
                        <div className="text-muted-foreground mb-1">将执行 {t.steps.length} 步操作：</div>
                        <ol className="list-decimal pl-5 space-y-0.5">
                          {t.steps.map((s, i) => (
                            <li key={i}>
                              <span className="font-mono text-[11px] bg-muted px-1 rounded">{s.op}</span>
                              <span className="text-muted-foreground ml-1">{s.note || ""}</span>
                            </li>
                          ))}
                          {t.steps.length === 0 && <li className="text-muted-foreground italic">无（直接使用）</li>}
                        </ol>
                      </div>
                      <div className="flex items-center gap-2 text-xs pt-1">
                        <span className="text-muted-foreground">合并角色：</span>
                        <select
                          value={t.merge_role}
                          onChange={(e) => updateTableRole(t.name, e.target.value as "panel" | "static")}
                          className="h-7 rounded border border-input bg-background px-2 text-xs"
                        >
                          <option value="panel">面板表（id + year）</option>
                          <option value="static">静态表（仅 id，广播）</option>
                        </select>
                        <span className="text-muted-foreground text-[11px]">{ROLE_LABEL[t.merge_role]}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 步骤 3：执行 */}
          <div className="grid grid-cols-[1fr_auto] gap-2 pt-2">
            <Input
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder="输出数据集名称"
              className="h-9 text-sm"
            />
            <Button onClick={onExecute} disabled={executing} data-testid="button-auto-execute">
              {executing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              第 3 步 · 一键执行
            </Button>
          </div>
        </div>
      )}

      {/* 步骤 3 报告 */}
      {report && (
        <div className="mt-5 pt-5 border-t space-y-3">
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> 执行报告
          </div>
          <div className="bg-muted/40 rounded-md p-3 text-xs space-y-1.5">
            <div className="font-medium text-foreground mb-1.5">合并日志</div>
            {(report.merge_log || []).map((line: string, i: number) => (
              <div key={i} className="text-muted-foreground font-mono text-[11px]">· {line}</div>
            ))}
          </div>
          {report.missing_per_col && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground font-medium">
                缺失值统计 ({Object.keys(report.missing_per_col).length} 列) ▾
              </summary>
              <div className="mt-2 max-h-40 overflow-y-auto border rounded p-2 bg-background grid grid-cols-2 gap-x-4">
                {Object.entries(report.missing_per_col)
                  .sort((a: any, b: any) => b[1] - a[1])
                  .map(([col, n]) => (
                    <div key={col} className="flex justify-between py-0.5">
                      <code className="font-mono text-[11px] truncate">{col}</code>
                      <span className={`tabular-nums text-[11px] ${(n as number) > 0 ? "text-yellow-700" : "text-muted-foreground"}`}>
                        {n as number} 缺失
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
