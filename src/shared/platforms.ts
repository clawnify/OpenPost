// Platform metadata shared by the server (publishing) and the client (composer,
// previews, channel picker).
//
// It lives here rather than in client/types.ts because the server enforces the
// same media limits it warns about: two copies of this table would drift, and
// the copy that drifts is the one that only fails at send time.

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

// Why a channel can't take this many images, in the user's words. Null when the
// count is fine (or the platform states no cap).
export function mediaLimitError(platform: string, count: number): string | null {
  const max = PLATFORM_MEDIA_LIMITS[platform as Platform];
  if (max === undefined || count <= max) return null;
  const label = PLATFORM_LABELS[platform as Platform] ?? platform;
  return `${label} takes at most ${max} image${max === 1 ? "" : "s"}; this post has ${count}.`;
}
