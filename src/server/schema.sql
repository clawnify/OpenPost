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
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | published | failed
  ref TEXT,            -- platform post id (Postiz: releaseId)
  url TEXT,            -- link to the live post (Postiz: releaseURL)
  error TEXT,          -- platform rejection reason when status = 'failed'
  published_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, channel_id)
);

-- Many-to-many: posts <-> labels
CREATE TABLE IF NOT EXISTS post_labels (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, label_id)
);

-- Media attachments
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
