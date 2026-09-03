import { createApp } from "@clawnify/app";
import { query, get, run } from "./db";
import { initCredentials, executeTool, getCredentials, stageFile } from "./credentials";
import type { CredentialServiceBinding, StagedFile } from "./credentials";
import { publishToBluesky, blueskyProfile, type BlueskyCreds } from "./bluesky";
import { scheduleDelivery, cancelDelivery, verifyDelivery } from "./queue";
import { initUploads, uploadsEnabled, putUpload, getUpload, makeKey } from "./uploads";
import { mediaLimitError } from "../shared/platforms";

type Env = {
  Bindings: {
    DB: D1Database;
    // R2 bucket for uploaded post images (clawnify.json app.storage: true)
    UPLOADS?: R2Bucket;
    // Service binding (production — injected by Clawnify builder)
    CREDENTIALS?: CredentialServiceBinding;
    // App owner's org ID (injected by builder as env var)
    CLAWNIFY_ORG_ID?: string;
    // Managed-service token (injected by Clawnify builder) — authorizes the
    // queue service that fires scheduled posts.
    CLAWNIFY_TOKEN?: string;
  };
};

interface PublishResult {
  channelId: number;
  channel: string;
  platform: string;
  success: boolean;
  error?: string;
  ref?: string;   // platform post id (Postiz: releaseId)
  url?: string;   // link to the live post (Postiz: releaseURL)
}

// Publish one post to every channel assigned to it, then update its status.
// Shared by the manual publish endpoint and the scheduled /internal/publish
// delivery. Every platform publishes via Composio execute (executeTool) —
// Composio holds the real token server-side and permanently redacts raw tokens
// since the May 2026 incident, so no raw-token path is usable.
async function publishPost(id: number): Promise<{ published: boolean; results: PublishResult[] } | null> {
  const post = await get<any>("SELECT * FROM posts WHERE id = ?", [id]);
  if (!post) return null;

  // channel_content is this channel's own version of the text; NULL means it
  // inherits the shared draft (posts.content). The pc.* delivery columns come
  // along because this function is re-entrant: it must know which channels are
  // already live before it sends anything.
  const channels = await query<any>(
    `SELECT c.*,
            pc.content AS channel_content,
            pc.status AS delivery_status,
            pc.ref AS delivery_ref,
            pc.url AS delivery_url,
            pc.attempts AS delivery_attempts
     FROM channels c
     JOIN post_channels pc ON pc.channel_id = c.id
     WHERE pc.post_id = ?`,
    [id],
  );
  const media = await query<any>("SELECT * FROM media WHERE post_id = ? ORDER BY id ASC", [id]);
  // Every attached image, in the order the composer shows them. Each platform
  // decides how many it can carry (see mediaLimitError) — none of them silently
  // gets a subset.
  const imageUrls = media.map((m: any) => m.url as string).filter(Boolean);

  // A post is publishable when at least one channel has text to send: the
  // shared draft, or its own override. Overriding every channel and clearing
  // the shared draft is a legitimate post, not an empty one.
  if (!channels.some((ch: any) => channelContent(ch, post.content).trim())) return null;

  const results: PublishResult[] = [];
  for (const channel of channels) {
    const base = {
      channelId: channel.id as number,
      channel: channel.name as string,
      platform: channel.platform as string,
    };

    // Already live. Report it as delivered — with the link it got the first
    // time — and send nothing. This is what makes the whole function safe to
    // run twice: the queue delivers at least once, so a redelivery (or a user
    // retrying a partial post) re-enters here with some channels already
    // published, and a tweet cannot be un-posted.
    if (channel.delivery_status === "published") {
      results.push({ ...base, success: true, ref: channel.delivery_ref ?? undefined, url: channel.delivery_url ?? undefined });
      continue;
    }

    // Claim the channel before sending: bump attempts only if it still holds
    // the value we read. Two deliveries racing each other both read the same
    // attempts, both try the swap, and exactly one wins — the loser skips
    // rather than posting a duplicate. Using the existing attempts counter (a
    // column that was written but never read) rather than a "sending" status
    // means a crashed run leaves no wedged row: the status is still
    // pending/failed, so the next retry simply claims it again.
    //
    // What this cannot cover: a crash after the platform accepted the post but
    // before the result was written. Only a platform-side idempotency key
    // could, and none of these APIs offers one.
    const claim = await run(
      `UPDATE post_channels SET attempts = attempts + 1
        WHERE post_id = ? AND channel_id = ? AND status != 'published' AND attempts = ?`,
      [id, channel.id, channel.delivery_attempts ?? 0],
    );
    if (claim.changes !== 1) continue;

    const r = await publishToChannel(channel, channelContent(channel, post.content), imageUrls);
    // Persist this channel's delivery outcome on its post_channels row.
    // attempts was already incremented by the claim above.
    await run(
      `UPDATE post_channels
         SET status = ?, ref = ?, url = ?, error = ?,
             published_at = CASE WHEN ? THEN datetime('now') ELSE published_at END
       WHERE post_id = ? AND channel_id = ?`,
      [
        r.success ? "published" : "failed",
        r.ref ?? null,
        r.url ?? null,
        r.error ?? null,
        r.success ? 1 : 0,
        id,
        r.channelId,
      ],
    );
    results.push(r);
  }

  // Roll the post's status up from what the table now says, not from this
  // run's results: a retry only touches the channels that had not gone out,
  // and a concurrent delivery may have settled the rest. Re-reading is the
  // only view that covers both.
  const states = await query<any>("SELECT status FROM post_channels WHERE post_id = ?", [id]);
  const delivered = states.filter((s: any) => s.status === "published").length;
  const inFlight = states.filter((s: any) => s.status === "pending").length;
  const rollup =
    delivered === states.length ? "published"
    : delivered > 0 ? "partial"
    // Nothing delivered but something is still pending: another delivery holds
    // it. Don't call the post failed on its behalf.
    : inFlight > 0 ? (post.status as string)
    : "failed";
  await run(
    `UPDATE posts
       SET status = ?,
           published_at = CASE WHEN ? THEN datetime('now') ELSE published_at END,
           updated_at = datetime('now')
     WHERE id = ?`,
    [rollup, delivered > 0 ? 1 : 0, id],
  );
  return { published: delivered > 0, results };
}

