import { useState } from "preact/hooks";
import { MoreHorizontal, Heart, MessageCircle, Send, Bookmark, Image as ImageIcon } from "lucide-preact";
import type { MediaItem } from "../../types";
import { PreviewMedia } from "./preview-media";

interface Props {
  username: string;
  avatarUrl?: string;
  content: string;
  media?: MediaItem;
  timeLabel?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toUsername(name: string): string {
  return name.replace(/^@/, "").replace(/\s+/g, "").toLowerCase() || "username";
}

// Instagram truncates captions after ~125 chars behind a "… more".
const COLLAPSE_AT = 125;

export function InstagramPreview({ username, avatarUrl, content, media, timeLabel }: Props) {
  const [expanded, setExpanded] = useState(false);
  const handle = toUsername(username);

  const isLong = content.length > COLLAPSE_AT || content.split("\n").length > 2;
  const shown = expanded || !isLong ? content : content.slice(0, COLLAPSE_AT).trimEnd();

  return (
    <div class="bg-white rounded-lg border border-[#dbdbdb] shadow-sm max-w-[468px] text-[#262626] overflow-hidden">
      {/* Header */}
      <div class="flex items-center gap-2.5 px-3 py-2.5">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" class="w-8 h-8 rounded-full object-cover shrink-0" />
        ) : (
          <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] text-white flex items-center justify-center text-[10px] font-semibold shrink-0">
            {initials(username)}
          </div>
        )}
        <div class="flex-1 min-w-0 text-sm font-semibold truncate">{handle}</div>
        <MoreHorizontal size={18} class="text-[#262626] shrink-0" />
      </div>

      {/* Instagram requires an attachment — this app publishes photo posts, so
          a video here is a channel that will fail rather than a Reel. */}
      {media ? (
        <PreviewMedia media={media} class="w-full aspect-square object-cover bg-[#fafafa]" />
      ) : (
        <div class="w-full aspect-square bg-[#fafafa] border-y border-[#efefef] flex flex-col items-center justify-center gap-2 text-[#8e8e8e]">
          <ImageIcon size={32} />
          <span class="text-xs">Instagram posts need an image</span>
        </div>
      )}

      {/* Action bar */}
      <div class="flex items-center justify-between px-3 pt-2.5">
        <div class="flex items-center gap-3.5">
          <Heart size={22} />
          <MessageCircle size={22} />
          <Send size={22} />
        </div>
        <Bookmark size={22} />
      </div>

      {/* Caption */}
      <div class="px-3 py-2 text-sm break-words">
        <span class="font-semibold">{handle}</span>{" "}
        <span class="whitespace-pre-wrap">
          {shown || <span class="text-[#8e8e8e]">Write a caption…</span>}
        </span>
        {isLong && !expanded && (
          <button class="text-[#8e8e8e] ml-1" onClick={() => setExpanded(true)}>
            … more
          </button>
        )}
      </div>

      {/* Date */}
      {timeLabel && <div class="px-3 pb-3 text-[10px] uppercase tracking-wide text-[#8e8e8e]">{timeLabel}</div>}
    </div>
  );
}
