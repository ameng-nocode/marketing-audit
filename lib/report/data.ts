import { one, q } from "../db";

// Everything one check collected, in one object: what the AI writer reads and what the report page shows.

export type RFact = { id: string; check_no: number; key: string; label: string; value: string | null; note: string | null; status: string; source_url: string | null; shot_id: string | null };
export type RShot = { id: string; kind: string; caption: string; source_url: string | null; check_no: number | null; step_key: string | null };
export type RReel = { id: string; reel_id: string; url: string; views: number | null; views_text: string | null; posted_on: string | null; caption: string | null; frames_shot_id: string | null; thumb_shot_id: string | null };
export type RAd = {
  id: string; own: boolean; library_id: string; page_name: string | null; started_on: string | null; versions: number | null; body: string | null; cta: string | null;
  search_word: string | null; picked: boolean; closest: boolean; pick_reason: string | null; sells_to: string | null; offer: string | null; funnel: string | null;
  opened: boolean; format: string | null; video_seconds: number | null; full_text: string | null; landing_url: string | null; page_url: string | null; followers: string | null;
  shot_id: string | null; frames_shot_id: string | null; creative_shot_id: string | null;
};
export type RHook = { id: string; ad_id: string | null; reel_id: string | null; own: boolean; frames_shot_id: string | null; shows: string | null; rating: string; why: string | null; fix: string | null };
export type RLanding = {
  id: string; own: boolean; ad_id: string | null; label: string; url: string; http_status: number | null; headline: string | null; headline_words: number | null; buttons_above: string | null;
  platform: string | null; has_meta: boolean | null; has_ga: boolean | null; has_whatsapp: boolean | null; page_text: string | null; desktop_shot_id: string | null; mobile_shot_id: string | null;
  checks: { item: string; result: string; note: string | null }[];
};
export type RAmRow = {
  id: string; upload_id: string | null; campaign: string; kind: string; delivery: string | null; spent: number | null; spent_text: string | null; results: string | null;
  result_count: number | null; result_type: string | null; cost_per_result: string | null; roas: number | null; read: string | null;
};
export type RStep = { key: string; check_no: number; label: string; status: string; note: string | null };
export type RTikTok = { handle: string; url: string; views: number | null; likes: number | null; posted_on: string | null; caption: string | null; seconds: number | null; thumb_shot_id: string | null };
export type RFunnel = { letter: string; name: string; note: string | null; steps: string[] };

export type ReportData = NonNullable<Awaited<ReturnType<typeof loadReportData>>>;