// The text this channel actually publishes: its own version when it has one,
// otherwise the post's shared draft. The single place the two are resolved, so
// publishing, previews and the API can never disagree about which text wins.
function channelContent(channel: any, shared: string | null | undefined): string {
  const own = channel.channel_content as string | null | undefined;
  return (own ?? shared ?? "") as string;
}

async function publishToChannel(channel: any, content: string, imageUrls: string[]): Promise<PublishResult> {
  const base = { channelId: channel.id as number, channel: channel.name as string, platform: channel.platform as string };

  // Only reachable when the shared draft is empty and this channel wasn't
  // given its own text — the other channels still go out.
  if (!content.trim()) {
    return { ...base, success: false, error: "No content for this channel. Write a shared draft, or customize this channel." };
  }

  // More images than this platform accepts fails the channel rather than
  // posting a truncated set. Sending fewer images than the user attached,
  // silently, is the bug the whole media path exists to avoid — and the
  // per-channel delivery model means the other channels still go out.
  const overLimit = mediaLimitError(channel.platform, imageUrls.length);
  if (overLimit) return { ...base, success: false, error: overLimit };

  switch (channel.platform) {
    case "twitter": {
      // Composio execute (raw tokens are permanently redacted post-incident).
      // Images are separate calls first: stage each with the broker, hand the
      // descriptor to TWITTER_UPLOAD_MEDIA, then attach every media id it mints.
      let mediaIds: string[] | undefined;
      if (imageUrls.length) {
        const ids: string[] = [];
        for (const url of imageUrls) {
          const up = await uploadTwitterMedia(url);
          if ("error" in up) return { ...base, success: false, error: up.error };
          ids.push(up.mediaId);
        }
        mediaIds = ids;
      }
      const r = await executeTool("twitter", "TWITTER_CREATION_OF_A_POST", {
        text: content,
        ...(mediaIds ? { media_media_ids: mediaIds } : {}),
      });
      if (!r) return { ...base, success: false, error: "No Twitter credentials. Connect Twitter in Clawnify." };
      const ref = (r.data as { data?: { id?: string } } | null)?.data?.id;
      const url = ref ? `https://x.com/i/status/${ref}` : undefined;
      return { ...base, success: !!r.successful, error: r.successful ? undefined : (r.error || "Tweet failed"), ref, url };
    }
    case "linkedin": {
      // Composio permanently redacts raw tokens (May 2026 incident), so post
      // via Composio execute — it holds the real token server-side.
      const me = await executeTool("linkedin", "LINKEDIN_GET_MY_INFO", {});
      if (!me?.successful) return { ...base, success: false, error: me?.error || "LinkedIn not connected" };
      const id = (me.data as { id?: string } | null)?.id;
      if (!id) return { ...base, success: false, error: "could not resolve LinkedIn member id" };
      // LinkedIn's action uploads the images itself, but only from files
      // staged through the broker — a URL in `images` is not a shape it takes.
      // The action carries 1-20 of them; slide order follows this array.
      let images: StagedFile[] | undefined;
      if (imageUrls.length) {
        const staged: StagedFile[] = [];
        for (const url of imageUrls) {
          const s = await stageFile("linkedin", "LINKEDIN_CREATE_LINKED_IN_POST", url);
          // No staging available at all: off-platform, or a runtime older than
          // the broker's stageFile. Either way the image cannot go out, and the
          // channel fails rather than quietly posting the text on its own.
          if (!s) return { ...base, success: false, error: "Couldn't upload the images to LinkedIn. Reconnect LinkedIn in Clawnify." };
          if (!s.descriptor) return { ...base, success: false, error: `LinkedIn image upload failed: ${s.error}` };
          staged.push(s.descriptor);
        }
        images = staged;
      }
      const r = await executeTool("linkedin", "LINKEDIN_CREATE_LINKED_IN_POST", {
        author: `urn:li:person:${id}`,
        commentary: content,
        visibility: "PUBLIC",
        lifecycleState: "PUBLISHED",
        ...(images ? { images } : {}),
      });
      const ref = (r?.data as { x_restli_id?: string } | null)?.x_restli_id;
      const url = ref ? `https://www.linkedin.com/feed/update/${ref}` : undefined;
      return { ...base, success: !!r?.successful, error: r?.successful ? undefined : (r?.error || "LinkedIn post failed"), ref, url };
    }
    case "instagram": {
      // Composio execute, two-step: create media container → publish it.
      // IG requires a Business account, an image, and the IG Business Account
      // ID (resolved from the connection, see resolveInstagramAccountId).
      //
      // One image is a plain container; two or more is a carousel, which takes
      // its children as URLs directly (no per-child container round-trip). Both
      // publish through the same media_publish call.
      //
      // INSTAGRAM_CREATE_MEDIA_CONTAINER / INSTAGRAM_CREATE_POST — what this
      // used to call — are both marked deprecated in Composio's catalogue, and
      // the carousel container has no deprecated publish partner anyway.
      if (!imageUrls.length) return { ...base, success: false, error: "Instagram requires an image." };
      const igUserId = await resolveInstagramAccountId(channel);
      if (!igUserId) return { ...base, success: false, error: "No Instagram credentials. Connect Instagram in Clawnify." };
      const container =
        imageUrls.length === 1
          ? await executeTool("instagram", "INSTAGRAM_POST_IG_USER_MEDIA", {
              ig_user_id: igUserId,
              image_url: imageUrls[0],
              caption: content,
            })
          : await executeTool("instagram", "INSTAGRAM_CREATE_CAROUSEL_CONTAINER", {
              ig_user_id: igUserId,
              child_image_urls: imageUrls,
              caption: content,
            });
      if (!container) return { ...base, success: false, error: "No Instagram credentials. Connect Instagram in Clawnify." };
      if (!container.successful) return { ...base, success: false, error: container.error || "Instagram container failed" };
      const creationId = (container.data as { id?: string } | null)?.id;
      if (!creationId) return { ...base, success: false, error: "Instagram: no creation_id returned" };
      const pub = await executeTool("instagram", "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", {
        ig_user_id: igUserId,
        creation_id: creationId,
      });
      const ref = (pub?.data as { id?: string } | null)?.id;
      return { ...base, success: !!pub?.successful, error: pub?.successful ? undefined : (pub?.error || "Instagram publish failed"), ref };
    }
    case "tiktok": {
      // Composio execute, single-step photo post (TikTok Content Posting API).
      // Image-only for now, matching this app's photo-first media model.
      // photo_images carries the whole set (1-35); the first is the cover.
      if (!imageUrls.length) return { ...base, success: false, error: "TikTok requires an image." };
      const r = await executeTool("tiktok", "TIKTOK_POST_PHOTO", {
        post_mode: "DIRECT_POST",
        photo_images: imageUrls,
        photo_cover_index: 0,
        title: content.slice(0, 90),
        description: content,
        privacy_level: "PUBLIC_TO_EVERYONE",
      });
      if (!r) return { ...base, success: false, error: "No TikTok credentials. Connect TikTok in Clawnify." };
      const d = (r.data as any)?.data || (r.data as any) || {};
      const ref = d.publish_id as string | undefined;
      // TikTok rejects PUBLIC_TO_EVERYONE (rather than silently downgrading
      // it) from apps TikTok hasn't audited yet, and from personal accounts
      // that haven't unlocked public posting — both surface as one of these
      // literal error codes. Relabel them instead of guessing a "safe" privacy
      // level up front, which would post successfully but invisibly to
      // everyone (Postiz's tiktok.provider.ts does the same relabeling).
      const raw = String(r.error || JSON.stringify(r.data || {}));
      const friendly = /unaudited_client_can_only_post_to_private_accounts|privacy_level_option_mismatch/.test(raw)
        ? "TikTok hasn't approved this account for public posts (app audit or account type). Contact support, or set this account to allow public posting in the TikTok app."
        : r.error || "TikTok post failed";
      return { ...base, success: !!r.successful, error: r.successful ? undefined : friendly, ref };
    }
    case "facebook": {
      // Composio execute against the Graph API. Facebook only lets apps publish
      // as a Page (the personal feed is closed), so the channel carries the
      // Page ID in platform_account_id — picked from the connected account's
      // Pages on the channel form. Photo posts go through /photos, text-only
      // through /feed (Postiz's facebook.provider.ts splits the same way).
      const pageId = accountId(channel);
      if (!pageId) return { ...base, success: false, error: "Facebook channel has no Page selected." };
      // Several photos need the unpublished-upload + attached_media dance;
      // FACEBOOK_CREATE_MULTI_PHOTO_POST does the whole thing in one call and
      // fails the post outright if any upload fails, so a partial set never
      // ships. One photo keeps the plain photo post.
      const r =
        imageUrls.length > 1
          ? await executeTool("facebook", "FACEBOOK_CREATE_MULTI_PHOTO_POST", {
              page_id: pageId,
              photo_urls: imageUrls,
              message: content,
            })
          : imageUrls.length === 1
            ? await executeTool("facebook", "FACEBOOK_CREATE_PHOTO_POST", {
                page_id: pageId,
                url: imageUrls[0],
                message: content,
                published: true,
              })
            : await executeTool("facebook", "FACEBOOK_CREATE_POST", {
                page_id: pageId,
                message: content,
                published: true,
              });
      if (!r) return { ...base, success: false, error: "No Facebook credentials. Connect Facebook in Clawnify." };
      // Composio wraps the raw Graph response as data.response_data. /feed
      // returns { id: "<page>_<post>" }; /photos returns { id: <photo>,
      // post_id: "<page>_<post>" } — the post id is the one that has a
      // permalink. The multi-photo action is Composio-authored and returns a
      // typed { post_id } with no response_data wrapper, which the same
      // `response_data ?? data` then `post_id || id` read already covers.
      const d = (((r.data as any)?.response_data ?? r.data) || {}) as { id?: string; post_id?: string };
      const ref = d.post_id || d.id;
      const url = ref ? facebookPostUrl(ref) : undefined;
      return { ...base, success: !!r.successful, error: r.successful ? undefined : (r.error || "Facebook post failed"), ref, url };
    }
    case "bluesky": {
      // Own-tier (AT Protocol app password), not Composio: the three-field
      // credential comes from the broker via getCredentials, and posting is a
      // raw XRPC call (see bluesky.ts). Handle + PDS host live on the vaulted
      // credential, so there is one Bluesky account per org — same as the
      // OAuth channels above.
      const creds = await resolveBlueskyCreds();
      if (!creds) return { ...base, success: false, error: "No Bluesky credentials. Connect Bluesky in Clawnify." };
      const r = await publishToBluesky(creds, content, imageUrls);
      return { ...base, success: r.success, error: r.error, ref: r.ref, url: r.url };
    }
    default:
      // Backstop for a channel whose platform has no case above (a legacy row,
      // a hand-edited DB). The picker only offers PUBLISHABLE_PLATFORMS
      // (src/client/types.ts), which must match the cases here — keep the two
      // in sync when adding a platform.
      return { ...base, success: false, error: `Publishing to ${channel.platform} not yet supported` };
  }
}

