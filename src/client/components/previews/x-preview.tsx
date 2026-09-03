import { MoreHorizontal, BadgeCheck, MessageCircle, Repeat2, Heart, Bookmark, Share } from "lucide-preact";
import type { MediaItem } from "../../types";
import { PreviewMedia } from "./preview-media";

interface Props {
  authorName: string;
  handle?: string;
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

function toHandle(handle: string | undefined, name: string): string {
  const raw = (handle || name || "").replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
  return raw ? `@${raw}` : "@username";
}

const ACTIONS = [MessageCircle, Repeat2, Heart, Bookmark, Share];

export function XPreview({ authorName, handle, avatarUrl, content, media, timeLabel }: Props) {
  return (
    <div class="bg-white rounded-2xl border border-[#eff3f4] shadow-sm max-w-[552px] text-[#0f1419] overflow-hidden px-4 py-3">
      {/* Header */}
      <div class="flex items-start gap-2">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" class="w-10 h-10 rounded-full object-cover shrink-0" />
        ) : (
          <div class="w-10 h-10 rounded-full bg-[#0f1419] text-white flex items-center justify-center text-xs font-semibold shrink-0">
            {initials(authorName)}
          </div>
        )}
        <div class="min-w-0 flex-1 leading-tight">
          <div class="flex items-center gap-1 font-bold text-[15px] truncate">
            {authorName || "Your name"}
            <BadgeCheck size={17} class="text-[#1d9bf0] shrink-0" fill="currentColor" stroke="white" />
          </div>
          <div class="text-[15px] text-[#536471] truncate">{toHandle(handle, authorName)}</div>
        </div>
        <MoreHorizontal size={18} class="text-[#536471] shrink-0" />
      </div>

      {/* Body */}
      <div class="mt-2 text-[15px] leading-snug whitespace-pre-wrap break-words">
        {content || <span class="text-[#536471]">What's happening?</span>}
      </div>

      {/* Attachment */}
      <PreviewMedia media={media} class="mt-3 w-full max-h-[480px] object-cover rounded-2xl border border-[#eff3f4]" />

      {/* Timestamp */}
      {timeLabel && <div class="mt-3 text-[15px] text-[#536471]">{timeLabel}</div>}

      {/* Action bar */}
      <div class="mt-3 pt-2 border-t border-[#eff3f4] flex items-center justify-between text-[#536471]">
        {ACTIONS.map((Icon, i) => (
          <Icon key={i} size={18} />
        ))}
      </div>
    </div>
  );
}
