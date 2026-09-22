import type { Channel, MediaItem } from "../../types";
import { PLATFORM_LABELS } from "../../types";
import { PlatformIcon } from "../platform-icon";
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
  media?: MediaItem;
  timeLabel?: string;
}

// Renders the post as it will appear on the channel's platform — a native card
// when available, otherwise a generic text+attachments preview.
export function PostPreview({ channel, content, media, timeLabel }: Props) {
  switch (channel.platform) {
    case "linkedin":
      return (
        <LinkedInPreview
          authorName={channel.profile_name || channel.name}
          authorHeadline={channel.profile_headline || channel.handle || undefined}
          avatarUrl={channel.profile_avatar_url || undefined}
          content={content}
          media={media}
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
          media={media}
          timeLabel={timeLabel}
        />
      );
    case "instagram":
      return (
        <InstagramPreview
          username={channel.profile_handle || channel.handle || channel.name}
          avatarUrl={channel.profile_avatar_url || undefined}
          content={content}
          media={media}
          timeLabel={timeLabel}
        />
      );
    case "facebook":
      return (
        <FacebookPreview
          pageName={channel.profile_name || channel.name}
          avatarUrl={channel.profile_avatar_url || undefined}
          content={content}
          media={media}
          timeLabel={timeLabel}
        />
      );
    case "tiktok":
      return (
        <TikTokPreview
          username={channel.profile_handle || channel.handle || channel.name}
          avatarUrl={channel.profile_avatar_url || undefined}
          content={content}
          media={media}
          timeLabel={timeLabel}
        />
      );
    default:
      return <GenericPreview channel={channel} content={content} media={media} timeLabel={timeLabel} />;
  }
}


// Avatar strip to switch which channel is being written and previewed. `null`
// is the "All channels" tab — the shared draft every channel inherits unless it
// was given its own version; a dot marks the ones that were.
//
// One strip drives both the editor and the preview on purpose: a separate
// preview switcher would let you type X's version while looking at LinkedIn.
export function ChannelTabs({
  channels,
  activeId,
  onSelect,
  customizedIds,
}: {
  channels: Channel[];
  activeId: number | null;
  onSelect: (id: number | null) => void;
  customizedIds?: number[];
}) {
  if (channels.length <= 1) return null;
  const customized = new Set(customizedIds ?? []);
  return (
    <div class="flex items-center gap-2 mb-3">
      <button
        type="button"
        onClick={() => onSelect(null)}
        title="The shared draft — every channel that has no version of its own"
        class={`h-9 px-3 rounded-full border text-xs font-medium transition-colors ${
          activeId === null
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        All channels
      </button>
      {channels.map((ch) => {
        const active = ch.id === activeId;
        const own = customized.has(ch.id);
        return (
          <button
            key={ch.id}
            type="button"
            onClick={() => onSelect(ch.id)}
            title={`${ch.name} · ${PLATFORM_LABELS[ch.platform] || ch.platform}${own ? " · has its own version" : ""}`}
            class={`brand-soft relative w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
              active ? "ring-2 ring-offset-2 ring-foreground" : "opacity-60 hover:opacity-100"
            }`}
            style={{ "--brand": ch.color }}
          >
            <PlatformIcon platform={ch.platform} size={16} />
            {own && (
              <span
                class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary border-2 border-background"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
