// What a post's attachments are, independent of any platform.
//
// Shared because the server and the client must agree on it: the composer
// decides which element to render (an <img> or a <video>) the moment a URL is
// pasted, and the server decides which platform call to make at publish time.
// Two copies of this rule would disagree exactly once — on the post that then
// goes out as the wrong kind of media, or not at all.

export type MediaType = "image" | "video";

// One attachment on a post, as it travels between the composer, the API and
// the publisher.
export interface MediaItem {
  url: string;
  type: MediaType;
}

// Container extensions the social platforms in PLATFORM_VIDEO actually accept
// (MP4 is the only one all of them do; the rest are here so a user's own URL
// isn't mistaken for an image and sent to an image endpoint, which fails with a
// far less useful error than "this platform can't take that video").
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|avi|mkv|mpe?g)(\?|#|$)/i;

// The type of a media URL we were not told the type of — a pasted link. Upload
// answers this from the file's own MIME type instead (mediaTypeFromMime), which
// is authoritative; this is the fallback for a URL with nothing but a path.
export function mediaTypeFromUrl(url: string): MediaType {
  return VIDEO_EXTENSIONS.test(url) ? "video" : "image";
}

// The type of a browser-supplied MIME, or null when it is neither — the caller
// turns that into "we don't take this file", rather than guessing "image" and
// uploading a PDF the platforms will reject at publish time.
export function mediaTypeFromMime(mime: string | undefined | null): MediaType | null {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  return null;
}

// Normalise whatever the API was handed into a MediaItem. Anything that isn't
// literally "video" is an image: the type only chooses which platform call is
// made, so an unrecognised value must fall back to the shape the platforms all
// accept rather than to the one only two of them do.
export function toMediaItem(input: unknown): MediaItem | null {
  if (typeof input === "string") {
    return input.trim() ? { url: input, type: mediaTypeFromUrl(input) } : null;
  }
  if (input && typeof input === "object") {
    const url = (input as { url?: unknown }).url;
    if (typeof url !== "string" || !url.trim()) return null;
    const type = (input as { type?: unknown }).type;
    return { url, type: type === "video" ? "video" : "image" };
  }
  return null;
}

// The images and the video on a post, split — the two questions every publish
// path asks. `video` is the first one: carrying more than one is rejected
// before publishing (see mediaShapeError).
export function splitMedia(media: MediaItem[]): { imageUrls: string[]; videoUrl?: string } {
  const imageUrls = media.filter((m) => m.type === "image").map((m) => m.url);
  const videoUrl = media.find((m) => m.type === "video")?.url;
  return { imageUrls, ...(videoUrl ? { videoUrl } : {}) };
}
