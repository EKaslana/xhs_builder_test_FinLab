import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { uploadFiles, pyPost } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { TeachButton } from "@/components/teach";
import { DatasetBar } from "@/components/dataset-bar";
import { DataPreview } from "@/components/data-preview";
import { AutoMerge } from "@/components/auto-merge";

export function PageImport() {
  const { datasets, refresh, activeId, setActiveId } = useStore();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // merge state
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [mergeKeys, setMergeKeys] = useState("id,year");
  const [mergeHow, setMergeHow] = useState("inner");
  const [mergeName, setMergeName] = useState("merged");
  const [merging, setMerging] = useState(false);

  const onUpload = async (files: FileList | File[] | null) => {
    if (!files || (files as any).length === 0) return;
    const arr = Array.from(files as FileList);
    // filter for accepted extensions only (defensive — the input has accept=, but drop bypasses it)
    const ok = arr.filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (ok.length === 0) {
      toast({ title: "未识别的文件类型", description: "请选择 .xlsx / .xls / .csv 文件", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const list = await uploadFiles(ok);
      await refresh();
      if (list[0]) setActiveId(list[0].id);
      toast({ title: "上传成功", description: `共导入 ${list.length} 张工作表` });
    } catch (e: any) {
      toast({ title: "上传失败", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dt = e.dataTransfer;
    if (!dt) return;
    // Use items if available (more reliable for folders), else files
    let files: File[] = [];
    if (dt.files && dt.files.length > 0) {
      files = Array.from(dt.files);
    } else if (dt.items && dt.items.length > 0) {
      for (let i = 0; i < dt.items.length; i++) {
        const f = dt.items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) onUpload(files);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // only flip off if leaving the drop zone, not its children
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };

  const onMerge = async () => {
    if (mergeIds.length < 2) {
      toast({ title: "请至少选择 2 个数据集", variant: "destructive" });
      return;
    }
    setMerging(true);
    try {
      const keys = mergeKeys.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await pyPost("merge", {
        datasets: mergeIds, on: keys, how: mergeHow, name: mergeName,
      });
      await refresh();
      setActiveId(r.id);
      toast({ title: "合并完成", description: `共 ${r.rows} 行 × ${r.cols.length} 列` });
    } catch (e: any) {
      toast({ title: "合并失败", description: String(e), variant: "destructive" });
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Upload className="h-4 w-4" />① 上传 Excel / CSV 文件
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              支持多 sheet 的 .xlsx / .xls / .csv；每个工作表会成为独立的数据集。
            </p>
          </div>
          <TeachButton
            topic="面板数据 (Panel Data)"
            def={{
              what: (
                <p>
                  <b>面板数据</b>同时包含 <b>横截面</b>（多家公司/个体）与 <b>时间序列</b>（多年）维度。例如「30 家公司 × 10 年 = 300 条样本」。
                  通常需要一个唯一识别个体的 <code className="font-mono">id</code> 列与一个时间列 <code className="font-mono">year</code>。
                </p>
              ),
              why: (
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>样本量大，参数估计更精确</li>
                  <li>可以控制不随时间变化的个体差异（固定效应），缓解遗漏变量偏差</li>
                  <li>能区分组间差异与个体内变化（within / between）</li>
                </ul>
              ),
              howToRead: (
                <p>
                  上传后，看预览中的「id, year」列是否唯一确定每一行。如果一个 id 在同一 year 出现多次，说明存在重复或主键设计有问题，需先合并/汇总。
                </p>
              ),
            }}
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
          data-testid="input-upload-files"
        />
        <div
          role="button"
          tabIndex={0}
          className={`border-2 border-dashed rounded-lg px-6 py-10 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-input hover:border-primary/50 hover:bg-muted/30"
          }`}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          onDragEnter={onDragOver}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          data-testid="dropzone-upload"
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
          ) : (
            <FileSpreadsheet
              className={`h-6 w-6 mx-auto ${dragOver ? "text-primary" : "text-muted-foreground"}`}
            />
          )}
          <div className="mt-2 text-sm">
            {uploading
              ? "上传中…"
              : dragOver
                ? "松开鼠标开始上传"
                : "点击选择文件，或拖拽到此（支持多文件）"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">.xlsx · .xls · .csv</div>
        </div>
      </Card>

      <DatasetBar />

      {datasets.length >= 1 && <AutoMerge />}

      {datasets.length >= 2 && (
        <Card className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold">②′ 手动合并（高级、按主键 join）</h2>
              <p className="text-xs text-muted-foreground mt-1">
                把多张工作表按 <code className="font-mono">id, year</code>（或自定义键）合并为一张面板表。
              </p>
            </div>
            <TeachButton
              topic="并表与 Join 类型"
              def={{
                what: (
                  <>
                    <p>把多张表按共同的「键」拼成一张宽表。</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                      <li><b>inner</b>：只保留所有表都有的样本（最严格，损失最大）</li>
                      <li><b>left / right</b>：以左/右表为基准</li>
                      <li><b>outer</b>：保留任一表存在的样本，缺失变量为空</li>
                    </ul>
                  </>
                ),
                why: <p>实证论文中常需把财务表 + 公司治理表 + 行业宏观表合并，再做回归。键的设计（通常 id+year）决定了合并质量。</p>,
                howToRead: <p>合并后样本量若大幅减少，说明各表覆盖度差异大；可改用 left join 保留主表全部样本。</p>,
              }}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">选择数据集（至少 2 个，按合并顺序）</label>
              <div className="border rounded-md p-2 max-h-40 overflow-y-auto bg-muted/20">
                {datasets.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mergeIds.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setMergeIds([...mergeIds, d.id]);
                        else setMergeIds(mergeIds.filter((x) => x !== d.id));
                      }}
                    />
                    <span className="text-xs font-mono">{d.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({d.rows}×{d.cols.length})
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">合并键（逗号分隔）</label>
                <Input value={mergeKeys} onChange={(e) => setMergeKeys(e.target.value)}
                  className="font-mono text-sm h-9" placeholder="id, year" data-testid="input-merge-keys" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">连接方式</label>
                <select value={mergeHow} onChange={(e) => setMergeHow(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm">
                  <option value="inner">inner — 只保留两表都有的</option>
                  <option value="left">left — 以左表为基准</option>
                  <option value="right">right — 以右表为基准</option>
                  <option value="outer">outer — 全部保留</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">输出数据集名称</label>
                <Input value={mergeName} onChange={(e) => setMergeName(e.target.value)}
                  className="text-sm h-9" data-testid="input-merge-name" />
              </div>
              <Button onClick={onMerge} disabled={merging || mergeIds.length < 2} className="w-full" data-testid="button-do-merge">
                {merging && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                执行合并
              </Button>
            </div>
          </div>
        </Card>
      )}

      {activeId && (
        <Card className="p-3">
          <DataPreview datasetId={activeId} />
        </Card>
      )}
    </div>
  );
}
