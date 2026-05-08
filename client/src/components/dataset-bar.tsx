import { useStore } from "@/lib/store";
import { Database, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function DatasetBar() {
  const { datasets, activeId, setActiveId, removeDataset } = useStore();
  if (datasets.length === 0) {
    return (
      <div className="text-xs text-muted-foreground px-3 py-2 border rounded-md bg-muted/30">
        尚未上传任何数据集 → 请前往「① 数据导入」页签上传 Excel 文件。
      </div>
    );
  }
  return (
    <div className="border rounded-md bg-card overflow-hidden">
      <div className="px-3 py-1.5 text-xs font-medium border-b text-muted-foreground bg-muted/40 flex items-center gap-1.5">
        <Database className="h-3.5 w-3.5" />
        数据集（点击切换当前分析对象）
      </div>
      <div className="flex flex-wrap gap-1 p-2">
        {datasets.map((d) => (
          <button
            key={d.id}
            onClick={() => setActiveId(d.id)}
            className={cn(
              "px-2.5 py-1.5 rounded-md text-xs flex items-center gap-2 border hover-elevate group",
              activeId === d.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-background"
            )}
            data-testid={`button-dataset-${d.id}`}
          >
            <span className="font-mono">{d.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {d.rows}×{d.cols.length}
            </span>
            <Trash2
              className="h-3 w-3 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`确认删除数据集 "${d.name}"？`)) removeDataset(d.id);
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
