import { useEffect, useRef, useState } from "preact/hooks";
import { Clock, ExternalLink, X } from "lucide-preact";
import { useApp } from "../context";
import { PlatformIcon } from "./platform-icon";
import type { Post } from "../types";

// Quick edit for a post reached from the calendar or a list: text, time and
// channels, saved in place. The composer stays the post's canonical surface
// (media, per-channel versions, previews); "Open in composer" is the escape.
//
// Built on the native <dialog>: it gives focus trapping, Escape-to-close and a
// top-layer backdrop without a library, which this app does not carry.
export function QuickEditDialog({
  post,
  onClose,
  navigate,
}: {
  post: Post | null;
  onClose: () => void;
  navigate: (path: string) => void;
}) {
  const { channels, updatePost } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState("");
  const [when, setWhen] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (post) {
      setContent(post.content);
      setWhen(post.scheduled_at ? post.scheduled_at.slice(0, 16) : "");
      setSelected(post.channels.map((c) => c.id));
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [post]);

  if (!post) return null;

  const save = async () => {
    setSaving(true);
    try {
      await updatePost(post.id, {
        content,
        scheduled_at: when || null,
        status: when ? "scheduled" : "draft",
        channel_ids: selected,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      class="m-auto w-[32rem] max-w-[calc(100vw-2rem)] rounded-lg bg-card p-0 text-foreground backdrop:bg-black/30"
      style={{ boxShadow: "var(--edge-float)" }}
    >
      <form
        method="dialog"
        onSubmit={(e) => { e.preventDefault(); void save(); }}
        class="flex flex-col"
      >
        <div class="flex items-center justify-between px-4 h-12">
          <span class="inline-flex items-center gap-2 text-sm font-medium">
            <Clock size={16} class="text-muted-foreground" /> Edit post
          </span>
          <button type="button" class="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* The primary input first, autofocused, edge to edge. */}
        <textarea
          value={content}
          onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)}
          rows={4}
          autoFocus
          class="w-full resize-none px-4 py-3 text-[0.9375rem] leading-relaxed outline-none placeholder:text-faint"
          style={{ boxShadow: "inset 0 1px 0 var(--color-border), inset 0 -1px 0 var(--color-border)" }}
          placeholder="What do you want to share?"
        />

        {/* Secondary fields as chips in the footer, not a stacked form. */}
        <div class="flex flex-wrap items-center gap-2 px-4 py-3">
          <label class="btn-ghost cursor-pointer gap-1.5 pl-1.5">
            <Clock size={14} />
            <input
              type="datetime-local"
              value={when}
              onInput={(e) => setWhen((e.target as HTMLInputElement).value)}
              class="bg-transparent text-sm text-foreground outline-none"
            />
          </label>
          <span class="h-4 w-px bg-border" aria-hidden="true" />
          {channels.map((ch) => {
            const on = selected.includes(ch.id);
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => toggle(ch.id)}
                aria-pressed={on}
                class={`brand-soft inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity ${on ? "" : "opacity-40 hover:opacity-70"}`}
                style={{ "--brand": ch.color }}
                title={ch.name}
              >
                <PlatformIcon platform={ch.platform} size={11} /> {ch.name}
              </button>
            );
          })}
        </div>

        <div class="flex items-center justify-between gap-2 px-4 h-12" style={{ boxShadow: "inset 0 1px 0 var(--color-border)" }}>
          <button type="button" class="btn-ghost" onClick={() => { onClose(); navigate(`/compose/${post.id}`); }}>
            <ExternalLink size={14} /> Open in composer
          </button>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-ghost" onClick={onClose}>
              Cancel <kbd class="chip ml-1 px-1 py-0 text-[10px]">Esc</kbd>
            </button>
            <button type="submit" class="btn-primary" disabled={saving}>
              Save <kbd class="ml-1 rounded-xs bg-white/15 px-1 py-0 text-[10px]">⏎</kbd>
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
