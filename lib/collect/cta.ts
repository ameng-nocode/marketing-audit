import { askJson } from "../ai";
import { HOUSE } from "../ai-rules";
import { q } from "../db";
import { shortUrl } from "../format";
import { leadsTo } from "./adlib";
import { isCaptcha, NotChecked, shotPath, Skipped, type Ctx } from "./kit";

// Check 5: what they ask customers to do. Landing pages (top of the page, desktop and phone),
// the above-the-fold checklist, buying steps and dead links (skill step 6).

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1366, height: 900 };

// What the first screen of a page shows: headline, buttons, tracking.
async function firstScreen(c: Ctx) {
  return c.page.evaluate(() => {
    const vh = innerHeight;
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.1;
    };
    let head = [...document.querySelectorAll("h1")].find(vis) as HTMLElement | undefined;
    if (!head) {
      let size = 0;
      for (const el of document.querySelectorAll<HTMLElement>("h1,h2,h3,p,div,span,a")) {
        if (!vis(el) || el.children.length > 2 || el.closest("nav, header, a, button, [role=button]")) continue;
        const t = (el.innerText || "").trim();
        if (t.length < 8 || t.length > 160) continue;
        const f = parseFloat(getComputedStyle(el).fontSize);
        if (f > size) { size = f; head = el; }
      }
    }
    const headline = head ? head.innerText.trim().replace(/\s+/g, " ").slice(0, 200) : null;
    const buttons = [...new Set([...document.querySelectorAll<HTMLElement>("a,button,[role=button]")].filter(vis)
      .map((e) => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "))
      .filter((t) => t && t.length < 40 && /buy|shop|order|cart|whatsapp|contact|book|get |call|chat|enquir|quote|start|try|sign up|register|claim|beli|hubungi|tempah|购买|下单|联系|预约|咨询|立即|询价/i.test(t)))].slice(0, 8);
    const w = window as unknown as Record<string, unknown>;
    const s = [...document.scripts].map((x) => x.src + " " + x.text.slice(0, 400)).join("\n");
    const html = document.documentElement.innerHTML;
    return {
      headline, buttons,
      meta: typeof w.fbq === "function" || /fbevents/i.test(s),
      ga: typeof w.gtag === "function" || !!w.google_tag_manager || /googletagmanager|google-analytics/i.test(s),
      whatsapp: !!document.querySelector('a[href*="wa.me"],a[href*="whatsapp"]'),
      platform: w.Shopify ? "Shopify" : /wp-content/.test(html) ? "WordPress" : /wixstatic/.test(html) ? "Wix" : /squarespace/.test(html) ? "Squarespace" : null,
      text: document.body.innerText.slice(0, 2500),
    };
  });
}

