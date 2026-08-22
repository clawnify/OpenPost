import { LayoutDashboard, PenSquare, Calendar, ListOrdered, FileText, Radio, BarChart3 } from "lucide-preact";
import type { View } from "../types";

const NAV: Array<{ view: View; path: string; label: string; icon: any }> = [
  { view: "dashboard", path: "/", label: "Dashboard", icon: LayoutDashboard },
  { view: "compose", path: "/compose", label: "Compose", icon: PenSquare },
  { view: "calendar", path: "/calendar", label: "Calendar", icon: Calendar },
  { view: "queue", path: "/queue", label: "Queue", icon: ListOrdered },
  { view: "drafts", path: "/drafts", label: "Drafts", icon: FileText },
  { view: "channels", path: "/channels", label: "Channels", icon: Radio },
  { view: "analytics", path: "/analytics", label: "Analytics", icon: BarChart3 },
];

interface Props {
  currentView: View;
  navigate: (path: string) => void;
}

export function Sidebar({ currentView, navigate }: Props) {
  return (
    <aside class="w-60 shrink-0 bg-card h-screen sticky top-0 flex flex-col border-r border-border">
      <div
        class="flex items-center gap-2 px-4 py-4 cursor-pointer hover:bg-accent transition-colors"
        onClick={() => navigate("/")}
      >
        <Radio size={20} class="text-primary" />
        <span class="font-semibold text-base">OpenPost</span>
      </div>

      <nav class="flex-1 px-2 py-2 space-y-0.5">
        {NAV.map((item) => (
          <a
            key={item.view}
            href={item.path}
            onClick={(e) => { e.preventDefault(); navigate(item.path); }}
            class={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
              currentView === item.view
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
}
