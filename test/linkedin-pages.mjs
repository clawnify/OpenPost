import assert from "node:assert/strict";
import { boot, check, section, report } from "./harness.mjs";

const MEMBER = { service: "linkedin", account: "li-ana", label: "Ana", isDefault: true };
const OTHER = { service: "linkedin", account: "li-ben", label: "Ben", isDefault: false };
const IMAGE = "https://app.example.com/api/uploads/photo.jpg";
const approved = (id, role = "ADMINISTRATOR") => ({ organization: `urn:li:organization:${id}`, role, state: "APPROVED" });
const ok = (data) => ({ successful: true, error: null, data });

// The real broker proxy contract, including its argument order, header/query
// parameters, response envelope and account selection. Never a publishing call.
function pagesBroker(plan = {}) {
  const calls = [];
  return {
    calls,
    async proxyRequest(service, orgId, request, opts) {
      assert.equal(service, "linkedin");
      assert.equal(orgId, "org-test");
      assert.equal(request.method, "GET");
      const headers = Object.fromEntries(request.parameters.filter((p) => p.in === "header").map((p) => [p.name, p.value]));
      assert.equal(headers["LinkedIn-Version"], "202610");
      assert.equal(headers["X-Restli-Protocol-Version"], "2.0.0");
      const query = Object.fromEntries(request.parameters.filter((p) => p.in === "query").map((p) => [p.name, p.value]));
      calls.push({ endpoint: request.endpoint, account: opts?.account, query });
      if (plan.error) return { successful: false, error: plan.error, data: null };
      if (request.endpoint === "/rest/organizationAcls") {
        assert.equal(query.q, "roleAssignee");
        assert.equal(query.state, "APPROVED");
        assert.equal(query.count, "100");
        const all = plan.acls?.(opts?.account) ?? [approved("100"), approved("200", "CONTENT_ADMINISTRATOR")];
        const start = Number(query.start);
        const elements = all.slice(start, start + 100);
        const links = start + elements.length < all.length ? [{ rel: "next", href: "/ignored-provider-link" }] : [];
        return ok({ elements, paging: { start, count: 100, links } });
      }
      const ids = /^\/rest\/organizationsLookup\?ids=List\((\d+(?:,\d+)*)\)$/.exec(request.endpoint)?.[1].split(",");
      assert.ok(ids);
      return ok({ results: Object.fromEntries(ids.map((id) => [id, { id: Number(id), localizedName: `Company ${id}`, vanityName: `company-${id}` }])) });
    },
  };
}

const add = async (h, extra = {}) => (await h.post("/api/channels", {
  name: "LinkedIn", platform: "linkedin", platform_account_id: MEMBER.account, ...extra,
})).body;
const publish = async (h, ids, extra = {}) => {
  const post = (await h.post("/api/posts", { content: "Company news", channel_ids: ids, ...extra })).body;
  return { post, response: await h.post(`/api/posts/${post.id}/publish`) };
};

section("Company discovery lists every approved publishing Page for the selected connection");
{
  const proxy = pagesBroker({ acls: () => [
    approved("100"), approved("100"), approved("200", "CONTENT_ADMINISTRATOR"),
    approved("300", "ANALYST"), approved("400", "DIRECT_SPONSORED_CONTENT_POSTER"),
    { ...approved("500"), state: "REQUESTED" }, { ...approved("600"), state: "REVOKED" },
  ] });
  const h = await boot({ connections: () => [MEMBER, OTHER], proxyRequest: proxy.proxyRequest });
  const r = await h.get(`/api/platforms/linkedin/pages?account=${OTHER.account}`);
  check("admin and content admin Pages only, without duplicates", r.status === 200 && r.body.pages.map((p) => p.id).join() === "100,200", JSON.stringify(r.body));
  check("Page names and handles come from the organization", r.body.pages?.[0].name === "Company 100" && r.body.pages?.[0].username === "company-100");
  check("all discovery calls use the chosen member connection", proxy.calls.length === 2 && proxy.calls.every((c) => c.account === OTHER.account), JSON.stringify(proxy.calls));
  const before = proxy.calls.length;
  const missing = await h.get("/api/platforms/linkedin/pages?account=disconnected");
  check("a missing account cannot fall back to the default", missing.status === 409 && proxy.calls.length === before);
}

