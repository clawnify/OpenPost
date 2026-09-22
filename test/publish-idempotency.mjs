/**
 * Publishing must be safe to run twice.
 *
 * Three things make it run twice in production, none of them exotic:
 *   • The Clawnify queue that fires scheduled posts is at-least-once, so a
 *     delivery whose response is lost comes back.
 *   • The Queue view offers a Retry on a post that only partly went out.
 *   • Someone edits a post that is already live and saves it again.
 *
 * A duplicate here is not a recoverable bug: the second tweet is on the user's
 * timeline and no code can take it back. So every check below counts the sends
 * the app actually made, not what it reported.
 *
 * Run with `pnpm test`.
 */
import { boot, check, section, report } from "./harness.mjs";

section("A redelivery of the same post");
{
  const h = await boot();
  const x = (await h.post("/api/channels", { name: "X", platform: "twitter" })).body;
  const li = (await h.post("/api/channels", { name: "LinkedIn", platform: "linkedin" })).body;
  const post = (await h.post("/api/posts", { content: "hello", channel_ids: [x.id, li.id] })).body;

  const first = await h.post(`/api/posts/${post.id}/publish`);
  const afterFirst = h.sends.length;
  const second = await h.post(`/api/posts/${post.id}/publish`);

  check("sends nothing the second time", afterFirst === 2 && h.sends.length === 2,
    `${afterFirst} sends, then ${h.sends.length}`);
  check("still reports both channels delivered",
    second.body.results.length === 2 && second.body.results.every((r) => r.success));
  check("reports the original post ids, not new ones",
    JSON.stringify(second.body.results.map((r) => r.ref)) ===
      JSON.stringify(first.body.results.map((r) => r.ref)),
    `${first.body.results.map((r) => r.ref)} then ${second.body.results.map((r) => r.ref)}`);
  check("leaves the post published", h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "published");
  check("does not count as another attempt",
    h.rows("SELECT attempts FROM post_channels WHERE post_id = ?", post.id).every((r) => r.attempts === 1));
}

section("Retrying a post that only partly went out");
{
  let linkedinUp = false;
  const h = await boot({ linkedinOk: () => linkedinUp });
  const x = (await h.post("/api/channels", { name: "X", platform: "twitter" })).body;
  const li = (await h.post("/api/channels", { name: "LinkedIn", platform: "linkedin" })).body;
  const post = (await h.post("/api/posts", { content: "hello", channel_ids: [x.id, li.id] })).body;

  await h.post(`/api/posts/${post.id}/publish`);
  check("one channel failing makes the post partial",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "partial");

  linkedinUp = true;
  await h.post(`/api/posts/${post.id}/publish`);
  const tweets = h.sends.filter((s) => s.service === "twitter").length;
  const linkedins = h.sends.filter((s) => s.service === "linkedin").length;
  check("does not post again to the channel that succeeded", tweets === 1, `${tweets} tweets`);
  check("does post to the channel that failed", linkedins === 1, `${linkedins} LinkedIn posts`);
  check("rolls the post up to published",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "published");
  const row = h.row("SELECT status, error FROM post_channels WHERE post_id = ? AND channel_id = ?", post.id, li.id);
  check("clears the recovered channel's error", row.status === "published" && row.error === null,
    JSON.stringify(row));
}

section("Editing a post that is already live");
{
  const h = await boot();
  const x = (await h.post("/api/channels", { name: "X", platform: "twitter" })).body;
  const post = (await h.post("/api/posts", { content: "hello", channel_ids: [x.id] })).body;
  await h.post(`/api/posts/${post.id}/publish`);
  const before = h.row("SELECT * FROM post_channels WHERE post_id = ?", post.id);

  await h.put(`/api/posts/${post.id}`, { content: "hello, edited", channel_ids: [x.id] });
  const after = h.row("SELECT * FROM post_channels WHERE post_id = ?", post.id);
  check("keeps the channel marked published", after.status === "published", after.status);
  check("keeps the link to the live post", after.ref === before.ref && after.url === before.url,
    `${before.ref} then ${after.ref}`);

  await h.post(`/api/posts/${post.id}/publish`);
  check("publishing the edit does not post a second time", h.sends.length === 1, `${h.sends.length} sends`);

  await h.put(`/api/posts/${post.id}`, {
    content: "shared", channel_ids: [x.id], channel_content: { [String(x.id)]: "just for X" },
  });
  check("still saves a per-channel rewrite",
    h.row("SELECT content FROM post_channels WHERE post_id = ?", post.id).content === "just for X");
}

section("Two deliveries arriving at once");
{
  const h = await boot();
  const x = (await h.post("/api/channels", { name: "X", platform: "twitter" })).body;
  const post = (await h.post("/api/posts", { content: "hello", channel_ids: [x.id] })).body;
  await Promise.all([
    h.post(`/api/posts/${post.id}/publish`),
    h.post(`/api/posts/${post.id}/publish`),
  ]);
  check("only one of them sends", h.sends.length === 1, `${h.sends.length} sends`);
  check("the post still ends up published",
    h.row("SELECT status FROM posts WHERE id = ?", post.id).status === "published");
}

section("Removing a channel from a post");
{
  const h = await boot();
  const x = (await h.post("/api/channels", { name: "X", platform: "twitter" })).body;
  const li = (await h.post("/api/channels", { name: "LinkedIn", platform: "linkedin" })).body;
  const post = (await h.post("/api/posts", { content: "hello", channel_ids: [x.id, li.id] })).body;
  await h.post(`/api/posts/${post.id}/publish`);

  await h.put(`/api/posts/${post.id}`, { channel_ids: [x.id] });
  const kept = h.rows("SELECT channel_id, status FROM post_channels WHERE post_id = ?", post.id);
  check("drops only the channel that was removed",
    kept.length === 1 && kept[0].channel_id === x.id && kept[0].status === "published",
    JSON.stringify(kept));

  await h.put(`/api/posts/${post.id}`, { channel_ids: [] });
  check("clearing every channel leaves no rows",
    h.row("SELECT COUNT(*) AS n FROM post_channels WHERE post_id = ?", post.id).n === 0);
}

report();
