import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { TeachButton } from "@/components/teach";
import { DatasetBar } from "@/components/dataset-bar";
import { DataPreview } from "@/components/data-preview";
import { VarMultiPicker, VarSinglePicker } from "@/components/var-picker";
import { pyPost } from "@/lib/api";

type Op = {
  type: string;
  columns?: string[];
  method?: string;
  lower?: number;
  upper?: number;
  value?: any;
  group?: string;
  time?: string;
  periods?: number;
  column?: string;
  op?: string;
  mapping?: Record<string, string>;
  // new fields
  n?: number;
  where?: string;
  scale?: number;
  source?: string;
  output?: string;
  id_vars?: string[];
  value_vars?: string[];
  var_name?: string;
  value_name?: string;
};

const OP_LABELS: Record<string, { name: string; teach: string }> = {
  // 表格预处理（【重点】用于去表头/单位行、字符转数值、宽转长）
  drop_rows: { name: "删除前 N 行（去表头）", teach: "表格预处理" },
  to_numeric: { name: "字符→数值转换", teach: "表格预处理" },
  extract_year: { name: "从日期提取年份", teach: "表格预处理" },
  wide_to_long: { name: "宽表转长表（unpivot）", teach: "宽转长" },
  rename: { name: "重命名列", teach: "表格预处理" },
  keep_columns: { name: "仅保留选中列", teach: "样本筛选" },
  // 常规清洗
  dropna: { name: "删除缺失值（dropna）", teach: "缺失值处理" },
  fillna: { name: "填充缺失值（fillna）", teach: "缺失值处理" },
  filter: { name: "条件筛选行", teach: "样本筛选" },
  drop_columns: { name: "删除列", teach: "样本筛选" },
  winsorize: { name: "缩尾（Winsorize）", teach: "缩尾与截尾" },
  truncate: { name: "截尾（Truncate）", teach: "缩尾与截尾" },
  log: { name: "对数转换 ln(x)", teach: "对数化" },
  log1p: { name: "对数转换 ln(1+x)", teach: "对数化" },
  standardize: { name: "标准化（z-score）", teach: "标准化" },
  lag: { name: "生成滞后变量 L.x", teach: "滞后与差分" },
  diff: { name: "生成差分变量 D.x", teach: "滞后与差分" },
  dummies: { name: "生成哑变量", teach: "哑变量" },
};

