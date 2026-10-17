import { askJson } from "../ai";
import { HOUSE } from "../ai-rules";
import { q, tx } from "../db";
import { leadsTo } from "../collect/adlib";
import { Skipped, type Ctx } from "../collect/kit";
import { loadReportData, reelMonths, type ReportData } from "./data";
import { moneyBrief, moneyOf } from "./money";
import { priceText, profitText } from "../format";
import { consultant, Consultant } from "../settings";

// Check 7, step 1: the AI writes the words of the report. Code already has every number;
// the AI may only repeat numbers that are in the data below (the text check flags any other).

const ST = { type: "string", enum: ["ok", "weak", "none", "info"] };
// The ad formats the "What to try" section picks from, in plain names (casual, phone-shot, by their own team).
export const FORMATS = [
  "A real customer talking (UGC)",
  "Before and after story",
  "A day in the life",
  "Problem, fix, offer",
  "Product demo",
  "Behind the scenes",
  "The owner talking",
];
const GL = { type: "object", properties: { status: ST, word: { type: "string" }, finding: { type: "string" } }, required: ["status", "word", "finding"] };
const LP = { type: "object", properties: { lead: { type: "string" }, points: { type: "array", items: { type: "string" } } }, required: ["lead", "points"] };

export const WRITE_SCHEMA = {
  type: "object",
  properties: {
    company_line: { type: "string", description: "What they sell and where, under 10 words" },
    verdict: { type: "string" },
    glance: { type: "object", properties: { channels: GL, content: GL, ads: GL, competitors: GL, cta: GL, creative: GL }, required: ["channels", "content", "ads", "competitors", "cta", "creative"] },
    channels: LP,
    content: LP,
    ads: LP,
    money: {
      type: "object",
      properties: { verdict: { type: ["string", "null"] }, insights: { type: "array", maxItems: 4, items: { type: "string" } } },
      required: ["verdict", "insights"],
    },
    competitors: { type: "object", properties: { lead: { type: "string" } }, required: ["lead"] },
    funnels: {
      type: "array", maxItems: 4,
      items: {
        type: "object",
        properties: { letter: { type: "string" }, name: { type: "string" }, steps: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 }, note: { type: "string" }, library_ids: { type: "array", items: { type: "string" } } },
        required: ["letter", "name", "steps", "note", "library_ids"],
      },
    },
    ad_labels: { type: "array", items: { type: "object", properties: { library_id: { type: "string" }, label: { type: "string" } }, required: ["library_id", "label"] } },
    cta: {
      type: "object",
      properties: {
        lead: { type: "string" },
        buy_steps: { type: "array", maxItems: 6, items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" } }, required: ["title", "detail"] } },
        other_ways: { type: "string" },
        broken: { type: "array", maxItems: 8, items: { type: "object", properties: { item: { type: "string" }, word: { type: "string" }, status: { type: "string", enum: ["none", "weak"] } }, required: ["item", "word", "status"] } },
        compare_with: { type: ["string", "null"] },
        compare: {
          type: "array", maxItems: 8,
          items: { type: "object", properties: { row: { type: "string" }, theirs: { type: "string" }, rival: { type: "string" }, theirs_ok: { type: ["boolean", "null"] }, rival_ok: { type: ["boolean", "null"] } }, required: ["row", "theirs", "rival", "theirs_ok", "rival_ok"] },
        },
      },
      required: ["lead", "buy_steps", "other_ways", "broken", "compare_with", "compare"],
    },
    landing: { type: "object", properties: { lead: { type: ["string", "null"] } }, required: ["lead"] },
    creative: {
      type: "object",
      properties: {
        lead: { type: "string" },
        hooks_lead: { type: ["string", "null"] },
        decisions: { type: "object", properties: { who: { type: "string" }, point: { type: "string" }, first3: { type: "string" }, action: { type: "string" } }, required: ["who", "point", "first3", "action"] },
      },
      required: ["lead", "hooks_lead", "decisions"],
    },
    plan: {
      type: "object",
      properties: {
        lead: { type: "string" },
        steps: { type: "array", minItems: 3, maxItems: 8, items: { type: "object", properties: { phase: { type: "string" }, title: { type: "string" }, body: { type: "string" }, first: { type: "boolean" } }, required: ["phase", "title", "body", "first"] } },
      },
      required: ["lead", "steps"],
    },
    try: {
      type: "object",
      properties: {
        lead: { type: "string" },
        offer: { type: "object", properties: { now: { type: "string" }, verdict: { type: "string", enum: ["ok", "weak", "none"] }, why: { type: "string" }, try: { type: "string" } }, required: ["now", "verdict", "why", "try"] },
        messages: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", properties: { now: { type: "string" }, from: { type: "string" }, better: { type: "string" } }, required: ["now", "from", "better"] } },
        mechanism: { type: ["object", "null"], properties: { line: { type: "string" }, from: { type: "string" } }, required: ["line", "from"] },
        formats: {
          type: "array", minItems: 3, maxItems: 4,
          items: {
            type: "object",
            properties: {
              name: { type: "string", enum: FORMATS },
              why: { type: "string" }, first3: { type: "string" }, end: { type: "string" },
              seen_in: { type: ["string", "null"], description: "library_id of a picked ad that already uses this format, or null" },
            },
            required: ["name", "why", "first3", "end", "seen_in"],
          },
        },
        order: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", properties: { name: { type: "string", enum: FORMATS }, why: { type: "string" } }, required: ["name", "why"] } },
      },
      required: ["lead", "offer", "messages", "mechanism", "formats", "order"],
    },
    questions: { type: "array", minItems: 5, maxItems: 5, items: { type: "string" } },
    not_checked: { type: "array", items: { type: "string" } },
  },
  required: ["company_line", "verdict", "glance", "channels", "content", "ads", "money", "competitors", "funnels", "ad_labels", "cta", "landing", "creative", "try", "plan", "questions", "not_checked"],
};