// lang picks the funnel names and steps (the 中文 writer makes its own; English when there are none yet).
export async function loadReportData(auditId: string, lang: "en" | "zh" = "en") {
  const biz = await one<{
    name: string; facebook_url: string; website: string | null; description: string | null; running_ads: string; created_at: string; started_at: string | null; finished_at: string | null;
    price_low: number | null; price_high: number | null; price_unit: string | null; profit_rm: number | null; profit_pct: number | null;
  }>(
    `select b.name, b.facebook_url, b.website, a.description, a.running_ads, a.created_at, a.started_at, a.finished_at,
            a.price_low::float8 price_low, a.price_high::float8 price_high, a.price_unit, a.profit_rm::float8 profit_rm, a.profit_pct::float8 profit_pct
       from audits a join businesses b on b.id = a.business_id where a.id = $1`, [auditId]);
  if (!biz) return null;
  const facts = await q<RFact>(`select id::text, check_no, key, label, value, note, status, source_url, shot_id::text from facts where audit_id = $1 order by check_no, id`, [auditId]);
  const shots = await q<RShot>(
    `select sh.id::text, sh.kind, sh.caption, sh.source_url, st.check_no, st.key as step_key from shots sh left join audit_steps st on st.id = sh.step_id where sh.audit_id = $1 order by sh.id`, [auditId]);
  const reels = await q<RReel>(`select id::text, reel_id, url, views, views_text, to_char(posted_on, 'YYYY-MM-DD') posted_on, caption, frames_shot_id::text, thumb_shot_id::text from reels where audit_id = $1 order by position`, [auditId]);
  const ads = await q<RAd>(
    `select id::text, own, library_id, page_name, to_char(started_on, 'YYYY-MM-DD') started_on, versions, body, cta, search_word, picked, closest, pick_reason, sells_to, offer, funnel,
            opened, format, video_seconds::float8 video_seconds, full_text, landing_url, page_url, followers, shot_id::text, frames_shot_id::text, creative_shot_id::text
       from ads where audit_id = $1 and (own or picked) order by own desc, closest desc, position`, [auditId]);
  const hooks = await q<RHook>(`select id::text, ad_id::text, reel_id::text, own, frames_shot_id::text, shows, rating, why, fix from hooks where audit_id = $1 order by position`, [auditId]);
  const landingRows = await q<Omit<RLanding, "checks">>(
    `select id::text, own, ad_id::text, label, url, http_status, headline, headline_words, buttons_above, platform, has_meta, has_ga, has_whatsapp, page_text, desktop_shot_id::text, mobile_shot_id::text
       from landings where audit_id = $1 order by position`, [auditId]);
  const checks = await q<{ landing_id: string; item: string; result: string; note: string | null }>(
    `select landing_id::text, item, result, note from landing_checks where landing_id in (select id from landings where audit_id = $1) order by position`, [auditId]);
  const landings: RLanding[] = landingRows.map((l) => ({ ...l, checks: checks.filter((c) => c.landing_id === l.id) }));
  const amRows = await q<RAmRow>(
    `select id::text, upload_id::text, campaign, kind, delivery, spent::float8 spent, spent_text, results, result_count::float8 result_count, result_type, cost_per_result, roas::float8 roas, read
       from ads_manager_rows where audit_id = $1 order by position`, [auditId]);
  const uploads = await q<{ id: string; original_name: string }>(`select id::text, original_name from uploads where audit_id = $1 order by id`, [auditId]);
  const steps = await q<RStep>(`select key, check_no, label, status, note from audit_steps where audit_id = $1 order by position`, [auditId]);
  const fq = (l: string) => q<{ id: string; letter: string; name: string; note: string | null }>(`select id::text, letter, name, note from funnels where audit_id = $1 and lang = $2 order by position`, [auditId, l]);
  let funnelRows = await fq(lang);
  if (!funnelRows.length && lang !== "en") funnelRows = await fq("en");
  const fsteps = await q<{ funnel_id: string; label: string }>(`select funnel_id::text, label from funnel_steps where funnel_id in (select id from funnels where audit_id = $1) order by position`, [auditId]);
  const funnels: RFunnel[] = funnelRows.map((f) => ({ letter: f.letter, name: f.name, note: f.note, steps: fsteps.filter((s) => s.funnel_id === f.id).map((s) => s.label) }));
  const tiktok = await q<RTikTok>(
    `select handle, url, views, likes, to_char(posted_on, 'YYYY-MM-DD') posted_on, caption, seconds, thumb_shot_id::text from tiktok_videos where audit_id = $1 order by handle, position`, [auditId]);
  const logo = shots.filter((s) => s.kind === "logo").pop() ?? null;
  return { auditId, biz, facts, shots, reels, ads, hooks, landings, amRows, uploads, steps, funnels, tiktok, logoId: logo?.id ?? null };
}

// Reels posted per month, for the 7 months up to the check date (skill step 6b), so a stop in posting shows as empty months.
export function reelMonths(reels: { posted_on: string | null }[], today: string, n = 7) {
  const days = reels.map((r) => r.posted_on).filter((d): d is string => !!d).sort();
  if (!days.length) return [];
  let y = +today.slice(0, 4);
  let m = +today.slice(5, 7);
  const out: { ym: string; label: string; count: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    out.unshift({ ym, label: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), count: days.filter((d) => d.startsWith(ym)).length });
    m--;
    if (m === 0) { m = 12; y--; }
  }
  // Start at the first month that has a Reel, so the chart doesn't open on empty months from before they posted.
  const first = out.findIndex((x) => x.count > 0);
  return out.slice(Math.max(0, Math.min(first, out.length - 3)));
}