// Stage an image with the broker, then turn it into an X media id.
//
// X's own upload endpoint isn't in Composio's Twitter catalogue as a URL call:
// TWITTER_UPLOAD_MEDIA takes a file staged through the broker,
// and returns a media id good for 24h (X returns expires_after_secs: 86400).
// Longer than a publish, shorter than a schedule — so this runs at publish
// time, not when the post is queued.
//
// A failure here fails the whole channel rather than posting text-only. Sending
// the user's post without the image they attached, silently, is the bug this
// path exists to close (bluesky.ts takes the same stance on an oversized blob).
async function uploadTwitterMedia(imageUrl: string): Promise<{ mediaId: string } | { error: string }> {
  const staged = await stageFile("twitter", "TWITTER_UPLOAD_MEDIA", imageUrl);
  // No staging available at all: off-platform, or a runtime older than the
  // broker's stageFile. Don't borrow the "no credentials" wording — that names
  // a cause this branch hasn't checked.
  if (!staged) return { error: "Couldn't upload the image to X. Reconnect X in Clawnify." };
  if (!staged.descriptor) return { error: `X image upload failed: ${staged.error}` };

  const r = await executeTool("twitter", "TWITTER_UPLOAD_MEDIA", {
    media: staged.descriptor,
    media_category: "tweet_image",
  });
  if (!r) return { error: "No Twitter credentials. Connect Twitter in Clawnify." };
  const mediaId = (r.data as { data?: { id?: string } } | null)?.data?.id;
  if (!r.successful || !mediaId) return { error: `X image upload failed: ${r.error || "no media id returned"}` };
  return { mediaId };
}

