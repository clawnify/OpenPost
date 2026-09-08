import { useEffect } from "preact/hooks";
import { ChevronRight, Plus, Send, Calendar, Clock, CheckCircle2, FileText, Radio } from "lucide-preact";
import { useApp } from "../context";
import { PostCard } from "./post-card";

interface Props {
  navigate: (path: string) => void;
}

export function Dashboard({ navigate }: Props) {
  const { posts, stats, loadStats, deletePost } = useApp();

  useEffect(() => { loadStats(); }, []);

  const upcoming = posts
    .filter((p) => p.status === "scheduled" && p.scheduled_at)
    .sort((a, b) => (a.scheduled_at! > b.scheduled_at! ? 1 : -1))
    .slice(0, 5);

  const recentDrafts = posts
    .filter((p) => p.status === "draft")
    .slice(0, 3);

  // Value first, label under, status icon top-right. A tinted tile means the
  // stat IS a status (Attio: Completed green, Failed red); a plain count stays
  // white with a hairline, so the tint keeps meaning something.
  const stats_tiles = [
    { value: stats?.scheduled ?? 0, label: "Scheduled", icon: Clock, tone: "bg-info-tint text-info", ring: "inset 0 0 0 1px var(--color-info-solid)" },
    { value: stats?.published ?? 0, label: "Published", icon: CheckCircle2, tone: "bg-success-tint text-success", ring: "inset 0 0 0 1px var(--color-success-solid)" },
    { value: stats?.drafts ?? 0, label: "Drafts", icon: FileText, tone: "bg-card text-foreground", ring: "var(--edge-rest)" },
    { value: stats?.channels ?? 0, label: "Channels", icon: Radio, tone: "bg-card text-foreground", ring: "var(--edge-rest)" },
  ];

  return (
    <div class="p-6 max-w-5xl mx-auto">
      <div class="flex items-center justify-between h-14 -mt-6 -mx-6 px-6 mb-4 border-b border-border">
        <h1 class="text-[1.375rem] font-semibold tracking-[-0.01em]">Dashboard</h1>
        <div class="flex items-center gap-2">
          <button class="btn-secondary" onClick={() => navigate("/calendar")}>
            <Calendar size={16} /> Calendar
          </button>
          <button class="btn-primary" onClick={() => navigate("/compose")}>
            <Plus size={16} /> New post
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {stats_tiles.map(({ value, label, icon: Icon, tone, ring }) => (
          <div key={label} class={`relative rounded-md px-3 py-2.5 ${tone}`} style={{ boxShadow: ring }}>
            <Icon size={14} class="absolute top-2.5 right-2.5 opacity-50" />
            <div class="text-[1.25rem] font-semibold leading-none tabular">{value}</div>
            <div class="text-[0.8125rem] mt-1 opacity-70">{label}</div>
          </div>
        ))}
      </div>

      {(upcoming.length > 0 || recentDrafts.length > 0) && (
        <div class="grid md:grid-cols-2 gap-4">
          {upcoming.length > 0 && (
            <section class="card p-5">
              <button class="flex items-center gap-1 mb-2 group" onClick={() => navigate("/queue")}>
                <span class="card-title">Upcoming</span>
                <ChevronRight size={16} class="text-faint group-hover:text-foreground transition-colors" />
              </button>
              <div class="space-y-3">
                {upcoming.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    onEdit={(id) => navigate(`/compose/${id}`)}
                    onDelete={deletePost}
                    flat
                  />
                ))}
              </div>
            </section>
          )}

          {recentDrafts.length > 0 && (
            <section class="card p-5">
              <button class="flex items-center gap-1 mb-2 group" onClick={() => navigate("/drafts")}>
                <span class="card-title">Recent drafts</span>
                <ChevronRight size={16} class="text-faint group-hover:text-foreground transition-colors" />
              </button>
              <div class="space-y-3">
                {recentDrafts.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    onEdit={(id) => navigate(`/compose/${id}`)}
                    onDelete={deletePost}
                    flat
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Empty state */}
      {posts.length === 0 && (
        <div class="flex flex-col items-center justify-center py-20 text-center">
          <Send size={40} class="text-faint mb-4" />
          <h3 class="text-lg font-semibold mb-1">No posts yet</h3>
          <p class="text-muted-foreground mb-5">Create your first post to get started</p>
          <button class="btn-primary" onClick={() => navigate("/compose")}>
            <Plus size={16} /> Create post
          </button>
        </div>
      )}
    </div>
  );
}
