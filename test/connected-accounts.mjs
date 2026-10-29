/**
 * Each channel posts as the connected account it names (OpenPost#17).
 *
 * An org can connect several accounts of one platform. Take one with two
 * LinkedIn accounts (Ana's, and Ben's as the default) and one Instagram.
 * Every LinkedIn channel used to post as the default, so a channel meant for
 * Ana went out as Ben. Now a channel names its account, every call made
 * for it is made as that account, and an account that is no longer connected is
 * refused rather than quietly sent as the default.
 *
 * Run with `pnpm test`.
 */
import { boot, check, section, report } from "./harness.mjs";

const IMAGE = "https://app.example.com/api/uploads/ab12-photo.jpg";
const ORG = [
  { service: "linkedin", account: "li-ana", label: "ana-lopez", isDefault: false },
  { service: "linkedin", account: "li-ben", label: "benwright", isDefault: true },
  { service: "instagram", account: "ig-200", label: "@acme", isDefault: true },
];
const publish = async (h, channelIds, media) => {
  const post = (await h.post("/api/posts", { content: "hello", channel_ids: channelIds, ...(media ? { media } : {}) })).body;
  return (await h.post(`/api/posts/${post.id}/publish`)).body.results;
};
const profileOf = (h, id) => h.row("SELECT profile_name, platform_account_id FROM channels WHERE id = ?", id);

section("The connected accounts are there for the channel form");
{
  const h = await boot({ connections: () => ORG });
  const r = await h.get("/api/accounts");
  check("all three accounts are listed", r.status === 200 && r.body.accounts.length === 3, JSON.stringify(r.body));
}

section("Two LinkedIn channels in one post go out as two different people");
{
  const h = await boot({ connections: () => ORG });
  const ana = (await h.post("/api/channels", { name: "Ana", platform: "linkedin", platform_account_id: "li-ana" })).body;
  const ben = (await h.post("/api/channels", { name: "Ben", platform: "linkedin", platform_account_id: "li-ben" })).body;
  check("each channel shows its own account's profile",
    ana.profile_name === "ana-lopez" && ben.profile_name === "benwright", JSON.stringify([ana.profile_name, ben.profile_name]));

  const res = await publish(h, [ana.id, ben.id]);
  check("both go out", res.length === 2 && res.every((r) => r.success), JSON.stringify(res));
  check("once per account", h.sends.map((s) => s.as).sort().join() === "li-ana,li-ben", JSON.stringify(h.sends));
  const anaSend = h.sends.find((s) => s.as === "li-ana");
  check("and Ana's is authored by her own member id", anaSend?.author === "urn:li:person:li-ana", JSON.stringify(anaSend));
}

section("A channel that never picked an account posts as the default, as before");
{
  const h = await boot({ connections: () => ORG });
  const ch = (await h.post("/api/channels", { name: "LinkedIn", platform: "linkedin" })).body;
  await publish(h, [ch.id]);
  check("it names no account", h.sends.length === 1 && h.sends[0].as === null, JSON.stringify(h.sends));
}

section("A channel whose account was disconnected is refused, not sent as the default");
{
  let connected = ORG;
  const h = await boot({ connections: () => connected });
  const ana = (await h.post("/api/channels", { name: "Ana", platform: "linkedin", platform_account_id: "li-ana" })).body;
  connected = ORG.filter((c) => c.account !== "li-ana");

  const res = await publish(h, [ana.id]);
  check("nothing is published", h.sends.length === 0, JSON.stringify(h.sends));
  check("and the channel says to reconnect",
    !res[0].success && /ana-lopez isn't connected to LinkedIn any more/.test(res[0].error), res[0]?.error);

  const sync = await h.post(`/api/channels/${ana.id}/sync-profile`);
  check("its profile isn't refilled from the default account",
    sync.status === 409 && profileOf(h, ana.id).profile_name === null, JSON.stringify({ status: sync.status, row: profileOf(h, ana.id) }));
  check("and it keeps the account it names", profileOf(h, ana.id).platform_account_id === "li-ana");
}

section("Two Instagram accounts: each channel publishes to its own");
{
  const connected = [...ORG, { service: "instagram", account: "ig-201", label: "@acme_de", isDefault: false }];
  const h = await boot({ connections: () => connected });
  const nl = (await h.post("/api/channels", { name: "NL", platform: "instagram", handle: "@acme", platform_account_id: "ig-200" })).body;
  const de = (await h.post("/api/channels", { name: "DE", platform: "instagram", handle: "@acme_de", platform_account_id: "ig-201" })).body;
  check("neither is refused as a copy of the other", nl.profile_name === "acme" && de.profile_name === "acme_de",
    JSON.stringify([nl.profile_name, de.profile_name]));

  const res = await publish(h, [nl.id, de.id], [{ url: IMAGE, type: "image" }]);
  check("both go out", res.every((r) => r.success), JSON.stringify(res));
  check("each to its own account, signed in as that account",
    h.sends.map((s) => s.account).sort().join() === "ig-200,ig-201" && h.sends.every((s) => s.as === s.account), JSON.stringify(h.sends));
}

section("An Instagram channel from before accounts were recorded keeps posting");
{
  // The org's only Instagram connection predates accounts: it can't say who it is.
  const h = await boot({ connections: () => [{ service: "instagram", account: null, label: null, isDefault: true }] });
  const ch = (await h.post("/api/channels", { name: "LEN10", platform: "instagram" })).body;
  check("it claims the connected account, as it always did", profileOf(h, ch.id).platform_account_id === "ig-100");

  const res = await publish(h, [ch.id], [{ url: IMAGE, type: "image" }]);
  check("and publishes through that connection without naming an account",
    res[0].success && h.sends.length === 1 && h.sends[0].as === null, JSON.stringify({ res, sends: h.sends }));
}

section("Moving a channel to another account shows that account");
{
  const h = await boot({ connections: () => ORG });
  const ch = (await h.post("/api/channels", { name: "LinkedIn", platform: "linkedin", platform_account_id: "li-ben" })).body;
  const r = await h.put(`/api/channels/${ch.id}`, { name: "LinkedIn", platform: "linkedin", handle: "", color: "#0a66c2", platform_account_id: "li-ana" });
  check("the profile is re-synced as the new account", r.body?.profile_name === "ana-lopez", JSON.stringify(r.body));
}

report();