// The platform-side account a channel publishes as (Facebook Page ID,
// Instagram Business Account ID). Rows from before platform_account_id existed
// kept that id in `handle`, so a purely numeric handle still counts.
function accountId(channel: any): string | undefined {
  const stored = channel.platform_account_id as string | null | undefined;
  if (stored) return stored;
  const legacy = String(channel.handle || "").trim();
  return /^\d+$/.test(legacy) ? legacy : undefined;
}

// Instagram Business Account ID for a channel: the stored one, else ask the
// connected account for itself (INSTAGRAM_GET_USER_INFO with no id returns
// the current user) and persist it. Null off-platform or when Instagram isn't
// connected — the caller turns that into a per-channel failure.
async function resolveInstagramAccountId(channel: any): Promise<string | null> {
  const stored = accountId(channel);
  if (stored) return stored;
  const r = await executeTool("instagram", "INSTAGRAM_GET_USER_INFO", {});
  const id = r?.successful ? ((r.data as any)?.id as string | undefined) : undefined;
  if (!id) return null;
  await run("UPDATE channels SET platform_account_id = ? WHERE id = ?", [id, channel.id]);
  return id;
}

// Permalink for a Graph API post id. Composite ids ("<page>_<post>") map to
// the canonical /<page>/posts/<post> form; anything else resolves at the root.
function facebookPostUrl(ref: string): string {
  const [page, post] = ref.split("_");
  return post ? `https://www.facebook.com/${page}/posts/${post}` : `https://www.facebook.com/${ref}`;
}

// Resolve the org's Bluesky connection into the three fields createSession
// needs. Returns null off-platform (no broker) or when Bluesky isn't connected
// / is missing a field — the caller turns that into a per-channel failure.
async function resolveBlueskyCreds(): Promise<BlueskyCreds | null> {
  const c = await getCredentials("bluesky");
  if (!c?.service || !c?.identifier || !c?.password) return null;
  return { service: c.service, identifier: c.identifier, password: c.password };
}

// Reconcile a post's queue job with its current schedule. Enqueues a delivery
// when the post is scheduled with a future time, and cancels a prior job on
// reschedule/unschedule. No-op (and harmless) in local dev where there's no
// CLAWNIFY_TOKEN.
async function syncSchedule(
  env: Env["Bindings"],
  origin: string,
  postId: number,
  status: string,
  scheduledAt: string | null,
  existingJobId: string | null,
): Promise<void> {
  const token = env.CLAWNIFY_TOKEN;
  if (existingJobId && token) await cancelDelivery(token, existingJobId);

  let newJobId: string | null = null;
  if (token && status === "scheduled" && scheduledAt) {
    newJobId = await scheduleDelivery({ token, origin, postId, runAt: scheduledAt });
  }
  await run("UPDATE posts SET queue_job_id = ? WHERE id = ?", [newJobId, postId]);
}

