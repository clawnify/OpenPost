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


/**
 * TikTok's Content Posting API is asynchronous: both the video upload and the
 * photo post return once TikTok has *accepted* the job, and the post only
 * appears after a download/transcode/moderation pass that can still reject it.
 *
 * A channel marked published is terminal — publishPost() never sends to it
 * again — so believing that acceptance is what makes a post that failed
 * moderation invisible forever. Everything below is about never doing that.
 */

section("A TikTok post is only published once TikTok says it is");
{
  const h = await boot();
  const ch = await channels(h);
  h.db.prepare("UPDATE channels SET profile_handle = ? WHERE id = ?").run("thespot", ch.tiktok.id);
  const post = (await h.post("/api/posts", {
    content: "our new spot",
    channel_ids: [ch.tiktok.id],
    media: [{ url: VIDEO, type: "video" }],
  })).body;

  const r = by((await h.post(`/api/posts/${post.id}/publish`)).body.results, ch.tiktok.id);

  check("it asked TikTok what happened before calling it published", h.polls.length === 1, h.polls.join(","));
  check("and it is published", r.success);
  check("with a link to the post TikTok reported", r.url === "https://www.tiktok.com/@thespot/video/7500", r.url);
}

section("A TikTok post that fails moderation is a failed channel, not a delivered one");
{
  const h = await boot({ tiktokStatus: () => ({ status: "FAILED", fail_reason: "spam_risk_text" }) });
  const ch = await channels(h);
  const post = (await h.post("/api/posts", {
    content: "buy now",
    channel_ids: [ch.tiktok.id],
    media: [{ url: VIDEO, type: "video" }],
  })).body;

  const r = by((await h.post(`/api/posts/${post.id}/publish`)).body.results, ch.tiktok.id);

  check("the channel fails, and says what TikTok objected to",
    !r.success && /flagged the caption as spam/.test(r.error), r.error);
  check("the row is failed, so the author can fix the caption and retry",
    h.row("SELECT status FROM post_channels WHERE post_id = ?", post.id).status === "failed");
  check("the post is not marked published",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status !== "published");
}

section("A TikTok post left as an inbox draft is not a published post");
{
  const h = await boot({ tiktokStatus: () => ({ status: "SEND_TO_USER_INBOX" }) });
  const ch = await channels(h);
  const post = (await h.post("/api/posts", {
    content: "draft",
    channel_ids: [ch.tiktok.id],
    media: [{ url: IMAGE, type: "image" }],
  })).body;

  const r = by((await h.post(`/api/posts/${post.id}/publish`)).body.results, ch.tiktok.id);
  check("the photo path polls too — it is just as asynchronous", h.polls.length === 1);
  check("and a draft is reported as one, not as a delivery",
    !r.success && /left it as a draft/.test(r.error), r.error);
}