export type Written = {
  company_line: string;
  verdict: string;
  glance: Record<"channels" | "content" | "ads" | "competitors" | "cta" | "creative", { status: string; word: string; finding: string }>;
  channels: { lead: string; points: string[] };
  content: { lead: string; points: string[] };
  ads: { lead: string; points: string[] };
  money: { verdict: string | null; insights: string[] };
  competitors: { lead: string };
  funnels: { letter: string; name: string; steps: string[]; note: string; library_ids: string[] }[];
  ad_labels: { library_id: string; label: string }[];
  cta: { lead: string; buy_steps: { title: string; detail: string }[]; other_ways: string; broken: { item: string; word: string; status: string }[]; compare_with: string | null; compare: { row: string; theirs: string; rival: string; theirs_ok: boolean | null; rival_ok: boolean | null }[] };
  landing: { lead: string | null };
  creative: { lead: string; hooks_lead: string | null; decisions: { who: string; point: string; first3: string; action: string } };
  try: {
    lead: string;
    offer: { now: string; verdict: string; why: string; try: string };
    messages: { now: string; from: string; better: string }[];
    mechanism: { line: string; from: string } | null;
    formats: { name: string; why: string; first3: string; end: string; seen_in: string | null }[];
    order: { name: string; why: string }[];
  };
  plan: { lead: string; steps: { phase: string; title: string; body: string; first: boolean }[] };
  questions: string[];
  not_checked: string[];
};

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
// Messenger and WhatsApp ads are named as such, never as the Ad Library's placeholder link.
const goesTo = (a: { landing_url: string | null; cta: string | null; opened: boolean }) => {
  const where = leadsTo(a.landing_url, a.cta);
  if (!where) return a.opened ? "no link shown" : "not opened";
  if (["Messenger", "WhatsApp", "Instagram", "Facebook"].includes(where)) return `${where} (a chat or page, not a website)`;
  return a.landing_url!;
};

