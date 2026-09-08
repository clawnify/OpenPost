import { useEffect } from "preact/hooks";
import { useApp } from "../context";
import { PostCard } from "./post-card";
import { ListOrdered, Plus, ArrowUpDown } from "lucide-preact";

interface Props {
  navigate: (path: string) => void;
}

export function QueueView({ navigate }: Props) {
  const { posts, loadPosts, deletePost, publishPost } = useApp();

  // Include posts that need attention — a failed or partial publish resurfaces
  // here (with a Retry button) instead of silently vanishing.
  useEffect(() => { loadPosts("status=scheduled,failed,partial"); }, []);

  const scheduled = posts
    .filter((p) => p.status === "scheduled" || p.status === "failed" || p.status === "partial")
    .sort((a, b) => (a.scheduled_at! > b.scheduled_at! ? 1 : -1));

  const needsAttention = scheduled.filter((p) => p.status === "failed" || p.status === "partial").length;

  return (
    <div class="p-6 max-w-[552px] mx-auto">
      <div class="flex items-center justify-between h-14 -mt-6 -mx-6 px-6 mb-2 border-b border-border">
        <h1 class="text-[1.375rem] font-semibold tracking-[-0.01em]">Queue</h1>
        <button class="btn-primary" onClick={() => navigate("/compose")}>
          <Plus size={16} /> New post
        </button>
      </div>
      <div class="flex items-center gap-2 mb-4">
        <span class="btn-ghost pointer-events-none">
          <ArrowUpDown size={14} /> Sorted by <span class="text-foreground">Scheduled date</span>
        </span>
        <span class="text-[0.8125rem] text-muted-foreground tabular">{scheduled.length} in queue</span>
        {needsAttention > 0 && (
          <span class="pill bg-destructive-tint text-destructive">{needsAttention} need attention</span>
        )}
      </div>

      {scheduled.length === 0 ? (
        <div class="flex flex-col items-center justify-center py-20 text-center">
          <ListOrdered size={48} class="text-faint mb-4" />
          <h3 class="text-lg font-semibold mb-1">Queue is empty</h3>
          <p class="text-muted-foreground mb-4">Schedule posts from the composer to see them here</p>
          <button
            class="btn-primary"
            onClick={() => navigate("/compose")}
          >
            Compose
          </button>
        </div>
      ) : (
        <div class="space-y-8">
          {scheduled.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              onEdit={(id) => navigate(`/compose/${id}`)}
              onDelete={deletePost}
              onPublish={publishPost}
              preview
            />
          ))}
        </div>
      )}
    </div>
  );
}
