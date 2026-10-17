import { q } from "./db";

// Apify, only when the free browser check is blocked (skill rule: "Apify only if Playwright can't get it").
// The key lives in .env.local (APIFY_API_KEY, see .env.example). No key = no Apify, the step says so.

export const apifyKey = () => process.env.APIFY_API_KEY?.trim() || null;

// The actor's price per result on the free Apify tier (dearest tier), so the cost shown is never too low.
const PRICE_PER_ITEM: Record<string, number> = { "clockworks~tiktok-profile-scraper": 0.003 };

const DONE = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];

// One run, waited for with Apify's own wait (up to 4 minutes), then its items. Every run is logged with its cost.
export async function runActor<T>(o: { auditId: string; actor: string; target: string; input: object; maxItems: number }): Promise<T[]> {
  const key = apifyKey();
  if (!key) throw new Error("No Apify key set.");
  const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const log = (ok: boolean, items: number | null, note: string | null) =>
    q(`insert into apify_runs (audit_id, actor, target, items, cost_usd, ok, note) values ($1, $2, $3, $4, $5, $6, $7)`,
      [o.auditId, o.actor, o.target, items, items != null ? items * (PRICE_PER_ITEM[o.actor] ?? 0) : null, ok, note?.slice(0, 300) ?? null]).catch(() => null);
  try {
    const start = await fetch(`https://api.apify.com/v2/acts/${o.actor}/runs?waitForFinish=60&maxItems=${o.maxItems}`, { method: "POST", headers: H, body: JSON.stringify(o.input) });
    if (!start.ok) throw new Error(`Apify said ${start.status}.`);
    let run = (await start.json()).data as { id: string; status: string; defaultDatasetId: string };
    for (let i = 0; i < 3 && !DONE.includes(run.status); i++) {
      run = (await (await fetch(`https://api.apify.com/v2/actor-runs/${run.id}?waitForFinish=60`, { headers: H })).json()).data;
    }
    if (run.status !== "SUCCEEDED") throw new Error(`The Apify run ended as ${run.status.toLowerCase()}.`);
    const items = (await (await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=${o.maxItems + 5}`, { headers: H })).json()) as T[];
    // Error items (a profile that doesn't exist) are free; only real results are charged.
    await log(true, items.filter((x) => !(x as { error?: string }).error).length, null);
    return items;
  } catch (e) {
    await log(false, null, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// What Apify cost on the latest run of one check.
export async function apifyCost(auditId: string) {
  const [r] = await q<{ runs: number; usd: number | null }>(
    `select count(*)::int runs, sum(c.cost_usd)::float8 usd from apify_runs c join audits a on a.id = c.audit_id
      where c.audit_id = $1 and c.made_at >= coalesce(a.started_at, a.created_at)`, [auditId]);
  return r;
}
