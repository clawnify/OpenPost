// Platform metadata shared by the server (publishing) and the client (composer,
// previews, channel picker).
//
// It lives here rather than in client/types.ts because the server enforces the
// same media limits it warns about: two copies of this table would drift, and
// the copy that drifts is the one that only fails at send time.

import type { MediaItem } from "./media";

export type Platform =
  | "twitter"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "bluesky"
  | "mastodon"
  | "threads"
  | "tiktok";

// The platforms the server can actually publish to — the single source the
// channel picker offers. It MUST track the cases in publishToChannel()
// (src/server/index.ts): a platform here with no server case would let a user
// schedule posts that only fail at send time (the mastodon/threads trap this
// list closes); a server case missing here is simply not offered.
// mastodon/threads stay out until they have a publish path.
export const PUBLISHABLE_PLATFORMS: Platform[] = [
  "twitter",
  "linkedin",
  "instagram",
  "facebook",
  "tiktok",
  "bluesky",
];

export const PLATFORM_LIMITS: Record<Platform, number> = {
  twitter: 280,
  linkedin: 3000,
  instagram: 2200,
  facebook: 63206,
  bluesky: 300,
  mastodon: 500,
  threads: 500,
  tiktok: 2200,
};

// How many images one post may carry, per platform. Only platforms whose own
// contract states a maximum appear here — an absent entry means "the platform
// publishes as many as it accepts, and its own rejection is the error we
// surface" (the stance bluesky.ts already takes on text length).
//
// Each number is the platform's stated cap, not folklore:
//   twitter    4 — TWITTER_CREATION_OF_A_POST.media_media_ids ("Up to 4 Media IDs")
//   linkedin  20 — LINKEDIN_CREATE_LINKED_IN_POST.images (maxItems: 20)
//   instagram 10 — a carousel is 2-10 items (INSTAGRAM_CREATE_CAROUSEL_CONTAINER)
//   tiktok    35 — TIKTOK_POST_PHOTO.photo_images (maxItems: 35)
//   bluesky    4 — app.bsky.embed.images.images (lexicon maxLength: 4)
// facebook is deliberately absent: FACEBOOK_CREATE_MULTI_PHOTO_POST.photo_urls
// declares minItems but no maximum, so there is no stated number to enforce.
export const PLATFORM_MEDIA_LIMITS: Partial<Record<Platform, number>> = {
  twitter: 4,
  linkedin: 20,
  instagram: 10,
  tiktok: 35,
  bluesky: 4,
};

export const PLATFORM_COLORS: Record<Platform, string> = {
  twitter: "#1da1f2",
  linkedin: "#0a66c2",
  instagram: "#e4405f",
  facebook: "#1877f2",
  bluesky: "#0085ff",
  mastodon: "#6364ff",
  threads: "#000000",
  tiktok: "#00f2ea",
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  threads: "Threads",
  tiktok: "TikTok",
};

// The platforms this app can deliver a video to. Membership is about the call
// this app has, not about what the platform's own product does: TikTok is a
// video service, but it is on this list because TIKTOK_UPLOAD_VIDEO takes the
// bytes, while X is off it because the broker's X media upload has no verified
// answer for a video's asynchronous processing yet.
//
//   facebook — FACEBOOK_CREATE_VIDEO_POST.file_url pulls the video from a URL.
//   tiktok   — TIKTOK_UPLOAD_VIDEO.file_to_upload takes the bytes. (Its URL-pull
//              sibling, TIKTOK_PUBLISH_VIDEO, needs the URL's domain to be
//              verified with TikTok, which an app's own hostname is not.)
export const PLATFORM_VIDEO: Partial<Record<Platform, boolean>> = {
  facebook: true,
  tiktok: true,
};

// The most bytes /api/upload accepts for one video. The ceiling that actually
// binds is smaller and lives in the credential broker, which buffers a staged
// file whole (10 MB) — but that limit is TikTok's path only, and a Facebook
// video is passed as a URL and never staged. So this caps what the app stores;
// the per-platform failure says the rest.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

// Why this set of attachments is not a post any platform would take, in the
// user's words. Null when the shape is fine. Platform-independent on purpose:
// these two rules hold everywhere this app publishes, so they are checked once
// rather than repeated per channel.
export function mediaShapeError(media: MediaItem[]): string | null {
  const videos = media.filter((m) => m.type === "video").length;
  if (videos > 1) return `A post carries one video; this one has ${videos}.`;
  if (videos && media.length > videos) return "A post carries either images or a video, not both.";
  return null;
}

// Why this channel can't carry these attachments, in the user's words. Null
// when it can. The composer shows this next to the images while they are still
// removable; publishToChannel calls the same function so the two can't disagree
// about what would have been rejected.
export function mediaError(platform: string, media: MediaItem[]): string | null {
  const shape = mediaShapeError(media);
  if (shape) return shape;

  const label = PLATFORM_LABELS[platform as Platform] ?? platform;
  if (media.some((m) => m.type === "video") && !PLATFORM_VIDEO[platform as Platform]) {
    return `${label} video posts aren't supported yet. Remove the video, or unselect this channel.`;
  }

  const images = media.filter((m) => m.type === "image").length;
  const max = PLATFORM_MEDIA_LIMITS[platform as Platform];
  if (max !== undefined && images > max) {
    return `${label} takes at most ${max} image${max === 1 ? "" : "s"}; this post has ${images}.`;
  }
  return null;
}
