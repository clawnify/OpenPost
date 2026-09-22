import { useEffect } from "preact/hooks";
import { AppNav, reportLocation, type AppNavItem } from "@clawnify/app/client";
import { AppContext } from "./context";
import { useAppState } from "./hooks/use-app";
import { useRouter } from "./hooks/use-router";
import { ErrorBanner } from "./components/error-banner";
import { Dashboard } from "./components/dashboard";
import { PostComposer } from "./components/post-composer";
import { CalendarView } from "./components/calendar-view";
import { QueueView } from "./components/queue-view";
import { DraftsView } from "./components/drafts-view";
import { ChannelList } from "./components/channel-list";
import { AnalyticsView } from "./components/analytics-view";

// One definition of the navigation. <AppNav> paints it as this app's own
// sidebar when the app is opened directly, and hands the same list to the
// Clawnify dashboard's sidebar when it is embedded there — so the user always
// sees one nav, never two. Item ids match the router's view names, which is
// what keeps `active` a straight lookup.
const PLANNING: AppNavItem[] = [
  // The dashboard is home: not a row of its own, the app's name opens it.
  { id: "dashboard", label: "Dashboard", href: "/", home: true },
  { id: "compose", label: "Compose", href: "/compose", icon: "sparkles", color: "violet" },
  { id: "calendar", label: "Calendar", href: "/calendar", icon: "calendar", color: "blue" },
  { id: "queue", label: "Queue", href: "/queue", icon: "clock", color: "amber" },
  { id: "drafts", label: "Drafts", href: "/drafts", icon: "file-text", color: "sky" },
  { id: "analytics", label: "Analytics", href: "/analytics", icon: "bar-chart-3", color: "pink" },
];
const SETTINGS: AppNavItem[] = [
  { id: "channels", label: "Channels", href: "/channels", icon: "hash", color: "green" },
];

export function App() {
  const appState = useAppState();
  const { view, editId, path, navigate } = useRouter();

  // Lets the dashboard restore this exact screen on reload.
  useEffect(() => {
    reportLocation(path);
  }, [path]);

  // Counts are plain state: the badges move the moment the numbers do, with
  // no endpoint and no polling behind them. Zero reads as no badge at all.
  const counts: Record<string, number> = {
    queue: appState.stats?.scheduled ?? 0,
    drafts: appState.stats?.drafts ?? 0,
  };
  const groups = [
    { items: PLANNING.map((item) => (counts[item.id] ? { ...item, count: counts[item.id] } : item)) },
    { label: "Settings", items: SETTINGS },
  ];

  const renderMain = () => {
    switch (view) {
      case "compose": return <PostComposer editId={editId} navigate={navigate} />;
      case "calendar": return <CalendarView navigate={navigate} />;
      case "queue": return <QueueView navigate={navigate} />;
      case "drafts": return <DraftsView navigate={navigate} />;
      case "channels": return <ChannelList />;
      case "analytics": return <AnalyticsView />;
      default: return <Dashboard navigate={navigate} />;
    }
  };

  return (
    <AppContext.Provider value={appState}>
      {/* The sidebar is a 275px column at ≥768px and a horizontal strip below
          it, so it has to be the first child of a flex-col/md:flex-row shell. */}
      <div class="flex min-h-screen flex-col md:flex-row">
        <AppNav
          title="Open Post"
          icon="send"
          groups={groups}
          active={view}
          onNavigate={(item) => navigate(item.href ?? "/")}
        />
        <main class="flex-1 overflow-auto min-w-0">
          {appState.loading ? (
            <div class="flex items-center justify-center h-full">
              <p class="text-muted-foreground">Loading...</p>
            </div>
          ) : (
            renderMain()
          )}
        </main>
      </div>
      <ErrorBanner />
    </AppContext.Provider>
  );
}
