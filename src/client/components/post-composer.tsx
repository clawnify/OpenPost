import { useState, useEffect, useMemo } from "preact/hooks";
import { Send, Save, ArrowLeft, Image, X, Upload, Loader2 } from "lucide-preact";
import { useApp } from "../context";
import { PLATFORM_LIMITS, PLATFORM_LABELS, mediaError, mediaShapeError, mediaTypeFromUrl } from "../types";
import type { MediaItem } from "../types";
import type { Platform } from "../types";
import { PostPreview, ChannelTabs } from "./previews";

// Timezone boundary: storage + the queue are always UTC; the browser is the
// only timezone-aware layer. Convert local <-> UTC only here, at the edges.

// datetime-local value ("2026-06-23T20:14", naive local) -> UTC ISO with Z.
function localInputToUtc(local: string): string {
  return new Date(local).toISOString();
}

// Stored UTC ISO -> local "YYYY-MM-DDTHH:mm" for the datetime-local input.
function utcToLocalInput(utc: string): string {
  const d = new Date(utc);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

interface Props {
  editId: number | null;
  navigate: (path: string) => void;
}

export function PostComposer({ editId, navigate }: Props) {
  const { channels, labels, posts, createPost, updatePost, uploadMedia } = useApp();

  const existing = editId ? posts.find((p) => p.id === editId) : null;

  const [content, setContent] = useState("");
  // Channels the author gave their own version of the text. A channel absent
  // here inherits `content` — the shared draft. Kept keyed by channel id (not
  // per-tab local state) so toggling a channel off and back on doesn't discard
  // what was typed for it.
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<number[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [newMediaUrl, setNewMediaUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) {
      setContent(existing.content);
      setOverrides(
        Object.fromEntries(
          existing.channels
            .filter((c) => c.content_override != null)
            .map((c) => [c.id, c.content_override as string]),
        ),
      );
      setSelectedChannels(existing.channels.map((c) => c.id));
      setSelectedLabels(existing.labels.map((l) => l.id));
      setScheduledAt(existing.scheduled_at ? utcToLocalInput(existing.scheduled_at) : "");
      setMedia(existing.media.map((m) => ({ url: m.url, type: m.type })));
    }
  }, [existing?.id]);

  // Selected channels, in selection order — the tab strip, the preview, and the
  // limits below all read this one list.
  const previewChannels = useMemo(
    () => selectedChannels.map((id) => channels.find((c) => c.id === id)).filter(Boolean) as typeof channels,
    [selectedChannels, channels],
  );

  // The shared draft only has to fit the channels that still inherit it: give
  // X its own version and LinkedIn stops being capped at 280 characters.
  const sharedLimit = useMemo(() => {
    const inheriting = previewChannels.filter((c) => overrides[c.id] === undefined);
    if (inheriting.length === 0) return null;
    return Math.min(...inheriting.map((c) => PLATFORM_LIMITS[c.platform as Platform] || 10000));
  }, [previewChannels, overrides]);

  // Save is blocked while any text on its way out is too long for where it's
  // going — the shared draft for the channels inheriting it, and each channel's
  // own version against its own platform's limit.
  const overLimit = useMemo(() => {
    if (sharedLimit !== null && content.length > sharedLimit) return true;
    return previewChannels.some((c) => {
      const own = overrides[c.id];
      if (own === undefined) return false;
      const limit = PLATFORM_LIMITS[c.platform as Platform];
      return limit !== undefined && own.length > limit;
    });
  }, [content, sharedLimit, previewChannels, overrides]);

  // Every channel publishes something. Customizing all of them and clearing the
  // shared draft is a real post; leaving all of them empty is not. Mirrors the
  // server's own rule in publishPost().
  const hasContent = previewChannels.length
    ? previewChannels.some((c) => (overrides[c.id] ?? content).trim())
    : !!content.trim();

  // Why a selected channel can't carry these attachments — too many images, a
  // video that platform has no path for, or a mix no platform takes.
  // Publishing fails those channels rather than posting a truncated set, so say
  // it here, while the attachments are still on screen and removable, instead
  // of letting it surface as a delivery error after the fact.
  //
  // The shape errors don't depend on a channel, so they show even before one is
  // picked: "images or a video, not both" is worth saying the moment it is true.
  const mediaWarnings = useMemo(() => {
    const messages = new Set<string>();
    const shape = mediaShapeError(media);
    if (shape) messages.add(shape);
    for (const c of channels) {
      if (!selectedChannels.includes(c.id)) continue;
      const msg = mediaError(c.platform, media);
      // Two channels on the same platform share one message.
      if (msg) messages.add(msg);
    }
    return [...messages];
  }, [selectedChannels, channels, media]);

  // Which tab is open: null = the shared draft ("All channels"), otherwise the
  // channel being written and previewed. Falls back to the shared draft when
  // the open channel is deselected.
  const [activeTab, setActiveTab] = useState<number | null>(null);
  useEffect(() => {
    if (activeTab !== null && !previewChannels.some((c) => c.id === activeTab)) {
      setActiveTab(null);
    }
  }, [previewChannels, activeTab]);

  // The channel the editor is writing for, if any. On the shared tab the
  // preview still has to pick someone — the first selected channel.
  const activeChannel = activeTab === null ? undefined : previewChannels.find((c) => c.id === activeTab);
  const activePreviewChannel = activeChannel ?? previewChannels[0];

  const isCustomized = activeChannel ? overrides[activeChannel.id] !== undefined : false;
  // What the textarea shows: this channel's own version, else the shared draft
  // it inherits (read-only until customized, so editing it can't silently
  // rewrite every other channel).
  const editorValue = activeChannel ? overrides[activeChannel.id] ?? content : content;
  const editorLimit = activeChannel
    ? PLATFORM_LIMITS[activeChannel.platform as Platform] ?? null
    : sharedLimit;
  const editorOverLimit = editorLimit !== null && editorValue.length > editorLimit;

  const customize = () => {
    if (activeChannel) setOverrides((prev) => ({ ...prev, [activeChannel.id]: content }));
  };
  const resetToShared = () => {
    if (!activeChannel) return;
    setOverrides((prev) => {
      const { [activeChannel.id]: _dropped, ...rest } = prev;
      return rest;
    });
  };

  const toggleChannel = (id: number) => {
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleLabel = (id: number) => {
    setSelectedLabels((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // A pasted link has only its path to go on, so the extension decides whether
  // it is a video. An upload doesn't guess — the server reads the file's MIME.
  const addMedia = () => {
    const url = newMediaUrl.trim();
    if (!url) return;
    setMedia((prev) => [...prev, { url, type: mediaTypeFromUrl(url) }]);
    setNewMediaUrl("");
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const item = await uploadMedia(file);
      if (item) setMedia((prev) => [...prev, item]);
    }
    setUploading(false);
  };

  const removeMedia = (index: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async (status: string) => {
    if (overLimit) return;
    setSaving(true);
    // Only the selected channels' overrides go out — a version typed for a
    // channel that is no longer selected isn't part of this post. A channel with
    // no entry inherits the shared draft server-side.
    const channel_content: Record<string, string> = {};
    for (const id of selectedChannels) {
      if (overrides[id] !== undefined) channel_content[String(id)] = overrides[id];
    }
    const data = {
      content,
      status,
      scheduled_at: scheduledAt ? localInputToUtc(scheduledAt) : undefined,
      channel_ids: selectedChannels,
      channel_content,
      label_ids: selectedLabels,
      media,
    };
    if (editId) {
      await updatePost(editId, data);
    } else {
      await createPost(data);
    }
    setSaving(false);
    navigate(status === "draft" ? "/drafts" : "/queue");
  };

  return (
    <div class="p-6 max-w-6xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <button
          class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => navigate("/")}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h1 class="text-xl font-semibold">{editId ? "Edit Post" : "New Post"}</h1>
      </div>

      <div class="flex gap-6">
        {/* Main editor */}
        <div class="flex-1 space-y-4">
          <div>
            {/* One strip for the whole composer: it picks which text you're
                editing AND which platform you're previewing. */}
            <ChannelTabs
              channels={previewChannels}
              activeId={activeTab}
              onSelect={setActiveTab}
              customizedIds={Object.keys(overrides).map(Number)}
            />
            <textarea
              class={`w-full min-h-[200px] p-4 border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                editorOverLimit ? "border-destructive focus:ring-destructive" : "border-border"
              } ${
                activeChannel && !isCustomized
                  ? "bg-muted/40 text-muted-foreground cursor-default"
                  : "bg-card"
              }`}
              placeholder={
                activeChannel
                  ? `What ${activeChannel.name} should post`
                  : "What do you want to share?"
              }
              value={editorValue}
              readOnly={!!activeChannel && !isCustomized}
              aria-label={
                activeChannel
                  ? `Post text for ${activeChannel.name}`
                  : "Shared post text"
              }
              onInput={(e) => {
                const value = (e.target as HTMLTextAreaElement).value;
                if (activeChannel) {
                  setOverrides((prev) => ({ ...prev, [activeChannel.id]: value }));
                } else {
                  setContent(value);
                }
              }}
            />
            <div class="flex items-center justify-between gap-3 mt-1.5">
              <div class="text-xs text-muted-foreground">
                {activeChannel ? (
                  isCustomized ? (
                    <button
                      type="button"
                      class="text-foreground hover:underline"
                      onClick={resetToShared}
                    >
                      Reset to the shared draft
                    </button>
                  ) : (
                    <>
                      <span>Using the shared draft. </span>
                      <button
                        type="button"
                        class="text-foreground font-medium hover:underline"
                        onClick={customize}
                      >
                        Write a version for {PLATFORM_LABELS[activeChannel.platform as Platform] || activeChannel.name}
                      </button>
                    </>
                  )
                ) : (
                  sharedLimit !== null &&
                  previewChannels.length > 1 && <span>Goes to every channel without its own version.</span>
                )}
              </div>
              <span class={`text-xs shrink-0 ${editorOverLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                {editorValue.length}
                {editorLimit !== null && ` / ${editorLimit}`}
              </span>
            </div>
          </div>

          {/* Media */}
          <div>
            <h3 class="text-sm font-medium mb-2">Media</h3>

            {/* Primary: upload (click or drop) */}
            <label
              class="flex flex-col items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground cursor-pointer hover:border-primary/50 hover:bg-accent/40 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); uploadFiles((e as DragEvent).dataTransfer?.files ?? null); }}
            >
              {uploading ? (
                <><Loader2 size={18} class="animate-spin" /> Uploading…</>
              ) : (
                <>
                  <Upload size={18} />
                  <span><span class="text-foreground font-medium">Upload images or a video</span> or drag &amp; drop</span>
                </>
              )}
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                class="hidden"
                onChange={(e) => { uploadFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ""; }}
              />
            </label>

            {/* Secondary: paste a URL */}
            <div class="flex gap-2 mt-2">
              <input
                type="url"
                placeholder="…or paste an image or video URL"
                value={newMediaUrl}
                onInput={(e) => setNewMediaUrl((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === "Enter" && addMedia()}
                class="flex-1 px-3 py-2 bg-card border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                class="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-sm hover:bg-accent transition-colors disabled:opacity-50"
                onClick={addMedia}
                disabled={!newMediaUrl.trim()}
              >
                <Image size={14} /> Add
              </button>
            </div>
            {mediaWarnings.length > 0 && (
              <div class="mt-2 space-y-1">
                {mediaWarnings.map((msg) => (
                  <p key={msg} class="text-xs text-destructive">{msg}</p>
                ))}
              </div>
            )}
            {media.length > 0 && (
              <div class="flex gap-2 mt-3 flex-wrap">
                {media.map((item, i) => (
                  <div key={i} class="relative group w-20 h-20 rounded-md overflow-hidden border border-border">
                    {item.type === "video" ? (
                      // muted + playsinline so the browser paints a first frame
                      // without the tile becoming something that plays audio.
                      <video src={item.url} class="w-full h-full object-cover bg-black" muted playsInline preload="metadata" />
                    ) : (
                      <img src={item.url} alt="" class="w-full h-full object-cover" />
                    )}
                    <button
                      class="absolute top-0.5 right-0.5 p-0.5 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeMedia(i)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live platform preview — follows the tab strip above, and renders
              the text that channel will actually publish (its own version, or
              the shared draft it inherits). */}
          {activePreviewChannel && (
            <div>
              <h3 class="text-sm font-medium mb-2">Preview</h3>
              <PostPreview
                channel={activePreviewChannel}
                content={overrides[activePreviewChannel.id] ?? content}
                media={media[0]}
                timeLabel="Now"
              />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div class="w-72 shrink-0 space-y-5">
          {/* Schedule */}
          <div>
            <h3 class="text-sm font-medium mb-2">Schedule</h3>
            <input
              type="datetime-local"
              class="w-full px-3 py-2 bg-card border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={scheduledAt}
              onInput={(e) => setScheduledAt((e.target as HTMLInputElement).value)}
            />
          </div>

          {/* Channels */}
          <div>
            <h3 class="text-sm font-medium mb-2">Channels</h3>
            {channels.length === 0 ? (
              <p class="text-sm text-muted-foreground">
                No channels yet.{" "}
                <a href="/channels" onClick={(e) => { e.preventDefault(); navigate("/channels"); }} class="text-blue-600 hover:underline">Add one</a>
              </p>
            ) : (
              <div class="space-y-2">
                {channels.map((ch) => {
                  const active = selectedChannels.includes(ch.id);
                  return (
                    <label key={ch.id} class="flex items-center justify-between gap-3 cursor-pointer group">
                      <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ch.color }} />
                        <span class="text-sm">{ch.name}</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        onClick={() => toggleChannel(ch.id)}
                        class={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                          active ? "bg-primary" : "bg-input"
                        }`}
                      >
                        <span
                          class={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                            active ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Labels */}
          <div>
            <h3 class="text-sm font-medium mb-2">Labels</h3>
            {labels.length === 0 ? (
              <p class="text-sm text-muted-foreground">No labels yet</p>
            ) : (
              <div class="flex flex-wrap gap-1.5">
                {labels.map((l) => (
                  <button
                    key={l.id}
                    class={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedLabels.includes(l.id)
                        ? "text-white border-transparent"
                        : "border-border text-foreground hover:bg-accent"
                    }`}
                    style={selectedLabels.includes(l.id) ? { background: l.color, borderColor: l.color } : {}}
                    onClick={() => toggleLabel(l.id)}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div class="space-y-2 pt-2">
            <button
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
              onClick={() => handleSave("draft")}
              disabled={saving || !hasContent}
            >
              <Save size={14} /> Save Draft
            </button>
            <button
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={() => handleSave(scheduledAt ? "scheduled" : "draft")}
              disabled={saving || !hasContent || overLimit}
            >
              <Send size={14} /> {scheduledAt ? "Schedule" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
