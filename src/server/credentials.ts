/**
 * Credential adapter — same pattern as db.ts and uploads.ts.
 *
 * Production (Clawnify):
 *   App calls env.CREDENTIALS.getToken("twitter", orgId) via service binding.
 *   The credential Worker fetches a fresh token from Composio.
 *
 * Local dev:
 *   Falls back to env vars (.dev.vars) or channel api_key from DB.
 *   No service binding available locally.
 */

// ── Service binding interface ──

export interface ExecResult {
  data: unknown;
  error: string | null;
  successful: boolean;
}

export interface CredentialServiceBinding {
  getToken(service: string, orgId: string): Promise<string | null>;
  listConnected(orgId: string): Promise<string[]>;
  executeTool(
    service: string,
    toolSlug: string,
    args: Record<string, unknown>,
    orgId: string,
  ): Promise<ExecResult>;
  // Every field of an own-tier (api_key / basic_auth) credential — for a
  // provider a single bearer can't authenticate. Optional so an older
  // credentials worker (no getCredentials) degrades to null, not a crash.
  getCredentials?(service: string, orgId: string): Promise<Record<string, string> | null>;
  // Stage a file for a tool's file parameter. Optional for the same reason as
  // getCredentials — an older credentials worker simply has no stageFile.
  stageFile?(
    service: string,
    toolSlug: string,
    file: { url: string; filename?: string; mimetype?: string },
  ): Promise<{ descriptor: StagedFile; error: null } | { descriptor: null; error: string }>;
}

// A file staged with the broker, ready to be a tool argument.
//
// Opaque on purpose: the concrete shape belongs to whichever maintainer staged
// it, and the broker is meant to stay swappable. The only correct use is to
// pass the whole value through as the argument — never to read a field off it.
export type StagedFile = Record<string, string>;

// ── State ──

let _credentialService: CredentialServiceBinding | null = null;
let _orgId: string | null = null;

export function initCredentials(opts: {
  env: Record<string, string>;
  credentialService?: CredentialServiceBinding;
  orgId?: string;
}) {
  _credentialService = opts.credentialService ?? null;
  _orgId = opts.orgId ?? null;
}

// ── Composio execute ──
//
// Since the May 2026 Composio security incident, the "get connected account"
// API permanently redacts raw OAuth tokens, so getToken() can't return a usable
// token for Composio connections. Posting must go through Composio's execute
// path (Composio holds the real token server-side). Returns null off-platform
// (no service binding) so callers degrade gracefully.
export async function executeTool(
  service: string,
  toolSlug: string,
  args: Record<string, unknown>,
): Promise<ExecResult | null> {
  if (_credentialService && _orgId) {
    return _credentialService.executeTool(service, toolSlug, args, _orgId);
  }
  return null;
}

// ── Own-tier multi-field credentials ──
//
// getToken returns one string; some own-tier connections need several fields to
// authenticate (Bluesky's PDS host + handle + app password). The broker returns
// the whole own-tier dict — never an OAuth or Composio secret. Null off-platform
// (no binding) or against an older worker, so callers degrade gracefully.
//
// The broker is the only authority when the binding is present, null included:
// a disconnected integration must read as "not connected", never fall back to a
// build-time-baked value. (The @clawnify/connections SDK's connect().credentials()
// is the doctrinal accessor and adds a local-dev env fallback; this direct
// pass-through mirrors executeTool above, which the rest of this app already uses.)
export async function getCredentials(
  service: string,
): Promise<Record<string, string> | null> {
  if (_credentialService?.getCredentials && _orgId) {
    return _credentialService.getCredentials(service, _orgId);
  }
  return null;
}

// ── Staged files ──
//
// The broker's file parameters (Twitter's `media`, LinkedIn's `images`) don't
// take a URL: they take a handle to a file already staged with the broker.
// Staging needs a platform credential no deployed app holds, so the broker
// does it and hands back an opaque handle to forward as the tool argument.
//
// Null off-platform (no binding) or against an older broker with no stageFile,
// mirroring executeTool — the caller turns that into the same "not connected"
// failure it already produces. A staging failure comes back as { error } so the
// reason (image too big, host refused the fetch) reaches the channel's row.
export async function stageFile(
  service: string,
  toolSlug: string,
  url: string,
): Promise<{ descriptor: StagedFile; error: null } | { descriptor: null; error: string } | null> {
  if (!_credentialService?.stageFile) return null;
  return _credentialService.stageFile(service, toolSlug, { url });
}