section("Discovery follows pagination and batches company details");
{
  const proxy = pagesBroker({ acls: () => Array.from({ length: 101 }, (_, i) => approved(String(i + 1))) });
  const h = await boot({ proxyRequest: proxy.proxyRequest });
  const r = await h.get("/api/platforms/linkedin/pages");
  check("the 101st company is available", r.status === 200 && r.body.pages.length === 101 && r.body.pages[100].id === "101");
  check("two ACL calls and two batch lookups, rather than one lookup per Page", proxy.calls.length === 4 && proxy.calls[1].query.start === "100");
}

section("Personal and company channels share a connection, and publish to distinct destinations");
{
  const proxy = pagesBroker();
  const h = await boot({ connections: () => [MEMBER], proxyRequest: proxy.proxyRequest });
  const person = await add(h);
  const company = await add(h, { linkedin_organization_id: "200" });
  check("the company channel caches its Page profile", company.linkedin_organization_id === "200" && company.profile_name === "Company 200" && company.profile_headline === "Company Page", JSON.stringify(company));
  check("the personal channel keeps its member profile", person.profile_name === "Ana" && person.linkedin_organization_id === null);
  const { post, response } = await publish(h, [person.id, company.id], { media: [{ url: IMAGE, type: "image" }] });
  check("both channels publish", response.status === 200 && response.body.results.every((r) => r.success), JSON.stringify(response.body));
  check("each post has the correct author URN", h.sends.map((s) => s.author).sort().join() === "urn:li:organization:200,urn:li:person:li-ana", JSON.stringify(h.sends));
  check("both use the selected member's authorization and preserve the image", h.sends.every((s) => s.as === MEMBER.account && s.images?.[0].staged === IMAGE));
  await h.post(`/api/posts/${post.id}/publish`);
  check("retry does not publish either destination twice", h.sends.length === 2);
  check("the company post has its own permalink", response.body.results.find((r) => r.channelId === company.id)?.url?.includes("linkedin.com/feed/update/"));
}

section("Scheduled company publishing uses the same Page and member");
{
  const h = await boot({ queue: true, connections: () => [MEMBER], proxyRequest: pagesBroker().proxyRequest });
  const company = await add(h, { linkedin_organization_id: "100" });
  const post = (await h.post("/api/posts", { content: "Scheduled company news", status: "scheduled", scheduled_at: "2030-01-01T12:00:00Z", channel_ids: [company.id] })).body;
  const r = await h.deliver({ post_id: post.id });
  check("the signed delivery publishes as the company", r.status === 200 && h.sends.length === 1 && h.sends[0].author === "urn:li:organization:100" && h.sends[0].as === MEMBER.account, JSON.stringify(r.body));
}

section("A company channel can use a non-default member without borrowing the default's Pages");
{
  const proxy = pagesBroker({ acls: (account) => [approved(account === OTHER.account ? "200" : "100")] });
  const h = await boot({ connections: () => [MEMBER, OTHER], proxyRequest: proxy.proxyRequest });
  const company = await add(h, { platform_account_id: OTHER.account, linkedin_organization_id: "200" });
  const { response } = await publish(h, [company.id]);
  check("discovery, profile and publishing all use the non-default account", company.profile_name === "Company 200" &&
    response.body.results[0].success && h.sends[0].as === OTHER.account && h.sends[0].author === "urn:li:organization:200" &&
    proxy.calls.every((c) => c.account === OTHER.account));
}

section("A company that loses access fails without becoming a personal post");
{
  let acls = [approved("100")];
  const h = await boot({ connections: () => [MEMBER], proxyRequest: pagesBroker({ acls: () => acls }).proxyRequest });
  const company = await add(h, { linkedin_organization_id: "100" });
  acls = [];
  const { response } = await publish(h, [company.id]);
  check("no post is sent", h.sends.length === 0);
  check("the delivery explains the lost Page permission", !response.body.results[0].success && /no longer publish/.test(response.body.results[0].error), JSON.stringify(response.body));
  const sync = await h.post(`/api/channels/${company.id}/sync-profile`);
  check("sync clears the stale company profile", sync.status === 409 && h.row("SELECT profile_name FROM channels WHERE id = ?", company.id).profile_name === null);
}

