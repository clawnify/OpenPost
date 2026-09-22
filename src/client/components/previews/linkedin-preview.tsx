import { useState } from "preact/hooks";
import { Globe, MoreHorizontal, X, ThumbsUp, MessageSquare, Repeat2, Send } from "lucide-preact";
import type { MediaItem } from "../../types";
import { PreviewMedia } from "./preview-media";

interface Props {
  authorName: string;
  authorHeadline?: string;
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

// LinkedIn collapses long posts after ~3 lines / ~210 chars behind a "…more".
const COLLAPSE_AT = 210;

const ACTIONS = [
  { Icon: ThumbsUp, label: "Like" },
  { Icon: MessageSquare, label: "Comment" },
  { Icon: Repeat2, label: "Repost" },
  { Icon: Send, label: "Send" },
];

export function LinkedInPreview({ authorName, authorHeadline, avatarUrl, content, media, timeLabel }: Props) {
  const [expanded, setExpanded] = useState(false);

  const isLong = content.length > COLLAPSE_AT || content.split("\n").length > 4;
  const shown = expanded || !isLong ? content : content.slice(0, COLLAPSE_AT).trimEnd();

  return (
    <div class="bg-white rounded-lg border border-[#00000014] shadow-sm max-w-[552px] text-[#000000e6] overflow-hidden">
      {/* Header */}
      <div class="flex items-start gap-2 px-4 pt-3">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" class="w-12 h-12 rounded-full object-cover shrink-0" />
        ) : (
          <div class="w-12 h-12 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-sm font-semibold shrink-0">
            {initials(authorName)}
          </div>
        )}
        <div class="min-w-0 flex-1 leading-tight">
          <div class="flex items-center gap-1 text-sm font-semibold truncate">
            {authorName || "Your name"}
            <span class="text-[#00000099] font-normal">· 1st</span>
          </div>
          {authorHeadline && (
            <div class="text-xs text-[#00000099] truncate">{authorHeadline}</div>
          )}
          <div class="flex items-center gap-1 text-xs text-[#00000099]">
            <span>{timeLabel || "Now"}</span>
            <span>·</span>
            <Globe size={12} />
          </div>
        </div>
        <div class="flex items-center gap-1 text-[#00000099] shrink-0">
          <MoreHorizontal size={20} />
          <X size={18} />
        </div>
      </div>

      {/* Body */}
      <div class="px-4 py-2 text-sm whitespace-pre-wrap break-words">
        {shown || <span class="text-[#00000066]">What do you want to share?</span>}
        {isLong && !expanded && (
          <button class="text-[#00000099] hover:text-[#0a66c2] hover:underline ml-1" onClick={() => setExpanded(true)}>
            …more
          </button>
        )}
      </div>

      {/* Attachment */}
      <PreviewMedia media={media} class="w-full max-h-[480px] object-cover bg-[#f3f2ef]" />

      {/* Action bar */}
      <div class="mt-1 border-t border-[#00000014] flex items-center justify-around px-2 py-1">
        {ACTIONS.map(({ Icon, label }) => (
          <div key={label} class="flex items-center gap-1.5 px-3 py-2 rounded text-[#00000099] text-[13px] font-semibold">
            <Icon size={18} /> {label}
          </div>
        ))}
      </div>
    </div>
  );
}