section("A TikTok post TikTok hasn't ruled on is re-checked, never re-sent");
{
  // TikTok never reaches a verdict on the first publish, then completes by the
  // time the next delivery looks. This is the case that would double-post: the
  // channel is not published, and re-initiating the same publish_id is exactly
  // what TikTok's docs say never to do.
  let verdict = { status: "PROCESSING_UPLOAD" };
  const h = await boot({ tiktokStatus: () => verdict });
  const ch = await channels(h);
  const post = (await h.post("/api/posts", {
    content: "still cooking",
    channel_ids: [ch.tiktok.id],
    media: [{ url: VIDEO, type: "video" }],
  })).body;

  const first = by((await h.post(`/api/posts/${post.id}/publish`)).body.results, ch.tiktok.id);
  check("it is neither published nor failed", !first.success && first.pending === true);
  check("and it says so plainly", /still processing/.test(first.error), first.error);

  const row = h.row("SELECT status, ref, error FROM post_channels WHERE post_id = ?", post.id);
  check("the row stays pending, holding the id TikTok gave us",
    row.status === "pending" && row.ref === "tt-1", JSON.stringify(row));
  check("the post reads partial, so the author still has a retry to press",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "partial",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status);

  verdict = { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7501"] };
  const sendsBefore = h.sends.length;
  const second = by((await h.post(`/api/posts/${post.id}/publish`)).body.results, ch.tiktok.id);

  check("the next delivery confirms it instead of uploading again",
    second.success && h.sends.length === sendsBefore, `${sendsBefore} -> ${h.sends.length}`);
  check("and the post is published now",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "published");
}


section("An unconfirmed TikTok post arranges its own follow-up");
{
  // Nobody is watching the request once it returns, so the re-check has to be
  // queued work. It goes to /api/internal/publish — the same endpoint the
  // scheduler uses — because publishPost already re-checks rather than re-sends.
  let verdict = { status: "PROCESSING_UPLOAD" };
  const h = await boot({ queue: true, tiktokStatus: () => verdict });
  const ch = await channels(h);
  const post = (await h.post("/api/posts", {
    content: "still cooking",
    channel_ids: [ch.tiktok.id],
    media: [{ url: VIDEO, type: "video" }],
  })).body;

  await h.post(`/api/posts/${post.id}/publish`);

  check("it queued exactly one follow-up", h.queued.length === 1, JSON.stringify(h.queued));
  const job = h.queued[0]?.body ?? {};
  check("aimed at the endpoint that re-checks, carrying this post",
    /\/api\/internal\/publish$/.test(job.target_url || "") && job.payload?.post_id === post.id,
    JSON.stringify(job));
  check("a minute out, not immediately",
    Math.round((Date.parse(job.run_at) - Date.now()) / 1000) >= 55, job.run_at);
  check("and the schedule column is untouched — that job is the post's own",
    h.row("SELECT queue_job_id FROM posts WHERE id = ?", post.id).queue_job_id === null);

  // The follow-up lands and TikTok has made up its mind: it confirms, and asks
  // for nothing further.
  verdict = { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7502"] };
  await h.post(`/api/posts/${post.id}/publish`);
  check("once it settles, nothing more is queued", h.queued.length === 1, JSON.stringify(h.queued));
  check("and the post is published",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "published");
}

section("A post TikTok never rules on stops rescheduling itself");
{
  // The ladder is the runaway guard: without it a publish_id the platform never
  // settles would re-queue itself forever. Past the last rung the row keeps its
  // ref and the author keeps the retry — nothing loops.
  const h = await boot({ queue: true, tiktokStatus: () => ({ status: "PROCESSING_UPLOAD" }) });
  const ch = await channels(h);
  const post = (await h.post("/api/posts", {
    content: "never settles",
    channel_ids: [ch.tiktok.id],
    media: [{ url: VIDEO, type: "video" }],
  })).body;

  await h.post(`/api/posts/${post.id}/publish`);
  check("the first delivery queues a follow-up", h.queued.length === 1);

  // Stand on the ladder's last rung, as a run of deliveries would have left us.
  // The claim bumps attempts before the re-check reads it, so 4 here is the 5th
  // and final delay.
  h.db.prepare("UPDATE post_channels SET attempts = 4 WHERE post_id = ?").run(post.id);
  await h.post(`/api/posts/${post.id}/publish`);
  check("the last rung still queues one", h.queued.length === 2, JSON.stringify(h.queued.length));

  await h.post(`/api/posts/${post.id}/publish`);
  check("past it, nothing more is queued", h.queued.length === 2);
  check("but the post keeps its id and its retry",
    h.row("SELECT status, ref FROM post_channels WHERE post_id = ?", post.id).ref === "tt-1" &&
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "partial");
}

section("Without the managed queue, publishing still works — it just can't self-resolve");
{
  // The self-hosted case. Scheduling degrades to nothing, so the in-request
  // poll is the only confirmation there is, and it must not take the post down
  // with it when there's no queue to fall back on.
  const h = await boot({ tiktokStatus: () => ({ status: "PROCESSING_UPLOAD" }) });
  const ch = await channels(h);
  const post = (await h.post("/api/posts", {
    content: "no queue here",
    channel_ids: [ch.tiktok.id],
    media: [{ url: VIDEO, type: "video" }],
  })).body;

  const res = await h.post(`/api/posts/${post.id}/publish`);
  check("the publish still succeeds as a request", res.status === 200);
  check("nothing was queued", h.queued.length === 0);
  check("and the row still holds the id, so a manual retry can confirm it",
    h.row("SELECT status, ref FROM post_channels WHERE post_id = ?", post.id).ref === "tt-1");
}

report();