// Latin words count one each; Chinese characters count one word per 2 (a short Chinese headline is about 10 to 16 characters).
export function headlineWords(h: string | null) {
  if (!h) return null;
  const cjk = (h.match(/[㐀-鿿]/g) || []).length;
  const latin = h.replace(/[㐀-鿿]/g, " ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  return latin + Math.ceil(cjk / 2);
}

async function oneLanding(c: Ctx, o: { url: string; label: string; own: boolean; adId?: string | null; pos: number }) {
  let status = 0;
  try { status = await c.open(o.url, 4000); } catch { status = 0; }
  const text = await c.text().catch(() => "");
  if (isCaptcha(text)) {
    await c.fact({ key: "landing", label: o.label, value: shortUrl(o.url), note: "The page showed a check for robots.", status: "not_checked", sourceUrl: o.url });
    return;
  }
  if (!status || status >= 400) {
    const shotId = await c.shot(`${o.label}: did not load`, { sourceUrl: o.url }).catch(() => null);
    await c.fact({ key: "landing", label: o.label, value: shortUrl(o.url), note: status ? `The page answers with error ${status}.` : "The page did not load.", status: "none", sourceUrl: o.url, shotId });
    return;
  }
  // A link that ends on Facebook (a redirect to a post, a login wall) is not a landing page to judge.
  if (!isWeb(c.page.url())) {
    await c.fact({ key: "landing", label: o.label, value: shortUrl(o.url), note: `The link opens ${leadsTo(c.page.url(), null)}, not a website.`, status: "info", sourceUrl: o.url });
    return;
  }
  const f = await firstScreen(c);
  const desk = await c.shot(`${o.label}: first screen on a computer`, { kind: "fold", sourceUrl: o.url });
  await c.page.setViewportSize(PHONE);
  let phone: string | null = null;
  try {
    await c.open(o.url, 3500);
    phone = await c.shot(`${o.label}: first screen on a phone`, { kind: "fold", sourceUrl: o.url });
  } finally {
    await c.page.setViewportSize(DESK);
  }
  await q(
    `insert into landings (audit_id, step_id, own, ad_id, label, url, http_status, headline, headline_words, buttons_above, platform, has_meta, has_ga, has_whatsapp, page_text, desktop_shot_id, mobile_shot_id, position)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [c.auditId, c.stepId, o.own, o.adId ?? null, o.label, o.url, status, f.headline, headlineWords(f.headline), f.buttons.join(" | ") || null, f.platform, f.meta, f.ga, f.whatsapp, f.text, desk, phone, o.pos],
  );
}

// A real web page, not Messenger, WhatsApp, Instagram or Facebook (those are chats or pages, not landing pages).
const isWeb = (u: string | null) => !!u && /^https?:\/\//.test(u) && !["Messenger", "WhatsApp", "Instagram", "Facebook"].includes(leadsTo(u, null) ?? "");
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export async function landings(c: Ctx) {
  const list: { url: string; label: string; own: boolean; adId?: string | null }[] = [];
  if (c.biz.website) list.push({ url: c.biz.website, label: "Their website", own: true });
  const ownAd = (await q<{ id: string; landing_url: string | null }>(`select id::text, landing_url from ads where audit_id = $1 and own and opened order by position`, [c.auditId]))
    .find((a) => isWeb(a.landing_url) && (!c.biz.website || host(a.landing_url!) !== host(c.biz.website) || new URL(a.landing_url!).pathname.length > 1));
  if (ownAd) list.push({ url: ownAd.landing_url!, label: "Where their ads go", own: true, adId: ownAd.id });
  const rival = (await q<{ id: string; landing_url: string | null; page_name: string | null }>(
    `select id::text, landing_url, page_name from ads where audit_id = $1 and picked and opened order by closest desc, position`, [c.auditId])).find((a) => isWeb(a.landing_url));
  if (rival) list.push({ url: rival.landing_url!, label: `Competitor: ${rival.page_name ?? host(rival.landing_url!)}`, own: false, adId: rival.id });
  if (!list.length) throw new Skipped("No website, and no competitor ad leads to a website.");
  for (const [i, l] of list.entries()) await oneLanding(c, { ...l, pos: i });
}

const ITEMS = [
  "Headline says what they sell",
  "Headline is short",
  "Offer or price on the first screen",
  "Button on the first screen",
  "Reviews or proof on the first screen",
  "WhatsApp or chat",
  "Clear on a phone",
] as const;

type Fold = { pages: { page: number; headline: string | null; checks: { item: (typeof ITEMS)[number]; result: "ok" | "weak" | "none"; note: string }[] }[] };

export async function foldReview(c: Ctx) {
  const rows = await q<{ id: string; label: string; url: string; headline: string | null; headline_words: number | null; buttons_above: string | null; has_whatsapp: boolean | null; desktop_shot_id: string | null; mobile_shot_id: string | null }>(
    `select id::text, label, url, headline, headline_words, buttons_above, has_whatsapp, desktop_shot_id::text, mobile_shot_id::text from landings where audit_id = $1 order by position`, [c.auditId]);
  if (!rows.length) throw new Skipped("No landing pages were loaded.");
  const images: string[] = [];
  const blocks: string[] = [];
  for (const [i, r] of rows.entries()) {
    const d = await shotPath(r.desktop_shot_id);
    const m = await shotPath(r.mobile_shot_id);
    if (d) images.push(d);
    if (m) images.push(m);
    blocks.push(`Page ${i + 1}: ${r.label} (${r.url})
- Computer screenshot: ${d ?? "none"}
- Phone screenshot: ${m ?? "none"}
- Headline found by code: ${r.headline ?? "none"} (${r.headline_words ?? "?"} words; Chinese counts 1 word per 2 characters)
- Buttons on the first screen: ${r.buttons_above ?? "none found"}
- WhatsApp link anywhere on the page: ${r.has_whatsapp ? "yes" : "no"}`);
  }
  const a = await askJson<Fold>({
    auditId: c.auditId, task: "fold-review", model: "sonnet", system: HOUSE, images,
    prompt: `Check the first screen (above the fold, before any scrolling) of these landing pages. Open every screenshot.
${blocks.join("\n\n")}

For each page, first write the main headline exactly as it reads on the computer screenshot (it may be inside a picture, and the code's guess can be a menu or language switch). null if there is none.
Then judge these ${ITEMS.length} items, in this order, from what the screenshots show:
1. Headline says what they sell: a stranger knows in 3 seconds what is on offer.
2. Headline is short: about 10 words or fewer (weak at 11 to 16, none above that or no headline).
3. Offer or price on the first screen.
4. Button on the first screen: one clear main action (Buy, Order, WhatsApp, Book) without scrolling.
5. Reviews or proof on the first screen: stars, review count, customer numbers, logos.
6. WhatsApp or chat: a visible way to ask a question.
7. Clear on a phone: text readable, main button visible, nothing covering the page.
result: ok, weak or none. note: one short line saying what you see (quote the headline or button text when it helps).`,
    schema: {
      type: "object",
      properties: {
        pages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              page: { type: "integer" },
              headline: { type: ["string", "null"] },
              checks: {
                type: "array",
                items: { type: "object", properties: { item: { type: "string", enum: [...ITEMS] }, result: { type: "string", enum: ["ok", "weak", "none"] }, note: { type: "string" } }, required: ["item", "result", "note"] },
              },
            },
            required: ["page", "headline", "checks"],
          },
        },
      },
      required: ["pages"],
    },
  });
  for (const p of a.pages) {
    const r = rows[p.page - 1];
    if (!r) continue;
    await q(`delete from landing_checks where landing_id = $1`, [r.id]);
    // The headline as a person reads it on the screenshot beats the code's guess (headlines are often inside a picture).
    if (p.headline?.trim()) await q(`update landings set headline = $2, headline_words = $3 where id = $1`, [r.id, p.headline.trim().slice(0, 200), headlineWords(p.headline)]);
    for (const [i, ch] of p.checks.entries()) {
      await q(`insert into landing_checks (landing_id, item, result, note, position) values ($1, $2, $3, $4, $5)`, [r.id, ch.item, ch.result, ch.note.slice(0, 300), ITEMS.indexOf(ch.item) >= 0 ? ITEMS.indexOf(ch.item) : 10 + i]);
    }
  }
}

// Buying steps and dead links on their website (skill step 6: buying steps, other ways in, broken or missing).
export async function buying(c: Ctx) {
  const url = c.biz.website!;
  let status = 0;
  try { status = await c.open(url, 3500); } catch { status = 0; }
  if (!status || status >= 400) throw new NotChecked("The website did not load.");
  const home = new URL(c.page.url());
  const links = await c.page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ h: (a as HTMLAnchorElement).href.split("#")[0], t: ((a as HTMLElement).innerText || "").trim().slice(0, 40) })));
  // Pages that say how to buy: contact, delivery, FAQ, about.
  const wanted = /contact|deliver|shipping|faq|how to (order|buy)|about|cara|penghantaran|hubungi|联系|配送|运费|常见问题|关于/i;
  const info = [...new Map(links.filter((l) => l.h.startsWith(home.origin) && l.h !== home.href && wanted.test(`${l.t} ${l.h}`)).map((l) => [l.h, l])).values()].slice(0, 3);
  const texts: string[] = [];
  for (const l of info) {
    try {
      const s = await c.open(l.h, 2500);
      if (s && s < 400) texts.push(`--- ${l.t || l.h} (${l.h})\n${(await c.text()).slice(0, 1500)}`);
    } catch { /* one page failing is fine */ }
  }
  if (texts.length) {
    await q(`update landings set page_text = left(coalesce(page_text, '') || $2, 8000) where audit_id = $1 and own and position = 0`, [c.auditId, `\n\n${texts.join("\n\n")}`]);
    await c.fact({ key: "site_pages", label: "Pages read for buying steps", value: `${texts.length} pages`, note: info.map((l) => l.t || shortUrl(l.h)).join(", "), status: "info", sourceUrl: url });
  }
  // Dead links: every link on the homepage to their own site, plus app and social links (the test copy stays on this PC).
  const outside = (h: string) => !process.env.COLLECT_ONLY && /play\.google\.com\/store|apps\.apple\.com|instagram\.com\/|tiktok\.com\/@|wa\.me\//.test(h);
  const check = [...new Set(links.map((l) => l.h).filter((h) => h.startsWith(home.origin) || outside(h)))]
    .filter((h) => !/\.(jpg|jpeg|png|webp|gif|pdf)(\?|$)|logout|cart\/add|\/cdn-cgi\//i.test(h)).slice(0, 30);
  let dead = 0;
  for (const h of check) {
    const r = await c.page.request.get(h, { timeout: 10000, failOnStatusCode: false, maxRedirects: 5 }).catch(() => null);
    const st = r?.status() ?? 0;
    // Instagram and TikTok answer odd codes to robots; only a real 404 or 410 counts there.
    const bad = /instagram|tiktok/.test(h) ? st === 404 || st === 410 : st === 0 || st >= 400;
    if (bad) {
      dead++;
      const label = links.find((l) => l.h === h)?.t || shortUrl(h);
      await c.fact({ key: "dead_link", label: label.slice(0, 80), value: st ? `Error ${st}` : "Did not load", note: shortUrl(h), status: "none", sourceUrl: h });
    }
  }
  await c.fact({ key: "links_checked", label: "Links checked on the homepage", value: `${check.length} checked, ${dead} dead`, status: dead ? "weak" : "ok", sourceUrl: url });
}
