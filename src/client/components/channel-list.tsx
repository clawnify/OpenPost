import { useState, useEffect } from "preact/hooks";
import { Plus, Trash2, Edit2, Check, X, RefreshCw } from "lucide-preact";
import { useApp } from "../context";
import { api } from "../api";
import { PLATFORM_LABELS, PLATFORM_COLORS, PUBLISHABLE_PLATFORMS, MULTI_ACCOUNT_PLATFORMS } from "../types";
import { PlatformIcon } from "./platform-icon";
import type { Platform, FacebookPage, ConnectedAccount, Channel } from "../types";

// Only offer platforms the server can publish to (see PUBLISHABLE_PLATFORMS) —
// a channel the composer can't actually deliver to is a trap, not a feature.
const PLATFORMS: Platform[] = PUBLISHABLE_PLATFORMS;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const accountName = (a: ConnectedAccount) => a.label || a.account;

// Does some channel already post as this account? A channel that never picked
// one posts as its platform's default account.
function inUse(a: ConnectedAccount, channels: Channel[]): boolean {
  return channels.some(
    (ch) => ch.platform === a.service && (ch.platform_account_id ? ch.platform_account_id === a.account : a.isDefault),
  );
}

export function ChannelList() {
  const { channels, createChannel, updateChannel, deleteChannel, syncChannelProfile } = useApp();
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<Platform>("twitter");
  const [handle, setHandle] = useState("");
  const [color, setColor] = useState("#1da1f2");
  // The account the channel publishes as: a Facebook Page ID, or which of the
  // org's connected accounts on a multi-account platform.
  const [accountId, setAccountId] = useState("");
  // What the channel being edited had, so an edit that leaves the account alone
  // doesn't send it (and can't wipe one the form couldn't show).
  const [originalAccountId, setOriginalAccountId] = useState("");
  // Facebook publishes as a Page: offer the connected account's Pages as a
  // picker; null = not loaded yet.
  const [fbPages, setFbPages] = useState<FacebookPage[] | null>(null);
  const [fbConnected, setFbConnected] = useState(true);
  // The org's connected accounts a channel can post as.
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [addingKey, setAddingKey] = useState<string | null>(null);

  useEffect(() => {
    api<{ accounts: ConnectedAccount[] }>("GET", "/api/accounts")
      .then((r) => setAccounts(r.accounts))
      .catch(() => setAccounts([]));
  }, []);

  const accountsFor = (p: Platform) =>
    MULTI_ACCOUNT_PLATFORMS.includes(p) ? accounts.filter((a) => a.service === p) : [];
  const defaultAccountFor = (p: Platform) => {
    const list = accountsFor(p);
    return (list.find((a) => a.isDefault) ?? list[0])?.account ?? "";
  };
  const platformAccounts = accountsFor(platform);
  // Connected, but no channel posts as them yet.
  const unused = accounts.filter((a) => !inUse(a, channels));

  const pickAccount = (id: string) => {
    const next = platformAccounts.find((a) => a.account === id);
    const prev = platformAccounts.find((a) => a.account === accountId);
    setAccountId(id);
    // Prefill the name, and the handle the Instagram check reads, from the
    // account unless the user typed their own.
    if (next && (!name.trim() || (prev && name === accountName(prev)))) setName(accountName(next));
    if (platform === "instagram") setHandle(next?.label ?? "");
  };

  const addFromAccount = async (a: ConnectedAccount) => {
    const key = `${a.service}:${a.account}`;
    setAddingKey(key);
    await createChannel({
      name: accountName(a),
      platform: a.service,
      handle: a.service === "instagram" ? (a.label ?? "") : "",
      color: PLATFORM_COLORS[a.service],
      platform_account_id: a.account,
    });
    setAddingKey(null);
  };

  useEffect(() => {
    if (platform !== "facebook" || !showForm) return;
    let cancelled = false;
    setFbPages(null);
    api<{ connected: boolean; pages: FacebookPage[] }>("GET", "/api/platforms/facebook/pages")
      .then((r) => { if (!cancelled) { setFbPages(r.pages); setFbConnected(r.connected); } })
      .catch(() => { if (!cancelled) { setFbPages([]); setFbConnected(true); } });
    return () => { cancelled = true; };
  }, [platform, showForm]);

  const pickFacebookPage = (id: string) => {
    const page = fbPages?.find((p) => p.id === id);
    setAccountId(id);
    // Prefill the channel name from the Page unless the user typed their own.
    const prevPage = fbPages?.find((p) => p.id === accountId);
    if (page && (!name.trim() || name === prevPage?.name)) setName(page.name);
  };

  const needsPage = platform === "facebook" && !accountId.trim();

  const resetForm = () => {
    setName(""); setPlatform("twitter"); setHandle(""); setAccountId(defaultAccountFor("twitter"));
    setOriginalAccountId("");
    setColor("#1da1f2");
    setShowForm(false); setEditingId(null);
  };

  const startEdit = (ch: any) => {
    setEditingId(ch.id); setName(ch.name); setPlatform(ch.platform);
    setHandle(ch.handle); setColor(ch.color); setAccountId(ch.platform_account_id || "");
    setOriginalAccountId(ch.platform_account_id || "");
    setShowForm(true);
  };

  // The account is sent for a Facebook Page, and on a multi-account platform
  // only when the form offered a choice and it changed. Otherwise an account
  // id resolved from the connection (Instagram's) must survive an edit:
  // sending null for it wiped the account a channel was tied to.
  const sendAccount =
    platform === "facebook" ||
    (platformAccounts.length > 0 && (editingId === null || accountId !== originalAccountId));

  const handleSave = async () => {
    if (!name.trim()) return;
    const data = {
      name: name.trim(), platform, handle: handle.trim(), color,
      ...(sendAccount ? { platform_account_id: accountId.trim() || null } : {}),
    };
    if (editingId) {
      await updateChannel(editingId, data);
    } else {
      await createChannel(data);
    }
    resetForm();
  };

  return (
    <div class="p-6 max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-[1.375rem] font-semibold tracking-[-0.01em]">Channels</h1>
        <button
          class="btn-primary"
          onClick={() => { resetForm(); setShowForm(true); }}
        >
          <Plus size={14} /> Add Channel
        </button>
      </div>

      {/* Connected accounts no channel posts as yet: one click makes one. */}
      {unused.length > 0 && !showForm && (
        <div class="card p-5 mb-6">
          <h3 class="text-base font-semibold">Connected accounts</h3>
          <p class="text-sm text-muted-foreground mt-0.5 mb-2">Connected in Clawnify, not a channel yet.</p>
          {unused.map((a) => {
            const key = `${a.service}:${a.account}`;
            return (
              <div key={key} class="flex items-center justify-between gap-3 py-2.5 border-t border-border first:border-t-0">
                <span class="inline-flex items-center gap-2 min-w-0 text-sm">
                  <PlatformIcon platform={a.service} />
                  <span class="truncate">{accountName(a)}</span>
                  <span class="text-xs text-muted-foreground shrink-0">{PLATFORM_LABELS[a.service]}</span>
                </span>
                <button class="btn-secondary disabled:opacity-50" disabled={addingKey !== null} onClick={() => addFromAccount(a)}>
                  <Plus size={14} /> {addingKey === key ? "Adding…" : "Add"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div class="card p-5 mb-6">
          <h3 class="text-base font-semibold mb-4">{editingId ? "Edit Channel" : "New Channel"}</h3>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
              <input
                class="input"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                placeholder="My Twitter"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-muted-foreground mb-1.5">Platform</label>
              <select
                class="input"
                value={platform}
                onChange={(e) => {
                  const p = (e.target as HTMLSelectElement).value as Platform;
                  setPlatform(p);
                  setColor(PLATFORM_COLORS[p]);
                  // An account belongs to one platform.
                  setAccountId(p === "facebook" ? "" : defaultAccountFor(p));
                }}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                ))}
              </select>
            </div>
            {platform === "facebook" ? (
              <div>
                <label class="block text-xs font-medium text-muted-foreground mb-1.5">Page</label>
                {fbPages && fbPages.length > 0 ? (
                  <select
                    class="input"
                    value={accountId}
                    onChange={(e) => pickFacebookPage((e.target as HTMLSelectElement).value)}
                  >
                    <option value="">Choose a Page…</option>
                    {fbPages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.username ? ` (@${p.username})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      class="input"
                      value={accountId}
                      onInput={(e) => setAccountId((e.target as HTMLInputElement).value)}
                      placeholder="Facebook Page ID"
                    />
                    <p class="text-xs text-muted-foreground mt-1.5">
                      {fbPages === null
                        ? "Loading your Pages…"
                        : !fbConnected
                          ? "Connect Facebook in Clawnify to pick a Page, or enter the Page ID."
                          : "No Pages found on the connected account. Enter the Page ID."}
                    </p>
                  </>
                )}
              </div>
            ) : platformAccounts.length > 0 ? (
              <div>
                <label class="block text-xs font-medium text-muted-foreground mb-1.5">Posts as</label>
                <select
                  class="input"
                  value={accountId}
                  onChange={(e) => pickAccount((e.target as HTMLSelectElement).value)}
                >
                  {/* Only an existing channel that never picked one has no account. */}
                  {!accountId && <option value="">The default account</option>}
                  {accountId && !platformAccounts.some((a) => a.account === accountId) && (
                    <option value={accountId}>An account that isn't connected any more</option>
                  )}
                  {platformAccounts.map((a) => (
                    <option key={a.account} value={a.account}>
                      {accountName(a)}{a.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                <p class="text-xs text-muted-foreground mt-1.5">
                  The {PLATFORM_LABELS[platform]} accounts connected in Clawnify.
                </p>
              </div>
            ) : (
              <div>
                <label class="block text-xs font-medium text-muted-foreground mb-1.5">Handle</label>
                <input
                  class="input"
                  value={handle}
                  onInput={(e) => setHandle((e.target as HTMLInputElement).value)}
                  placeholder="@username"
                />
                {platform === "instagram" && (
                  <p class="text-xs text-muted-foreground mt-1.5">
                    The Business account is picked up from the Instagram connection in Clawnify.
                  </p>
                )}
              </div>
            )}
            <div>
              <label class="block text-xs font-medium text-muted-foreground mb-1.5">Color</label>
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="w-10 h-10 rounded-sm cursor-pointer shadow-edge"
                  value={color}
                  onInput={(e) => setColor((e.target as HTMLInputElement).value)}
                />
                <span class="text-sm text-muted-foreground">{color}</span>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-4 pt-4 border-t border-border">
            <button
              class="btn-secondary"
              onClick={resetForm}
            >
              <X size={14} /> Cancel
            </button>
            <button
              class="btn-primary disabled:opacity-50"
              onClick={handleSave}
              disabled={!name.trim() || needsPage}
            >
              <Check size={14} /> {editingId ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Channel list */}
      {channels.length === 0 && !showForm ? (
        <div class="flex flex-col items-center justify-center py-20 text-center">
          <h3 class="text-lg font-semibold mb-1">No channels</h3>
          <p class="text-muted-foreground">Add your social media channels to start scheduling</p>
        </div>
      ) : (
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {channels.map((ch) => (
            <div key={ch.id} class="card">
              <div class="p-5">
                <div class="flex items-start gap-3">
                  {ch.profile_avatar_url ? (
                    <img src={ch.profile_avatar_url} alt="" class="w-10 h-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div
                      class="brand-soft w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                      style={{ "--brand": ch.color }}
                    >
                      <PlatformIcon platform={ch.platform} size={20} />
                    </div>
                  )}
                  <div class="min-w-0">
                    <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <PlatformIcon platform={ch.platform} /> {PLATFORM_LABELS[ch.platform] || ch.platform}
                    </span>
                    <h3 class="font-semibold mt-0.5 truncate">{ch.profile_name || ch.name}</h3>
                    {(ch.profile_handle || ch.handle) && (
                      <span class="text-xs text-muted-foreground truncate block">
                        {ch.profile_handle ? `@${ch.profile_handle}` : ch.handle}
                      </span>
                    )}
                  </div>
                </div>
                <div class="flex gap-3 mt-3 pt-3 border-t border-border">
                  <button
                    class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    onClick={async () => { setSyncingId(ch.id); await syncChannelProfile(ch.id); setSyncingId(null); }}
                    disabled={syncingId === ch.id}
                    title="Pull the latest name, photo and handle from the connected account"
                  >
                    <RefreshCw size={12} class={syncingId === ch.id ? "animate-spin" : ""} />
                    {syncingId === ch.id ? "Syncing…" : "Sync"}
                  </button>
                  <button
                    class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => startEdit(ch)}
                  >
                    <Edit2 size={12} /> Edit
                  </button>
                  <button
                    class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => deleteChannel(ch.id)}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
