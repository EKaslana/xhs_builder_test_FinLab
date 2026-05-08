import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function VarMultiPicker({
  options,
  value,
  onChange,
  placeholder = "选择变量",
  testIdPrefix = "var",
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  testIdPrefix?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(q.toLowerCase())),
    [options, q]
  );
  const toggle = (o: string) => {
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  };
  return (
    <div className="border rounded-md bg-card">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="border-0 h-7 px-0 focus-visible:ring-0 text-sm"
          data-testid={`input-${testIdPrefix}-search`}
        />
        {value.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            清空
          </button>
        )}
      </div>
      {value.length > 0 && (
        <div className="px-2 py-1.5 flex flex-wrap gap-1 border-b bg-muted/30">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 h-6 font-mono text-[11px]">
              {v}
              <X className="h-3 w-3 cursor-pointer" onClick={() => toggle(v)} />
            </Badge>
          ))}
        </div>
      )}
      <ScrollArea className="h-44">
        <div className="p-1">
          {filtered.map((o) => {
            const active = value.includes(o);
            return (
              <button
                key={o}
                onClick={() => toggle(o)}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 hover-elevate font-mono",
                  active && "text-primary"
                )}
                data-testid={`option-${testIdPrefix}-${o}`}
              >
                <span
                  className={cn(
                    "h-3.5 w-3.5 rounded border flex items-center justify-center",
                    active ? "bg-primary border-primary" : "border-input"
                  )}
                >
                  {active && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </span>
                {o}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">无匹配项</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function VarSinglePicker({
  options,
  value,
  onChange,
  placeholder = "选择",
  allowEmpty = false,
  testId,
}: {
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  testId?: string;
}) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm font-mono"
      data-testid={testId}
    >
      <option value="">{allowEmpty ? "(无)" : placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