section("An older connection explains how to get Page permissions while personal posting works");
{
  const h = await boot({ connections: () => [MEMBER], proxyRequest: pagesBroker({ error: "403: missing r_organization_admin" }).proxyRequest });
  const r = await h.get(`/api/platforms/linkedin/pages?account=${MEMBER.account}`);
  check("permission failure is not presented as an empty list", r.status === 502 && /Reconnect/.test(r.body.error) && !r.body.pages, JSON.stringify(r.body));
  const company = await add(h, { linkedin_organization_id: "100" });
  const person = await add(h);
  const { response } = await publish(h, [company.id, person.id]);
  check("the company fails but the personal channel still publishes", response.body.results.length === 2 && !response.body.results[0].success && response.body.results[1].success && h.sends.length === 1 && h.sends[0].author === "urn:li:person:li-ana");
}

section("Company destinations survive edits and can be switched explicitly");
{
  const h = await boot({ connections: () => [MEMBER], proxyRequest: pagesBroker().proxyRequest });
  const company = await add(h, { linkedin_organization_id: "100" });
  const rename = await h.put(`/api/channels/${company.id}`, { name: "Renamed" });
  check("renaming keeps both member and company IDs", rename.body.linkedin_organization_id === "100" && rename.body.platform_account_id === MEMBER.account);
  const other = await h.put(`/api/channels/${company.id}`, { linkedin_organization_id: "200" });
  check("changing Pages refreshes the profile", other.body.profile_name === "Company 200");
  const person = await h.put(`/api/channels/${company.id}`, { linkedin_organization_id: null });
  check("explicitly choosing personal clears the company and refreshes the member profile", person.body.linkedin_organization_id === null && person.body.profile_name === "Ana");
  const move = await h.put(`/api/channels/${company.id}`, { platform: "twitter" });
  check("changing platforms clears the LinkedIn company destination", move.body.linkedin_organization_id === null);
}

section("A temporary provider failure is not diagnosed as missing permissions");
{
  const h = await boot({ proxyRequest: pagesBroker({ error: "LinkedIn 503: temporarily unavailable" }).proxyRequest });
  const r = await h.get("/api/platforms/linkedin/pages");
  check("a transient failure says to retry", r.status === 502 && /Try again/.test(r.body.error) && !/Reconnect/.test(r.body.error));
}

section("Malformed or misplaced company IDs are rejected before changing the channel");
{
  const h = await boot();
  for (const id of ["", "urn:li:organization:100", "../100", 100, {}, " 100"]) {
    const r = await h.post("/api/channels", { name: "Bad", platform: "linkedin", linkedin_organization_id: id });
    check(`rejects ${JSON.stringify(id)}`, r.status === 400);
  }
  const r = await h.post("/api/channels", { name: "Bad", platform: "twitter", linkedin_organization_id: "100" });
  check("company IDs belong only to LinkedIn", r.status === 400 && h.rows("SELECT * FROM channels").length === 0);
  const ch = await add(h);
  const update = await h.put(`/api/channels/${ch.id}`, { linkedin_organization_id: "bad", name: "Bad update" });
  check("invalid edits do not overwrite the existing channel", update.status === 400 && h.row("SELECT name FROM channels WHERE id = ?", ch.id).name === "LinkedIn");
}

section("A credentials service without proxy support cannot publish a company channel");
{
  const h = await boot();
  const list = await h.get("/api/platforms/linkedin/pages");
  check("the picker explains the runtime requirement", list.status === 502 && /credentials service/.test(list.body.error));
  const company = await add(h, { linkedin_organization_id: "100" });
  const { response } = await publish(h, [company.id]);
  check("the company destination is retained and no personal post slips through", company.linkedin_organization_id === "100" && !response.body.results[0].success && h.sends.length === 0);
}

report();