export function PageClean() {
  const { datasets, activeId, refresh, setActiveId } = useStore();
  const { toast } = useToast();
  const ds = datasets.find((d) => d.id === activeId);
  const [ops, setOps] = useState<Op[]>([]);
  const [newName, setNewName] = useState("cleaned");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<any[] | null>(null);

  const addOp = (type: string) => {
    const def: Op = { type };
    if (type === "winsorize" || type === "truncate") {
      def.lower = 0.01; def.upper = 0.99;
    }
    if (type === "fillna") def.method = "mean";
    if (type === "lag" || type === "diff") def.periods = 1;
    if (type === "filter") { def.op = ">"; def.value = 0; }
    if (type === "drop_rows") { def.n = 2; def.where = "top"; }
    if (type === "to_numeric") { def.scale = 1; }
    if (type === "extract_year") { def.output = "year"; }
    if (type === "wide_to_long") {
      def.id_vars = [];
      def.value_vars = [];
      def.var_name = "year";
      def.value_name = "value";
    }
    setOps([...ops, def]);
  };
  const updOp = (i: number, patch: Partial<Op>) => {
    const nx = [...ops]; nx[i] = { ...nx[i], ...patch }; setOps(nx);
  };
  const rmOp = (i: number) => setOps(ops.filter((_, idx) => idx !== i));

  const run = async () => {
    if (!ds) return;
    setRunning(true);
    try {
      const r = await pyPost("clean", { dataset: ds.id, operations: ops, name: newName });
      setLog(r.log);
      await refresh();
      setActiveId(r.id);
      toast({ title: "清洗完成", description: `${r.initial_rows} → ${r.final_rows} 行` });
    } catch (e: any) {
      toast({ title: "清洗失败", description: String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <DatasetBar />
      {!ds ? null : (
        <>
          <Card className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />数据清洗流水线
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  顺序执行下列操作；每步会生成新数据集，原数据保留。
                </p>
              </div>
              <TeachButton
                topic="数据清洗的核心步骤"
                def={{
                  what: (
                    <ul className="list-disc pl-5 space-y-1.5">
                      <li><b>缺失值</b>：直接删除（dropna）或用均值/中位数填充</li>
                      <li><b>缩尾 Winsorize</b>：把极端值替换为分位数，常用 1%/99% 双侧</li>
                      <li><b>截尾 Truncate</b>：直接删除极端样本</li>
                      <li><b>对数化</b>：把右偏的金额类变量（资产、市值）转为正态分布</li>
                      <li><b>标准化</b>：(x − μ) / σ，让不同单位的变量可比</li>
                    </ul>
                  ),
                  why: (
                    <p>
                      实证论文几乎都要做缩尾，因为财务数据极易出现异常值（例如 ROA = 50000%）。审稿人通常要求报告：
                      "All continuous variables are winsorized at the 1% and 99% levels."
                    </p>
                  ),
                  howToRead: (
                    <p>清洗后样本量、均值、标准差应该明显更"温和"。在论文方法部分说明具体处理（如缩尾比例）。</p>
                  ),
                }}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
              {Object.keys(OP_LABELS).map((k) => (
                <Button key={k} variant="outline" size="sm" className="h-8 text-xs justify-start" onClick={() => addOp(k)}>
                  <Plus className="h-3 w-3 mr-1.5" />
                  {OP_LABELS[k].name}
                </Button>
              ))}
            </div>

            {ops.length > 0 && (
              <div className="mt-4 space-y-2">
                {ops.map((op, i) => (
                  <div key={i} className="border rounded-md p-3 bg-muted/20">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] flex items-center justify-center tabular-nums">{i + 1}</span>
                        {OP_LABELS[op.type]?.name || op.type}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => rmOp(i)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                    <OpEditor op={op} cols={ds.cols} update={(p) => updOp(i, p)} />
                  </div>
                ))}
                <div className="flex gap-2 items-end pt-2">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground mb-1 block">输出数据集名称</label>
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="text-sm h-9" />
                  </div>
                  <Button onClick={run} disabled={running} data-testid="button-run-clean">
                    {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    执行清洗
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {log && (
            <Card className="p-4">
              <div className="text-xs font-medium mb-2 text-muted-foreground">操作日志</div>
              <div className="space-y-1 text-xs font-mono">
                {log.map((l, i) => (
                  <div key={i} className="flex justify-between border-b py-1 last:border-b-0">
                    <span>{i + 1}. {l.op?.type}{l.op?.columns ? ` [${l.op.columns.join(",")}]` : ""}</span>
                    <span className="text-muted-foreground">
                      {l.error ? `错误: ${l.error}` : `${l.rows_before} → ${l.rows_after}`}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {activeId && (
            <Card className="p-3">
              <DataPreview datasetId={activeId} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function OpEditor({ op, cols, update }: { op: Op; cols: string[]; update: (p: Partial<Op>) => void }) {
  if (op.type === "fillna") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <VarMultiPicker options={cols} value={op.columns || []} onChange={(v) => update({ columns: v })} placeholder="变量（留空=所有数值列）" testIdPrefix="fillna" />
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">填充方式</label>
          <select value={op.method} onChange={(e) => update({ method: e.target.value })} className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm">
            <option value="mean">均值</option>
            <option value="median">中位数</option>
            <option value="ffill">前向填充</option>
            <option value="bfill">后向填充</option>
            <option value="zero">填 0</option>
          </select>
        </div>
      </div>
    );
  }
  if (op.type === "winsorize" || op.type === "truncate") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <VarMultiPicker options={cols} value={op.columns || []} onChange={(v) => update({ columns: v })} placeholder="变量（留空=所有数值列）" testIdPrefix="wins" />
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">下分位</label>
          <Input type="number" value={op.lower} step="0.01" min="0" max="0.5"
            onChange={(e) => update({ lower: Number(e.target.value) })} className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">上分位</label>
          <Input type="number" value={op.upper} step="0.01" min="0.5" max="1"
            onChange={(e) => update({ upper: Number(e.target.value) })} className="h-9 text-sm" />
        </div>
      </div>
    );
  }
  if (op.type === "dropna" || op.type === "log" || op.type === "log1p" || op.type === "standardize" || op.type === "dummies" || op.type === "drop_columns" || op.type === "keep_columns") {
    return (
      <VarMultiPicker options={cols} value={op.columns || []} onChange={(v) => update({ columns: v })} placeholder="变量" testIdPrefix={op.type} />
    );
  }
  if (op.type === "drop_rows") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">删除行数 N</label>
          <Input type="number" min="1" value={op.n ?? 1} onChange={(e) => update({ n: Number(e.target.value) })} className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">位置</label>
          <select value={op.where || "top"} onChange={(e) => update({ where: e.target.value })} className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm">
            <option value="top">顶部（表头/单位行）</option>
            <option value="bottom">底部（末尾总计行）</option>
          </select>
        </div>
      </div>
    );
  }
  if (op.type === "to_numeric") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <VarMultiPicker options={cols} value={op.columns || []} onChange={(v) => update({ columns: v })} placeholder="需转为数值的字符列" testIdPrefix="tonum" />
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">同时乘以系数（单位换算）</label>
          <Input type="number" step="any" value={op.scale ?? 1} onChange={(e) => update({ scale: Number(e.target.value) })} className="h-9 text-sm" placeholder="万元转亿元填 0.0001" />
        </div>
      </div>
    );
  }
  if (op.type === "extract_year") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">源日期列</label>
          <VarSinglePicker options={cols} value={op.source || null} onChange={(v) => update({ source: v || undefined })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">输出列名</label>
          <Input value={op.output || "year"} onChange={(e) => update({ output: e.target.value })} className="h-9 text-sm font-mono" />
        </div>
      </div>
    );
  }
  if (op.type === "wide_to_long") {
    return (
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">保留为身份的列 (id_vars)</label>
          <VarMultiPicker options={cols} value={op.id_vars || []} onChange={(v) => update({ id_vars: v })} placeholder="例如：province" testIdPrefix="w2l-id" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">要展开的宽列 (value_vars，例如各年份列)</label>
          <VarMultiPicker options={cols} value={op.value_vars || []} onChange={(v) => update({ value_vars: v })} placeholder="例如：2015,2016,...,2024" testIdPrefix="w2l-val" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">新列名（原列名变变量）</label>
            <Input value={op.var_name || "year"} onChange={(e) => update({ var_name: e.target.value })} className="h-9 text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">新列名（数值）</label>
            <Input value={op.value_name || "value"} onChange={(e) => update({ value_name: e.target.value })} className="h-9 text-sm font-mono" />
          </div>
        </div>
      </div>
    );
  }
  if (op.type === "rename") {
    const m = op.mapping || {};
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">点击左侧原列名输入新名；留空不改</div>
        <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
          {cols.map((c) => (
            <div key={c} className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground w-24 truncate" title={c}>{c}</span>
              <Input value={m[c] || ""} onChange={(e) => {
                const nm = { ...m };
                if (e.target.value) nm[c] = e.target.value; else delete nm[c];
                update({ mapping: nm });
              }} className="h-8 text-xs font-mono" placeholder="新名" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (op.type === "lag" || op.type === "diff") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <VarMultiPicker options={cols} value={op.columns || []} onChange={(v) => update({ columns: v })} placeholder="变量" testIdPrefix={op.type} />
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">个体ID</label>
          <VarSinglePicker options={cols} value={op.group || null} onChange={(v) => update({ group: v || undefined })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">时间</label>
          <VarSinglePicker options={cols} value={op.time || null} onChange={(v) => update({ time: v || undefined })} />
        </div>
        {op.type === "lag" && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">滞后阶数</label>
            <Input type="number" value={op.periods} min="1" onChange={(e) => update({ periods: Number(e.target.value) })} className="h-9 text-sm" />
          </div>
        )}
      </div>
    );
  }
  if (op.type === "filter") {
    return (
      <div className="grid grid-cols-3 gap-3">
        <VarSinglePicker options={cols} value={op.column || null} onChange={(v) => update({ column: v || undefined })} />
        <select value={op.op} onChange={(e) => update({ op: e.target.value })} className="h-9 rounded-md border border-input bg-background px-2.5 text-sm">
          <option value=">">{">"}</option><option value=">=">{">="}</option>
          <option value="<">{"<"}</option><option value="<=">{"<="}</option>
          <option value="==">{"=="}</option><option value="!=">{"!="}</option>
        </select>
        <Input value={op.value} onChange={(e) => update({ value: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })} className="h-9 text-sm" />
      </div>
    );
  }
  return null;
}
