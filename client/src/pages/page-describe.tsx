import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Activity } from "lucide-react";
import { useStore } from "@/lib/store";
import { TeachButton } from "@/components/teach";
import { DatasetBar } from "@/components/dataset-bar";
import { VarMultiPicker, VarSinglePicker } from "@/components/var-picker";
import { pyPost } from "@/lib/api";

const fmt = (x: any, d = 3) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(d);

export function PageDescribe() {
  const { datasets, activeId } = useStore();
  const ds = datasets.find((d) => d.id === activeId);
  const [vars, setVars] = useState<string[]>([]);
  const [by, setBy] = useState<string | null>(null);
  const [stdz, setStdz] = useState(false);
  const [data, setData] = useState<any>(null);
  const [corr, setCorr] = useState<any>(null);
  const [method, setMethod] = useState("pearson");
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!ds || vars.length === 0) return;
    setLoading(true);
    try {
      const [d, c] = await Promise.all([
        pyPost("describe", { dataset: ds.id, variables: vars, standardize: stdz, by }),
        pyPost("corr", { dataset: ds.id, variables: vars, method }),
      ]);
      setData(d); setCorr(c);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <DatasetBar />
      {ds && (
        <Card className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4" />描述性统计
              </h2>
              <p className="text-xs text-muted-foreground mt-1">N、均值、标准差、四分位数、分布形态。</p>
            </div>
            <TeachButton
              topic="描述性统计 (Descriptive Statistics)"
              def={{
                what: (
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li><b>N</b>：有效观测数</li>
                    <li><b>Mean / SD</b>：均值与标准差，反映集中趋势与离散程度</li>
                    <li><b>Min / P25 / Median / P75 / Max</b>：分位数，反映分布形状</li>
                    <li><b>Skew / Kurtosis</b>：偏度（&gt;0 右偏）与峰度（&gt;3 比正态尖）</li>
                  </ul>
                ),
                why: <p>论文表 1 几乎都是描述性统计。它让审稿人快速判断：样本是否代表性、是否有极端值需要缩尾、变量量纲是否合理。</p>,
                howToRead: (
                  <ul className="list-disc pl-5 space-y-1">
                    <li>SD 远大于 Mean ⇒ 离散度高，可能需缩尾</li>
                    <li>Median 与 Mean 差距大 ⇒ 分布偏斜，考虑取对数</li>
                    <li>分组（by 处理组/对照组）描述统计 + t 检验 ⇒ 检验组间初始差异</li>
                  </ul>
                ),
              }}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">变量</label>
              <VarMultiPicker options={ds.cols} value={vars} onChange={setVars} testIdPrefix="desc-vars" />
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">分组列（可选）</label>
                <VarSinglePicker options={ds.cols} value={by} onChange={setBy} allowEmpty testId="select-desc-by" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={stdz} onChange={(e) => setStdz(e.target.checked)} />
                标准化变量后再统计
              </label>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">相关系数方法</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm">
                  <option value="pearson">Pearson</option>
                  <option value="spearman">Spearman</option>
                  <option value="kendall">Kendall</option>
                </select>
              </div>
            </div>
            <div className="flex items-end">
              <Button onClick={run} disabled={loading || vars.length === 0} className="w-full" data-testid="button-run-describe">
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                生成
              </Button>
            </div>
          </div>
        </Card>
      )}

      {data && (
        <Card className="p-3 overflow-x-auto">
          <div className="px-2 py-1 text-sm font-medium border-b mb-2">总体描述统计</div>
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="border-b">
                <th className="px-2 py-1.5 text-left">变量</th>
                {["N", "Mean", "SD", "Min", "P25", "Median", "P75", "Max", "Skew", "Kurt"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-right tabular-nums">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vars.map((v) => {
                const r = data.overall[v];
                if (!r) return null;
                return (
                  <tr key={v} className="border-b last:border-b-0">
                    <td className="px-2 py-1.5 font-mono">{v}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.N}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.mean)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.sd)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.min)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.p25)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.median)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.p75)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.max)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.skew, 2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.kurtosis, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.grouped && (
            <div className="mt-4">
              <div className="px-2 py-1 text-sm font-medium border-b mb-2">分组描述统计 (by {by})</div>
              {Object.entries(data.grouped).map(([gname, gstats]: any) => (
                <div key={gname} className="mb-4">
                  <div className="text-xs text-muted-foreground px-2 py-1">分组 = <span className="font-mono text-foreground">{gname}</span></div>
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr className="border-b">
                        <th className="px-2 py-1 text-left">变量</th>
                        {["N", "Mean", "SD", "Min", "Med", "Max"].map((h) => (
                          <th key={h} className="px-2 py-1 text-right tabular-nums">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vars.map((v) => {
                        const r = gstats[v]; if (!r) return null;
                        return (
                          <tr key={v} className="border-b last:border-b-0">
                            <td className="px-2 py-1 font-mono">{v}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{r.N}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmt(r.mean)}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmt(r.sd)}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmt(r.min)}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmt(r.median)}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmt(r.max)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {corr && (
        <Card className="p-3">
          <div className="flex items-center justify-between px-2 py-1 mb-2">
            <div className="text-sm font-medium">相关系数矩阵 ({corr.n} obs)</div>
            <TeachButton
              topic="相关系数矩阵 (Correlation Matrix)"
              def={{
                what: <p>变量两两之间的线性相关程度，取值 [-1, 1]。Pearson 默认衡量线性关系；Spearman/Kendall 衡量秩相关，对极端值更稳健。</p>,
                why: <p>报告在论文里能让审稿人一眼判断：被解释变量与解释变量是否有合理相关；自变量之间是否高度相关（多重共线性预警）。</p>,
                howToRead: <p>对角线全是 1。<b>系数 |r| &gt; 0.7</b> 通常预示多重共线性问题，应进一步看 VIF。星号表示显著性：<code>***</code> p&lt;0.01，<code>**</code> p&lt;0.05，<code>*</code> p&lt;0.1。</p>,
              }}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr><th></th>{corr.columns.map((c: string) => <th key={c} className="px-2 py-1 font-mono">{c}</th>)}</tr>
              </thead>
              <tbody>
                {corr.columns.map((row: string, i: number) => (
                  <tr key={row}>
                    <td className="px-2 py-1 font-mono font-medium">{row}</td>
                    {corr.columns.map((_: string, j: number) => {
                      const r = corr.corr[i][j];
                      const p = corr.p[i][j];
                      const star = i === j ? "" : (p < 0.01 ? "***" : p < 0.05 ? "**" : p < 0.1 ? "*" : "");
                      const intensity = Math.abs(r);
                      const bg = i === j ? "" :
                        r > 0 ? `rgba(10, 88, 118, ${0.05 + intensity * 0.4})` :
                                `rgba(180, 60, 60, ${0.05 + intensity * 0.4})`;
                      return (
                        <td key={j} className="px-2 py-1 text-right tabular-nums" style={{ backgroundColor: bg }}>
                          {fmt(r)}<span className="text-[10px]">{star}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 px-2">*** p&lt;0.01, ** p&lt;0.05, * p&lt;0.1</div>
        </Card>
      )}
    </div>
  );
}
