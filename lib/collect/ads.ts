import path from "node:path";
import { askJson } from "../ai";
import { HOUSE } from "../ai-rules";
import { uploadsDir } from "../checks";
import { q } from "../db";
import { openAd, readResults, saveFound } from "./adlib";
import { NotChecked, Skipped, type Ctx } from "./kit";

// Check 3: their own live ads (opened like competitor ads) and the Ads Manager screenshots.

export async function ownAds(c: Ctx) {
  const [b] = await q<{ facebook_page_id: string | null }>(`select facebook_page_id from businesses where facebook_url = $1`, [c.biz.facebook_url]);
  if (!b?.facebook_page_id) throw new NotChecked("Couldn't find the Facebook page ID.");
  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&media_type=all&search_type=page&view_all_page_id=${b.facebook_page_id}`;
  const r = await readResults(c, url, 2);
  if (r.none || !r.ads.length) throw new Skipped("No live ads right now.");
  const shotId = await c.shot(`Their live ads: ${r.count ?? r.ads.length}`, { sourceUrl: url });
  await c.fact({ key: "own_live", label: "Live ads now", value: r.count ? r.count.replace(/results?/, "ads") : `${r.ads.length} ads`, note: "All countries, live now.", status: "ok", sourceUrl: url, shotId });
  // Different copy first: 4 ads that say different things tell more than 4 copies of one.
  const seen = new Set<string>();
  const distinct = r.ads.filter((a) => { const k = (a.text ?? a.id).slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; });
  await saveFound(c, distinct.slice(0, 8), { own: true, start: 0 });
  const rows = await q<{ id: string; library_id: string; page_name: string | null }>(
    `select id::text, library_id, page_name from ads where audit_id = $1 and own order by position limit 4`, [c.auditId]);
  for (const a of rows) await openAd(c, a);
}

type AmRow = { screenshot: number; campaign: string; kind: string; delivery: string | null; spent: number | null; spent_text: string | null; results: string | null; result_count: number | null; result_type: string; cost_per_result: string | null; roas: number | null; read: string };
type AmAnswer = { rows: AmRow[]; currency: string | null; date_range: string | null; note: string | null };

const AM_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          screenshot: { type: "integer", description: "Which picture (1, 2, 3 ...) this row is in" },
          campaign: { type: "string" },
          kind: { type: "string", enum: ["sales", "leads", "traffic", "engagement", "hiring", "other"] },
          delivery: { type: ["string", "null"], description: "Active, Off, Completed, Learning ... as shown" },
          spent: { type: ["number", "null"], description: "Amount spent as a plain number, no currency" },
          spent_text: { type: ["string", "null"], description: "Amount spent exactly as shown" },
          results: { type: ["string", "null"], description: "Results exactly as shown, with the result type" },
          result_count: { type: ["number", "null"] },
          result_type: { type: "string", enum: ["chat", "lead", "purchase", "click", "other"], description: "What one result is" },
          cost_per_result: { type: ["string", "null"], description: "As shown" },
          roas: { type: ["number", "null"], description: "Purchase ROAS as a plain number (3.2 for 3.2x), only when the row shows it" },
          read: { type: "string", enum: ["Works", "Middle", "Costly", "No result", "Just started", "Not for customers"] },
        },
        required: ["screenshot", "campaign", "kind", "delivery", "spent", "spent_text", "results", "result_count", "result_type", "cost_per_result", "roas", "read"],
      },
    },
    currency: { type: ["string", "null"] },
    date_range: { type: ["string", "null"], description: "The date range shown in Ads Manager, as shown" },
    note: { type: ["string", "null"], description: "One plain sentence about anything you could not read" },
  },
  required: ["rows", "currency", "date_range", "note"],
};

export async function adsManager(c: Ctx) {
  const ups = await q<{ id: string; file: string }>(`select id::text, file from uploads where audit_id = $1 and kind = 'ads_manager' order by id`, [c.auditId]);
  if (!ups.length) throw new Skipped("No Ads Manager screenshots were added.");
  await q(`delete from ads_manager_rows where audit_id = $1`, [c.auditId]);
  const files = ups.map((u) => path.join(uploadsDir(), u.file));
  const a = await askJson<AmAnswer>({
    auditId: c.auditId, task: "ads-manager", model: "sonnet", images: files,
    system: HOUSE,
    prompt: `These are ${files.length} screenshots from the Meta Ads Manager of "${c.biz.name}". Open each picture in order (picture 1 is the first path).
Read every campaign, ad set or ad row you can see into the table. Use only rows you can actually read. If the same row shows in two pictures, list it once.
For "read":
- Works: results at a cost that looks fine next to the other rows.
- Middle: some results, cost in the middle.
- Costly: results, but much dearer than the other rows.
- No result: money spent, no results, and it ran more than 2 days.
- Just started: 1 to 2 days old or still learning. Never call a brand-new campaign "No result".
- Not for customers: hiring, page likes or engagement only.
Kind: sales means messages, purchases or leads that can turn into orders. Hiring and engagement are separate.
Result type, what one result is:
- chat: messaging conversations started (WhatsApp, Messenger, Instagram Direct)
- lead: lead forms, leads, registrations
- purchase: website purchases or checkouts
- click: link clicks or landing page views
- other: reach, likes, video views, anything else
ROAS: only when a ROAS column is in the picture. Never work it out yourself.`,
    schema: AM_SCHEMA,
  });
  for (const [i, r] of a.rows.entries()) {
    const up = ups[Math.min(Math.max(r.screenshot, 1), ups.length) - 1];
    await q(
      `insert into ads_manager_rows (audit_id, upload_id, campaign, kind, delivery, spent, spent_text, results, result_count, result_type, cost_per_result, roas, read, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [c.auditId, up.id, r.campaign.slice(0, 200), r.kind, r.delivery, r.spent, r.spent_text, r.results, r.result_count, r.result_type, r.cost_per_result, r.roas, r.read, i],
    );
  }
  const spent = a.rows.reduce((s, r) => s + (r.spent ?? 0), 0);
  await c.fact({
    key: "ads_manager", label: "Ads Manager screenshots",
    value: a.rows.length ? `${a.rows.length} rows read` : "No rows readable",
    note: [spent ? `Spend in the visible rows: ${a.currency ?? ""} ${spent.toLocaleString("en-US")}.`.replace("  ", " ") : "", a.date_range ? `Dates: ${a.date_range}.` : "", a.note ?? ""].filter(Boolean).join(" ") || null,
    status: a.rows.length ? "info" : "weak",
  });
}
