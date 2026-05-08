import { ReactNode, useState } from "react";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";

export type TeachDef = {
  what: ReactNode;
  why: ReactNode;
  howToRead: ReactNode;
  formula?: string; // KaTeX-rendered if provided
  example?: ReactNode;
};

export function TeachButton({ topic, def }: { topic: string; def: TeachDef }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          data-testid={`button-teach-${topic.replace(/\s/g, "")}`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          学一学
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-lg">{topic}</SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="what" className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="what">是什么</TabsTrigger>
            <TabsTrigger value="why">为什么</TabsTrigger>
            <TabsTrigger value="how">怎么读</TabsTrigger>
          </TabsList>
          <TabsContent value="what" className="mt-4 space-y-3 text-sm leading-relaxed text-foreground">
            {def.what}
            {def.formula && <FormulaBlock tex={def.formula} />}
          </TabsContent>
          <TabsContent value="why" className="mt-4 space-y-3 text-sm leading-relaxed text-foreground">
            {def.why}
          </TabsContent>
          <TabsContent value="how" className="mt-4 space-y-3 text-sm leading-relaxed text-foreground">
            {def.howToRead}
            {def.example && (
              <div className="mt-4 p-3 rounded-md bg-muted/50 border border-border text-xs">
                <div className="text-muted-foreground mb-1.5 font-medium">举例</div>
                {def.example}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

export function FormulaBlock({ tex }: { tex: string }) {
  return <KatexInline tex={tex} block />;
}

export function KatexInline({ tex, block = false }: { tex: string; block?: boolean }) {
  // dynamic import to keep main bundle lean
  const [html, setHtml] = useState<string>("");
  if (!html) {
    import("katex").then((k) => {
      try {
        setHtml(k.default.renderToString(tex, { displayMode: block, throwOnError: false }));
      } catch {
        setHtml(`<code>${tex}</code>`);
      }
    });
  }
  return (
    <div
      className={block ? "katex-block my-3 overflow-x-auto" : "katex-inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
