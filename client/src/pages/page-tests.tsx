import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, FlaskConical } from "lucide-react";
import { useStore } from "@/lib/store";
import { TeachButton } from "@/components/teach";
import { DatasetBar } from "@/components/dataset-bar";
import { VarMultiPicker, VarSinglePicker } from "@/components/var-picker";
import { pyPost } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const fmt = (x: any, d = 4) => x === null || x === undefined ? "—" : Number(x).toFixed(d);
const stars = (p: number) => p < 0.01 ? "***" : p < 0.05 ? "**" : p < 0.1 ? "*" : "";

export function PageTests() {
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
                <FlaskConical className="h-4 w-4" />假设检验工具箱
              </h2>
              <p className="text-xs text-muted-foreground mt-1">t 检验、Wald 联合检验、VIF 共线性、Hausman 模型选择。</p>
            </div>
          </div>

          <Tabs defaultValue="t" className="w-full">
            <TabsList className="grid grid-cols-4 w-full max-w-2xl">
              <TabsTrigger value="t">t 检验</TabsTrigger>
              <TabsTrigger value="wald">Wald 检验</TabsTrigger>
              <TabsTrigger value="vif">VIF 共线性</TabsTrigger>
              <TabsTrigger value="hausman">Hausman</TabsTrigger>
            </TabsList>
            <TabsContent value="t" className="mt-4"><TTestPanel ds={ds} /></TabsContent>
            <TabsContent value="wald" className="mt-4"><WaldPanel ds={ds} /></TabsContent>
            <TabsContent value="vif" className="mt-4"><VIFPanel ds={ds} /></TabsContent>
            <TabsContent value="hausman" className="mt-4"><HausmanPanel ds={ds} /></TabsContent>
          </Tabs>
        </Card>
      )}
    </div>
  );
}

function TTestPanel({ ds }: { ds: any }) {
  const [variable, setVariable] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [mu, setMu] = useState("0");
  const [equalVar, setEqualVar] = useState(false);
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (!variable) return;
    setLoading(true);
    try {
      const result = await pyPost("ttest", { dataset: ds.id, variable, group, mu: group ? null : Number(mu), equal_var: equalVar });
      setR(result);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-start">
        <div className="text-sm">用于检验「样本均值是否等于某值」（单样本）或「两组均值是否相同」（双样本）。</div>
        <TeachButton topic="t 检验" def={{
          what: <><p>检验某个均值是否等于某个值，或两组均值是否显著不同。</p></>,
          formula: "t = \\frac{\\bar{X} - \\mu_0}{s / \\sqrt{n}} \\quad \\text{(单样本)}",
          why: <p>实证常用于：(1) 处理组 vs 对照组在解释变量上是否有显著差异；(2) DID 设计中事前平行趋势的初步检验。</p>,
          howToRead: <p>看 <b>p 值</b>：p &lt; 0.05 拒绝"均值相同"的原假设。结合 t 统计量符号判断方向。</p>,
        }} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">检验变量</label>
          <VarSinglePicker options={ds.cols} value={variable} onChange={setVariable} testId="ttest-var" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">分组变量（可选，留空则做单样本）</label>
          <VarSinglePicker options={ds.cols} value={group} onChange={setGroup} allowEmpty testId="ttest-group" />
        </div>
        {!group && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">假设均值 μ₀</label>
            <Input value={mu} onChange={(e) => setMu(e.target.value)} className="h-9 text-sm" />
          </div>
        )}
        {group && (
          <label className="flex items-center gap-2 text-sm pt-6">
            <input type="checkbox" checked={equalVar} onChange={(e) => setEqualVar(e.target.checked)} />
            假设两组方差相同
          </label>
        )}
      </div>
      <Button onClick={run} disabled={!variable || loading}>
        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}运行 t 检验
      </Button>
      {r && (
        <div className="border rounded-md p-3 bg-muted/20 text-sm space-y-1.5">
          {r.type === "two-sample" ? (
            <>
              <div className="font-medium">双样本 t 检验</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>组 1 ({r.groups[0]}): n = {r.n1}, 均值 = {fmt(r.mean1)}</div>
                <div>组 2 ({r.groups[1]}): n = {r.n2}, 均值 = {fmt(r.mean2)}</div>
                <div>均值差: <span className="font-mono">{fmt(r.diff)}</span></div>
                <div>t 统计量: <span className="font-mono">{fmt(r.t)}</span></div>
                <div className="col-span-2">p 值: <span className="font-mono">{fmt(r.p, 6)}</span> <span className="text-primary">{stars(r.p)}</span></div>
              </div>
            </>
          ) : (
            <>
              <div className="font-medium">单样本 t 检验</div>
              <div className="text-xs space-y-0.5">
                <div>n = {r.n}, 样本均值 = {fmt(r.mean)}, μ₀ = {r.mu}</div>
                <div>t = {fmt(r.t)}, p = {fmt(r.p, 6)} <span className="text-primary">{stars(r.p)}</span></div>
              </div>
            </>
          )}
          <div className="text-xs text-muted-foreground pt-1 border-t">
            {r.p < 0.05 ? "→ 拒绝原假设，差异显著" : "→ 不拒绝原假设，差异不显著"}
          </div>
        </div>
      )}
    </div>
  );
}

