import { PLATFORM_LABELS } from "../../types";
import type { Channel, MediaItem } from "../../types";
import { PreviewMedia } from "./preview-media";

interface Props {
  channel: Channel;
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

// Plain text + attachments preview, used for platforms that don't have a
// native-looking card yet. Mirrors the post's content as it will be sent.
export function GenericPreview({ channel, content, media, timeLabel }: Props) {
  return (
    <div class="bg-card rounded-lg border border-border max-w-[552px] overflow-hidden">
      <div class="flex items-center gap-2 px-4 pt-3">
        <div
          class="w-10 h-10 rounded-full text-white flex items-center justify-center text-xs font-semibold shrink-0"
          style={{ background: channel.color }}
        >
          {initials(channel.name)}
        </div>
        <div class="min-w-0 leading-tight">
          <div class="text-sm font-semibold truncate">{channel.name}</div>
          <div class="text-xs text-muted-foreground">
            {PLATFORM_LABELS[channel.platform] || channel.platform}
            {timeLabel ? ` · ${timeLabel}` : ""}
          </div>
        </div>
      </div>

      <div class="px-4 py-3 text-sm whitespace-pre-wrap break-words text-foreground">
        {content || <span class="text-muted-foreground">What do you want to share?</span>}
      </div>

      <PreviewMedia media={media} class="w-full max-h-[480px] object-cover bg-muted" />
    </div>
  );
}
