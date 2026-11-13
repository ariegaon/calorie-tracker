// Server-only: talks to Supabase on behalf of the signed-in caller, using the caller's own token.
// Row level security therefore applies on the server exactly as it does in the browser.

export type Access = { url: string; key: string; token: string; userId: string };

export function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function headers(access: Pick<Access, "key" | "token">, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: access.key, Authorization: `Bearer ${access.token}`, ...extra };
}

/** Confirms the caller's session. Returns the access details, or the error response to send back. */
export async function authenticate(request: Request): Promise<Access | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return json(500, { error: "השרת לא הוגדר" });

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token === "") return json(401, { error: "יש להתחבר מחדש" });

  try {
    const response = await fetch(`${url}/auth/v1/user`, { headers: headers({ key, token }), cache: "no-store" });
    if (!response.ok) return json(401, { error: "יש להתחבר מחדש" });
    const user = (await response.json()) as { id?: unknown };
    if (typeof user.id !== "string") return json(401, { error: "יש להתחבר מחדש" });
    return { url, key, token, userId: user.id };
  } catch {
    return json(502, { error: "לא הצלחנו לאמת את ההתחברות. נסה שוב" });
  }
}

async function check(response: Response, action: string): Promise<Response> {
  if (!response.ok) throw new Error(`${action} failed with status ${response.status}`);
  return response;
}

/** GET rows. `query` is a PostgREST query string without the leading "?". */
export async function selectRows<T>(access: Access, table: string, query: string): Promise<T[]> {
  const response = await check(
    await fetch(`${access.url}/rest/v1/${table}?${query}`, { headers: headers(access), cache: "no-store" }),
    `select ${table}`,
  );
  return (await response.json()) as T[];
}

export async function insertRows(
  access: Access,
  table: string,
  rows: Record<string, unknown>[],
  options: { onConflict?: string; resolution?: "merge-duplicates" | "ignore-duplicates" } = {},
): Promise<void> {
  if (rows.length === 0) return;
  const query = options.onConflict ? `?on_conflict=${encodeURIComponent(options.onConflict)}` : "";
  const prefer = ["return=minimal", options.resolution ? `resolution=${options.resolution}` : ""].filter(Boolean).join(",");
  await check(
    await fetch(`${access.url}/rest/v1/${table}${query}`, {
      method: "POST",
      headers: headers(access, { "Content-Type": "application/json", Prefer: prefer }),
      body: JSON.stringify(rows),
      cache: "no-store",
    }),
    `insert ${table}`,
  );
}

/** PATCH the rows matched by `filter` (a PostgREST filter such as "id=eq.123"). A filter is required. */
export async function updateRows(access: Access, table: string, filter: string, values: Record<string, unknown>): Promise<void> {
  if (filter.trim() === "") throw new Error("refusing to update without a filter");
  await check(
    await fetch(`${access.url}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: headers(access, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(values),
      cache: "no-store",
    }),
    `update ${table}`,
  );
}

export async function deleteRows(access: Access, table: string, filter: string): Promise<void> {
  if (filter.trim() === "") throw new Error("refusing to delete without a filter");
  await check(
    await fetch(`${access.url}/rest/v1/${table}?${filter}`, {
      method: "DELETE",
      headers: headers(access, { Prefer: "return=minimal" }),
      cache: "no-store",
    }),
    `delete ${table}`,
  );
}
