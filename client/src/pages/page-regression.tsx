import { useState, Fragment } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, BarChart3, Plus, X, Play } from "lucide-react";
import { useStore } from "@/lib/store";
import { TeachButton } from "@/components/teach";
import { DatasetBar } from "@/components/dataset-bar";
import { VarMultiPicker, VarSinglePicker } from "@/components/var-picker";
import { pyPost, RegResult } from "@/lib/api";
import { cn } from "@/lib/utils";

const fmt = (x: any, d = 3) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(d);

type Spec = {
  id: string;
  name: string;
  y: string | null;
  x: string[];
  controls: string[];
  model: "ols" | "fe" | "re" | "fe_time" | "fe_two";
  entity: string | null;
  time: string | null;
  cluster: string | null;
  cov_type: string;
};

const blankSpec = (idx: number): Spec => ({
  id: `spec-${idx}-${Math.random().toString(36).slice(2, 7)}`,
  name: `(${idx})`,
  y: null,
  x: [],
  controls: [],
  model: "ols",
  entity: null,
  time: null,
  cluster: null,
  cov_type: "HC1",
});

export function PageRegression() {
  const { datasets, activeId, regResults, setRegResults } = useStore();
  const ds = datasets.find((d) => d.id === activeId);
  const [specs, setSpecs] = useState<Spec[]>([blankSpec(1)]);
  const columns = regResults;
  const setColumns = setRegResults;
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const updateSpec = (i: number, patch: Partial<Spec>) =>
    setSpecs((s) => s.map((sp, idx) => (idx === i ? { ...sp, ...patch } : sp)));

  const addSpec = () => {
    const next = blankSpec(specs.length + 1);
    // copy y/x/entity/time from first spec for convenience
    if (specs[0]) {
      next.y = specs[0].y;
      next.x = [...specs[0].x];
      next.entity = specs[0].entity;
      next.time = specs[0].time;
    }
    setSpecs([...specs, next]);
    setActiveIdx(specs.length);
  };

  const removeSpec = (i: number) => {
    if (specs.length === 1) return;
    setSpecs((s) => s.filter((_, idx) => idx !== i));
    setActiveIdx(Math.max(0, Math.min(activeIdx, specs.length - 2)));
  };

  const runAll = async () => {
    if (!ds) return;
    const valid = specs.filter((s) => s.y && s.x.length > 0);
    if (valid.length === 0) return;
    setLoading(true);
    try {
      const result = await pyPost<{ columns: RegResult[] }>("regression_table", {
        specs: valid.map((s) => ({
          dataset: ds.id,
          y: s.y!,
          x: s.x,
          controls: s.controls,
          model: s.model,
          entity: s.entity,
          time: s.time,
          cluster: s.cluster,
          cov_type: s.cov_type,
          name: s.name,
        })),
      });
      setColumns(result.columns);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <DatasetBar />
      {ds && (
        <Card className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />基准回归
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                设置一个或多个回归设定，并行运行后并列展示，构成论文级三线表。
              </p>
            </div>
            <TeachButton
              topic="基准回归（OLS / FE / RE / 双向 FE）"
              def={{
                what: (
                  <>
                    <p>
                      基准回归是论文 4.1 节的核心：用最规范的设定汇报核心因果关系。常见做法是依次报告：
                    </p>
                    <ol className="list-decimal pl-5 space-y-0.5">
                      <li>仅核心 X，加 robust SE</li>
                      <li>加入控制变量</li>
                      <li>加入个体固定效应（FE）</li>
                      <li>加入时间固定效应（双向 FE）</li>
                    </ol>
                  </>
                ),
                formula:
                  "Y_{it} = \\alpha + \\beta X_{it} + \\gamma' Z_{it} + \\mu_i + \\lambda_t + \\varepsilon_{it}",
                why: (
                  <>
                    <p>
                      面板数据中的<b>个体固定效应 μᵢ</b>（如公司哑变量）吸收所有不随时间变化的个体异质性（管理层风格、行业、地理位置），消除了由这些不可观测因素带来的内生性偏误；
                      <b>时间固定效应 λₜ</b>（年份哑变量）吸收宏观冲击（金融危机、监管变动）。
                    </p>
                    <p>
                      <b>聚类标准误（Cluster SE）</b>容许同一个体内不同年份的扰动相关，避免低估标准误（这是金融实证的标准做法）。
                    </p>
                  </>
                ),
                howToRead: (
                  <>
                    <p>
                      看 <b>核心 X 的系数 β、显著性（星号）和方向</b>。论文逻辑链：
                    </p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      <li>逐列加入控制变量后系数仍稳健 → 核心结论可信</li>
                      <li>加入 FE 后系数大幅缩水 → 原 OLS 高估，存在遗漏变量</li>
                      <li>加 FE 后仍显著 → 结论成立</li>
                      <li>R² within 反映 FE 模型对组内变动的解释力</li>
                    </ul>
                  </>
                ),
              }}
            />
          </div>

          {/* Spec tabs */}
          <div className="flex flex-wrap gap-1 mb-3 border-b pb-2">
            {specs.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  "px-3 py-1.5 rounded-t text-xs flex items-center gap-1.5 hover-elevate group",
                  activeIdx === i
                    ? "bg-primary/10 text-foreground border-b-2 border-primary"
                    : "text-muted-foreground"
                )}
                data-testid={`button-spec-${i}`}
              >
                <span>设定 {s.name}</span>
                {specs.length > 1 && (
                  <X
                    className="h-3 w-3 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSpec(i);
                    }}
                  />
                )}
              </button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={addSpec}
              data-testid="button-add-spec"
            >
              <Plus className="h-3.5 w-3.5" />新增设定
            </Button>
          </div>

          {/* Spec editor */}
          {specs[activeIdx] && (
            <SpecEditor
              spec={specs[activeIdx]}
              cols={ds.cols}
              onChange={(p) => updateSpec(activeIdx, p)}
            />
          )}

          <div className="flex items-center gap-2 mt-4 pt-3 border-t">
            <Button onClick={runAll} disabled={loading} data-testid="button-run-regression">
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              运行全部回归（{specs.length} 个设定）
            </Button>
            <span className="text-xs text-muted-foreground">
              提示：同一被解释变量 Y、依次加入控制变量与固定效应，得到论文标准三线表。
            </span>
          </div>
        </Card>
      )}

      {columns.length > 0 && <ResultTable columns={columns} />}
    </div>
  );
}