// The collected data as plain text, the only source the writer may use.
export function brief(d: ReportData, today: string) {
  const f = (n: number) => d.facts.filter((x) => x.check_no === n).map((x) => `- ${x.label}: ${[x.value, x.note].filter(Boolean).join(". ")} [${x.status}]`).join("\n") || "- nothing collected";
  const ad = (a: ReportData["ads"][number]) =>
    `- library_id ${a.library_id}${a.opened ? " (opened)" : " (search list only)"} | ${a.page_name ?? "?"} | since ${a.started_on ?? "?"} | ${a.versions ? `${a.versions} versions` : "1 version"} | ${a.format ?? "?"}${a.video_seconds ? ` ${a.video_seconds}s` : ""} | button: ${a.cta ?? "not read"} | goes to: ${goesTo(a)}${a.followers ? ` | FB followers ${a.followers}` : ""}${a.offer ? ` | offer: ${a.offer}` : ""}${a.sells_to ? ` | sells to: ${a.sells_to}` : ""}${a.closest ? " | CLOSEST" : ""}${a.pick_reason ? ` | why picked: ${a.pick_reason}` : ""}\n  copy: ${clip(a.full_text ?? a.body, 400)}`;
  const own = d.ads.filter((a) => a.own);
  const rivals = d.ads.filter((a) => !a.own);
  const months = reelMonths([...d.reels, ...d.tiktok], today);
  const notDone = d.steps.filter((s) => s.status === "not_checked" || s.status === "failed").map((s) => `- ${s.label}: ${s.status === "failed" ? "failed" : "not checked"}. ${s.note ?? ""}`);
  const hookLine = (h: ReportData["hooks"][number]) => {
    const a = h.ad_id ? d.ads.find((x) => x.id === h.ad_id) : null;
    return `- ${h.own ? "THEIR" : "COMPETITOR"} ${h.reel_id ? "Reel" : `ad (${a?.page_name ?? "?"})`}: ${h.rating}. Shows: ${h.shows}. Why: ${h.why}. Fix: ${h.fix}`;
  };
  return `Business: ${d.biz.name}
Facebook: ${d.biz.facebook_url}
Website: ${d.biz.website ?? "none given"}
What they sell (from the form): ${d.biz.description ?? "not given"}
Price (from the form): ${priceText(d.biz.price_low, d.biz.price_high, d.biz.price_unit) || "not sure"}
Profit per sale (from the form): ${profitText(d.biz.profit_rm, d.biz.profit_pct) || "not sure"}
Running ads (from the form): ${d.biz.running_ads}
Checked on: ${today} (Malaysia time), logged out.

CHECK 1 CHANNELS
${f(1)}

CHECK 2 OWN CONTENT
${f(2)}
Newest TikTok videos (read through Apify, newest first): ${d.tiktok.map((t) => `@${t.handle} ${t.views ?? "?"} views${t.posted_on ? ` on ${t.posted_on}` : ""}${t.caption ? ` "${clip(t.caption, 60)}"` : ""}`).join("; ") || "none read"}
Newest Reels (newest first): ${d.reels.map((r) => `${r.views_text ?? "?"} views${r.posted_on ? ` on ${r.posted_on}` : ""}${r.caption ? ` "${clip(r.caption, 80)}"` : ""}`).join("; ") || "none"}

CHECK 3 ADS
${f(3)}
Their live ads:
${own.map(ad).join("\n") || "- none"}
Ads Manager rows read from their screenshots, as shown:
${d.amRows.map((r) => `- ${r.campaign} | ${r.kind} | ${r.delivery ?? ""} | spent ${r.spent_text ?? r.spent ?? "?"} | results ${r.results ?? "?"} | cost per result ${r.cost_per_result ?? "?"}${r.roas ? ` | ROAS ${r.roas}` : ""} | read: ${r.read}`).join("\n") || "- none"}
The ad money, worked out by the code from their price, profit and these rows:
${moneyBrief(moneyOf(d))}

CHECK 4 COMPETITORS
${f(4)}
Competitor ads picked (one per business):
${rivals.map(ad).join("\n") || "- none"}

CHECK 5 CALL TO ACTION
${f(5)}
Landing pages, first screen:
${d.landings.map((l) => `- ${l.label} (${l.url}): headline "${l.headline ?? "none"}" (${l.headline_words ?? "?"} words) | buttons on first screen: ${l.buttons_above ?? "none"} | Meta pixel ${l.has_meta ? "yes" : "no"} | Google ${l.has_ga ? "yes" : "no"} | WhatsApp ${l.has_whatsapp ? "yes" : "no"}${l.platform ? ` | ${l.platform}` : ""}
  checklist: ${l.checks.map((c) => `${c.item}: ${c.result} (${c.note ?? ""})`).join(" | ") || "not judged"}`).join("\n") || "- none"}
Text from their website (home, then contact, delivery and FAQ pages):
${clip(d.landings.find((l) => l.own)?.page_text, 5000) || "none"}

CHECK 6 CREATIVE
Reels and TikTok videos per month (from their post dates): ${months.map((m) => `${m.label} ${m.count}`).join(", ") || "no dates"}
Hooks (first 3 seconds):
${d.hooks.map(hookLine).join("\n") || "- none judged"}

NOT CHECKED OR FAILED
${notDone.join("\n") || "- nothing"}`;
}

