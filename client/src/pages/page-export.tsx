import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, FileText, Copy, Check } from "lucide-react";
import { useStore } from "@/lib/store";
import { TeachButton } from "@/components/teach";
import { pyPost } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function PageExport() {
  const { regResults } = useStore();
  const [fmt, setFmt] = useState<"latex" | "csv" | "text">("latex");
  const [digits, setDigits] = useState(3);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async (newFmt?: "latex" | "csv" | "text") => {
    if (regResults.length === 0) return;
    const f = newFmt || fmt;
    setFmt(f);
    setLoading(true);
    try {
      const res = await pyPost<{ content: string }>("export_table", {
        columns: regResults,
        fmt: f,
        digits,
      });
      setContent(res.content);
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = () => {
    if (!content) return;
    const ext = fmt === "latex" ? "tex" : fmt === "csv" ? "csv" : "md";
    const mime =
      fmt === "csv" ? "text/csv" : fmt === "latex" ? "application/x-tex" : "text/markdown";
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `regression_table.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />结果导出（论文式三线表）
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              将「⑤ 基准回归」中并列展示的回归结果导出为 LaTeX / CSV / Markdown 三线表格式。
            </p>
          </div>
          <TeachButton
            topic="论文级三线表（Three-line Table）"
            def={{
              what: (
                <>
                  <p>
                    经济学/金融论文的标准回归表格式：只有<b>顶端线、表头线、表底线</b>三条横线，没有竖线，行间距紧凑——这就是「三线表」。
                  </p>
                  <p>
                    系数下方括号内是<b>标准误</b>（部分期刊偏好 t 值），右上角的星号表示显著性水平（*** p&lt;0.01, ** p&lt;0.05, * p&lt;0.1）。
                  </p>
                </>
              ),
              why: (
                <>
                  <p>
                    LaTeX 格式可直接粘贴进 Overleaf 论文模板（需 booktabs 宏包以获得真正的三线表线条）；CSV 适合在 Word / 数据处理；Markdown 适合写汇报草稿。
                  </p>
                </>
              ),
              howToRead: (
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>每列一个回归设定（OLS、+ 控制变量、+ FE、+ 双向 FE）</li>
                  <li>系数稳健（across columns）→ 核心结论可信</li>
                  <li>表底报告 N、R²、FE 是否包含等控制信息</li>
                  <li>表注交代标准误类型（Robust 或 Cluster）和显著性水平</li>
                </ul>
              ),
            }}
          />
        </div>

        {regResults.length === 0 ? (
          <div className="border-2 border-dashed rounded-lg py-10 text-center">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <div className="text-sm text-muted-foreground">
              尚无可导出的回归结果。请先在「⑤ 基准回归」页运行回归。
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">导出格式</label>
                <Tabs
                  value={fmt}
                  onValueChange={(v) => generate(v as any)}
                  className="w-full"
                >
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="latex" data-testid="tab-latex">
                      LaTeX
                    </TabsTrigger>
                    <TabsTrigger value="csv" data-testid="tab-csv">
                      CSV
                    </TabsTrigger>
                    <TabsTrigger value="text" data-testid="tab-md">
                      Markdown
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">小数位数</label>
                <select
                  value={digits}
                  onChange={(e) => setDigits(Number(e.target.value))}
                  className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm"
                  data-testid="select-digits"
                >
                  <option value={2}>2 位</option>
                  <option value={3}>3 位（默认）</option>
                  <option value={4}>4 位</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => generate()}
                  disabled={loading}
                  className="w-full"
                  data-testid="button-generate"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4 mr-2" />
                  )}
                  生成 {fmt === "latex" ? "LaTeX" : fmt === "csv" ? "CSV" : "Markdown"}
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground mb-2">
              当前包含 <span className="font-medium text-foreground">{regResults.length}</span>{" "}
              列回归结果：
              {regResults.map((c, i) => (
                <span
                  key={i}
                  className="ml-2 px-2 py-0.5 rounded bg-muted text-foreground font-mono"
                >
                  {c.label || `(${i + 1})`}
                </span>
              ))}
            </div>

            {content ? (
              <div className="space-y-2">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyToClipboard}
                    data-testid="button-copy"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {copied ? "已复制" : "复制"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadFile}
                    data-testid="button-download"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    下载
                  </Button>
                </div>
                <pre
                  className="text-xs p-4 rounded-md border bg-muted/30 overflow-x-auto whitespace-pre font-mono leading-relaxed max-h-[500px] overflow-y-auto"
                  data-testid="pre-output"
                >
                  {content}
                </pre>
                {fmt === "latex" && (
                  <div className="text-xs text-muted-foreground p-3 rounded bg-muted/20 border">
                    <div className="font-medium mb-1">LaTeX 使用提示</div>
                    在导言区添加：
                    <code className="font-mono px-1 py-0.5 rounded bg-muted text-foreground">
                      \usepackage{"{booktabs}"}, \usepackage{"{threeparttable}"}
                    </code>
                    ，可获得论文标准三线表外观。
                  </div>
                )}
              </div>
            ) : (
              <div className="border-2 border-dashed rounded-lg py-8 text-center">
                <div className="text-sm text-muted-foreground">点击「生成」按钮以生成导出内容</div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
