import { useState } from "preact/hooks";
import { Globe, MoreHorizontal, X, ThumbsUp, MessageCircle, Forward } from "lucide-preact";

interface Props {
  pageName: string;
  avatarUrl?: string;
  content: string;
  imageUrl?: string;
  timeLabel?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Facebook folds long Page posts behind a "See more" after a few lines.
const COLLAPSE_AT = 400;

const ACTIONS = [
  { Icon: ThumbsUp, label: "Like" },
  { Icon: MessageCircle, label: "Comment" },
  { Icon: Forward, label: "Share" },
];

export function FacebookPreview({ pageName, avatarUrl, content, imageUrl, timeLabel }: Props) {
  const [expanded, setExpanded] = useState(false);

  const isLong = content.length > COLLAPSE_AT || content.split("\n").length > 5;
  const shown = expanded || !isLong ? content : content.slice(0, COLLAPSE_AT).trimEnd();

  return (
    <div class="bg-white rounded-lg border border-[#ced0d4] shadow-sm max-w-[500px] text-[#050505] overflow-hidden">
      {/* Header */}
      <div class="flex items-start gap-2 px-4 pt-3">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" class="w-10 h-10 rounded-full object-cover shrink-0" />
        ) : (
          <div class="w-10 h-10 rounded-full bg-[#1877f2] text-white flex items-center justify-center text-sm font-semibold shrink-0">
            {initials(pageName)}
          </div>
        )}
        <div class="min-w-0 flex-1 leading-tight">
          <div class="text-[15px] font-semibold truncate">{pageName || "Your Page"}</div>
          <div class="flex items-center gap-1 text-[13px] text-[#65676b]">
            <span>{timeLabel || "Just now"}</span>
            <span>·</span>
            <Globe size={12} />
          </div>
        </div>
        <div class="flex items-center gap-2 text-[#65676b] shrink-0">
          <MoreHorizontal size={20} />
          <X size={18} />
        </div>
      </div>

      {/* Body */}
      <div class="px-4 py-2 text-[15px] whitespace-pre-wrap break-words">
        {shown || <span class="text-[#65676b]">What's on your mind?</span>}
        {isLong && !expanded && (
          <>
            …{" "}
            <button class="font-semibold text-[#050505] hover:underline" onClick={() => setExpanded(true)}>
              See more
            </button>
          </>
        )}
      </div>

      {/* Image */}
      {imageUrl && (
        <img src={imageUrl} alt="" class="w-full max-h-[500px] object-cover bg-[#f0f2f5]" />
      )}

      {/* Action bar */}
      <div class="mx-4 mt-1 border-t border-[#ced0d4] flex items-center justify-around py-1">
        {ACTIONS.map(({ Icon, label }) => (
          <div key={label} class="flex items-center gap-1.5 px-3 py-2 rounded text-[#65676b] text-[15px] font-semibold">
            <Icon size={18} /> {label}
          </div>
        ))}
      </div>
    </div>
  );
}