interface ChannelProfile {
  profile_name: string | null;
  profile_handle: string | null;
  profile_avatar_url: string | null;
  profile_headline: string | null;
}

// Fetch the live platform profile for a channel via Composio so previews render
// the real name / photo / @handle / headline. Returns null when the platform
// has no profile fetch, isn't connected, or the call fails (off-platform too).
async function fetchChannelProfile(channel: any): Promise<ChannelProfile | null> {
  try {
    switch (channel.platform) {
      case "linkedin": {
        const r = await executeTool("linkedin", "LINKEDIN_GET_MY_INFO", {});
        if (!r?.successful) return null;
        const d = (r.data as any) || {};
        const name = [d.localizedFirstName, d.localizedLastName].filter(Boolean).join(" ").trim();
        return {
          profile_name: name || null,
          profile_handle: null,
          profile_avatar_url: d.profilePicture?.displayImage || null,
          profile_headline: null, // not exposed by LINKEDIN_GET_MY_INFO
        };
      }
      case "twitter": {
        const r = await executeTool("twitter", "TWITTER_USER_LOOKUP_ME", {
          user__fields: "name,username,profile_image_url,description",
        });
        if (!r?.successful) return null;
        const d = (r.data as any)?.data || {};
        return {
          profile_name: d.name || null,
          profile_handle: d.username || null,
          // Swap Twitter's 48px "_normal" crop for the 400px original.
          profile_avatar_url: (d.profile_image_url || "").replace("_normal", "_400x400") || null,
          profile_headline: d.description || null,
        };
      }
      case "instagram": {
        const igUserId = await resolveInstagramAccountId(channel);
        if (!igUserId) return null;
        const r = await executeTool("instagram", "INSTAGRAM_GET_USER_INFO", { ig_user_id: igUserId });
        if (!r?.successful) return null;
        const d = (r.data as any) || {};
        return {
          profile_name: d.username || null,
          profile_handle: d.username || null,
          profile_avatar_url: d.profile_picture_url || null,
          profile_headline: d.biography || null,
        };
      }
      case "tiktok": {
        const r = await executeTool("tiktok", "TIKTOK_GET_USER_STATS", {
          fields: ["display_name", "avatar_url", "username", "bio_description"],
        });
        if (!r?.successful) return null;
        const d = (r.data as any)?.data?.user || (r.data as any)?.user || (r.data as any) || {};
        return {
          profile_name: d.display_name || null,
          profile_handle: d.username || null,
          profile_avatar_url: d.avatar_url || null,
          profile_headline: d.bio_description || null,
        };
      }
      case "facebook": {
        const pageId = accountId(channel);
        if (!pageId) return null;
        const r = await executeTool("facebook", "FACEBOOK_GET_PAGE_DETAILS", {
          page_id: pageId,
          fields: "id,name,username,about,picture.type(large)",
        });
        if (!r?.successful) return null;
        const d = ((r.data as any)?.response_data ?? (r.data as any)) || {};
        return {
          profile_name: d.name || null,
          profile_handle: d.username || null,
          profile_avatar_url: d.picture?.data?.url || null,
          profile_headline: d.about || null,
        };
      }
      case "bluesky": {
        const creds = await resolveBlueskyCreds();
        if (!creds) return null;
        return blueskyProfile(creds);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// Fetch + persist the platform profile onto a channel row. Returns the updated
// row (or the unchanged row when the fetch yields nothing).
async function syncChannelProfile(id: number): Promise<any | null> {
  const channel = await get<any>("SELECT * FROM channels WHERE id = ?", [id]);
  if (!channel) return null;
  const profile = await fetchChannelProfile(channel);
  if (profile) {
    await run(
      `UPDATE channels SET profile_name = ?, profile_handle = ?, profile_avatar_url = ?,
         profile_headline = ?, profile_synced_at = datetime('now') WHERE id = ?`,
      [profile.profile_name, profile.profile_handle, profile.profile_avatar_url, profile.profile_headline, id],
    );
  }
  return get<any>("SELECT * FROM channels WHERE id = ?", [id]);
}

const app = createApp<Env>({
  title: "OpenPost",
  version: "1.0.0",
  description:
    "Social media post scheduler with a calendar view, multi-channel composer, queue management, and analytics.",
});

app.use("*", async (c, next) => {
  initUploads(c.env.UPLOADS);
  initCredentials({
    env: c.env as unknown as Record<string, string>,
    credentialService: c.env.CREDENTIALS,
    orgId: c.env.CLAWNIFY_ORG_ID,
  });
  await next();
});

// ── Image uploads ──

// Upload an image to R2 and return its absolute, publicly-fetchable URL. The
// URL must be public because the social platforms (Instagram especially) fetch
// the image server-side at publish time — see /api/uploads/:key in the public
// routes (clawnify.json).
app.post("/api/upload", async (c) => {
  if (!uploadsEnabled()) return c.json({ error: "Uploads not configured" }, 503);
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") return c.json({ error: "No file provided" }, 400);
  if (!file.type.startsWith("image/")) return c.json({ error: "Only images are supported" }, 400);

  const key = makeKey(file.name || "image");
  await putUpload(key, await file.arrayBuffer(), file.type || "application/octet-stream");

  const url = `${new URL(c.req.url).origin}/api/uploads/${key}`;
  return c.json({ url }, 201);
});

app.get("/api/uploads/:key", async (c) => {
  const obj = await getUpload(c.req.param("key"));
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.data, {
    headers: { "Content-Type": obj.contentType, "Cache-Control": "public, max-age=31536000" },
  });
});

// ── Platform helpers ──

// The Pages the connected Facebook account manages, for the channel form's
// Page picker. `connected: false` with no pages (not an error) off-platform or
// when Facebook isn't connected, so the form falls back to a manual Page ID.
// Only id / name / username leave this handler — the Graph response also
// carries per-Page access tokens, which must never reach the browser.
app.get("/api/platforms/facebook/pages", async (c) => {
  const r = await executeTool("facebook", "FACEBOOK_GET_USER_PAGES", { fields: "id,name,username" });
  if (!r) return c.json({ connected: false, pages: [] });
  if (!r.successful) return c.json({ error: r.error || "Could not list Facebook Pages" }, 502);
  const d = ((r.data as any)?.response_data ?? (r.data as any)) || {};
  const pages = ((d.data ?? []) as Array<{ id: string | number; name?: string; username?: string }>).map((p) => ({
    id: String(p.id),
    name: p.name || String(p.id),
    username: p.username ?? null,
  }));
  return c.json({ connected: true, pages });
});

// ── Channels ──

app.get("/api/channels", async (c) => {
  const rows = await query("SELECT * FROM channels ORDER BY created_at DESC");
  return c.json(rows);
});

app.post("/api/channels", async (c) => {
  const { name, platform, handle, color, platform_account_id } = await c.req.json<{
    name: string; platform?: string; handle?: string; color?: string; platform_account_id?: string | null;
  }>();
  if (!name?.trim()) return c.json({ error: "Name required" }, 400);
  const result = await run(
    "INSERT INTO channels (name, platform, handle, color, platform_account_id) VALUES (?, ?, ?, ?, ?)",
    [name.trim(), platform || "twitter", handle || "", color || "#1da1f2", platform_account_id?.trim() || null]
  );
  const id = Number(result.lastInsertRowid);
  // Pull the real platform profile so previews are accurate from the start.
  // Best-effort: a failed sync still returns the created channel.
  const row =
    (await syncChannelProfile(id)) ?? (await get("SELECT * FROM channels WHERE id = ?", [id]));
  return c.json(row, 201);
});

// Re-sync a channel's cached platform profile on demand.
app.post("/api/channels/:id/sync-profile", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await syncChannelProfile(id);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.put("/api/channels/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { name, platform, handle, color, platform_account_id } = await c.req.json<{
    name?: string; platform?: string; handle?: string; color?: string; platform_account_id?: string | null;
  }>();
  const existing = await get<any>("SELECT * FROM channels WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const nextPlatform = platform ?? existing.platform;
  // An account id belongs to one platform: drop it when the platform changes
  // unless the request supplies a new one.
  const nextAccountId =
    platform_account_id !== undefined
      ? platform_account_id?.trim() || null
      : nextPlatform === existing.platform ? existing.platform_account_id : null;
  await run(
    "UPDATE channels SET name = ?, platform = ?, handle = ?, color = ?, platform_account_id = ? WHERE id = ?",
    [
      name ?? existing.name,
      nextPlatform,
      handle ?? existing.handle,
      color ?? existing.color,
      nextAccountId,
      id,
    ]
  );
  const row = await get("SELECT * FROM channels WHERE id = ?", [id]);
  return c.json(row);
});

app.delete("/api/channels/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await run("DELETE FROM channels WHERE id = ?", [id]);
  return c.json({ ok: true });
});

// ── Labels ──

app.get("/api/labels", async (c) => {
  const rows = await query("SELECT * FROM labels ORDER BY name ASC");
  return c.json(rows);
});

app.post("/api/labels", async (c) => {
  const { name, color } = await c.req.json<{ name: string; color?: string }>();
  if (!name?.trim()) return c.json({ error: "Name required" }, 400);
  const result = await run(
    "INSERT INTO labels (name, color) VALUES (?, ?)",
    [name.trim(), color || "#6b7280"]
  );
  const row = await get("SELECT * FROM labels WHERE id = ?", [result.lastInsertRowid]);
  return c.json(row, 201);
});

app.put("/api/labels/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { name, color } = await c.req.json<{ name?: string; color?: string }>();
  const existing = await get("SELECT * FROM labels WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  await run(
    "UPDATE labels SET name = ?, color = ? WHERE id = ?",
    [name ?? (existing as any).name, color ?? (existing as any).color, id]
  );
  const row = await get("SELECT * FROM labels WHERE id = ?", [id]);
  return c.json(row);
});

app.delete("/api/labels/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await run("DELETE FROM labels WHERE id = ?", [id]);
  return c.json({ ok: true });
});

