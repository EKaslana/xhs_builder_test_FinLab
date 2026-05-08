import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider } from "@/lib/store";
import NotFound from "@/pages/not-found";
import { PageImport } from "@/pages/page-import";
import { PageClean } from "@/pages/page-clean";
import { PageDescribe } from "@/pages/page-describe";
import { PageTests } from "@/pages/page-tests";
import { PageRegression } from "@/pages/page-regression";
import { PageMechanism } from "@/pages/page-mechanism";
import { PageExport } from "@/pages/page-export";
import { PageTemplates } from "@/pages/page-templates";
import {
  Upload,
  Sparkles,
  Activity,
  FlaskConical,
  BarChart3,
  Workflow,
  FileText,
  TrendingUp,
  BookMarked,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { path: "/", label: "数据导入", num: "①", icon: Upload, comp: PageImport },
  { path: "/clean", label: "数据清洗", num: "②", icon: Sparkles, comp: PageClean },
  { path: "/describe", label: "描述统计", num: "③", icon: Activity, comp: PageDescribe },
  { path: "/tests", label: "假设检验", num: "④", icon: FlaskConical, comp: PageTests },
  { path: "/regression", label: "基准回归", num: "⑤", icon: BarChart3, comp: PageRegression },
  { path: "/mechanism", label: "机制分析", num: "⑥", icon: Workflow, comp: PageMechanism },
  { path: "/templates", label: "实证模板", num: "⑦", icon: BookMarked, comp: PageTemplates },
  { path: "/export", label: "结果导出", num: "⑧", icon: FileText, comp: PageExport },
];

function Sidebar() {
  const [location] = useLocation();
  return (
    <aside className="w-56 border-r border-border bg-card flex flex-col shrink-0">
      <div className="px-4 py-4 border-b">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">金融实证分析</div>
            <div className="text-[11px] text-muted-foreground leading-tight">
              Empirical Finance Lab
            </div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map((n) => {
          const active = location === n.path;
          const Icon = n.icon;
          return (
            <Link
              key={n.path}
              href={n.path}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm hover-elevate cursor-pointer transition-colors",
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-foreground/80 hover:text-foreground"
              )}
              data-testid={`nav-${n.path.slice(1) || "home"}`}
            >
              <span
                className={cn(
                  "text-xs tabular-nums w-4 text-center",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                {n.num}
              </span>
              <Icon className="h-4 w-4" />
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t text-[11px] text-muted-foreground leading-relaxed">
        <div className="font-medium text-foreground mb-1">教学模式</div>
        每个模块右上角的「学一学」按钮提供该方法的「是什么 / 为什么 / 怎么读」详解。
      </div>
    </aside>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-6xl mx-auto px-6 py-6">{children}</div>
      </main>
    </div>
  );
}

function AppRouter() {
  return (
    <Layout>
      <Switch>
        {NAV.map((n) => (
          <Route key={n.path} path={n.path} component={n.comp} />
        ))}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <StoreProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </StoreProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
