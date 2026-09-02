import type { Channel } from "../../types";
import { PLATFORM_LABELS } from "../../types";
import { LinkedInPreview } from "./linkedin-preview";
import { XPreview } from "./x-preview";
import { InstagramPreview } from "./instagram-preview";
import { TikTokPreview } from "./tiktok-preview";
import { FacebookPreview } from "./facebook-preview";
import { GenericPreview } from "./generic-preview";

// Platforms with a native-looking preview card. Others fall back to the generic
// text+attachments preview.
const NATIVE_PREVIEW_PLATFORMS = new Set(["linkedin", "twitter", "instagram", "facebook", "tiktok"]);

export function hasNativePreview(platform: string): boolean {
  return NATIVE_PREVIEW_PLATFORMS.has(platform);
}

interface Props {
  channel: Channel;
  content: string;
  imageUrl?: string;
  timeLabel?: string;
}

// Renders the post as it will appear on the channel's platform — a native card
// when available, otherwise a generic text+attachments preview.
export function PostPreview({ channel, content, imageUrl, timeLabel }: Props) {
  switch (channel.platform) {
    case "linkedin":
      return (
        <LinkedInPreview
          authorName={channel.profile_name || channel.name}
          authorHeadline={channel.profile_headline || channel.handle || undefined}
          avatarUrl={channel.profile_avatar_url || undefined}
          content={content}
          imageUrl={imageUrl}
          timeLabel={timeLabel}
        />
      );
    case "twitter":
      return (
        <XPreview
          authorName={channel.profile_name || channel.name}
          handle={channel.profile_handle || channel.handle || undefined}
          avatarUrl={channel.profile_avatar_url || undefined}
          content={content}
          imageUrl={imageUrl}
          timeLabel={timeLabel}
        />
      );
    case "instagram":
      return (
        <InstagramPreview
          username={channel.profile_handle || channel.handle || channel.name}
          avatarUrl={channel.profile_avatar_url || undefined}
          content={content}
          imageUrl={imageUrl}
          timeLabel={timeLabel}
        />
      );
    case "facebook":
      return (
        <FacebookPreview
          pageName={channel.profile_name || channel.name}
          avatarUrl={channel.profile_avatar_url || undefined}
          content={content}
          imageUrl={imageUrl}
          timeLabel={timeLabel}
        />
      );
    case "tiktok":
      return (
        <TikTokPreview
          username={channel.profile_handle || channel.handle || channel.name}
          avatarUrl={channel.profile_avatar_url || undefined}
          content={content}
          imageUrl={imageUrl}
          timeLabel={timeLabel}
        />
      );
    default:
      return <GenericPreview channel={channel} content={content} imageUrl={imageUrl} timeLabel={timeLabel} />;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Avatar strip to switch which selected channel's preview is shown.
export function PreviewChannelTabs({
  channels,
  activeId,
  onSelect,
}: {
  channels: Channel[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  if (channels.length <= 1) return null;
  return (
    <div class="flex items-center gap-2 mb-3">
      {channels.map((ch) => {
        const active = ch.id === activeId;
        return (
          <button
            key={ch.id}
            type="button"
            onClick={() => onSelect(ch.id)}
            title={`${ch.name} · ${PLATFORM_LABELS[ch.platform] || ch.platform}`}
            class={`w-9 h-9 rounded-full text-white flex items-center justify-center text-xs font-semibold transition-all ${
              active ? "ring-2 ring-offset-2 ring-primary" : "opacity-50 hover:opacity-100"
            }`}
            style={{ background: ch.color }}
          >
            {initials(ch.name)}
          </button>
        );
      })}
    </div>
  );
}
