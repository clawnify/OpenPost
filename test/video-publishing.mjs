/**
 * A post can carry a video, and it reaches the platforms that can take one.
 *
 * Two failure modes matter more than the happy path:
 *
 *   • Publishing the text and quietly dropping the video. Every platform here
 *     accepts a text-only post, so a video that never got attached still comes
 *     back "successful" — the author finds out from their timeline. So every
 *     check below reads the video off the call the app actually made.
 *
 *   • Calling a channel delivered when nothing is live. TikTok's upload can
 *     succeed while leaving the video as a draft in the creator's inbox; a
 *     "published" row there would hide a post that never went out.
 *
 * Run with `pnpm test`.
 */
import { boot, check, section, report } from "./harness.mjs";

const VIDEO = "https://app.example.com/api/uploads/ab12-clip.mp4";
const IMAGE = "https://app.example.com/api/uploads/cd34-photo.jpg";

async function channels(h) {
  const mk = (name, platform, extra = {}) =>
    h.post("/api/channels", { name, platform, ...extra }).then((r) => r.body);
  return {
    tiktok: await mk("TikTok", "tiktok"),
    facebook: await mk("Page", "facebook", { platform_account_id: "9001" }),
    x: await mk("X", "twitter"),
    linkedin: await mk("LinkedIn", "linkedin"),
  };
}

const by = (results, id) => results.find((r) => r.channelId === id);

section("A video post reaches the platforms that can take one");
{
  const h = await boot();
  const ch = await channels(h);
  const post = (await h.post("/api/posts", {
    content: "our new spot",
    channel_ids: [ch.tiktok.id, ch.facebook.id, ch.x.id, ch.linkedin.id],
    media: [{ url: VIDEO, type: "video" }],
  })).body;

  const res = (await h.post(`/api/posts/${post.id}/publish`)).body.results;

  check("TikTok takes it", by(res, ch.tiktok.id).success);
  check("Facebook takes it", by(res, ch.facebook.id).success);
  check("X refuses it, and says why",
    !by(res, ch.x.id).success && /video posts aren't supported yet/.test(by(res, ch.x.id).error),
    by(res, ch.x.id).error);
  check("LinkedIn refuses it, and says why",
    !by(res, ch.linkedin.id).success && /video posts aren't supported yet/.test(by(res, ch.linkedin.id).error));

  check("sends nothing at all to the two that can't take it", h.sends.length === 2,
    h.sends.map((s) => s.toolSlug).join(", "));
  check("the video itself reached TikTok, not just the caption",
    h.sends.find((s) => s.service === "tiktok")?.video === VIDEO,
    JSON.stringify(h.sends.find((s) => s.service === "tiktok")));
  check("the video itself reached Facebook, not just the message",
    h.sends.find((s) => s.service === "facebook")?.video === VIDEO);
  check("Facebook posted it as a video, not as a plain text post",
    h.sends.find((s) => s.service === "facebook")?.toolSlug === "FACEBOOK_CREATE_VIDEO_POST");
  check("the post is partial, not published",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "partial");
  check("the refused channels are retryable, not stuck as delivered",
    h.rows("SELECT status FROM post_channels WHERE post_id = ? AND status = 'failed'", post.id).length === 2);
}

section("A TikTok upload that lands in the inbox is not a published post");
{
  const h = await boot({ tiktokPublished: () => false });
  const ch = await channels(h);
  const post = (await h.post("/api/posts", {
    content: "draft only",
    channel_ids: [ch.tiktok.id],
    media: [{ url: VIDEO, type: "video" }],
  })).body;

  const res = (await h.post(`/api/posts/${post.id}/publish`)).body.results;
  check("the channel fails rather than reporting a post nobody can see",
    !res[0].success && /draft in the TikTok app/.test(res[0].error), res[0].error);
  check("the post is not marked published",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "failed");
}

section("Attachments no platform accepts are refused before anything is sent");
{
  const h = await boot();
  const ch = await channels(h);
  const mixed = (await h.post("/api/posts", {
    content: "both",
    channel_ids: [ch.tiktok.id, ch.facebook.id],
    media: [{ url: IMAGE, type: "image" }, { url: VIDEO, type: "video" }],
  })).body;

  const res = (await h.post(`/api/posts/${mixed.id}/publish`)).body.results;
  check("images and a video together fail every channel",
    res.every((r) => !r.success && /either images or a video/.test(r.error)), res[0]?.error);
  check("and nothing was sent", h.sends.length === 0);

  const two = (await h.post("/api/posts", {
    content: "two clips",
    channel_ids: [ch.tiktok.id],
    media: [{ url: VIDEO, type: "video" }, { url: VIDEO + "?b", type: "video" }],
  })).body;
  const res2 = (await h.post(`/api/posts/${two.id}/publish`)).body.results;
  check("a second video is refused too",
    !res2[0].success && /one video/.test(res2[0].error), res2[0].error);
}

section("Image posts are untouched by any of this");
{
  const h = await boot();
  const ch = await channels(h);
  const post = (await h.post("/api/posts", {
    content: "look at this",
    channel_ids: [ch.tiktok.id, ch.facebook.id, ch.x.id],
    media: [{ url: IMAGE, type: "image" }],
  })).body;

  const res = (await h.post(`/api/posts/${post.id}/publish`)).body.results;
  check("TikTok still gets a photo post",
    by(res, ch.tiktok.id).success &&
      h.sends.some((s) => s.toolSlug === "TIKTOK_POST_PHOTO" && s.images?.[0] === IMAGE));
  check("Facebook still gets a photo post",
    by(res, ch.facebook.id).success &&
      h.sends.some((s) => s.toolSlug === "FACEBOOK_CREATE_PHOTO_POST" && s.images?.[0] === IMAGE));
  check("X still gets the image attached, not the text on its own",
    by(res, ch.x.id).success &&
      h.sends.find((s) => s.service === "twitter")?.images?.[0] === `media-${IMAGE}`,
    JSON.stringify(h.sends.find((s) => s.service === "twitter")));
}

section("The stored type is what decides, and it survives the round trip");
{
  const h = await boot();
  const ch = await channels(h);
  // A bare string is the shape a pasted link arrives in: the extension is all
  // there is to go on, so a .mp4 link must not be filed as an image and sent
  // to an image endpoint.
  const post = (await h.post("/api/posts", {
    content: "pasted",
    channel_ids: [ch.tiktok.id],
    media: [VIDEO],
  })).body;
  check("a pasted .mp4 URL is stored as a video", post.media[0].type === "video",
    JSON.stringify(post.media));

  const reread = (await h.get(`/api/posts/${post.id}`)).body;
  check("and reads back as one", reread.media[0].type === "video");

  await h.put(`/api/posts/${post.id}`, { media: [{ url: IMAGE, type: "image" }] });
  const edited = (await h.get(`/api/posts/${post.id}`)).body;
  check("replacing the video with an image leaves only the image",
    edited.media.length === 1 && edited.media[0].type === "image" && edited.media[0].url === IMAGE,
    JSON.stringify(edited.media));

  const res = (await h.post(`/api/posts/${post.id}/publish`)).body.results;
  check("and it publishes down the photo path", res[0].success &&
    h.sends.some((s) => s.toolSlug === "TIKTOK_POST_PHOTO"));
}

report();
