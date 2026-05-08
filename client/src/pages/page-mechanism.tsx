import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Workflow } from "lucide-react";
import { useStore } from "@/lib/store";
import { TeachButton } from "@/components/teach";
import { DatasetBar } from "@/components/dataset-bar";
import { VarMultiPicker, VarSinglePicker } from "@/components/var-picker";
import { pyPost } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const fmt = (x: any, d = 4) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(d);
const stars = (p: number | null) =>
  p === null || p === undefined
    ? ""
    : p < 0.01
      ? "***"
      : p < 0.05
        ? "**"
        : p < 0.1
          ? "*"
          : "";

export function PageMechanism() {
  const { datasets, activeId } = useStore();
  const ds = datasets.find((d) => d.id === activeId);

  return (
    <div className="space-y-4">
      <DatasetBar />
      {ds && (
        <Card className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Workflow className="h-4 w-4" />机制分析与异质性
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                中介效应、调节效应、分组回归。机制分析回答「X 是怎样影响 Y 的？」。
              </p>
            </div>
          </div>
          <Tabs defaultValue="mediation" className="w-full">
            <TabsList className="grid grid-cols-3 w-full max-w-2xl">
              <TabsTrigger value="mediation">中介效应</TabsTrigger>
              <TabsTrigger value="moderation">调节效应</TabsTrigger>
              <TabsTrigger value="group">分组回归</TabsTrigger>
            </TabsList>
            <TabsContent value="mediation" className="mt-4">
              <MediationPanel ds={ds} />
            </TabsContent>
            <TabsContent value="moderation" className="mt-4">
              <ModerationPanel ds={ds} />
            </TabsContent>
            <TabsContent value="group" className="mt-4">
              <GroupPanel ds={ds} />
            </TabsContent>
          </Tabs>
        </Card>
      )}
    </div>
  );
}

