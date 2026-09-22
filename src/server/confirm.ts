/**
 * Waiting for a platform to finish a post it has only accepted.
 *
 * Some publish calls return before the post exists: TikTok (every post) and
 * Facebook video both take the job, then download, encode and moderate it, and
 * any of that can still fail. A channel marked published is terminal —
 * publishPost() never sends to it again — so believing the acceptance is how a
 * post that never appeared stays green forever.
 *
 * Each such platform supplies one status check; this module owns the waiting.
 * When the platform still hasn't ruled by the end of the budget the answer is
 * "processing": not published (a lie) and not failed (a retry would re-send,
 * and a second upload is a duplicate post).
 */

export type PublishOutcome =
  /** Live. `postId` / `url` when the platform told us where. */
  | { state: "published"; postId?: string; url?: string }
  /** Accepted, not finished. Not live, and must not be re-sent. */
  | { state: "processing"; message: string }
  /** Terminal: rejected, or parked somewhere that isn't a post. */
  | { state: "failed"; message: string };

// Milliseconds to wait *before* each retry. The first check is immediate, so a
// post that is already done costs nothing. Four checks over ~10s stays far
// inside every platform's status rate limit (TikTok: 30/min per token), catches
// what settles quickly, and keeps one slow channel from stalling a
// multi-channel publish. Anything slower comes back as "processing" and is
// settled by a queued follow-up delivery (see scheduleRecheck in index.ts).
const POLL_DELAYS_MS = [1500, 3000, 6000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Run one platform's status check until it says something terminal, or give up as "processing". */
export async function pollOutcome(check: () => Promise<PublishOutcome>): Promise<PublishOutcome> {
  for (let attempt = 0; ; attempt++) {
    const outcome = await check();
    if (outcome.state !== "processing" || attempt >= POLL_DELAYS_MS.length) return outcome;
    await sleep(POLL_DELAYS_MS[attempt]);
  }
}
