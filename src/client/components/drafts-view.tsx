import { useEffect } from "preact/hooks";
import { useApp } from "../context";
import { PostCard } from "./post-card";
import { FileText } from "lucide-preact";

interface Props {
  navigate: (path: string) => void;
}

export function DraftsView({ navigate }: Props) {
  const { posts, loadPosts, deletePost } = useApp();

  useEffect(() => { loadPosts("status=draft"); }, []);

  const drafts = posts.filter((p) => p.status === "draft");

  return (
    <div class="p-6 max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <h1 class="text-[1.375rem] font-semibold tracking-[-0.01em]">Drafts</h1>
          <span class="text-sm text-muted-foreground">{drafts.length} drafts</span>
        </div>
      </div>

      {drafts.length === 0 ? (
        <div class="flex flex-col items-center justify-center py-20 text-center">
          <FileText size={48} class="text-faint mb-4" />
          <h3 class="text-lg font-semibold mb-1">No drafts</h3>
          <p class="text-muted-foreground mb-4">Save a post as draft to come back to it later</p>
          <button
            class="btn-primary"
            onClick={() => navigate("/compose")}
          >
            Compose
          </button>
        </div>
      ) : (
        <div class="space-y-3">
          {drafts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              onEdit={(id) => navigate(`/compose/${id}`)}
              onDelete={deletePost}
            />
          ))}
        </div>
      )}
    </div>
  );
}