export async function writeReport(c: Ctx) {
  const d = await loadReportData(c.auditId);
  if (!d) throw new Skipped("The check is gone.");
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const data = brief(d, today);
  const w = await askJson<Written>({
    auditId: c.auditId, task: "write-report", model: "opus", system: HOUSE, timeoutMs: 600000,
    prompt: `Write the words for the marketing audit report of ${d.biz.name}. The reader is ${consultant()}, before the call with the owner.

THE DATA (the only source you may use):
${data}

HOW TO WRITE
- Every section opens with one lead sentence that says the main finding. Wrap the 1 or 2 most important phrases in **double stars** (they become bold).
- points: 2 to 4 short lines, each starting with a **bold** phrase. Only findings from the data.
- Numbers: only numbers that appear in the data. Never round or add them up yourself, except counting items in a list. When you compare, quote the real numbers or the real range from the data ("183 to 579 views"), never a rounded line like "under 600" or "over 1,000".
- "button: not read" means the code could not read the ad's button: never say the ad has no button. "Messenger (a chat or page, not a website)" is a normal click-to-message ad, not a broken link.
- Only ads marked "opened" were looked at one by one. The rest come from the search list.
- An Instagram or TikTok account marked "the name was guessed" may belong to someone else. Call it theirs only if its name or bio clearly matches the business. Otherwise say it looks like someone else's account, and don't count it as theirs.
- status per area: ok (fine), weak (a problem to fix), none (missing), info (neutral, e.g. competitors advertising). word: 1 to 3 words like Weak, Low reach, None, Gaps, No rhythm, Advertising, Good.
- glance finding: one sentence, under 20 words, may use **bold**.
- verdict: 1 or 2 sentences for the cover: what they have, what is missing, and the most urgent gap. The most urgent gap is something broken or missing in their own setup (from the data), never just a difference from what competitors do.
- funnels: the ways competitors (and they, if they run ads) sell through ads. Letters A, B, C. A = offer to online store, B = video to chat or WhatsApp order, C = supply offer to businesses then WhatsApp price. A new pattern gets the next letter and a plain name. steps = 3 to 5 short boxes. library_ids = which picked ads use it. Skip funnels if no ads were picked.
- money (block "Is the ad money working?", only when there are Ads Manager numbers, else verdict null and no insights). The code already shows their funnel steps, the break-even line and the questions for the owner, so don't repeat those.
  - verdict: one plain sentence: do the ads pay or not, or what is still unknown. Use only the worked-out numbers.
  - insights: 2 to 4 lines, one per thing that is true in the worked-out numbers: money in rows read Costly or No result, cheapest vs dearest campaign (say where to move the money), money on likes, views or clicks when the sale happens in chat, lead form or checkout, and whether their funnel fits the price (a high price usually sells through a chat or a call first, a low price can go straight to checkout). Each line starts with a **bold** phrase. Never just repeat a row ("spent RM100 on campaign X"): say what it means and what to do.
- ad_labels: for each competitor ad, a small grey label of 2 to 4 words (Closest competitor, Running 14 months, Same area, Wholesale).
- cta.buy_steps: how a customer buys today, from the website text and the Facebook button. If there's no website, the steps through Facebook or WhatsApp. cta.other_ways: one sentence on other ways in.
- cta.broken: broken or missing things that cost sales (no WhatsApp, no tracking, no reviews, stale pages, headline too long, dead app links). word = Missing, 404, Dead, Weak, Too long ... Dead links on their homepage are listed by the code already: don't repeat them one by one (one line like "2 dead links on the homepage" is fine).
- cta.compare: their business next to the closest competitor, only rows with a fact on both sides. compare_with = the competitor's name, or null if there is none.
- landing.lead: 1 or 2 sentences on the first screen of their landing page next to the competitor's (headline length, button, offer, proof). null if no landing pages.
- creative.lead: about the Reels per month and gaps. creative.hooks_lead: one sentence on how their first 3 seconds compare with the competitors', or null if none were judged. decisions: one line each for this business: who it's for, one selling point, first 3 seconds, what to do next. Format ideas go in "try", not here.
- try (section "What to try", shown to the owner, so plain and short, one line per item):
  - lead: one sentence on the biggest idea to test.
  - offer.now: their offer today in under 15 words, from their ads or website. verdict: ok, weak or none (none = no clear offer). why: one short line. offer.try: one simpler, stronger offer shape to test, under 15 words. Use only prices and numbers that are in the data. If you need a new price, describe it without a number ("one starter set at one clear price").
  - messages: 2 or 3 of their own lines, "now" quoted exactly as written (from their ads, Reels or website), "from" = where it came from (Ad, Reel, Website headline). "better" = the same idea said as the change in the customer's life, not the feature, under 12 words, words a customer would say.
  - mechanism: one line that explains why their product works, built only from facts in their own words (how it is made, what is in it). from = where those words came from. null if the data has none.
  - formats: 3 or 4 ad formats that fit this business, from the list. All are phone-shot, casual and real, made by their own team. why: one line tied to a finding (their footage, a competitor's ad, their offer). first3: what the first 3 seconds show and say. end: what the video says at the end (the button or the WhatsApp line). seen_in: the library_id of a picked competitor ad that already uses this format, or null.
  - order: the 3 formats to test first, one per week, each with one short reason.
- plan.steps: fix first (broken basics, tracking, page clean-up, with first = true), then "Start now: Set up a weekly creative routine", then Test 1 and Test 2 with the cheapest funnel already working for competitors (phase like "Test 1 · Type B"), then conditional ones ("If wholesale · Type C"). Each body ties to a finding. The business's team does the work. ${Consultant()} gives direction and training.
- questions: exactly 5 questions for the owner (sales split, orders per month, who makes content and how often they can shoot, which page is main and who has admin, monthly ad budget, adjusted to this business).
- not_checked: what this check could not see (from the NOT CHECKED list, plus 小红书, YouTube, Google Ads, Shopee or Lazada if relevant, full post history that needs a login).`,
    schema: WRITE_SCHEMA,
  });
  await saveWritten(c.auditId, w, d);
  return { written: w, data };
}

