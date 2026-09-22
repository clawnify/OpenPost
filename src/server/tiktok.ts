/**
 * TikTok's Content Posting API is asynchronous, and that is the whole reason
 * this module exists.
 *
 * Both of the calls this app makes — TIKTOK_UPLOAD_VIDEO with publish=true, and
 * TIKTOK_POST_PHOTO with post_mode=DIRECT_POST — return as soon as TikTok has
 * *accepted* the job. TikTok then downloads or transcodes the media, runs it
 * through moderation, and only then does the post appear on the profile. Any of
 * those stages can still reject it (spam risk, a duration or frame-rate check,
 * a banned account), and none of that shows up in the response we already have.
 *
 * TIKTOK_UPLOAD_VIDEO's `published` field is not the answer either: it reports
 * whether we asked TikTok to publish, not whether TikTok did. Trusting it marks
 * the channel delivered — a terminal state that publishPost() never retries —
 * while nothing is live and no retry will ever happen.
 *
 * So the publish_id gets polled through TIKTOK_FETCH_PUBLISH_STATUS until TikTok
 * says something terminal. When it hasn't by the end of the budget, the honest
 * answer is "we don't know yet": neither published (a lie) nor failed (which
 * would invite a retry, and re-initiating the same publish_id is exactly what
 * TikTok's docs tell you never to do — it would double-post).
 */

import { pollOutcome, type PublishOutcome } from "./confirm";

// TikTok's fail_reason vocabulary. Anything unlisted falls through to the raw
// code, which is still more useful to the author than "TikTok post failed".
const FAIL_REASONS: Record<string, string> = {
  file_format_check_failed: "TikTok rejected the file format. Use MP4, MOV or WEBM.",
  picture_size_check_failed: "TikTok rejected the image size.",
  frame_rate_check_failed: "TikTok rejected the video's frame rate (it accepts 23-60 fps).",
  duration_check_failed: "The video is longer than this TikTok account is allowed to post.",
  video_pull_failed: "TikTok couldn't download the video.",
  photo_pull_failed: "TikTok couldn't download the images.",
  spam_risk_text: "TikTok flagged the caption as spam.",
  spam_risk: "TikTok flagged the post as spam.",
  spam_risk_too_many_posts: "This TikTok account has posted too many times today.",
  spam_risk_user_banned_from_posting: "This TikTok account is banned from posting.",
  auth_removed: "The TikTok connection was revoked. Reconnect TikTok in Clawnify.",
  publish_cancelled: "The post was cancelled in the TikTok app.",
  internal: "TikTok hit an internal error while publishing.",
};

/** The subset of executeTool this module needs, so it stays testable in isolation. */
type Exec = (
  service: string,
  toolSlug: string,
  args: Record<string, unknown>,
) => Promise<{ successful?: boolean; error?: string | null; data?: unknown } | null>;

/**
 * Poll a publish_id to a terminal state, or give up and report "processing".
 *
 * Never throws and never reports success on an unknown state — every path this
 * returns is one the caller can persist as-is.
 */
export function awaitPublish(exec: Exec, publishId: string): Promise<PublishOutcome> {
  return pollOutcome(() => checkOnce(exec, publishId));
}

async function checkOnce(exec: Exec, publishId: string): Promise<PublishOutcome> {
  const r = await exec("tiktok", "TIKTOK_FETCH_PUBLISH_STATUS", { publish_id: publishId });

  // No broker at all (off-platform, or TikTok disconnected between the two
  // calls). We can't confirm, and we already handed TikTok the post, so this
  // is "unknown", not "failed" — the same reasoning as a timed-out poll.
  if (!r) return { state: "processing", message: "Couldn't reach TikTok to confirm this post went out." };

  const body = (r.data as any)?.data as
    | { status?: string; fail_reason?: string; publicaly_available_post_id?: string[] }
    | undefined;
  // Composio nests TikTok's own error object under data.error; the wrapper's
  // top-level `error` is Composio's. Either can carry the real reason.
  const apiError = (r.data as any)?.error as { code?: string; message?: string } | undefined;

  if (apiError?.code && apiError.code !== "ok") {
    // invalid_publish_id / token_not_authorized are terminal: no amount of
    // polling fixes them, and the post is not coming.
    if (apiError.code === "invalid_publish_id" || apiError.code === "token_not_authorized_for_specified_publish_id") {
      return { state: "failed", message: `TikTok lost track of this post (${apiError.code}).` };
    }
    return { state: "processing", message: apiError.message || `TikTok status check failed (${apiError.code}).` };
  }
  if (!r.successful) return { state: "processing", message: r.error || "TikTok status check failed." };

  switch (body?.status) {
    case "PUBLISH_COMPLETE":
      // The post id array is only populated once moderation has approved a
      // public post, so it can legitimately be empty on a private one.
      return { state: "published", postId: body.publicaly_available_post_id?.[0] };
    case "FAILED":
      return {
        state: "failed",
        message: FAIL_REASONS[body.fail_reason ?? ""] ?? `TikTok rejected the post (${body.fail_reason || "no reason given"}).`,
      };
    case "SEND_TO_USER_INBOX":
      // Uploaded, but as a draft the creator has to finish by hand. Never
      // a published post, and nothing we can push further from here.
      return {
        state: "failed",
        message: "TikTok took the post but left it as a draft — open the TikTok app to finish posting it.",
      };
    case "PROCESSING_UPLOAD":
    case "PROCESSING_DOWNLOAD":
    default:
      return { state: "processing", message: "TikTok is still processing this post." };
  }
}

/**
 * Link to a published TikTok post. Needs the creator's @handle, which only the
 * channel's synced profile carries — without it there is no URL to build, and
 * the post id alone is not a link.
 */
export function tiktokPostUrl(handle: string | null | undefined, postId: string | undefined): string | undefined {
  const at = String(handle || "").trim().replace(/^@/, "");
  return at && postId ? `https://www.tiktok.com/@${at}/video/${postId}` : undefined;
}
