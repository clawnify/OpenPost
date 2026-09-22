import type { MediaItem } from "../../types";

// The post's first attachment, rendered as the platform would show it: an
// image, or a video the reviewer can actually play.
//
// One component rather than an `<img>` in each preview card, because the
// attachment is the one part of a preview that isn't platform-specific — only
// its frame is, which is what `class` carries. A preview that quietly rendered
// a video URL into an <img> would show a broken tile and tell the author their
// post is broken when it isn't.
export function PreviewMedia({ media, class: className }: { media?: MediaItem; class: string }) {
  if (!media) return null;
  if (media.type === "video") {
    return <video src={media.url} class={className} controls muted playsInline preload="metadata" />;
  }
  return <img src={media.url} alt="" class={className} />;
}
