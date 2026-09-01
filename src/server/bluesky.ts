// Bluesky (AT Protocol) publishing — raw XRPC, no SDK.
//
// Bluesky isn't a Composio integration: AT Protocol authenticates with an app
// password against a PDS (no OAuth, no app review), so it's own-tier. The three
// connection fields (PDS host, handle, app password) are read at runtime via
// the credentials broker's getCredentials — getToken returns only one.
//
// Why raw fetch instead of @atproto/api: the SDK is ~9MB unpacked with eight
// transitive deps, against a template whose whole bundle is ~100KB. Its real
// value-add is RichText.detectFacets, and Bluesky publishes an official no-SDK
// guide for exactly that. Three endpoints, verified against the atproto
// lexicons (com.atproto.server.createSession, com.atproto.repo.uploadBlob,
// com.atproto.repo.createRecord, app.bsky.actor.getProfile).

export interface BlueskyCreds {
  service: string; // PDS base URL, e.g. https://bsky.social
  identifier: string; // handle or DID
  password: string; // app password
}

export interface BlueskyResult {
  success: boolean;
  ref?: string; // at:// URI of the created post
  url?: string; // https://bsky.app/... permalink
  error?: string;
}

const encoder = new TextEncoder();
const utf8Len = (s: string): number => encoder.encode(s).length;

interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; uri?: string; tag?: string }>;
}

// Facet indices are byte offsets into the UTF-8 text (the lexicon is explicit
// that JS's UTF-16 string indexing must be converted first). We match on the JS
// string, then measure the byte offset of each span with TextEncoder — links
// and hashtags only. Mentions are left as plain text: a mention facet needs the
// account's DID, an extra resolve round-trip that can fail, and every other
// channel in this app renders mentions as plain text too.
export function detectFacets(text: string): Facet[] {
  const facets: Facet[] = [];
  const TRAIL = /[.,;:!?)\]]+$/; // trailing punctuation, not part of a link/tag

  // Full http(s) URLs. A URL that ends a sentence keeps its period out of the
  // link span.
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    let url = m[0];
    const trail = url.match(TRAIL);
    if (trail) url = url.slice(0, url.length - trail[0].length);
    if (!url) continue;
    const byteStart = utf8Len(text.slice(0, m.index!));
    facets.push({
      index: { byteStart, byteEnd: byteStart + utf8Len(url) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
    });
  }

  // Hashtags: #tag preceded by start-of-string or whitespace. The facet ref
  // carries the tag without the leading '#'. Pure-number tags are skipped (an
  // atproto rule), and the tag is capped at the lexicon's 640-byte limit.
  for (const m of text.matchAll(/(^|\s)#([^\s#]+)/g)) {
    let raw = m[2].replace(TRAIL, "");
    if (!raw || /^\d+$/.test(raw) || utf8Len(raw) > 640) continue;
    const hashAt = m.index! + m[1].length;
    const byteStart = utf8Len(text.slice(0, hashAt));
    facets.push({
      index: { byteStart, byteEnd: byteStart + utf8Len("#" + raw) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: raw }],
    });
  }

  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

const trimBase = (service: string): string => service.replace(/\/+$/, "");

type Session = { accessJwt: string; did: string; handle: string };

async function createSession(creds: BlueskyCreds): Promise<Session | { error: string }> {
  const res = await fetch(`${trimBase(creds.service)}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: creds.identifier, password: creds.password }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) {
    // A second factor is required for these credentials — the common cause is
    // using the main account password instead of an app password.
    if (data.error === "AuthFactorTokenRequired") {
      return {
        error:
          "Bluesky wants a second authentication factor. Use an app password " +
          "(Bluesky → Settings → App Passwords), not your main account password.",
      };
    }
    return { error: data.message || data.error || `Bluesky login failed (${res.status})` };
  }
  return { accessJwt: data.accessJwt, did: data.did, handle: data.handle };
}

async function uploadBlob(
  base: string,
  accessJwt: string,
  imageUrl: string,
): Promise<{ blob: unknown } | { error: string }> {
  const img = await fetch(imageUrl);
  if (!img.ok) return { error: `couldn't fetch the image to upload (${img.status})` };
  const bytes = await img.arrayBuffer();
  // Bluesky enforces the blob cap at createRecord, but fail here with the real
  // number instead of a generic record rejection. No downscale path: there's no
  // sharp on Workers, and silently posting without the image the user attached
  // is worse than a clear error — the other channels in the fan-out still send.
  if (bytes.byteLength > 2_000_000) {
    return { error: `image is ${(bytes.byteLength / 1e6).toFixed(1)}MB; Bluesky's limit is 2MB` };
  }
  const res = await fetch(`${base}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: {
      "Content-Type": img.headers.get("content-type") || "image/jpeg",
      Authorization: `Bearer ${accessJwt}`,
    },
    body: bytes,
  });
  const data = (await res.json().catch(() => ({}))) as { blob?: unknown; message?: string };
  if (!res.ok || !data.blob) return { error: data.message || `image upload failed (${res.status})` };
  return { blob: data.blob };
}

// Publish one post: createSession → (optional) uploadBlob → createRecord.
export async function publishToBluesky(
  creds: BlueskyCreds,
  content: string,
  imageUrl?: string,
): Promise<BlueskyResult> {
  const base = trimBase(creds.service);
  const session = await createSession(creds);
  if ("error" in session) return { success: false, error: session.error };

  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text: content,
    createdAt: new Date().toISOString(),
  };
  const facets = detectFacets(content);
  if (facets.length) record.facets = facets;

  if (imageUrl) {
    const up = await uploadBlob(base, session.accessJwt, imageUrl);
    if ("error" in up) return { success: false, error: up.error };
    record.embed = {
      $type: "app.bsky.embed.images",
      images: [{ image: up.blob, alt: "" }],
    };
  }

  const res = await fetch(`${base}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
  });
  const data = (await res.json().catch(() => ({}))) as { uri?: string; message?: string; error?: string };
  if (!res.ok || !data.uri) {
    // Bluesky's own rejection is the source of truth (text too long, bad
    // record) — surface it rather than pre-guessing limits.
    return { success: false, error: data.message || data.error || `Bluesky post failed (${res.status})` };
  }

  // at://<did>/app.bsky.feed.post/<rkey> → the permalink uses handle + rkey.
  const rkey = data.uri.split("/").pop();
  return {
    success: true,
    ref: data.uri,
    url: rkey ? `https://bsky.app/profile/${session.handle}/post/${rkey}` : undefined,
  };
}

export interface BlueskyProfile {
  profile_name: string | null;
  profile_handle: string | null;
  profile_avatar_url: string | null;
  profile_headline: string | null;
}

// Fetch the connected account's profile for accurate previews. Doubles as the
// connection check: a bad credential fails createSession and returns null (this
// integration has no connect-time verification — the atproto app has no
// @clawnify/integrations definition to drive one).
export async function blueskyProfile(creds: BlueskyCreds): Promise<BlueskyProfile | null> {
  const base = trimBase(creds.service);
  const session = await createSession(creds);
  if ("error" in session) return null;
  const res = await fetch(
    `${base}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(session.did)}`,
    { headers: { Authorization: `Bearer ${session.accessJwt}` } },
  );
  if (!res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as Record<string, string>;
  return {
    profile_name: d.displayName || null,
    profile_handle: d.handle || null,
    profile_avatar_url: d.avatar || null,
    profile_headline: d.description || null,
  };
}
