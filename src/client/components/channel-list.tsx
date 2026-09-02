import { useState, useEffect } from "preact/hooks";
import { Plus, Trash2, Edit2, Check, X, RefreshCw } from "lucide-preact";
import { useApp } from "../context";
import { api } from "../api";
import { PLATFORM_LABELS, PLATFORM_COLORS, PUBLISHABLE_PLATFORMS } from "../types";
import type { Platform, FacebookPage } from "../types";

// Only offer platforms the server can publish to (see PUBLISHABLE_PLATFORMS) —
// a channel the composer can't actually deliver to is a trap, not a feature.
const PLATFORMS: Platform[] = PUBLISHABLE_PLATFORMS;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  // Platform-side account the channel publishes as (Facebook Page ID). Instagram
  // resolves its own from the connection, so only Facebook edits this here.
  const [accountId, setAccountId] = useState("");
  // Facebook publishes as a Page: offer the connected account's Pages as a
  // picker; null = not loaded yet.
  const [fbPages, setFbPages] = useState<FacebookPage[] | null>(null);
  const [fbConnected, setFbConnected] = useState(true);

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
    setName(""); setPlatform("twitter"); setHandle(""); setAccountId("");
    setColor("#1da1f2");
    setShowForm(false); setEditingId(null);
  };

  const startEdit = (ch: any) => {
    setEditingId(ch.id); setName(ch.name); setPlatform(ch.platform);
    setHandle(ch.handle); setColor(ch.color); setAccountId(ch.platform_account_id || "");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const data = {
      name: name.trim(), platform, handle: handle.trim(), color,
      platform_account_id: platform === "facebook" ? accountId.trim() || null : null,
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
        <h1 class="text-xl font-semibold">Channels</h1>
        <button
          class="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
          onClick={() => { resetForm(); setShowForm(true); }}
        >
          <Plus size={14} /> Add Channel
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div class="bg-card border border-border rounded-lg p-5 mb-6">
          <h3 class="text-base font-semibold mb-4">{editingId ? "Edit Channel" : "New Channel"}</h3>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
              <input
                class="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                placeholder="My Twitter"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-muted-foreground mb-1.5">Platform</label>
              <select
                class="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={platform}
                onChange={(e) => {
                  const p = (e.target as HTMLSelectElement).value as Platform;
                  setPlatform(p);
                  setColor(PLATFORM_COLORS[p]);
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
                    class="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
                      class="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
            ) : (
              <div>
                <label class="block text-xs font-medium text-muted-foreground mb-1.5">Handle</label>
                <input
                  class="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
                  class="w-10 h-10 rounded-md border border-border cursor-pointer"
                  value={color}
                  onInput={(e) => setColor((e.target as HTMLInputElement).value)}
                />
                <span class="text-sm text-muted-foreground">{color}</span>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-4 pt-4 border-t border-border">
            <button
              class="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-sm hover:bg-accent transition-colors"
              onClick={resetForm}
            >
              <X size={14} /> Cancel
            </button>
            <button
              class="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
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
            <div key={ch.id} class="bg-card border border-border rounded-lg overflow-hidden">
              <div class="h-1" style={{ background: ch.color }} />
              <div class="p-4">
                <div class="flex items-start gap-3">
                  {ch.profile_avatar_url ? (
                    <img src={ch.profile_avatar_url} alt="" class="w-10 h-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div
                      class="w-10 h-10 rounded-full text-white flex items-center justify-center text-xs font-semibold shrink-0"
                      style={{ background: ch.color }}
                    >
                      {initials(ch.profile_name || ch.name)}
                    </div>
                  )}
                  <div class="min-w-0">
                    <span class="text-xs font-medium" style={{ color: ch.color }}>
                      {PLATFORM_LABELS[ch.platform] || ch.platform}
                    </span>
                    <h3 class="text-sm font-semibold mt-0.5 truncate">{ch.profile_name || ch.name}</h3>
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