// The writer's words go into texts (one row per piece), funnels and the ads they name.
// lang en replaces everything (the 中文 words were made from the old English, so they go too). lang zh replaces only the 中文.
export async function saveWritten(auditId: string, w: Written, d: ReportData, lang: "en" | "zh" = "en") {
  const rows: [string, string, number, string][] = [];
  const add = (section: string, key: string, body: string | null | undefined, pos = 0) => { if (body != null && String(body).trim()) rows.push([section, key, pos, String(body)]); };
  add("cover", "company_line", w.company_line);
  add("cover", "verdict", w.verdict);
  for (const [k, g] of Object.entries(w.glance)) { add("glance", `${k}.status`, g.status); add("glance", `${k}.word`, g.word); add("glance", `${k}.finding`, g.finding); }
  for (const s of ["channels", "content", "ads"] as const) { add(s, "lead", w[s].lead); w[s].points.forEach((p, i) => add(s, "point", p, i)); }
  add("money", "verdict", w.money?.verdict);
  (w.money?.insights ?? []).forEach((x, i) => add("money", "insight", x, i));
  add("competitors", "lead", w.competitors.lead);
  add("cta", "lead", w.cta.lead);
  w.cta.buy_steps.forEach((b, i) => { add("cta", "buy.title", b.title, i); add("cta", "buy.detail", b.detail, i); });
  add("cta", "other_ways", w.cta.other_ways);
  w.cta.broken.forEach((b, i) => { add("cta", "broken.item", b.item, i); add("cta", "broken.word", b.word, i); add("cta", "broken.status", b.status, i); });
  add("cta", "compare_with", w.cta.compare_with);
  w.cta.compare.forEach((r, i) => {
    add("cta", "compare.row", r.row, i); add("cta", "compare.theirs", r.theirs, i); add("cta", "compare.rival", r.rival, i);
    add("cta", "compare.theirs_ok", r.theirs_ok == null ? "" : String(r.theirs_ok), i); add("cta", "compare.rival_ok", r.rival_ok == null ? "" : String(r.rival_ok), i);
  });
  add("landing", "lead", w.landing.lead);
  add("creative", "lead", w.creative.lead);
  add("creative", "hooks_lead", w.creative.hooks_lead);
  for (const [k, v] of Object.entries(w.creative.decisions)) add("creative", `decision.${k}`, v);
  add("plan", "lead", w.plan.lead);
  w.plan.steps.forEach((s, i) => { add("plan", "phase", s.phase, i); add("plan", "title", s.title, i); add("plan", "body", s.body, i); add("plan", "first", String(s.first), i); });
  add("try", "lead", w.try.lead);
  add("try", "offer.now", w.try.offer.now); add("try", "offer.verdict", w.try.offer.verdict); add("try", "offer.why", w.try.offer.why); add("try", "offer.try", w.try.offer.try);
  w.try.messages.forEach((m, i) => { add("try", "msg.now", m.now, i); add("try", "msg.from", m.from, i); add("try", "msg.better", m.better, i); });
  if (w.try.mechanism) { add("try", "mech.line", w.try.mechanism.line); add("try", "mech.from", w.try.mechanism.from); }
  w.try.formats.forEach((f, i) => { add("try", "fmt.name", f.name, i); add("try", "fmt.why", f.why, i); add("try", "fmt.first3", f.first3, i); add("try", "fmt.end", f.end, i); add("try", "fmt.seen", f.seen_in, i); });
  w.try.order.forEach((o, i) => { add("try", "order.name", o.name, i); add("try", "order.why", o.why, i); });
  w.questions.forEach((x, i) => add("plan", "question", x, i));
  w.not_checked.forEach((x, i) => add("plan", "not_checked", x, i));
  for (const l of w.ad_labels) add("ad_label", l.library_id, l.label);

  const keepAsWritten = new Set(["msg.now"]); // their own quoted lines stay exactly as they wrote them
  const zh = (x: string) => (lang === "zh" ? zhPunct(x) : x);
  await tx(async (t) => {
    if (lang === "en") {
      await t(`delete from texts where audit_id = $1`, [auditId]);
      await t(`delete from reports where audit_id = $1 and lang = 'zh'`, [auditId]);
      await t(`delete from funnels where audit_id = $1`, [auditId]);
      await t(`update ads set funnel = null where audit_id = $1`, [auditId]);
    } else {
      await t(`delete from texts where audit_id = $1 and lang = 'zh' and section <> 'str'`, [auditId]);
      await t(`delete from funnels where audit_id = $1 and lang = 'zh'`, [auditId]);
    }
    for (const [section, key, position, body] of rows) {
      const text = keepAsWritten.has(key) ? body : zh(body);
      await t(`insert into texts (audit_id, lang, section, key, position, body) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`, [auditId, lang, section, key, position, text.slice(0, 2000)]);
    }
    for (const [i, f] of w.funnels.entries()) {
      const [row] = await t<{ id: string }>(`insert into funnels (audit_id, lang, letter, name, note, position) values ($1, $2, $3, $4, $5, $6) returning id::text`,
        [auditId, lang, f.letter.slice(0, 2), zh(f.name), zh(f.note), i]);
      for (const [j, st] of f.steps.entries()) await t(`insert into funnel_steps (funnel_id, label, position) values ($1, $2, $3)`, [row.id, zh(st), j]);
      if (lang !== "en") continue; // the funnel letter on each ad comes from the English writer only
      const ids = f.library_ids.filter((x) => d.ads.some((a) => a.library_id === x));
      if (ids.length) await t(`update ads set funnel = $2 where audit_id = $1 and library_id = any($3::text[])`, [auditId, f.letter.slice(0, 2), ids]);
    }
  });
}