// ── Posts ──

// Reconcile a post's channel rows against the set the request asked for,
// carrying each channel's own version of the text where it supplied one. A
// blank override is stored as NULL — "no override, inherit the shared draft" —
// so an emptied box never publishes an empty post.
//
// Channels that stay on the post are updated in place, never deleted and
// re-inserted. Their post_channels row carries the delivery state (status /
// ref / url / published_at), so re-inserting would drop the link to a post
// that is already live and reset it to "pending" — losing the link the user
// clicks through, and re-arming publishPost to send the same thing again.
// Editing a post must not be able to double-post it.
async function setPostChannels(
  postId: number,
  channelIds: number[],
  overrides: Record<string, string | null> | undefined,
): Promise<void> {
  // Drop only the channels the post no longer has.
  if (channelIds.length) {
    await run(
      `DELETE FROM post_channels
        WHERE post_id = ? AND channel_id NOT IN (${channelIds.map(() => "?").join(", ")})`,
      [postId, ...channelIds],
    );
  } else {
    await run("DELETE FROM post_channels WHERE post_id = ?", [postId]);
  }
  for (const cid of channelIds) {
    const own = overrides?.[String(cid)];
    await run(
      `INSERT INTO post_channels (post_id, channel_id, content) VALUES (?, ?, ?)
       ON CONFLICT(post_id, channel_id) DO UPDATE SET content = excluded.content`,
      [postId, cid, typeof own === "string" && own.trim() ? own : null],
    );
  }
}

