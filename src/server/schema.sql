-- Social media channels
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'twitter',
  handle TEXT DEFAULT '',
  color TEXT NOT NULL DEFAULT '#1da1f2',
  -- The platform-side account this channel publishes as, where the connection
  -- alone doesn't pin one down: the Facebook Page ID (one connection manages
  -- many Pages) or the Instagram Business Account ID (resolved from the
  -- connected account). NULL for platforms that publish as the connection.
  platform_account_id TEXT,
  -- Cached platform profile, synced from the connected account via Composio,
  -- so previews render the real name / photo / @handle / headline.
  profile_name TEXT,
  profile_handle TEXT,
  profile_avatar_url TEXT,
  profile_headline TEXT,
  profile_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Labels for categorizing posts
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Posts (core entity)
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  published_at TEXT,
  -- Clawnify queue job that will fire this post at scheduled_at (if any), so we
  -- can cancel/replace it when the post is rescheduled or unscheduled.
  queue_job_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Many-to-many: posts <-> channels, plus per-channel delivery state.
-- Mirrors Postiz's per-integration publishing model (state / releaseId /
-- releaseURL / error) so a fan-out post tracks each channel independently —
-- one channel failing (e.g. Twitter CreditsDepleted) no longer hides behind a
-- single post-level "published".
CREATE TABLE IF NOT EXISTS post_channels (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- This channel's own version of the text. NULL means "use posts.content" —
  -- the shared draft — so a post nobody customized keeps exactly one body of
  -- text, and only the channels the user actually tailored carry a row value.
  -- Empty is never stored: a blank override normalises to NULL (inherit).
  content TEXT,
  -- pending | published | failed. `pending` covers both "not sent yet" and
  -- "sent, and the platform hasn't ruled on it" — the second is the one with a
  -- ref, which publishPost() re-checks instead of re-sending (TikTok's Content
  -- Posting API only ever accepts a post synchronously).
  status TEXT NOT NULL DEFAULT 'pending',
  ref TEXT,            -- platform post id (Postiz: releaseId)
  url TEXT,            -- link to the live post (Postiz: releaseURL)
  error TEXT,          -- platform rejection reason when status = 'failed'
  published_at TEXT,
  -- Delivery attempts, and the claim token that makes publishing re-entrant:
  -- publishPost() bumps this with a compare-and-swap before it sends, so two
  -- concurrent deliveries of the same post (the queue is at-least-once) can
  -- never both send to this channel. See publishPost() in src/server/index.ts.
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, channel_id)
);

-- Many-to-many: posts <-> labels
CREATE TABLE IF NOT EXISTS post_labels (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, label_id)
);

-- Media attachments. `type` is 'image' or 'video' and decides which platform
-- call publishes the post — an images post and a video post go to different
-- endpoints on every platform that takes both. A post carries either images or
-- one video, never a mix (mediaShapeError in src/shared/platforms.ts); the rule
-- lives in code rather than in a constraint because the composer has to explain
-- it while the attachments are still removable.
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'image',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_post_channels_post ON post_channels(post_id);
CREATE INDEX IF NOT EXISTS idx_post_channels_channel ON post_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_post_labels_post ON post_labels(post_id);
CREATE INDEX IF NOT EXISTS idx_post_labels_label ON post_labels(label_id);
CREATE INDEX IF NOT EXISTS idx_media_post ON media(post_id);