// House style for 大马华语: half-width ", " and ". " (as in the approved 中文 report), no semicolons or dashes.
export const zhPunct = (s: string) =>
  s.replace(/\s*[，、]\s*/g, ", ").replace(/\s*。\s*/g, ". ").replace(/\s*[；;]\s*/g, ". ").replace(/\s*：\s*/g, ": ")
    .replace(/\s*！\s*/g, "! ").replace(/\s*？\s*/g, "? ").replace(/（/g, " (").replace(/）/g, ") ").replace(/\s*(——|—|–)\s*/g, ", ")
    .replace(/……/g, "...").replace(/[“”]/g, '"').replace(/ {2,}/g, " ").replace(/ ([,.!?:)])/g, "$1").trim();

// Texts back as a lookup: t("cta", "lead"), list("plan", "question"). Section "str" holds the 中文 of the code's own words (see write-zh.ts).
export async function loadTexts(auditId: string, lang: "en" | "zh" = "en") {
  const rows = await q<{ section: string; key: string; position: number; body: string }>(
    `select section, key, position, body from texts where audit_id = $1 and lang = $2 and section <> 'str' order by section, key, position`, [auditId, lang]);
  const t = (section: string, key: string, pos = 0) => rows.find((r) => r.section === section && r.key === key && r.position === pos)?.body ?? null;
  const list = (section: string, key: string) => rows.filter((r) => r.section === section && r.key === key).map((r) => r.body);
  const count = (section: string, key: string) => rows.filter((r) => r.section === section && r.key === key).length;
  return { t, list, count, any: rows.length > 0 };
}
