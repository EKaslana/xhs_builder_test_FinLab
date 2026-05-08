import { useEffect, useState } from "react";
import { getDataset } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export function DataPreview({ datasetId, max = 80 }: { datasetId: string; max?: number }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    getDataset(datasetId, max).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, [datasetId, max]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!data) return null;
  const cols: string[] = data.preview.columns;
  const rows: any[] = data.preview.rows;

  return (
    <div className="border rounded-md bg-card overflow-hidden">
      <div className="px-3 py-1.5 text-xs border-b bg-muted/40 flex items-center justify-between">
        <span className="text-muted-foreground">
          数据预览 — 共 <span className="text-foreground tabular-nums">{data.rows}</span> 行 ×{" "}
          <span className="text-foreground tabular-nums">{cols.length}</span> 列（仅显示前 {rows.length} 行）
        </span>
      </div>
      <ScrollArea className="h-72">
        <table className="text-[12px] w-full">
          <thead className="sticky top-0 bg-card z-10 border-b">
            <tr>
              <th className="px-2 py-1.5 text-left text-muted-foreground font-medium tabular-nums w-12 border-r">#</th>
              {cols.map((c) => (
                <th key={c} className="px-2 py-1.5 text-left font-mono font-medium whitespace-nowrap">
                  {c}
                  <div className="text-[10px] text-muted-foreground font-normal">
                    {String(data.dtypes?.[c] || "")}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-2 py-1 text-muted-foreground tabular-nums border-r">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c} className="px-2 py-1 font-mono whitespace-nowrap tabular-nums">
                    {r[c] === null || r[c] === undefined
                      ? <span className="text-muted-foreground italic">NaN</span>
                      : typeof r[c] === "number"
                        ? Number(r[c]).toLocaleString(undefined, { maximumFractionDigits: 4 })
                        : String(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
