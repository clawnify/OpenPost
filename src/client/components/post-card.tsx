import { Clock, Edit2, Trash2, Send, ExternalLink, AlertCircle } from "lucide-preact";
import type { Post, Channel } from "../types";
import { PLATFORM_LABELS } from "../types";
import { PostPreview, hasNativePreview } from "./previews";

interface Props {
  post: Post;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onPublish?: (id: number) => void;
  // When set, render the post as a native-looking platform preview (used in the
  // queue) instead of the plain text excerpt.
  preview?: boolean;
}

function formatDate(d: string | null) {
  if (!d) return "";
  const date = new Date(d + (d.includes("T") ? "" : "T00:00:00"));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-blue-50 text-blue-700",
  published: "bg-green-50 text-green-700",
  partial: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
};

// Per-channel chip: links out to the live post when delivered, and surfaces the
// platform rejection (e.g. Twitter "CreditsDepleted") on failure.
function ChannelChip({ ch }: { ch: Channel }) {
  const label = PLATFORM_LABELS[ch.platform] || ch.platform;
  const base = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white";

  if (ch.delivery_status === "failed") {
    return (
      <span class={`${base} opacity-60`} style={{ background: ch.color }} title={ch.delivery_error || "Failed to publish"}>
        {label} <AlertCircle size={11} />
      </span>
    );
  }

  if (ch.delivery_status === "published" && ch.delivery_url) {
    return (
      <a
        href={ch.delivery_url}
        target="_blank"
        rel="noopener noreferrer"
        class={`${base} hover:opacity-90`}
        style={{ background: ch.color }}
        title="View live post"
      >
        {label} <ExternalLink size={11} />
      </a>
    );
  }

  return (
    <span class={base} style={{ background: ch.color }}>
      {label}
    </span>
  );
}

export function PostCard({ post, onEdit, onDelete, onPublish, preview }: Props) {
  const excerpt = post.content.length > 140 ? post.content.slice(0, 140) + "..." : post.content;
  const previewChannel = preview ? post.channels.find((ch) => hasNativePreview(ch.platform)) : undefined;
  const firstImage = post.media[0]?.url;
  const timeLabel = post.scheduled_at
    ? new Date(post.scheduled_at + (post.scheduled_at.includes("T") ? "" : "T00:00:00"))
        .toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Now";

  return (
    <div class="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-shadow">
      {previewChannel ? (
        <PostPreview channel={previewChannel} content={post.content} imageUrl={firstImage} timeLabel={timeLabel} />
      ) : (
        <p class="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {excerpt || "(empty)"}
        </p>
      )}

      {post.channels.length > 0 && (
        <div class="flex flex-wrap gap-1.5 mt-3">
          {post.channels.map((ch) => (
            <ChannelChip key={ch.id} ch={ch} />
          ))}
        </div>
      )}

      {post.labels.length > 0 && (
        <div class="flex flex-wrap gap-1.5 mt-2">
          {post.labels.map((l) => (
            <span
              key={l.id}
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border"
              style={{ borderColor: l.color, color: l.color }}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}

      <div class="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <div class="flex items-center gap-2">
          <span class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[post.status] || ""}`}>
            {post.status}
          </span>
          {post.scheduled_at && (
            <span class="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock size={12} /> {formatDate(post.scheduled_at)}
            </span>
          )}
        </div>
        <div class="flex items-center gap-1">
          {/* A partial post is the one that most needs this button — some
              channels went out, some didn't — and it used to be the one status
              that couldn't reach it. Safe now that publishing skips channels
              already delivered (publishPost, src/server/index.ts). */}
          {onPublish && (post.status === "scheduled" || post.status === "failed" || post.status === "partial") && (
            <button
              onClick={() => onPublish(post.id)}
              class="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title={
                post.status === "partial"
                  ? "Retry the channels that failed"
                  : post.status === "failed"
                    ? "Retry"
                    : "Publish now"
              }
            >
              <Send size={14} />
            </button>
          )}
          <button
            onClick={() => onEdit(post.id)}
            class="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => onDelete(post.id)}
            class="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-destructive transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
