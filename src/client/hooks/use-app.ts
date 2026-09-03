import { useState, useEffect, useCallback } from "preact/hooks";
import { api } from "../api";
import type { Post, Channel, Label, Stats } from "../types";

export function useAppState() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [calendarData, setCalendarData] = useState<Record<string, Post[]>>({});
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const clearError = useCallback(() => setError(""), []);

  const loadChannels = useCallback(async () => {
    try {
      setChannels(await api<Channel[]>("GET", "/api/channels"));
    } catch (e: any) { setError(e.message); }
  }, []);

  const loadLabels = useCallback(async () => {
    try {
      setLabels(await api<Label[]>("GET", "/api/labels"));
    } catch (e: any) { setError(e.message); }
  }, []);

  const loadPosts = useCallback(async (params?: string) => {
    try {
      const url = params ? `/api/posts?${params}` : "/api/posts";
      setPosts(await api<Post[]>("GET", url));
    } catch (e: any) { setError(e.message); }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api<Stats>("GET", "/api/stats"));
    } catch (e: any) { setError(e.message); }
  }, []);

  const loadCalendar = useCallback(async (month: string) => {
    try {
      setCalendarData(await api<Record<string, Post[]>>("GET", `/api/posts/calendar?month=${month}`));
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => {
    Promise.all([loadChannels(), loadLabels(), loadPosts()]).then(() => setLoading(false));
  }, []);

  // ── Channel CRUD ──

  const createChannel = useCallback(async (data: Partial<Channel>) => {
    try {
      await api("POST", "/api/channels", data);
      await loadChannels();
    } catch (e: any) { setError(e.message); }
  }, [loadChannels]);

  const updateChannel = useCallback(async (id: number, data: Partial<Channel>) => {
    try {
      await api("PUT", `/api/channels/${id}`, data);
      await loadChannels();
    } catch (e: any) { setError(e.message); }
  }, [loadChannels]);

  // Upload an image to the app's storage; returns its public URL.
  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const data = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !data.url) throw new Error(data.error || "Upload failed");
      return data.url;
    } catch (e: any) { setError(e.message); return null; }
  }, []);

  const syncChannelProfile = useCallback(async (id: number) => {
    try {
      await api("POST", `/api/channels/${id}/sync-profile`);
      await loadChannels();
    } catch (e: any) { setError(e.message); }
  }, [loadChannels]);

  const deleteChannel = useCallback(async (id: number) => {
    try {
      await api("DELETE", `/api/channels/${id}`);
      await loadChannels();
    } catch (e: any) { setError(e.message); }
  }, [loadChannels]);

  // ── Label CRUD ──

  const createLabel = useCallback(async (data: Partial<Label>) => {
    try {
      await api("POST", "/api/labels", data);
      await loadLabels();
    } catch (e: any) { setError(e.message); }
  }, [loadLabels]);

  const updateLabel = useCallback(async (id: number, data: Partial<Label>) => {
    try {
      await api("PUT", `/api/labels/${id}`, data);
      await loadLabels();
    } catch (e: any) { setError(e.message); }
  }, [loadLabels]);

  const deleteLabel = useCallback(async (id: number) => {
    try {
      await api("DELETE", `/api/labels/${id}`);
      await loadLabels();
    } catch (e: any) { setError(e.message); }
  }, [loadLabels]);

  // ── Post CRUD ──

  const createPost = useCallback(async (data: {
    content: string;
    status?: string;
    scheduled_at?: string;
    channel_ids?: number[];
    // Per-channel text overrides, keyed by channel id; omitted channels publish
    // the shared draft.
    channel_content?: Record<string, string | null>;
    label_ids?: number[];
    media_urls?: string[];
  }) => {
    try {
      const post = await api<Post>("POST", "/api/posts", data);
      await loadPosts();
      return post;
    } catch (e: any) { setError(e.message); return null; }
  }, [loadPosts]);

  const updatePost = useCallback(async (id: number, data: {
    content?: string;
    status?: string;
    scheduled_at?: string | null;
    channel_ids?: number[];
    channel_content?: Record<string, string | null>;
    label_ids?: number[];
    media_urls?: string[];
  }) => {
    try {
      await api("PUT", `/api/posts/${id}`, data);
      await loadPosts();
    } catch (e: any) { setError(e.message); }
  }, [loadPosts]);

  const deletePost = useCallback(async (id: number) => {
    try {
      await api("DELETE", `/api/posts/${id}`);
      await loadPosts();
    } catch (e: any) { setError(e.message); }
  }, [loadPosts]);

  const publishPost = useCallback(async (id: number) => {
    try {
      const result = await api<{ published: boolean; results: Array<{ channel: string; platform: string; success: boolean; error?: string }> }>(
        "POST", `/api/posts/${id}/publish`
      );
      if (!result.published) {
        const errors = result.results.filter((r) => !r.success).map((r) => `${r.channel}: ${r.error}`);
        setError(errors.join("; "));
      }
      await loadPosts();
      return result;
    } catch (e: any) { setError(e.message); return null; }
  }, [loadPosts]);

  return {
    posts, channels, labels, stats, calendarData, calendarMonth,
    loading, error, clearError,
    setCalendarMonth,
    loadPosts, loadStats, loadCalendar,
    createChannel, updateChannel, deleteChannel, syncChannelProfile,
    uploadImage,
    createLabel, updateLabel, deleteLabel,
    createPost, updatePost, deletePost, publishPost,
  };
}
