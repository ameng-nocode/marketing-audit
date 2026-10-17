import { askJson } from "../ai";
import { HOUSE } from "../ai-rules";
import { q } from "../db";
import { openAd, readResults, saveFound } from "./adlib";
import { nameKey, Skipped, type Ctx } from "./kit";

// Check 4: who else sells the same thing with ads right now, and how (skill step 5).

// What we know about the business so far, as plain lines for the AI.
export async function bizBrief(c: Ctx) {
  const facts = await q<{ key: string; label: string; value: string | null; note: string | null }>(
    `select key, label, value, note from facts where audit_id = $1 and key in ('website', 'facebook', 'newest_post', 'maps', 'instagram', 'tiktok') order by id`, [c.auditId]);
  const reels = await q<{ caption: string | null }>(`select caption from reels where audit_id = $1 and caption is not null order by position limit 4`, [c.auditId]);
  return [
    `Business: ${c.biz.name}`,
    `Facebook page: ${c.biz.facebook_url}`,
    c.biz.website ? `Website: ${c.biz.website}` : "No website given.",
    c.biz.description ? `What they sell (from the form): ${c.biz.description}` : "",
    ...facts.map((f) => `${f.label}: ${[f.value, f.note].filter(Boolean).join(". ")}`),
    ...reels.map((r) => `Reel caption: ${r.caption}`),
  ].filter(Boolean).join("\n");
}

type Words = { words: { word: string; lang: "Chinese" | "English" | "Malay"; why: string }[] };

export async function searchWords(c: Ctx) {
  const a = await askJson<Words>({
    auditId: c.auditId, task: "search-words", model: "sonnet", system: HOUSE,
    prompt: `${await bizBrief(c)}

Pick 3 or 4 words to search the Meta Ad Library (Malaysia, live ads) for their competitors: other businesses selling the same product or service.
- The product or service word, the way a Malaysian buyer would type it. One in Chinese, one in English, one in Malay; a 4th only if it clearly helps (for example the product plus "delivery" or the service plus the town).
- Short: 1 to 3 words each. No brand names, no "${c.biz.name}".
- "why" is one short line.`,
    schema: {
      type: "object",
      properties: {
        words: {
          type: "array", minItems: 2, maxItems: 4,
          items: { type: "object", properties: { word: { type: "string" }, lang: { type: "string", enum: ["Chinese", "English", "Malay"] }, why: { type: "string" } }, required: ["word", "lang", "why"] },
        },
      },
      required: ["words"],
    },
  });
  for (const w of a.words) await c.fact({ key: "search_word", label: w.lang, value: w.word.trim().slice(0, 60), note: w.why, status: "info" });
}

export async function competitorSearch(c: Ctx) {
  const words = await q<{ value: string }>(`select value from facts where audit_id = $1 and key = 'search_word' order by id`, [c.auditId]);
  if (!words.length) throw new Skipped("No search words.");
  const own = nameKey(c.biz.name);
  let pos = 1000;
  for (const { value: w } of words) {
    const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=MY&media_type=all&q=${encodeURIComponent(w)}&search_type=keyword_unordered`;
    const r = await readResults(c, url, 3);
    const shotId = await c.shot(`Ad Library search: ${w}`, { sourceUrl: url });
    const theirs = r.ads.filter((a) => !(own && nameKey(a.page ?? "").includes(own)));
    await c.fact({ key: "search", label: `Search: ${w}`, value: r.none ? "0 live ads" : r.count ? r.count.replace(/results?/, "live ads") : `${r.ads.length} live ads`, note: "Malaysia, live now.", status: r.none ? "none" : "info", sourceUrl: url, shotId });
    pos = await saveFound(c, theirs.slice(0, 40), { own: false, word: w, start: pos });
  }
}

type Pick = { picks: { library_id: string; reason: string; closest: boolean; sells_to: string; offer: string }[]; none_reason: string | null };

export async function competitorPick(c: Ctx) {
  await q(`update ads set picked = false, closest = false, pick_reason = null where audit_id = $1 and not own`, [c.auditId]);
  const ads = await q<{ library_id: string; page_name: string | null; started_on: string | null; versions: number | null; body: string | null; cta: string | null; search_word: string | null }>(
    `select library_id, page_name, to_char(started_on, 'YYYY-MM-DD') started_on, versions, body, cta, search_word from ads where audit_id = $1 and not own order by position`, [c.auditId]);
  if (!ads.length) throw new Skipped("The searches found no live ads.");
  const list = ads.map((a) => `- id ${a.library_id} | page: ${a.page_name ?? "?"} | since ${a.started_on ?? "?"} | ${a.versions ? `${a.versions} versions` : "1 version"} | button: ${a.cta ?? "none"} | word: ${a.search_word} | copy: ${(a.body ?? "").replace(/\s+/g, " ").slice(0, 220)}`).join("\n");
  const today = new Date().toISOString().slice(0, 10);
  const a = await askJson<Pick>({
    auditId: c.auditId, task: "competitor-pick", model: "sonnet", system: HOUSE,
    prompt: `${await bizBrief(c)}

Today is ${today}. These live ads came up in the Meta Ad Library searches (Malaysia):
${list}

Pick 4 to 6 real competitors: businesses selling the same product or service as ${c.biz.name}. Most search hits are unrelated (restaurants, games, other products); leave those out.
- One ad per business: its best example.
- Prefer the same area, ads running over 3 months (they usually work) and ads with many versions (they are testing).
- Mark exactly one as closest: the most similar business, ideally in the same area.
- reason: one short line on why it counts (same product, same area, running since when).
- sells_to: who the ad is for, in 2 to 4 words (Homes, Restaurants, Office workers ...).
- offer: the offer in the ad, in under 12 words, from the copy only.
If fewer than 4 are real competitors, pick only those. If none are, return no picks and say why in none_reason.`,
    schema: {
      type: "object",
      properties: {
        picks: {
          type: "array", maxItems: 6,
          items: { type: "object", properties: { library_id: { type: "string" }, reason: { type: "string" }, closest: { type: "boolean" }, sells_to: { type: "string" }, offer: { type: "string" } }, required: ["library_id", "reason", "closest", "sells_to", "offer"] },
        },
        none_reason: { type: ["string", "null"] },
      },
      required: ["picks", "none_reason"],
    },
  });
  const known = new Set(ads.map((x) => x.library_id));
  const picks = a.picks.filter((p) => known.has(p.library_id));
  if (!picks.length) {
    await c.fact({ key: "competitors", label: "Competitors advertising", value: "None found", note: a.none_reason, status: "none" });
    return;
  }
  if (!picks.some((p) => p.closest)) picks[0].closest = true;
  let closestSet = false;
  for (const p of picks) {
    const closest = p.closest && !closestSet;
    if (closest) closestSet = true;
    await q(`update ads set picked = true, closest = $3, pick_reason = $4, sells_to = $5, offer = $6 where audit_id = $1 and library_id = $2`,
      [c.auditId, p.library_id, closest, p.reason, p.sells_to, p.offer]);
  }
  await c.fact({ key: "competitors", label: "Competitors advertising", value: `${picks.length} picked`, note: "Picked by the AI from the searches: same product, then same area, long-running and many versions first.", status: "info" });
}

export async function competitorAds(c: Ctx) {
  const rows = await q<{ id: string; library_id: string; page_name: string | null }>(
    `select id::text, library_id, page_name from ads where audit_id = $1 and picked order by closest desc, position`, [c.auditId]);
  if (!rows.length) throw new Skipped("No competitors picked.");
  for (const a of rows) await openAd(c, a, { followers: true });
}