async function enrichPost(post: any) {
  // Include the per-channel delivery state (Postiz-style) so the UI can show
  // each channel's status, link out to the live post, and surface failures.
  const channels = await query(
    `SELECT c.*,
            pc.content AS content_override,
            pc.status AS delivery_status,
            pc.ref AS delivery_ref,
            pc.url AS delivery_url,
            pc.error AS delivery_error,
            pc.published_at AS delivery_published_at
     FROM channels c
     JOIN post_channels pc ON pc.channel_id = c.id
     WHERE pc.post_id = ?`,
    [post.id]
  );
  const labels = await query(
    `SELECT l.* FROM labels l
     JOIN post_labels pl ON pl.label_id = l.id
     WHERE pl.post_id = ?`,
    [post.id]
  );
  const mediaItems = await query(
    "SELECT * FROM media WHERE post_id = ? ORDER BY id ASC",
    [post.id]
  );
  return { ...post, channels, labels, media: mediaItems };
}

app.get("/api/posts", async (c) => {
  const status = c.req.query("status");
  const channelId = c.req.query("channel_id");
  const from = c.req.query("from");
  const to = c.req.query("to");

  let sql = "SELECT * FROM posts";
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    // Accept a comma-separated list, e.g. status=scheduled,failed,partial.
    const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      conditions.push("status = ?");
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
  }
  if (channelId) {
    conditions.push("id IN (SELECT post_id FROM post_channels WHERE channel_id = ?)");
    params.push(Number(channelId));
  }
  if (from) {
    conditions.push("scheduled_at >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("scheduled_at <= ?");
    params.push(to);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY COALESCE(scheduled_at, created_at) DESC";

  const rows = await query(sql, params);
  const enriched = await Promise.all(rows.map(enrichPost));
  return c.json(enriched);
});

app.get("/api/posts/calendar", async (c) => {
  const month = c.req.query("month"); // YYYY-MM
  if (!month) return c.json({ error: "month param required (YYYY-MM)" }, 400);

  const from = `${month}-01T00:00:00`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, "0")}T23:59:59`;

  const rows = await query(
    "SELECT * FROM posts WHERE scheduled_at >= ? AND scheduled_at <= ? ORDER BY scheduled_at ASC",
    [from, to]
  );
  const enriched = await Promise.all(rows.map(enrichPost));

  const grouped: Record<string, any[]> = {};
  for (const post of enriched) {
    const day = (post as any).scheduled_at?.slice(0, 10) || "unscheduled";
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(post);
  }
  return c.json(grouped);
});

app.get("/api/posts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const post = await get("SELECT * FROM posts WHERE id = ?", [id]);
  if (!post) return c.json({ error: "Not found" }, 404);
  return c.json(await enrichPost(post));
});

app.post("/api/posts", async (c) => {
  const { content, status, scheduled_at, channel_ids, channel_content, label_ids, media_urls } = await c.req.json<{
    content: string;
    status?: string;
    scheduled_at?: string;
    channel_ids?: number[];
    // Per-channel text overrides, keyed by channel id. Additive: a request that
    // omits it posts the same shared draft everywhere, exactly as before.
    channel_content?: Record<string, string | null>;
    label_ids?: number[];
    media_urls?: string[];
  }>();

  const postStatus = status || (scheduled_at ? "scheduled" : "draft");
  const result = await run(
    "INSERT INTO posts (content, status, scheduled_at) VALUES (?, ?, ?)",
    [content || "", postStatus, scheduled_at || null]
  );
  const postId = result.lastInsertRowid;

  if (channel_ids?.length) {
    await setPostChannels(Number(postId), channel_ids, channel_content);
  }
  if (label_ids?.length) {
    for (const lid of label_ids) {
      await run("INSERT INTO post_labels (post_id, label_id) VALUES (?, ?)", [postId, lid]);
    }
  }
  if (media_urls?.length) {
    for (const url of media_urls) {
      await run("INSERT INTO media (post_id, url) VALUES (?, ?)", [postId, url]);
    }
  }

  await syncSchedule(c.env, new URL(c.req.url).origin, Number(postId), postStatus, scheduled_at || null, null);

  const post = await get("SELECT * FROM posts WHERE id = ?", [postId]);
  return c.json(await enrichPost(post), 201);
});

app.put("/api/posts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await get("SELECT * FROM posts WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const { content, status, scheduled_at, channel_ids, channel_content, label_ids, media_urls } = await c.req.json<{
    content?: string;
    status?: string;
    scheduled_at?: string | null;
    channel_ids?: number[];
    channel_content?: Record<string, string | null>;
    label_ids?: number[];
    media_urls?: string[];
  }>();

  await run(
    "UPDATE posts SET content = ?, status = ?, scheduled_at = ?, updated_at = datetime('now') WHERE id = ?",
    [
      content ?? (existing as any).content,
      status ?? (existing as any).status,
      scheduled_at !== undefined ? scheduled_at : (existing as any).scheduled_at,
      id,
    ]
  );

  if (channel_ids !== undefined) {
    await setPostChannels(id, channel_ids, channel_content);
  }
  if (label_ids !== undefined) {
    await run("DELETE FROM post_labels WHERE post_id = ?", [id]);
    for (const lid of label_ids) {
      await run("INSERT INTO post_labels (post_id, label_id) VALUES (?, ?)", [id, lid]);
    }
  }
  if (media_urls !== undefined) {
    await run("DELETE FROM media WHERE post_id = ?", [id]);
    for (const url of media_urls) {
      await run("INSERT INTO media (post_id, url) VALUES (?, ?)", [id, url]);
    }
  }

  const resolvedStatus = status ?? (existing as any).status;
  const resolvedScheduledAt =
    scheduled_at !== undefined ? scheduled_at : (existing as any).scheduled_at;
  await syncSchedule(
    c.env,
    new URL(c.req.url).origin,
    id,
    resolvedStatus,
    resolvedScheduledAt || null,
    (existing as any).queue_job_id ?? null,
  );

  const post = await get("SELECT * FROM posts WHERE id = ?", [id]);
  return c.json(await enrichPost(post));
});

app.delete("/api/posts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await get<any>("SELECT queue_job_id FROM posts WHERE id = ?", [id]);
  if (existing?.queue_job_id && c.env.CLAWNIFY_TOKEN) {
    await cancelDelivery(c.env.CLAWNIFY_TOKEN, existing.queue_job_id);
  }
  await run("DELETE FROM posts WHERE id = ?", [id]);
  return c.json({ ok: true });
});

// ── Publish (manual — "post now" from the dashboard) ──

app.post("/api/posts/:id/publish", async (c) => {
  const id = Number(c.req.param("id"));
  const post = await get<any>("SELECT * FROM posts WHERE id = ?", [id]);
  if (!post) return c.json({ error: "Post not found" }, 404);

  const channelCount = await get<{ count: number }>(
    "SELECT COUNT(*) as count FROM post_channels WHERE post_id = ?",
    [id],
  );
  if (!channelCount?.count) return c.json({ error: "No channels assigned to this post" }, 400);

  // The post exists and has channels, so a null here means no channel had any
  // text to send — neither the shared draft nor its own version.
  const result = await publishPost(id);
  if (!result) return c.json({ error: "Post has no content" }, 400);
  return c.json(result);
});

// ── Scheduled delivery (called by the Clawnify queue at scheduled_at) ──
//
// Must live under /api/ — the Clawnify builder only routes /api/* to this Hono
// server; other paths go to the static-asset handler (which 405s a POST). It's
// declared public in clawnify.json so the queue's tokenless server-to-server
// POST clears the perimeter; authenticity is enforced by the HMAC signature.

app.post("/api/internal/publish", async (c) => {
  const raw = await c.req.text();
  // app-router strips incoming X-Clawnify-* headers, so the queue sends
  // delivery metadata under X-Queue-*.
  const valid = await verifyDelivery(raw, {
    signature: c.req.header("X-Queue-Signature"),
    timestamp: c.req.header("X-Queue-Timestamp"),
    keyId: c.req.header("X-Queue-Key-Id"),
  });
  if (!valid) return c.json({ error: "invalid signature" }, 401);

  const { post_id } = JSON.parse(raw || "{}") as { post_id?: number };
  if (!post_id) return c.json({ error: "post_id required" }, 400);

  // The job already fired — clear its id so reconciliation doesn't try to
  // cancel a delivered job.
  await run("UPDATE posts SET queue_job_id = NULL WHERE id = ?", [post_id]);

  const result = await publishPost(post_id);
  if (!result) return c.json({ error: "post not found or empty" }, 404);
  // 200 so the queue marks the job done even if a channel rejected the content
  // (a platform-level rejection isn't a delivery failure to retry).
  return c.json(result);
});

// ── Stats ──

app.get("/api/stats", async (c) => {
  const totalPosts = await get<{ count: number }>("SELECT COUNT(*) as count FROM posts");
  const scheduled = await get<{ count: number }>("SELECT COUNT(*) as count FROM posts WHERE status = 'scheduled'");
  const drafts = await get<{ count: number }>("SELECT COUNT(*) as count FROM posts WHERE status = 'draft'");
  const published = await get<{ count: number }>("SELECT COUNT(*) as count FROM posts WHERE status = 'published'");
  const channels = await get<{ count: number }>("SELECT COUNT(*) as count FROM channels");

  const perChannel = await query(
    `SELECT c.id, c.name, c.platform, c.color, COUNT(pc.post_id) as post_count
     FROM channels c
     LEFT JOIN post_channels pc ON pc.channel_id = c.id
     GROUP BY c.id ORDER BY post_count DESC`
  );

  const perLabel = await query(
    `SELECT l.id, l.name, l.color, COUNT(pl.post_id) as post_count
     FROM labels l
     LEFT JOIN post_labels pl ON pl.label_id = l.id
     GROUP BY l.id ORDER BY post_count DESC`
  );

  // Posts per day for the last 30 days
  const daily = await query(
    `SELECT date(scheduled_at) as day, COUNT(*) as count
     FROM posts
     WHERE scheduled_at >= datetime('now', '-30 days')
     GROUP BY day ORDER BY day ASC`
  );

  return c.json({
    total: totalPosts?.count || 0,
    scheduled: scheduled?.count || 0,
    drafts: drafts?.count || 0,
    published: published?.count || 0,
    channels: channels?.count || 0,
    per_channel: perChannel,
    per_label: perLabel,
    daily,
  });
});

export default app;
