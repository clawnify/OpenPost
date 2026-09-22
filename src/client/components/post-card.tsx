import { Clock, Edit2, Trash2, Send, ExternalLink, AlertCircle, Hourglass } from "lucide-preact";
import type { Post, Channel } from "../types";
import { PLATFORM_LABELS } from "../types";
import { PostPreview, hasNativePreview } from "./previews";
import { PlatformIcon } from "./platform-icon";

interface Props {
  post: Post;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onPublish?: (id: number) => void;
  // When set, render the post as a native-looking platform preview (used in the
  // queue) instead of the plain text excerpt.
  preview?: boolean;
  // Inside a card already (dashboard): no shadow of its own, a hairline on top instead.
  flat?: boolean;
}

function formatDate(d: string | null) {
  if (!d) return "";
  const date = new Date(d + (d.includes("T") ? "" : "T00:00:00"));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_STYLES: Record<string, string> = {
  draft: "chip",
  scheduled: "pill bg-info-tint text-info",
  published: "pill bg-success-tint text-success",
  partial: "pill bg-warning-tint text-warning",
  failed: "pill bg-destructive-tint text-destructive",
};

// Per-channel chip: links out to the live post when delivered, and surfaces the
// platform rejection (e.g. Twitter "CreditsDepleted") on failure.
function ChannelChip({ ch }: { ch: Channel }) {
  const label = PLATFORM_LABELS[ch.platform] || ch.platform;
  const base = "brand-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium";

  // Sent, and the platform hasn't ruled on it yet — TikTok and Facebook video
  // only accept a post synchronously, the verdict comes later. A pending row
  // carrying a message is the one that has already gone out; a plain pending
  // row hasn't. Showing them the same way would hide a post whose fate nobody
  // knows.
  if (ch.delivery_status === "pending" && ch.delivery_error) {
    return (
      <span class={`${base} opacity-75`} style={{ "--brand": ch.color }} title={ch.delivery_error}>
        <PlatformIcon platform={ch.platform} /> {label} <Hourglass size={11} />
      </span>
    );
  }

  if (ch.delivery_status === "failed") {
    return (
      <span class={`${base} opacity-60`} style={{ "--brand": ch.color }} title={ch.delivery_error || "Failed to publish"}>
        <PlatformIcon platform={ch.platform} /> {label} <AlertCircle size={11} />
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
        style={{ "--brand": ch.color }}
        title="View live post"
      >
        <PlatformIcon platform={ch.platform} /> {label} <ExternalLink size={11} />
      </a>
    );
  }

  return (
    <span class={base} style={{ "--brand": ch.color }}>
      <PlatformIcon platform={ch.platform} /> {label}
    </span>
  );
}

export function PostCard({ post, onEdit, onDelete, onPublish, preview, flat }: Props) {
  const excerpt = post.content.length > 140 ? post.content.slice(0, 140) + "..." : post.content;
  const previewChannel = preview ? post.channels.find((ch) => hasNativePreview(ch.platform)) : undefined;
  const firstMedia = post.media[0];
  const timeLabel = post.scheduled_at
    ? new Date(post.scheduled_at + (post.scheduled_at.includes("T") ? "" : "T00:00:00"))
        .toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Now";

  return (
    <div class={preview ? "" : flat ? "pt-3 border-t border-border first:border-t-0 first:pt-0" : "card p-5"}>
      {previewChannel ? (
        <PostPreview channel={previewChannel} content={post.content} media={firstMedia} timeLabel={timeLabel} />
      ) : (
        <p class="text-foreground leading-relaxed whitespace-pre-wrap">
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
              class="pill brand-pill"
              style={{ "--brand": l.color }}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}

      <div class="flex items-center justify-between mt-3">
        <div class="flex items-center gap-2">
          <span class={`capitalize ${STATUS_STYLES[post.status] || "chip"}`}>
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
              class="icon-btn"
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
            class="icon-btn"
            title="Edit"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => onDelete(post.id)}
            class="icon-btn hover:!bg-destructive-tint hover:!text-destructive"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
