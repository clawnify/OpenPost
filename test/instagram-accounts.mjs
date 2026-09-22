/**
 * One Instagram connection is one Instagram account.
 *
 * Instagram connects through Instagram Login, and a token from it belongs to a
 * single professional account. An org with two Instagram channels therefore
 * has one account both of them can reach — and OpenPost used to hide that: a
 * channel with no stored account asked the connection who it was and saved the
 * answer, so the second channel quietly became a copy of the first. Its profile
 * synced as the other account, and its posts went there.
 *
 * This is the scenario that was reported: "LEN10" and "LEN10 Experience", with
 * Instagram connected as @rubenlen10.
 *
 * Run with `pnpm test`.
 */
import { boot, check, section, report } from "./harness.mjs";

const IMAGE = "https://app.example.com/api/uploads/cd34-photo.jpg";
const syncOf = (h, id) => h.post(`/api/channels/${id}/sync-profile`);
const rowOf = (h, id) => h.row("SELECT platform_account_id, profile_handle, handle FROM channels WHERE id = ?", id);

section("Two channels, one connected account: the second can't become a copy");
{
  // Both channels exist before Instagram is connected, so neither has claimed
  // an account yet — the state the reported app was in.
  let connected = null;
  const h = await boot({ instagramMe: () => connected });
  const len10 = (await h.post("/api/channels", { name: "LEN10", platform: "instagram" })).body;
  const exp = (await h.post("/api/channels", { name: "LEN10 Experience", platform: "instagram" })).body;
  connected = { id: "ig-100", username: "rubenlen10" };

  // The second channel was synced first. It claims the connected account.
  const first = await syncOf(h, exp.id);
  check("the first channel synced claims the connected account",
    first.status === 200 && rowOf(h, exp.id).platform_account_id === "ig-100", JSON.stringify(rowOf(h, exp.id)));

  const second = await syncOf(h, len10.id);
  check("the other channel is refused, not relabelled as the same person",
    second.status === 409 && /already the "LEN10 Experience" channel/.test(second.body.error), second.body?.error);
  const row = rowOf(h, len10.id);
  check("and it shows no profile rather than someone else's",
    row.profile_handle === null && row.platform_account_id === null, JSON.stringify(row));

  // A post to both reaches the account once, from the channel that owns it.
  const post = (await h.post("/api/posts", { content: "hello", channel_ids: [len10.id, exp.id], media: [{ url: IMAGE, type: "image" }] })).body;
  const res = (await h.post(`/api/posts/${post.id}/publish`)).body.results;
  check("publishing sends to the account exactly once", h.sends.length === 1, JSON.stringify(h.sends));
  check("and the channel without an account of its own fails and says why",
    !res.find((r) => r.channelId === len10.id).success &&
      /already the "LEN10 Experience" channel/.test(res.find((r) => r.channelId === len10.id).error));
}

section("A channel whose handle names another account is never published as the connected one");
{
  const h = await boot();
  const len10 = (await h.post("/api/channels", { name: "LEN10", platform: "instagram" })).body;
  const exp = (await h.post("/api/channels", { name: "LEN10 Experience", platform: "instagram", handle: "@len10experience" })).body;
  check("the channel with no handle claimed the connected account on creation",
    rowOf(h, len10.id).platform_account_id === "ig-100");

  const r = await syncOf(h, exp.id);
  check("the other is refused with both accounts named",
    r.status === 409 && /This channel is @len10experience, but Instagram is connected as @rubenlen10/.test(r.body.error), r.body?.error);

  const post = (await h.post("/api/posts", { content: "hello", channel_ids: [exp.id], media: [{ url: IMAGE, type: "image" }] })).body;
  await h.post(`/api/posts/${post.id}/publish`);
  check("and nothing is published for it", h.sends.length === 0, JSON.stringify(h.sends));
}

section("A channel the old code stamped with the wrong account is repaired");
{
  // What the reported app holds today: both channels carry @rubenlen10's id,
  // and the one meant to be @len10experience is the OLDER row — so "first
  // claim wins" alone would hand it the account. Its handle says otherwise.
  let connected = null;
  const h = await boot({ instagramMe: () => connected });
  const exp = (await h.post("/api/channels", { name: "LEN10 Experience", platform: "instagram", handle: "len10experience" })).body;
  const len10 = (await h.post("/api/channels", { name: "LEN10", platform: "instagram" })).body;
  h.db.prepare("UPDATE channels SET platform_account_id = 'ig-100', profile_handle = 'rubenlen10' WHERE platform = 'instagram'").run();
  connected = { id: "ig-100", username: "rubenlen10" };

  const r = await syncOf(h, exp.id);
  check("the mislabelled channel is refused",
    r.status === 409 && /This channel is @len10experience/.test(r.body.error), r.body?.error);
  check("its wrong account and profile are cleared",
    rowOf(h, exp.id).platform_account_id === null && rowOf(h, exp.id).profile_handle === null, JSON.stringify(rowOf(h, exp.id)));

  const ok = await syncOf(h, len10.id);
  check("and the real owner keeps the account, even though it is the newer row",
    ok.status === 200 && rowOf(h, len10.id).platform_account_id === "ig-100" && rowOf(h, len10.id).profile_handle === "rubenlen10",
    JSON.stringify({ status: ok.status, row: rowOf(h, len10.id), err: ok.body?.error }));

  const post = (await h.post("/api/posts", { content: "hello", channel_ids: [len10.id, exp.id], media: [{ url: IMAGE, type: "image" }] })).body;
  await h.post(`/api/posts/${post.id}/publish`);
  check("a post to both goes out once, as @rubenlen10, from LEN10",
    h.sends.length === 1 && h.sends[0].account === "ig-100", JSON.stringify(h.sends));
}

section("Editing an Instagram channel keeps the account it is tied to");
{
  const h = await boot();
  const ch = (await h.post("/api/channels", { name: "LEN10", platform: "instagram" })).body;
  check("created and claimed", rowOf(h, ch.id).platform_account_id === "ig-100");
  // Exactly the body the channel form sends for a non-Facebook channel.
  await h.put(`/api/channels/${ch.id}`, { name: "LEN10 main", platform: "instagram", handle: "", color: "#e1306c" });
  check("the account survives the edit", rowOf(h, ch.id).platform_account_id === "ig-100", JSON.stringify(rowOf(h, ch.id)));
}

report();
