import { proxyRequest } from "./credentials";

// LinkedIn's versioned REST API, via the credential broker: raw OAuth tokens
// never leave the broker. GET_COMPANY_INFO only returns the first company, so
// discovery uses the paginated ACL endpoint and a batch profile lookup instead.
// https://learn.microsoft.com/linkedin/marketing/community-management/organizations/organization-access-control-by-role
// https://learn.microsoft.com/linkedin/marketing/community-management/organizations/organization-lookup-api
const VERSION = "202610";
const PAGE_SIZE = 100;
const ROLES = new Set(["ADMINISTRATOR", "CONTENT_ADMINISTRATOR"]);

export interface LinkedInPage {
  id: string;
  name: string;
  username: string | null;
}

async function read(endpoint: string, query: Record<string, string>, account?: string): Promise<any> {
  const r = await proxyRequest("linkedin", {
    method: "GET",
    endpoint,
    parameters: [
      { name: "LinkedIn-Version", value: VERSION, in: "header" },
      { name: "X-Restli-Protocol-Version", value: "2.0.0", in: "header" },
      ...Object.entries(query).map(([name, value]) => ({ name, value, in: "query" as const })),
    ],
  }, account);
  if (!r) throw new Error("This deployment cannot read LinkedIn Pages. Update the credentials service and connect LinkedIn in Clawnify.");
  if (!r.successful) {
    const reconnect = /401|403|permission|scope|revoked|expired/i.test(r.error || "")
      ? " Reconnect this LinkedIn account in Clawnify to grant company Page permissions."
      : " Try again.";
    throw new Error(`Couldn't read LinkedIn Pages.${reconnect} ${r.error || ""}`.trim());
  }
  return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
}

export async function listLinkedInPages(account?: string): Promise<LinkedInPage[]> {
  const ids = new Set<string>();
  for (let start = 0; ; ) {
    const d = await read("/rest/organizationAcls", {
      q: "roleAssignee", state: "APPROVED", count: String(PAGE_SIZE), start: String(start),
    }, account);
    if (!Array.isArray(d?.elements)) throw new Error("LinkedIn returned an invalid company Page list. Try again.");
    for (const acl of d.elements) {
      if (acl.state !== "APPROVED" || !ROLES.has(acl.role)) continue;
      const id = /^urn:li:organization:(\d+)$/.exec(acl.organization ?? acl.organizationTarget ?? "")?.[1];
      if (id) ids.add(id);
    }
    if (!d.paging?.links?.some((l: any) => l.rel === "next")) break;
    // Advance from the provider's page size; never follow an arbitrary URL
    // from a response with the account's authorization attached.
    const count = Number(d.paging.count);
    if (Number(d.paging.start) !== start || !Number.isInteger(count) || count <= 0) {
      throw new Error("LinkedIn returned invalid company Page pagination. Try again.");
    }
    start += count;
  }

  const pages: LinkedInPage[] = [];
  const all = [...ids];
  for (let offset = 0; offset < all.length; offset += PAGE_SIZE) {
    const batch = all.slice(offset, offset + PAGE_SIZE);
    // Rest.li's List(...) syntax must remain literal in the query string.
    // The proxy URL-encodes parameter values, which LinkedIn rejects for ids.
    const d = await read(`/rest/organizationsLookup?ids=List(${batch.join(",")})`, {}, account);
    for (const id of batch) {
      const org = d?.results?.[id];
      // Missing metadata must not hide a Page the member can publish to.
      pages.push({ id, name: org?.localizedName || `LinkedIn Page ${id}`, username: org?.vanityName || null });
    }
  }
  return pages;
}

export async function linkedInPage(id: string, account?: string): Promise<LinkedInPage | { error: string }> {
  try {
    const page = (await listLinkedInPages(account)).find((p) => p.id === id);
    return page ?? { error: "This LinkedIn account can no longer publish to the selected company Page. Choose a Page you administer or reconnect LinkedIn in Clawnify." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't read LinkedIn Pages. Try again." };
  }
}