function MediationPanel({ ds }: { ds: any }) {
  const [y, setY] = useState<string | null>(null);
  const [x, setX] = useState<string | null>(null);
  const [m, setM] = useState<string | null>(null);
  const [controls, setControls] = useState<string[]>([]);
  const [bootstrap, setBootstrap] = useState(1000);
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!y || !x || !m) return;
    setLoading(true);
    try {
      const res = await pyPost("mediation", {
        dataset: ds.id,
        y,
        x,
        m,
        controls,
        bootstrap,
        seed: 42,
      });
      setR(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-start">
        <div className="text-sm">
          检验「X 通过中介 M 影响 Y」。运行 Baron-Kenny 三步法 + Sobel 检验 + Bootstrap 置信区间。
        </div>
        <TeachButton
          topic="中介效应（Mediation）"
          def={{
            what: (
              <>
                <p>
                  中介效应分析「X 通过哪些渠道影响 Y」。例如：高管薪酬激励 → 研发投入 → 公司价值，研发投入就是中介变量 M。
                </p>
                <p>三步回归：</p>
                <ol className="list-decimal pl-5 space-y-0.5 text-xs">
                  <li>Y = c·X + ε（总效应）</li>
                  <li>M = a·X + ε（X 是否影响 M）</li>
                  <li>Y = c'·X + b·M + ε（控制 M 后 X 的直接效应）</li>
                </ol>
                <p>
                  间接效应 = a×b，总效应 = 间接 + 直接 = a×b + c'。
                </p>
              </>
            ),
            formula:
              "\\text{Indirect} = a \\cdot b, \\quad c = c' + a\\cdot b",
            why: (
              <>
                <p>
                  Sobel 检验在小样本下 type-I 错误偏高、置信区间偏窄。<b>Bootstrap</b>（默认 1000 次重抽样）通过重复抽样得到 a×b 的经验分布，给出更稳健的 95% 置信区间——这是顶刊（JFE / RFS）的现行标准。
                </p>
                <p>
                  判断标准：若 Bootstrap 95% CI <b>不包含 0</b>，则中介效应显著。
                </p>
              </>
            ),
            howToRead: (
              <ul className="list-disc pl-5 space-y-0.5">
                <li><b>a 和 b 都显著</b>，且 Bootstrap CI 不含 0 → 存在中介效应</li>
                <li>c' 不显著（c 显著） → <b>完全中介</b>，X 完全通过 M 影响 Y</li>
                <li>c' 仍显著但比 c 小 → <b>部分中介</b>，M 解释了一部分机制</li>
                <li>a 或 b 任一不显著 → 中介路径不通</li>
              </ul>
            ),
          }}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Y（被解释变量）</label>
          <VarSinglePicker options={ds.cols} value={y} onChange={setY} testId="med-y" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">X（解释变量）</label>
          <VarSinglePicker options={ds.cols} value={x} onChange={setX} testId="med-x" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">M（中介变量）</label>
          <VarSinglePicker options={ds.cols} value={m} onChange={setM} testId="med-m" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Bootstrap 次数</label>
          <select
            value={bootstrap}
            onChange={(e) => setBootstrap(Number(e.target.value))}
            className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm"
            data-testid="select-boot"
          >
            <option value={500}>500</option>
            <option value={1000}>1000（推荐）</option>
            <option value={2000}>2000</option>
            <option value={5000}>5000</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">控制变量</label>
        <VarMultiPicker
          options={ds.cols.filter((c: string) => c !== y && c !== x && c !== m)}
          value={controls}
          onChange={setControls}
          testIdPrefix="med-ctrl"
        />
      </div>
      <Button onClick={run} disabled={loading || !y || !x || !m} data-testid="button-run-med">
        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}运行中介分析
      </Button>

      {r && (
        <div className="space-y-3">
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">回归路径</th>
                  <th className="px-3 py-2 text-right">系数</th>
                  <th className="px-3 py-2 text-right">标准误</th>
                  <th className="px-3 py-2 text-right">p 值</th>
                </tr>
              </thead>
              <tbody>
                {[r.step1_total, r.step2_a, r.step3_b, r.step3_cprime].map((row: any, i: number) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5">{row.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-mono">{fmt(row.coef)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-mono text-muted-foreground">
                      ({fmt(row.se)})
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-mono">
                      {fmt(row.p, 4)} <span className="text-primary">{stars(row.p)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="text-xs text-muted-foreground mb-1">间接效应 a×b</div>
              <div className="text-xl font-mono">{fmt(r.indirect)}</div>
            </div>
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="text-xs text-muted-foreground mb-1">Sobel 检验</div>
              <div className="text-sm">
                z = <span className="font-mono">{fmt(r.sobel.z)}</span>, p ={" "}
                <span className="font-mono">{fmt(r.sobel.p, 4)}</span>{" "}
                <span className="text-primary">{stars(r.sobel.p)}</span>
              </div>
            </div>
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="text-xs text-muted-foreground mb-1">
                Bootstrap 95% CI（B = {r.bootstrap.B}）
              </div>
              <div className="text-sm font-mono">
                [{fmt(r.bootstrap.ci_low)}, {fmt(r.bootstrap.ci_high)}]
              </div>
              <div className="text-xs mt-1">
                {r.bootstrap.significant ? (
                  <span className="text-primary font-medium">CI 不含 0 → 中介显著</span>
                ) : (
                  <span className="text-muted-foreground">CI 含 0 → 不显著</span>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-md border-l-4 border-primary bg-primary/5 px-4 py-3 text-sm">
            <div className="text-xs text-muted-foreground mb-0.5">分析结论</div>
            <div className="font-medium">{r.type}</div>
            <div className="text-xs text-muted-foreground mt-1">N = {r.n}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModerationPanel({ ds }: { ds: any }) {
  const [y, setY] = useState<string | null>(null);
  const [x, setX] = useState<string | null>(null);
  const [w, setW] = useState<string | null>(null);
  const [controls, setControls] = useState<string[]>([]);
  const [center, setCenter] = useState(true);
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!y || !x || !w) return;
    setLoading(true);
    try {
      const res = await pyPost("moderation", { dataset: ds.id, y, x, w, controls, center });
      setR(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-start">
        <div className="text-sm">
          检验「W 是否调节 X 对 Y 的作用强度」。在回归中加入交互项 X × W。
        </div>
        <TeachButton
          topic="调节效应（Moderation）"
          def={{
            what: (
              <p>
                调节变量 W 改变 X 对 Y 的影响强度／方向。例如：金融危机期间（W=1）杠杆率（X）对企业价值（Y）的负向冲击是否更强？通过加入交互项 X × W 来检验。
              </p>
            ),
            formula:
              "Y = \\alpha + \\beta_1 X + \\beta_2 W + \\beta_3 (X \\cdot W) + \\gamma' Z + \\varepsilon",
            why: (
              <>
                <p>
                  <b>为什么要中心化？</b> 直接计算 X×W 时主效应 β₁ 和 β₂ 没有清晰含义（数值依赖于 X、W 的原点）；中心化后 β₁ 表示「W 取平均值时 X 对 Y 的边际效应」，更易解读。
                </p>
                <p>
                  <b>简单斜率（Simple Slopes）</b>：分别报告 W 取低值（mean − SD）和高值（mean + SD）时 X 对 Y 的斜率，让审稿人直观看到调节效应的方向与强度。
                </p>
              </>
            ),
            howToRead: (
              <ul className="list-disc pl-5 space-y-0.5">
                <li>看 <b>交互项 X×W 的系数与显著性</b></li>
                <li>显著且为正 → W 增强 X 对 Y 的正向作用</li>
                <li>显著且为负 → W 削弱（甚至反转）X 对 Y 的作用</li>
                <li>不显著 → 调节效应不成立</li>
                <li>对比 W 高低值下的简单斜率，画出「Johnson-Neyman 图」</li>
              </ul>
            ),
          }}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Y</label>
          <VarSinglePicker options={ds.cols} value={y} onChange={setY} testId="mod-y" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">X</label>
          <VarSinglePicker options={ds.cols} value={x} onChange={setX} testId="mod-x" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">W（调节变量）</label>
          <VarSinglePicker options={ds.cols} value={w} onChange={setW} testId="mod-w" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">控制变量</label>
        <VarMultiPicker
          options={ds.cols.filter((c: string) => c !== y && c !== x && c !== w)}
          value={controls}
          onChange={setControls}
          testIdPrefix="mod-ctrl"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={center}
          onChange={(e) => setCenter(e.target.checked)}
          data-testid="checkbox-center"
        />
        中心化 X 与 W（推荐）
      </label>
      <Button onClick={run} disabled={loading || !y || !x || !w} data-testid="button-run-mod">
        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}运行调节分析
      </Button>

      {r && (
        <div className="space-y-3">
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">变量</th>
                  <th className="px-3 py-2 text-right">系数</th>
                  <th className="px-3 py-2 text-right">SE</th>
                  <th className="px-3 py-2 text-right">t</th>
                  <th className="px-3 py-2 text-right">p</th>
                </tr>
              </thead>
              <tbody>
                {r.coefficients.map((c: any) => (
                  <tr
                    key={c.name}
                    className={`border-t ${c.name === "X×W" ? "bg-primary/5 font-medium" : ""}`}
                  >
                    <td className="px-3 py-1.5 font-mono">{c.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-mono">
                      {fmt(c.coef)}
                      <sup className="text-primary ml-0.5">{c.star}</sup>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-mono text-muted-foreground">
                      {fmt(c.se)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-mono">{fmt(c.t)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-mono">{fmt(c.p, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="text-xs text-muted-foreground mb-1">交互项 X×W</div>
              <div className="text-base">
                系数 = <span className="font-mono">{fmt(r.interaction.coef)}</span>, p ={" "}
                <span className="font-mono">{fmt(r.interaction.p, 4)}</span>
              </div>
              <div className="text-xs mt-1">
                {r.interaction.significant ? (
                  <span className="text-primary font-medium">→ 调节效应显著</span>
                ) : (
                  <span className="text-muted-foreground">→ 调节效应不显著</span>
                )}
              </div>
            </div>
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="text-xs text-muted-foreground mb-1">简单斜率</div>
              <div className="text-sm space-y-0.5">
                <div>
                  低 W (mean − SD): X 斜率 ={" "}
                  <span className="font-mono">{fmt(r.simple_slopes["low_W (mean-SD)"])}</span>
                </div>
                <div>
                  高 W (mean + SD): X 斜率 ={" "}
                  <span className="font-mono">{fmt(r.simple_slopes["high_W (mean+SD)"])}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            N = {r.n}, R² = {fmt(r.r2)}
            {r.centered && " · 已中心化"}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupPanel({ ds }: { ds: any }) {
  const [y, setY] = useState<string | null>(null);
  const [x, setX] = useState<string[]>([]);
  const [group, setGroup] = useState<string | null>(null);
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!y || x.length === 0 || !group) return;
    setLoading(true);
    try {
      setR(await pyPost("group_regression", { dataset: ds.id, y, x, group, cov_type: "HC1" }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-start">
        <div className="text-sm">
          按某个变量（行业、产权性质、规模分位数等）分组，分别跑回归，比较系数差异。
        </div>
        <TeachButton
          topic="分组回归 / 异质性分析"
          def={{
            what: (
              <p>
                把样本按某个分类变量（如国企 vs 民企、大公司 vs 小公司、危机期 vs 平稳期）拆分，分别估计 X 对 Y 的影响，比较系数大小与显著性。
              </p>
            ),
            why: (
              <p>
                平均效应可能掩盖了重要的<b>异质性</b>。例如「ESG 对企业价值的影响」整体看可能不显著，但只在<b>制造业</b>子样本中显著为正——这个发现往往是论文亮点。
              </p>
            ),
            howToRead: (
              <ul className="list-disc pl-5 space-y-0.5">
                <li>对比各组核心 X 的系数大小、符号、显著性</li>
                <li>若各组系数差异较大、且显著性不同 → 存在异质性</li>
                <li>正式检验组间差异：用 Chow 检验（结构突变）或在主回归中加 group × X 交互项</li>
              </ul>
            ),
          }}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Y</label>
          <VarSinglePicker options={ds.cols} value={y} onChange={setY} testId="grp-y" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">X（解释变量）</label>
          <VarMultiPicker options={ds.cols} value={x} onChange={setX} testIdPrefix="grp-x" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">分组变量</label>
          <VarSinglePicker options={ds.cols} value={group} onChange={setGroup} testId="grp-by" />
        </div>
      </div>
      <Button
        onClick={run}
        disabled={loading || !y || x.length === 0 || !group}
        data-testid="button-run-group"
      >
        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}运行分组回归
      </Button>
      {r && (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">分组（{r.by}）</th>
                <th className="px-3 py-2 text-right">N</th>
                <th className="px-3 py-2 text-right">R²</th>
                {x.map((v) => (
                  <th key={v} className="px-3 py-2 text-center font-mono">
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.groups.map((g: any, i: number) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-1.5 font-medium">{g.group}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{g.n}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(g.r2)}</td>
                  {x.map((v) => {
                    const co = g.coefficients?.find((c: any) => c.name === v);
                    return (
                      <td key={v} className="px-3 py-1.5 text-center tabular-nums">
                        {co ? (
                          <>
                            <div className="font-mono">
                              {fmt(co.coef)}
                              <sup className="text-primary ml-0.5">{co.star}</sup>
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              ({fmt(co.se)})
                            </div>
                          </>
                        ) : (
                          g.error || "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
