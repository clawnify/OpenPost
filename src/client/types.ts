export type PostStatus = "draft" | "scheduled" | "published" | "partial" | "failed";

// Per-channel delivery state on a post's channel (Postiz-style). Present on the
// Channel objects returned inside a Post; absent in the standalone channel list.
export type DeliveryStatus = "pending" | "published" | "failed";
// Platform metadata (limits, colours, labels, the publishable list) lives in
// src/shared/platforms.ts because the server enforces the same tables. Re-exported
// here so client code keeps importing platform facts from one place.
export {
  PUBLISHABLE_PLATFORMS,
  PLATFORM_LIMITS,
  PLATFORM_MEDIA_LIMITS,
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  mediaLimitError,
} from "../shared/platforms";
export type { Platform } from "../shared/platforms";
import type { Platform } from "../shared/platforms";

// A Facebook Page the connected account manages (GET /api/platforms/facebook/pages).
export interface FacebookPage {
  id: string;
  name: string;
  username: string | null;
}

export interface Channel {
  id: number;
  name: string;
  platform: Platform;
  handle: string;
  color: string;
  // Platform-side account the channel publishes as (Facebook Page ID,
  // Instagram Business Account ID); null where the connection is the account.
  platform_account_id?: string | null;
  created_at: string;
  // Cached platform profile (synced from the connected account) for accurate
  // previews — real name, photo, @handle, headline.
  profile_name?: string | null;
  profile_handle?: string | null;
  profile_avatar_url?: string | null;
  profile_headline?: string | null;
  profile_synced_at?: string | null;
  // Per-channel delivery state — only populated on channels nested in a Post.
  delivery_status?: DeliveryStatus;
  delivery_ref?: string | null;
  delivery_url?: string | null;
  delivery_error?: string | null;
  delivery_published_at?: string | null;
}

export interface Label {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Media {
  id: number;
  post_id: number;
  url: string;
  type: string;
  created_at: string;
}

export interface Post {
  id: number;
  content: string;
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  channels: Channel[];
  labels: Label[];
  media: Media[];
}

export interface Stats {
  total: number;
  scheduled: number;
  drafts: number;
  published: number;
  channels: number;
  per_channel: Array<Channel & { post_count: number }>;
  per_label: Array<Label & { post_count: number }>;
  daily: Array<{ day: string; count: number }>;
}

export type View = "dashboard" | "compose" | "calendar" | "queue" | "drafts" | "channels" | "analytics";