function WaldPanel({ ds }: { ds: any }) {
  const [y, setY] = useState<string | null>(null);
  const [x, setX] = useState<string[]>([]);
  const [test, setTest] = useState<string[]>([]);
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (!y || x.length === 0 || test.length === 0) return;
    setLoading(true);
    try { setR(await pyPost("wald", { dataset: ds.id, y, x, test })); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-start">
        <div className="text-sm">联合检验「多个系数同时为 0」的假设。常用于检验一组哑变量、政策虚拟变量整体是否显著。</div>
        <TeachButton topic="Wald 检验 / F 检验" def={{
          what: <p>对多元回归模型，检验一组系数是否<b>同时为 0</b>。Wald 检验在大样本下与 F 检验等价。</p>,
          formula: "H_0: \\beta_1 = \\beta_2 = \\cdots = \\beta_k = 0",
          why: <p>当解释变量是一组（如 5 个行业哑变量），单独看每个 t 值不可靠，Wald/F 检验从整体上回答"这组变量是否有解释力"。</p>,
          howToRead: <p>看 <b>F 值</b>与 <b>p 值</b>。p &lt; 0.05 → 拒绝"全为 0"的原假设，说明这组变量整体显著。</p>,
        }} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">被解释变量 Y</label>
          <VarSinglePicker options={ds.cols} value={y} onChange={setY} testId="wald-y" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">解释变量 X（全部）</label>
          <VarMultiPicker options={ds.cols} value={x} onChange={setX} testIdPrefix="wald-x" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">联合检验的变量子集</label>
          <VarMultiPicker options={x} value={test} onChange={setTest} testIdPrefix="wald-test" />
        </div>
      </div>
      <Button onClick={run} disabled={loading || !y || x.length === 0 || test.length === 0}>
        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}运行 Wald 检验
      </Button>
      {r && (
        <div className="border rounded-md p-3 bg-muted/20 text-sm space-y-1.5">
          <div className="text-xs font-mono">{r.hypothesis}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>F = <span className="font-mono">{fmt(r.F)}</span></div>
            <div>df = ({r.df_num}, {r.df_den})</div>
            <div>p = <span className="font-mono">{fmt(r.p, 6)}</span> <span className="text-primary">{stars(r.p)}</span></div>
            <div className="col-span-full text-muted-foreground border-t pt-1.5 mt-1">
              {r.p < 0.05 ? `→ 拒绝原假设：${r.tested.join(", ")} 联合显著` : "→ 不拒绝原假设：联合不显著"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VIFPanel({ ds }: { ds: any }) {
  const [vars, setVars] = useState<string[]>([]);
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (vars.length < 2) return;
    setLoading(true);
    try { setR(await pyPost("vif", { dataset: ds.id, variables: vars })); } finally { setLoading(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-start">
        <div className="text-sm">检测自变量之间的多重共线性。VIF 越大共线性越严重。</div>
        <TeachButton topic="VIF 多重共线性" def={{
          what: <p>方差膨胀因子（VIF）= 1 / (1 − R²ᵢ)，其中 R²ᵢ 是第 i 个自变量被其他自变量回归的拟合度。</p>,
          formula: "VIF_i = \\frac{1}{1 - R^2_i}",
          why: <p>多重共线性会让回归系数标准误过大、显著性下降甚至符号反转，让你误判变量"不显著"。</p>,
          howToRead: <p><b>VIF &lt; 5</b>：基本无共线性；<b>5–10</b>：警戒；<b>&gt; 10</b>：严重，应剔除冗余变量或使用主成分。</p>,
        }} />
      </div>
      <VarMultiPicker options={ds.cols} value={vars} onChange={setVars} testIdPrefix="vif" />
      <Button onClick={run} disabled={loading || vars.length < 2}>
        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}计算 VIF
      </Button>
      {r && (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr><th className="px-3 py-2 text-left">变量</th><th className="px-3 py-2 text-right">VIF</th><th className="px-3 py-2 text-left">判断</th></tr>
            </thead>
            <tbody>
              {r.vif.map((v: any) => (
                <tr key={v.variable} className="border-t">
                  <td className="px-3 py-1.5 font-mono">{v.variable}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(v.vif, 2)}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {v.vif < 5 ? <span className="text-green-600">良好</span> :
                     v.vif < 10 ? <span className="text-amber-600">警戒</span> :
                     <span className="text-destructive">严重</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HausmanPanel({ ds }: { ds: any }) {
  const [y, setY] = useState<string | null>(null);
  const [x, setX] = useState<string[]>([]);
  const [entity, setEntity] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (!y || x.length === 0 || !entity || !time) return;
    setLoading(true);
    try { setR(await pyPost("hausman", { dataset: ds.id, y, x, entity, time })); } finally { setLoading(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-start">
        <div className="text-sm">面板回归：在固定效应（FE）与随机效应（RE）之间做选择。</div>
        <TeachButton topic="Hausman 检验" def={{
          what: <p>在 FE 与 RE 估计之间做选择。原假设 H₀：RE 与 FE 系数无系统差异（即可用更高效的 RE）。</p>,
          why: <p>RE 假定个体效应与解释变量不相关。如果违反此假设，RE 会有偏，必须用 FE。</p>,
          howToRead: <p><b>p &lt; 0.05</b> → 拒绝原假设，应使用 FE；<b>p &gt; 0.05</b> → 可以使用更有效率的 RE。</p>,
        }} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label className="text-xs text-muted-foreground mb-1 block">Y</label>
          <VarSinglePicker options={ds.cols} value={y} onChange={setY} testId="haus-y" /></div>
        <div className="col-span-2"><label className="text-xs text-muted-foreground mb-1 block">X</label>
          <VarMultiPicker options={ds.cols} value={x} onChange={setX} testIdPrefix="haus-x" /></div>
        <div><label className="text-xs text-muted-foreground mb-1 block">个体ID</label>
          <VarSinglePicker options={ds.cols} value={entity} onChange={setEntity} testId="haus-entity" /></div>
        <div><label className="text-xs text-muted-foreground mb-1 block">时间</label>
          <VarSinglePicker options={ds.cols} value={time} onChange={setTime} testId="haus-time" /></div>
      </div>
      <Button onClick={run} disabled={loading || !y || x.length === 0 || !entity || !time}>
        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}运行 Hausman
      </Button>
      {r && (
        <div className="border rounded-md p-3 bg-muted/20 text-sm">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>H 统计量: <span className="font-mono">{fmt(r.H)}</span></div>
            <div>自由度: {r.df}</div>
            <div>p 值: <span className="font-mono">{fmt(r.p, 6)}</span> <span className="text-primary">{stars(r.p)}</span></div>
          </div>
          <div className="border-t mt-2 pt-2 text-sm font-medium text-primary">{r.decision}</div>
        </div>
      )}
    </div>
  );
}
