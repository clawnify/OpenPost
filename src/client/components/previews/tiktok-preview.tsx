import { Heart, MessageCircle, Bookmark, Share, Music2, Image as ImageIcon } from "lucide-preact";

interface Props {
  username: string;
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

function toUsername(name: string): string {
  return name.replace(/^@/, "").replace(/\s+/g, "").toLowerCase() || "username";
}

const ACTIONS = [Heart, MessageCircle, Bookmark, Share];

// Photo post only (matches this app's photo-first media model) — rendered as
// TikTok's full-bleed vertical feed card with the caption + action rail
// overlaid, rather than the actual short-form video player.
export function TikTokPreview({ username, avatarUrl, content, imageUrl, timeLabel }: Props) {
  const handle = toUsername(username);

  return (
    <div class="relative bg-black rounded-2xl overflow-hidden w-[280px] aspect-[9/16] text-white mx-auto shadow-sm">
      {imageUrl ? (
        <img src={imageUrl} alt="" class="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40 bg-[#121212]">
          <ImageIcon size={32} />
          <span class="text-xs">TikTok posts need an image</span>
        </div>
      )}
      <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

      {/* Right action rail */}
      <div class="absolute right-2 bottom-16 flex flex-col items-center gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" class="w-9 h-9 rounded-full object-cover border-2 border-white" />
        ) : (
          <div class="w-9 h-9 rounded-full bg-gradient-to-tr from-[#25f4ee] to-[#fe2c55] flex items-center justify-center text-[10px] font-semibold border-2 border-white">
            {initials(username)}
          </div>
        )}
        {ACTIONS.map((Icon, i) => (
          <div key={i} class="flex flex-col items-center gap-0.5">
            <Icon size={24} fill={Icon === Heart ? "white" : "none"} />
          </div>
        ))}
      </div>

      {/* Caption */}
      <div class="absolute left-0 right-14 bottom-3 px-3">
        <div class="text-sm font-semibold">@{handle}</div>
        <div class="mt-1 text-sm leading-snug whitespace-pre-wrap break-words line-clamp-3">
          {content || <span class="text-white/60">Write a caption…</span>}
        </div>
        <div class="mt-1.5 flex items-center gap-1.5 text-xs text-white/80">
          <Music2 size={12} /> original sound
        </div>
        {timeLabel && <div class="mt-1 text-[10px] text-white/60">{timeLabel}</div>}
      </div>
    </div>
  );
}