function SpecEditor({
  spec,
  cols,
  onChange,
}: {
  spec: Spec;
  cols: string[];
  onChange: (p: Partial<Spec>) => void;
}) {
  const isPanel = spec.model !== "ols";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">列名</label>
          <Input
            value={spec.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-9 text-sm"
            data-testid={`input-spec-name-${spec.id}`}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">模型</label>
          <select
            value={spec.model}
            onChange={(e) => onChange({ model: e.target.value as Spec["model"] })}
            className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm"
            data-testid={`select-model-${spec.id}`}
          >
            <option value="ols">OLS（混合）</option>
            <option value="fe">FE（个体固定效应）</option>
            <option value="fe_time">FE（时间固定效应）</option>
            <option value="fe_two">FE（双向固定效应）</option>
            <option value="re">RE（随机效应）</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">标准误</label>
          <select
            value={spec.cov_type}
            onChange={(e) => onChange({ cov_type: e.target.value })}
            className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm"
            data-testid={`select-se-${spec.id}`}
          >
            <option value="HC1">Robust (HC1)</option>
            <option value="HC0">HC0</option>
            <option value="HC3">HC3</option>
            <option value="cluster">聚类 (Cluster)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">聚类变量</label>
          <VarSinglePicker
            options={cols}
            value={spec.cluster}
            onChange={(v) => onChange({ cluster: v })}
            allowEmpty
            testId={`select-cluster-${spec.id}`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">被解释变量 Y</label>
          <VarSinglePicker
            options={cols}
            value={spec.y}
            onChange={(v) => onChange({ y: v })}
            testId={`select-y-${spec.id}`}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">核心解释变量 X</label>
          <VarMultiPicker
            options={cols}
            value={spec.x}
            onChange={(v) => onChange({ x: v })}
            testIdPrefix={`x-${spec.id}`}
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">控制变量（自动加入回归）</label>
        <VarMultiPicker
          options={cols.filter((c) => !spec.x.includes(c) && c !== spec.y)}
          value={spec.controls}
          onChange={(v) => onChange({ controls: v })}
          testIdPrefix={`ctrl-${spec.id}`}
        />
      </div>

      {isPanel && (
        <div className="grid grid-cols-2 gap-3 p-3 rounded-md border bg-muted/20">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">个体 ID（必填）</label>
            <VarSinglePicker
              options={cols}
              value={spec.entity}
              onChange={(v) => onChange({ entity: v })}
              testId={`select-entity-${spec.id}`}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">时间列（必填）</label>
            <VarSinglePicker
              options={cols}
              value={spec.time}
              onChange={(v) => onChange({ time: v })}
              testId={`select-time-${spec.id}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ResultTable({ columns }: { columns: RegResult[] }) {
  // collect variable names in order of first appearance
  const varSet: string[] = [];
  for (const c of columns) {
    for (const coef of c.coefficients || []) {
      if (!varSet.includes(coef.name)) varSet.push(coef.name);
    }
  }
  const findCoef = (col: RegResult, name: string) =>
    col.coefficients?.find((x) => x.name === name);

  return (
    <Card className="p-5">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold">回归结果（论文式三线表）</h3>
        <div className="text-xs text-muted-foreground">
          *** p &lt; 0.01 &nbsp;&nbsp; ** p &lt; 0.05 &nbsp;&nbsp; * p &lt; 0.1
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr className="border-b-2 border-foreground/20">
              <th className="px-3 py-2 text-left font-semibold">变量</th>
              {columns.map((c, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-center font-semibold min-w-[110px]"
                  data-testid={`th-col-${i}`}
                >
                  <div>{c.label || `(${i + 1})`}</div>
                  <div className="text-muted-foreground font-normal">
                    {c.error ? "—" : c.model}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {varSet.map((v) => (
              <Fragment key={v}>
                <tr className="border-t">
                  <td className="px-3 py-1 font-mono text-xs">{v}</td>
                  {columns.map((c, i) => {
                    const co = findCoef(c, v);
                    return (
                      <td
                        key={i}
                        className="px-3 py-1 text-center tabular-nums"
                        data-testid={`coef-${v}-${i}`}
                      >
                        {co?.coef !== null && co?.coef !== undefined ? (
                          <>
                            {fmt(co.coef)}
                            <sup className="text-primary ml-0.5">{co.star}</sup>
                          </>
                        ) : (
                          ""
                        )}
                      </td>
                    );
                  })}
                </tr>
                <tr className="text-xs text-muted-foreground">
                  <td></td>
                  {columns.map((c, i) => {
                    const co = findCoef(c, v);
                    return (
                      <td key={i} className="px-3 pb-1.5 text-center tabular-nums">
                        {co?.se !== null && co?.se !== undefined ? `(${fmt(co.se)})` : ""}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/20 bg-muted/20 text-xs">
              <td className="px-3 py-1.5 font-medium">个体 FE</td>
              {columns.map((c, i) => (
                <td key={i} className="px-3 py-1.5 text-center">
                  {c.fe_entity ? "Yes" : "No"}
                </td>
              ))}
            </tr>
            <tr className="text-xs">
              <td className="px-3 py-1.5 font-medium">时间 FE</td>
              {columns.map((c, i) => (
                <td key={i} className="px-3 py-1.5 text-center">
                  {c.fe_time ? "Yes" : "No"}
                </td>
              ))}
            </tr>
            <tr className="text-xs">
              <td className="px-3 py-1.5 font-medium">SE 类型</td>
              {columns.map((c, i) => (
                <td key={i} className="px-3 py-1.5 text-center">
                  {c.se_type || "—"}
                </td>
              ))}
            </tr>
            <tr className="text-xs">
              <td className="px-3 py-1.5 font-medium">N</td>
              {columns.map((c, i) => (
                <td key={i} className="px-3 py-1.5 text-center tabular-nums">
                  {c.n ?? "—"}
                </td>
              ))}
            </tr>
            <tr className="text-xs">
              <td className="px-3 py-1.5 font-medium">R²</td>
              {columns.map((c, i) => (
                <td key={i} className="px-3 py-1.5 text-center tabular-nums">
                  {fmt(c.r2)}
                </td>
              ))}
            </tr>
            {columns.some((c) => c.r2_within !== null && c.r2_within !== undefined) && (
              <tr className="text-xs">
                <td className="px-3 py-1.5 font-medium">R² within</td>
                {columns.map((c, i) => (
                  <td key={i} className="px-3 py-1.5 text-center tabular-nums">
                    {fmt((c as any).r2_within)}
                  </td>
                ))}
              </tr>
            )}
            <tr className="text-xs">
              <td className="px-3 py-1.5 font-medium">F 统计量</td>
              {columns.map((c, i) => (
                <td key={i} className="px-3 py-1.5 text-center tabular-nums">
                  {fmt(c.f_stat, 2)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {columns.some((c) => c.error) && (
        <div className="mt-2 text-xs text-destructive">
          {columns.map(
            (c, i) => c.error && <div key={i}>设定 {c.label}: {c.error}</div>
          )}
        </div>
      )}
      <div className="mt-3 text-xs text-muted-foreground">
        系数下方括号内为标准误。结果可在「⑦ 结果导出」页导出为 LaTeX / CSV / Markdown 格式。
      </div>
    </Card>
  );
}
