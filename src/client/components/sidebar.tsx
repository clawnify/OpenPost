import { useState } from "preact/hooks";
import { AppNav, embedded } from "@clawnify/app/client";
import { LayoutDashboard, PenSquare, Calendar, ListOrdered, FileText, Radio, BarChart3, PanelLeft } from "lucide-preact";
import type { View } from "../types";

// Inside the Clawnify workspace the host draws these sections in its own
// sidebar (icon names from the host's library).
const HOST_ICONS: Record<View, string> = {
  dashboard: "layout-dashboard",
  compose: "message-square",
  calendar: "calendar",
  queue: "list",
  drafts: "file-text",
  channels: "globe",
  analytics: "bar-chart-3",
};

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

// The shell's sidebar: a brand row the same height as the page toolbar (so
// their bottom rules meet as one line), 28px nav rows with a neutral active
// fill, and a collapse toggle that folds it to icons only.
export function Sidebar({ currentView, navigate }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (embedded) {
    return (
      <AppNav
        title="Post"
        icon="send"
        active={currentView}
        groups={[{
          items: NAV.map((item) => ({
            id: item.view,
            label: item.label,
            href: item.path,
            icon: HOST_ICONS[item.view],
            home: item.view === "dashboard",
          })),
        }]}
        onNavigate={(item) => item.href && navigate(item.href)}
      />
    );
  }

  return (
    <aside
      class={`shrink-0 h-screen sticky top-0 flex flex-col bg-muted border-r border-border transition-[width] duration-150 ${collapsed ? "w-14" : "w-[275px]"}`}
    >
      <div class={`flex items-center h-14 border-b border-border ${collapsed ? "justify-center px-0" : "gap-2.5 px-4"}`}>
        <button type="button" class="app-icon size-7" onClick={() => navigate("/")} aria-label="OpenPost home">
          <Radio size={16} strokeWidth={2.25} />
        </button>
        {!collapsed && (
          <>
            <span class="font-semibold">OpenPost</span>
            <button
              type="button"
              class="icon-btn ml-auto"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeft size={16} />
            </button>
          </>
        )}
      </div>

      <nav class={`flex-1 py-2 space-y-px ${collapsed ? "px-2" : "px-2"}`}>
        {NAV.map((item) => {
          const active = currentView === item.view;
          return (
            <a
              key={item.view}
              href={item.path}
              onClick={(e) => { e.preventDefault(); navigate(item.path); }}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              class={`flex h-7 items-center rounded-[9px] text-sm font-medium tracking-[-0.01em] transition-colors ${
                collapsed ? "justify-center px-0" : "gap-1.5 pl-2 pr-4"
              } ${active ? "bg-black/[0.04] text-foreground" : "text-foreground hover:bg-black/[0.03]"}`}
            >
              <item.icon size={16} />
              {!collapsed && <span>{item.label}</span>}
            </a>
          );
        })}
      </nav>

      {collapsed && (
        <button
          type="button"
          class="icon-btn mx-auto mb-3"
          onClick={() => setCollapsed(false)}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeft size={16} />
        </button>
      )}
    </aside>
  );
}
