import fs from "node:fs";
import path from "node:path";
import { uploadsDir } from "../checks";
import { q } from "../db";
import { rm, shortUrl } from "../format";
import { leadsTo } from "../collect/adlib";
import { SLOP_WORDS } from "../ai-rules";
import { Skipped, type Ctx } from "../collect/kit";
import { loadReportData, reelMonths, type RAd, type ReportData } from "./data";
import { breakEvenLine, funnelSteps, moneyBrief, moneyOf, ownerQuestions } from "./money";
import { consultant, consultantName, Consultant, TIME_ZONE } from "../settings";
import { brief, loadTexts } from "./write";
import { loadZhStrings, MAINLAND, strKey } from "./write-zh";

// Check 7, step 2: the report page. The <style>, the icons and the photo viewer come straight from the
// skill's locked template (lib/report/report-template.html), so the look can't drift. Code fills every number.

const TEMPLATE = () => fs.readFileSync(path.join(process.cwd(), "lib", "report", "report-template.html"), "utf8");
function parts() {
  const t = TEMPLATE();
  // Start after the top comment: it mentions "<style>" itself.
  const from = t.indexOf("<style>", t.indexOf("-->"));
  const style = t.slice(from, t.indexOf("</style>", from) + 8);
  const icons = t.slice(t.indexOf('<svg width="0"'), t.indexOf("</svg>", t.indexOf('<svg width="0"')) + 6);
  const viewer = t.slice(t.indexOf('<div class="lb"'));
  return { style, icons, viewer };
}

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// The AI sees "@" as a full-width "＠" (see lib/ai.ts), so it can come back that way.
const clean = (s: string | null | undefined) => (s ?? "").replace(/＠\s*/g, "@").replace(/\s*[;；]\s*(\S)/g, (_m, c: string) => `. ${c.toUpperCase()}`).replace(EMOJI, "").replace(/\s*[—–]\s*/g, ", ").replace(/--/g, ",").replace(/[ \t]+/g, " ").trim();
const rich = (s: string | null | undefined, tag = "b") => esc(clean(s)).replace(/\*\*(.+?)\*\*/g, `<${tag}>$1</${tag}>`).replace(/\*\*/g, "");
const ICON: Record<string, string> = { ok: "i-ok", none: "i-no", weak: "i-warn", info: "i-info", not_checked: "i-info" };
const st = (status: string, word: string) =>
  `<span class="st${status === "none" || status === "weak" ? " is-bad" : status === "not_checked" ? " is-na" : ""}"><svg class="ico"><use href="#${ICON[status] ?? "i-info"}"/></svg>${esc(word)}</span>`;
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "long", year: "numeric" });
const shortDate = (ymd: string | null) => (ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const monthsSince = (ymd: string | null, today: string) => (ymd ? Math.max(0, Math.round((Date.parse(today) - Date.parse(ymd)) / (30.44 * 864e5))) : null);
const link = (href: string, text: string) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
const num = (v: string | null | undefined) => (v ?? "").match(/~?[\d.,]+[KMk]?/)?.[0] ?? null;

type Src = { shot: (id: string) => string; upload: (id: string) => string };
// page = its own tab, embed = inside the check page (the app shows the photos), print = the PDF.
export type Mode = "page" | "embed" | "print";

// Added for the app, after the template's own style (which stays as it is): one frame per photo kind,
// Reel previews, number tiles, tracking tiles and spend bars, all in the template's colours.
const ADDED = `
  [hidden] { display: none !important; }
  .mflow { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
  .mflow li { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: grid; gap: 4px; align-content: start; }
  .mflow li b { font-size: 14px; color: var(--ink); }
  .mflow li span { font-size: 13px; color: var(--muted); }
  .mflow li.known span { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  .be { margin: 0; font-size: 15.5px; line-height: 1.55; color: var(--ink); font-weight: 600; }
  .asks { margin: 0; padding-left: 20px; display: grid; gap: 8px; font-size: 14.5px; color: var(--ink-2); }
  .shots, .shots.one { grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr)); }
  figure a { aspect-ratio: 4 / 3; }
  figure a img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
  figure.tall a { aspect-ratio: 9 / 16; }
  figure.ad a { aspect-ratio: 4 / 5; }
  figure.strip a { aspect-ratio: 23 / 10; }
  figure.tall a img, figure.ad a img, figure.strip a img { object-position: center; }
  .pair { display: grid; grid-template-columns: minmax(0, 2.885fr) minmax(0, 1fr); gap: 12px; max-width: 640px; align-items: start; }
  figure.phone a { aspect-ratio: 390 / 844; }
  .reels { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px 12px; }
  @media (max-width: 640px) { .reels { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .reel { display: grid; gap: 4px; align-content: start; }
  .reel .v { font-family: var(--display); font-weight: 800; font-size: 18px; line-height: 1.1; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .reel .v small { font-family: var(--body); font-size: 12px; font-weight: 500; color: var(--muted); margin-left: 4px; }
  .reel .d { font-size: 12px; color: var(--muted); }
  .noprev { display: grid; place-items: center; aspect-ratio: 9 / 16; border: 1px dashed var(--line-2); border-radius: 10px; font-size: 12px; color: var(--muted); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 12px; }
  .tile { border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: grid; gap: 6px; align-content: start; }
  .tile .big { font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1.05; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .tile .lab { font-size: 13px; color: var(--muted); line-height: 1.4; }
  .track { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); gap: 10px; }
  .track > div { border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: grid; gap: 8px; align-content: start; }
  .track b { font-size: 14px; font-weight: 600; }
  .hbars { display: grid; gap: 10px; border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .hbar { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr) auto; gap: 12px; align-items: center; font-size: 13.5px; }
  .bar-track { height: 12px; }
  .bar-track i { display: block; height: 100%; background: var(--ink-2); border-radius: 4px; }
  .hbar .num { font-family: var(--mono); font-size: 12.5px; }
  .seen { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--ink-2); border-top: 1px solid var(--line); padding-top: 10px; }
  .seen figure { width: 48px; flex: none; }
  @media (max-width: 640px) { .hbar { grid-template-columns: minmax(0, 1fr) auto; } .bar-track { grid-column: 1 / -1; grid-row: 2; } }`;

const EMBED = `
  .topbar { display: none; }
  body { background: transparent; }
  main { max-width: none; padding: 0; }`;

const PRINT = `
  @page { size: A4; margin: 12mm; }
  .topbar, .lb { display: none !important; }
  body { background: #fff; }
  main { max-width: none; padding: 0; gap: 0; }
  .panel { border: 0; border-radius: 0; padding: 0 0 8mm; }
  main > section:not(#glance) { break-before: page; }
  .sec { grid-template-columns: minmax(0, 1fr); }
  .sec-aside { position: static; }
  figure, .card, .box, .tile, .track > div, .plan-row, .chan-row, tr, .fun, .reel, .row, .hbar, .why4 > div, .loop li, .chart { break-inside: avoid; }
  h2, h3 { break-after: avoid; }
  a { text-decoration: none; }
  /* Cover and the summary share page 1. */
  .cover { gap: 14px; }
  .cover h1 { font-size: 48px; }
  .cover .verdict { font-size: 17px; }
  .glance { gap: 10px; }
  .row { padding-block: 9px; }
  .row .big { font-size: 24px; }`;

// Inside the check page: a photo click and a jump link go to the app around it (its viewer, its scroll).
const EMBED_SCRIPT = `<script>
(function () {
  var links = [].slice.call(document.querySelectorAll('a.zoom'));
  var list = links.map(function (a) {
    var fig = a.closest('figure'), fc = fig && fig.querySelector('figcaption');
    var box = a.closest('.card, .box, .reel'), h = box && box.querySelector('h3');
    return { src: a.getAttribute('href'), name: (fc && fc.textContent.trim()) || (h && h.textContent.trim()) || (a.querySelector('img') || {}).alt || 'Screenshot' };
  });
  links.forEach(function (a, i) {
    a.addEventListener('click', function (e) { e.preventDefault(); e.stopImmediatePropagation(); parent.postMessage({ type: 'report-zoom', list: list, at: i }, location.origin); }, true);
  });
  [].slice.call(document.querySelectorAll('a[href^="#"]')).forEach(function (a) {
    a.addEventListener('click', function (e) {
      var t = document.querySelector(a.getAttribute('href'));
      if (!t) return;
      e.preventDefault();
      parent.postMessage({ type: 'report-scroll', y: t.getBoundingClientRect().top + window.scrollY }, location.origin);
    });
  });
})();
</script>`;

export type Lang = "en" | "zh";

// The code's own fixed words in 大马华语 (wording from the approved 中文 report where it had one).
const ZH_ITEMS: Record<string, string> = {
  "Headline says what they sell": "标题说清楚卖什么",
  "Headline is short": "标题够短",
  "Offer or price on the first screen": "首屏有优惠或价格",
  "Button on the first screen": "首屏有按钮",
  "Reviews or proof on the first screen": "首屏有评价或证明",
  "WhatsApp or chat": "有 WhatsApp 或聊天",
  "Clear on a phone": "手机上看得清楚",
};
const ZH_TRACK: Record<string, string> = { "Google Analytics or Tag Manager": "Google Analytics 或 Tag Manager", "WhatsApp button": "WhatsApp 按钮" };
const ZH_UNIT: Record<string, string> = { followers: "followers", places: "个地点", place: "个地点", ads: "个广告", videos: "个 video" };

export function buildHtml(d: ReportData, T: Awaited<ReturnType<typeof loadTexts>>, src: Src, today: string, mode: Mode = "page", lang: Lang = "en", Z: Map<string, string> = new Map()) {
  const { style, icons, viewer } = parts();
  const name = d.biz.name;
  const zh = lang === "zh";
  const tr = (en: string, cn: string) => (zh ? cn : en);
  // The code's own collected words (notes, captions, hook notes) in 中文 when they were made, else as collected.
  const S = (en: string | null | undefined) => (en == null ? "" : zh ? Z.get(strKey(en.trim())) ?? en : en);
  const ymd = (s: string) => ({ y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) });
  const dLong = (iso: string) => {
    if (!zh) return longDate(iso);
    const x = ymd(new Date(Date.parse(iso) + 8 * 3600e3).toISOString());
    return `${x.y}年${x.m}月${x.d}日`;
  };
  const dShort = (s: string | null) => (!s ? "" : zh ? `${ymd(s).y}年${ymd(s).m}月${ymd(s).d}日` : shortDate(s));
  const views = (n: string) => (zh ? `${n}<small>次观看</small>` : `${n}<small>views</small>`);

  // Every photo sits in a fixed frame (cls picks it: default 4:3, tall = phone, strip = 4 frames); the full picture opens on click.
  const fig = (id: string | null | undefined, alt: string, caption?: string | null, upload = false, cls = "") =>
    id ? `<figure${cls ? ` class="${cls}"` : ""}><a href="${upload ? src.upload(id) : src.shot(id)}" class="zoom"><img src="${upload ? src.upload(id) : src.shot(id)}" alt="${esc(alt)}" loading="lazy"></a>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>` : "";
  const shotFig = (s: { id: string; caption: string }) => fig(s.id, S(s.caption), esc(S(s.caption)));
  const shotsOf = (check: number, kinds = ["page"]) => d.shots.filter((s) => s.check_no === check && kinds.includes(s.kind));
  const proof = (figs: string[]) => {
    const n = figs.filter(Boolean).length;
    return n ? `<div class="proof"><div class="proof-head"><h3>${tr("Proof", "截图证明")}</h3><span>${n > 1 ? tr(`${n} screenshots, click to enlarge`, `${n} 张截图, 点击放大`) : tr("Click to enlarge", "点击放大")}</span></div><div class="shots">${figs.join("")}</div></div>` : "";
  };
  const facts = (key: string) => d.facts.filter((f) => f.key === key);
  const fact = (key: string) => facts(key)[0];
  const points = (sec: string) => {
    const p = T.list(sec, "point");
    return p.length ? `<ul class="points">${p.map((x) => `<li>${rich(x)}</li>`).join("")}</ul>` : "";
  };
  const g = (k: string) => ({ status: T.t("glance", `${k}.status`) ?? "info", word: T.t("glance", `${k}.word`) ?? "", finding: T.t("glance", `${k}.finding`) ?? "" });
  const aside = (n: string, id: string, title: string, qn: string, k?: string) =>
    `<div class="sec-aside"><span class="num">${n}</span><h2 id="h-${id}">${esc(title)}</h2><span class="q">${esc(qn)}</span>${k ? st(g(k).status, g(k).word) : ""}</div>`;

  // --- numbers, all from code -----------------------------------------------------------
  const okChannels = new Set(d.facts.filter((f) => f.check_no === 1 && f.status === "ok" && ["website", "facebook", "instagram", "tiktok", "maps", "app"].includes(f.key)).map((f) => f.key)).size;
  const reelViews = d.reels.map((r) => r.views).filter((v): v is number => v != null);
  const avgViews = reelViews.length ? Math.round(reelViews.reduce((a, b) => a + b, 0) / reelViews.length) : null;
  const lib = fact("ad_library");
  const libCount = lib ? num(lib.value) ?? "0" : null;
  const rivals = d.ads.filter((a) => !a.own);
  const own = d.ads.filter((a) => a.own);
  const brokenN = T.count("cta", "broken.item") + facts("dead_link").length;
  // Posting rhythm counts Reels and TikTok videos together (TikTok only when it was read).
  const months = reelMonths([...d.reels, ...d.tiktok], today);
  const monthLabel = (m: { ym: string; label: string }) => (zh ? `${+m.ym.slice(5, 7)}月` : m.label);
  const postsLabel = d.tiktok.length ? tr("Facebook Reels and TikTok videos", "Facebook Reels 和 TikTok video") : "Facebook Reels";
  const zeroMonths = months.filter((m) => m.count === 0).length;

  // --- cover + glance -----------------------------------------------------------------------
  const checkedOn = dLong(d.biz.finished_at ?? new Date().toISOString());
  const looked = (zh
    ? ["网站", "Facebook", "Instagram", "TikTok", "Google Maps", "Meta 广告库", d.landings.length ? "着陆页" : "", d.amRows.length ? "Ads Manager 截图" : ""]
    : ["Website", "Facebook", "Instagram", "TikTok", "Google Maps", "Meta Ad Library", d.landings.length ? "landing pages" : "", d.amRows.length ? "Ads Manager screenshots" : ""]).filter(Boolean).join(", ");
  const logo = d.logoId ? src.shot(d.logoId) : null;
  const glanceRow = (n: string, id: string, k: string, title: string, big: string, small: string, bad: boolean) =>
    `<a class="row" href="#${id}"><span class="n">${n}</span><span class="area"><b>${title}</b>${st(g(k).status, g(k).word)}</span><span class="find">${rich(g(k).finding, "strong")}</span><span class="big${bad ? " bad" : ""}">${esc(big)}<small>${esc(small)}</small></span></a>`;

  // --- 01 channels --------------------------------------------------------------------------
  const chanRow = (f: ReportData["facts"][number]) => {
    const [plat, ...rest] = f.label.split(" ");
    const nm = f.key === "maps" ? "Google Maps" : f.key === "same_name" ? "Facebook" : f.key === "app" ? f.label : plat;
    const sub = f.key === "same_name" ? f.label : f.key === "app" ? "" : rest.join(" ") || (f.value && !/^\d/.test(f.value) ? shortUrl(f.value) : "");
    const word = f.status === "ok" ? (f.key === "website" || f.key === "facebook" || f.key === "app" ? tr("Live", "在线") : tr("Found", "有"))
      : f.status === "none" ? (f.key === "app" || f.key === "website" ? tr("Dead", "失效") : tr("None", "没有"))
      : f.status === "weak" ? (f.key === "same_name" ? tr("Same name", "同名") : tr("Weak", "需要加强"))
      : f.status === "not_checked" ? tr("Not checked", "未检查") : tr("Found", "有");
    // A count only when the value starts with one ("11K followers", "2 places found"); a web address is never a count.
    const n = /^~?[\d.,]+[KMk]?\s/.test(f.value ?? "") ? num(f.value) : null;
    const unit = n ? (f.value ?? "").replace(n, "").trim().split(" ")[0] ?? "" : "";
    const val = f.status === "none" ? `<span class="val bad">${esc(n ?? "0")}</span>`
      : n ? `<span class="val">${esc(n)}<small>${esc(zh ? ZH_UNIT[unit] ?? unit : unit)}</small></span>`
      : `<span class="val">${f.key === "website" && /shop or cart/i.test(f.note ?? "") ? tr("Shop", "网店") : ""}</span>`;
    return `<div class="chan-row"><span class="name">${esc(nm)}${sub ? `<span>${esc(sub)}</span>` : ""}</span>${st(f.status === "info" ? "ok" : f.status, word)}${val}<p>${esc(clean(S(f.note)))}</p></div>`;
  };
  const chanFacts = [...d.facts.filter((f) => f.check_no === 1 && ["website", "facebook", "instagram", "tiktok", "maps", "app"].includes(f.key)), ...facts("same_name").filter((f) => f.status === "weak")];
  const ch1 = shotsOf(1).map(shotFig);

  // --- 02 content: a preview of each Reel with its views --------------------------------------
  const noPrev = `<figure class="tall"><span class="noprev">${tr("No preview", "没有预览")}</span></figure>`;
  const reelTiles = d.reels.slice(0, 10).map((r) => `<div class="reel">${
    r.thumb_shot_id ? fig(r.thumb_shot_id, `Reel${r.caption ? `: ${clean(r.caption).slice(0, 60)}` : ""}`, null, false, "tall") : noPrev
  }<span class="v">${views(esc(r.views_text ?? "?"))}</span><span class="d">${r.posted_on ? esc(dShort(r.posted_on)) : ""}</span></div>`).join("");
  const avgLine = (avg: number | null) => (avg == null ? "" : tr(` · average <b class="mono">${avg.toLocaleString("en-US")}</b> views`, ` · 平均 <b class="mono">${avg.toLocaleString("en-US")}</b> 次观看`));
  const reelChart = d.reels.length
    ? `<div class="chart"><div class="chart-head"><b>${tr(`The ${Math.min(10, d.reels.length)} newest Facebook Reels`, `最新 ${Math.min(10, d.reels.length)} 个 Facebook Reels`)}</b><span class="eyebrow">${tr("Newest first", "最新的在前")}${avgLine(avgViews)}</span></div><div class="reels">${reelTiles}</div></div>`
    : "";
  // TikTok videos (read through Apify when TikTok showed a puzzle), one block per account, same style as the Reels.
  const compact = (v: number | null) => (v == null ? "?" : v >= 1e6 ? `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K` : v.toLocaleString("en-US"));
  const tiktokCharts = [...new Set(d.tiktok.map((t) => t.handle))].map((h) => {
    const vids = d.tiktok.filter((t) => t.handle === h);
    const vv = vids.map((t) => t.views).filter((x): x is number => x != null);
    const avg = vv.length ? Math.round(vv.reduce((a, b) => a + b, 0) / vv.length) : null;
    const tiles = vids.map((t) => `<div class="reel">${
      t.thumb_shot_id ? fig(t.thumb_shot_id, `TikTok video${t.caption ? `: ${clean(t.caption).slice(0, 60)}` : ""}`, null, false, "tall") : noPrev
    }<span class="v">${views(esc(compact(t.views)))}</span><span class="d">${t.posted_on ? esc(dShort(t.posted_on)) : ""}</span></div>`).join("");
    return `<div class="chart"><div class="chart-head"><b>${tr(`The ${vids.length} newest TikTok videos`, `最新 ${vids.length} 个 TikTok video`)} · @${esc(h)}</b><span class="eyebrow">${tr("Newest first", "最新的在前")}${avgLine(avg)}</span></div><div class="reels">${tiles}</div></div>`;
  }).join("");
  const ch2 = [...shotsOf(2), ...d.shots.filter((s) => s.check_no === 1 && s.step_key === "facebook" && s.kind === "page")].map(shotFig);

  // --- ad cards (their ads in 03, competitors in 04) -------------------------------------
  const fmtOf = (a: RAd) =>
    a.format === "video" && a.video_seconds ? `Video, ${Math.floor(a.video_seconds / 60)}:${String(Math.round(a.video_seconds % 60)).padStart(2, "0")}`
    : a.format === "image" ? tr("Image", "图片") : a.format === "carousel or several images" ? tr("Carousel or several images", "多张图片") : a.format ? a.format[0].toUpperCase() + a.format.slice(1) : "";
  const adCard = (a: RAd) => {
    const label = T.t("ad_label", a.library_id) ?? (a.closest ? tr("Closest competitor", "最接近的同行") : a.own ? tr("Their ad", "他们的广告") : "");
    const m = monthsSince(a.started_on, today);
    const leads = leadsTo(a.landing_url, a.cta) ?? "";
    const fmt = fmtOf(a);
    const copy = clean((a.full_text ?? a.body ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 2).join(" ")).slice(0, 220);
    const since = a.started_on
      ? tr(`Since ${dShort(a.started_on)}${m && m >= 3 ? `, ${m} months` : ""}${a.versions ? `, ${a.versions} versions` : ""}`,
        `从 ${dShort(a.started_on)} 开始${m && m >= 3 ? `, 已经 ${m} 个月` : ""}${a.versions ? `, ${a.versions} 个版本` : ""}`)
      : "";
    // The ad's own picture; the whole Ad Library box when the picture couldn't be cut out (it stays in the proof below).
    return `<article class="card">${fig(a.creative_shot_id ?? a.shot_id, `${a.page_name ?? "Ad"} ad`, null, false, "ad") || "<div></div>"}<div class="body"><div class="ctop">${a.funnel ? `<span class="fl">${esc(a.funnel)}</span>` : ""}<span>${esc(label)}</span></div><h3>${esc(a.page_name ?? a.library_id)}</h3><dl class="facts">
      ${since ? `<dt>${tr("Running", "投放")}</dt><dd>${esc(since)}</dd>` : ""}
      ${a.offer ? `<dt>${tr("Offer", "优惠")}</dt><dd>${esc(clean(S(a.offer)))}</dd>` : ""}
      ${fmt ? `<dt>${tr("Format", "形式")}</dt><dd>${esc(fmt)}</dd>` : ""}
      ${leads ? `<dt>${tr("Leads to", "带去")}</dt><dd>${esc(leads)}${a.cta && leads !== a.cta ? ` (${esc(a.cta)})` : ""}</dd>` : ""}
      ${a.followers ? `<dt>Facebook</dt><dd>${esc(a.followers)} followers</dd>` : ""}
    </dl>${copy ? `<p class="quote">${esc(copy)}</p>` : ""}<span class="links">${link(`https://www.facebook.com/ads/library/?id=${a.library_id}`, a.format === "video" ? tr("Watch the video ad", "看 video 广告") : tr("View ad", "看广告"))}${a.page_url ? ` · ${link(a.page_url, tr("Facebook page", "Facebook 专页"))}` : ""}</span></div></article>`;
  };

  // --- 03 ads -----------------------------------------------------------------------------
  const tracking = facts("tracking");
  const trans = fact("transparency");
  const domain = fact("ad_domain");
  // "Is the ad money working?": the numbers worked out by code from their price, profit and Ads Manager rows.
  // The screenshot rows themselves are not repeated (the screenshots are in the proof below).
  const tile = (big: string, lab: string, bad = false) => `<div class="tile"><span class="big${bad ? " bad" : ""}">${esc(big)}</span><span class="lab">${esc(lab)}</span></div>`;
  const m = moneyOf(d);
  const UNIT_ONE: Record<string, [string, string]> = { chat: ["chat", "每个聊天"], lead: ["lead", "每个 lead"], purchase: ["purchase", "每单购买"] };
  const UNIT_MANY: Record<string, [string, string]> = { chat: ["chats", "个聊天"], lead: ["leads", "个 lead"], purchase: ["purchases", "单购买"] };
  const span = (lo: number, hi: number, f: (n: number) => string = String) => (lo === hi ? f(lo) : `${f(lo)} ${tr("to", "到")} ${f(hi)}`);
  const beLine = breakEvenLine(m, zh);
  const steps = funnelSteps(m, zh);
  const asks = ownerQuestions(m, zh);
  const insights = T.list("money", "insight");
  const moneyTiles = [
    m.cpr && m.unit ? tile(rm(m.cpr), tr(`per ${UNIT_ONE[m.unit][0]}, worked out from the screenshots`, `${UNIT_ONE[m.unit][1]}, 从截图算出来`), !!m.breakEven && m.breakEven.hi < 1) : "",
    m.breakEven && m.breakEven.hi >= 1 && m.unit ? tile(zh ? span(m.breakEven.lo, m.breakEven.hi) : `1 in ${span(m.breakEven.lo, m.breakEven.hi)}`, tr(`${UNIT_MANY[m.unit][0]} buying is enough for the ads to pay`, `${UNIT_MANY[m.unit][1]}里成交 1 个, 广告就回本`)) : "",
    m.perSale ? tile(span(m.perSale.left.lo, m.perSale.left.hi, rm), tr("left per purchase after the ad cost", "每单扣掉广告费还剩"), m.perSale.left.hi <= 0) : "",
    m.roas ? tile(`${m.roas}x`, m.roasNeed ? tr(`ROAS now. They need ${span(m.roasNeed.lo, m.roasNeed.hi)}x to break even (price ÷ profit).`, `现在的 ROAS. 要 ${span(m.roasNeed.lo, m.roasNeed.hi)}x 才回本 (售价 ÷ 利润).`) : tr("ROAS shown in Ads Manager", "Ads Manager 显示的 ROAS"), !!m.roasNeed && m.roas < m.roasNeed.lo) : "",
    m.total ? tile(rm(m.total), tr("spent in the rows on the screenshots", "截图里看得到的花费")) : "",
  ].filter(Boolean).join("");
  const moneyBlock = m.rows.length
    ? `<div class="block"><h3 class="sub">${tr("Is the ad money working?", "广告的钱有没有回本?")}</h3>
      ${T.t("money", "verdict") ? `<p class="lead">${rich(T.t("money", "verdict"))}</p>` : ""}
      ${moneyTiles ? `<div class="tiles">${moneyTiles}</div>` : ""}
      ${steps.length ? `<div class="block"><h3 class="sub">${tr("Their funnel, step by step", "他们的成交流程")}</h3><ol class="mflow">${steps.map((s) => `<li class="${s.value ? "known" : ""}"><b>${esc(s.label)}</b><span>${esc(s.value ?? tr("Ask the owner", "问老板"))}</span></li>`).join("")}</ol></div>` : ""}
      ${beLine ? `<p class="be">${esc(beLine)}</p>` : `<p class="muted" style="font-size:13.5px">${!m.cpr ? tr("The screenshots show no chats, leads or purchases with a count, so the cost per result can't be worked out.", "截图里看不到聊天, lead 或购买的数量, 所以算不出每个成效的成本.") : tr("Add what they keep from one sale (edit the check) to see if the ads pay.", "填上每单的利润 (编辑这个检查), 就能看到广告有没有回本.")}</p>`}
      ${insights.length ? `<ul class="points">${insights.map((x) => `<li>${rich(x)}</li>`).join("")}</ul>` : ""}
      ${asks.length ? `<div class="box"><h3>${tr("Ask the owner", "要问老板的")}</h3><ol class="asks">${asks.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>` : ""}
    </div>`
    : "";
  const ch3 = [...shotsOf(3, ["page", "ad"]).map(shotFig), ...d.uploads.map((u) => fig(u.id, u.original_name, `Ads Manager: ${esc(u.original_name)}`, true))];
  // Number tiles, tracking tiles and spend bars: the ads at a glance.
  const ownLive = fact("own_live");
  const oldest = own.map((a) => a.started_on).filter((x): x is string => !!x).sort()[0];
  const domainName = domain?.label.replace(/^Ads mentioning /, "") ?? "";
  const adTiles = `<div class="tiles">
    ${tile(libCount ?? "?", libCount ? tr("ads in Meta Ad Library, all countries, live and past", "Meta 广告库里的广告, 所有国家, 包括已经停的") : tr("Ad Library not checked", "广告库未检查"), libCount === "0")}
    ${ownLive ? tile(num(ownLive.value) ?? ownLive.value ?? "", tr("running right now", "目前正在投放")) : ""}
    ${oldest ? tile(dShort(oldest), tr("oldest live ad found, running since", "正在跑的广告里, 最早开始的日期")) : ""}
    ${domain ? tile(num(domain.value) ?? "0", tr(`ads mentioning ${domainName}`, `提到 ${domainName} 的广告`), num(domain.value) === "0") : ""}
  </div>${trans ? `<p class="muted" style="font-size:13px">${tr("Page transparency", "专页透明度")}: ${esc(S(trans.value))}.${trans.note ? ` ${esc(clean(S(trans.note)))}` : ""}</p>` : ""}`;
  const trackTiles = tracking.length
    ? `<div class="block"><h3 class="sub">${tr("Tracking on their website", "网站追踪")}</h3><div class="track">${tracking.map((t) => `<div><b>${esc(zh ? ZH_TRACK[t.label] ?? t.label : t.label)}</b>${st(t.status, zh ? (t.status === "ok" ? "有装" : "未安装") : t.value ?? "")}</div>`).join("")}</div></div>`
    : `<p class="muted" style="font-size:13.5px">${d.biz.website ? tr("Website tracking was not checked.", "网站追踪未检查.") : tr("No website given, so there is no tracking to check.", "没有网站, 所以没有追踪可以检查.")}</p>`;

  // --- 04 competitors -------------------------------------------------------------------------
  const funnels = d.funnels.length
    ? `<div class="block"><h3 class="sub">${d.funnels.length === 1 ? tr("The way they sell through ads", "他们用广告卖东西的方式") : tr(`The ${d.funnels.length} ways they sell through ads`, `他们用广告卖东西的 ${d.funnels.length} 种方式`)}</h3><div class="funnels">${d.funnels
        .map((f) => {
          const who = [...new Set(d.ads.filter((a) => a.funnel === f.letter).map((a) => (a.own ? `${name} ${tr("(their own ads)", "(自己的广告)")}` : a.page_name)).filter(Boolean))];
          return `<div class="fun"><div class="fun-top"><span class="fl">${esc(f.letter)}</span><b>${esc(clean(f.name))}</b>${who.length ? `<span class="muted">${esc(who.join(", "))}</span>` : ""}</div><ul class="flow">${f.steps.map((s) => `<li>${esc(clean(s))}</li>`).join('<li class="to">›</li>')}</ul>${f.note ? `<p>${esc(clean(f.note))}</p>` : ""}</div>`;
        })
        .join("")}</div></div>`
    : "";
  const whoTable = rivals.length
    ? `<div class="block"><h3 class="sub">${tr("Who is advertising", "谁在打广告")}</h3><div class="table-wrap"><table><thead><tr><th>${tr("Type", "类型")}</th><th>${tr("Advertiser", "广告主")}</th><th>${tr("Sells to", "卖给谁")}</th><th>${tr("Running since", "开始投放")}</th><th>${tr("Format", "形式")}</th><th>${tr("Offer", "优惠")}</th></tr></thead><tbody>${rivals
        .map((a) => `<tr><td>${a.funnel ? `<span class="fl">${esc(a.funnel)}</span>` : ""}</td><td><strong>${esc(a.page_name ?? a.library_id)}</strong>${a.pick_reason ? `<span class="sm">${esc(clean(S(a.pick_reason)))}</span>` : ""}</td><td>${esc(S(a.sells_to))}</td><td class="num">${esc(dShort(a.started_on))}</td><td>${esc(fmtOf(a))}${a.versions ? tr(`, ${a.versions} versions`, `, ${a.versions} 个版本`) : ""}</td><td>${esc(clean(S(a.offer)))}</td></tr>`)
        .join("")}</tbody></table></div></div>`
    : "";
  const words = facts("search_word").map((f) => f.value).filter(Boolean);
  const ch4 = d.shots.filter((s) => s.check_no === 4 && (s.kind === "page" || s.kind === "ad")).map(shotFig);

  // --- 05 call to action ------------------------------------------------------------------
  const buy = T.list("cta", "buy.title").map((t, i) => `<li><div><b>${esc(clean(t))}</b>${esc(clean(T.t("cta", "buy.detail", i)))}</div></li>`).join("");
  // The AI's list, then every dead link the code found (each with its own proof link).
  const broken = [
    ...T.list("cta", "broken.item").map((t, i) => `<li><span>${esc(clean(t))}</span>${st(T.t("cta", "broken.status", i) ?? "none", T.t("cta", "broken.word", i) ?? tr("Missing", "没有"))}</li>`),
    ...facts("dead_link").map((f) => `<li><span>${tr("Link", "连结")} "${esc(f.label)}"${f.source_url ? `<span style="display:block;font-size:12.5px;color:var(--muted)">${link(f.source_url, shortUrl(f.source_url).slice(0, 60))}</span>` : ""}</span>${st("none", f.value ?? tr("Dead", "失效"))}</li>`),
  ].join("");
  const cmpWith = T.t("cta", "compare_with");
  const cmpRows = T.list("cta", "compare.row").map((r, i) => {
    const cell = (v: string | null, ok: string | null) => (ok === "true" ? `<td>${st("ok", clean(v))}</td>` : ok === "false" ? `<td>${st("none", clean(v))}</td>` : `<td>${esc(clean(v))}</td>`);
    return `<tr><td>${esc(clean(r))}</td>${cell(T.t("cta", "compare.theirs", i), T.t("cta", "compare.theirs_ok", i))}${cell(T.t("cta", "compare.rival", i), T.t("cta", "compare.rival_ok", i))}</tr>`;
  }).join("");
  const RES: Record<string, [string, string]> = { ok: ["ok", "OK"], weak: ["weak", tr("Weak", "需要加强")], none: ["none", tr("Missing", "没有")] };
  const landingBlocks = d.landings.map((l) => `<div class="block"><h3 class="sub">${esc(S(l.label))}: ${link(l.url, shortUrl(l.url).slice(0, 60))}</h3>
      ${l.headline ? `<p class="muted" style="font-size:13.5px">${tr("Headline on the first screen", "首屏标题")}: <span style="color:var(--ink)">"${esc(clean(l.headline))}"</span>${l.headline_words ? tr(`, ${l.headline_words} words`, `, 约 ${l.headline_words} 个词`) : ""}.</p>` : ""}
      <div class="pair">${fig(l.desktop_shot_id, `${S(l.label)} ${tr("on a computer", "电脑版")}`, tr("On a computer, before scrolling", "电脑, 还没往下滑"), false, "desk")}${fig(l.mobile_shot_id, `${S(l.label)} ${tr("on a phone", "手机版")}`, tr("On a phone", "手机"), false, "phone")}</div>
      ${l.checks.length ? `<div class="box"><h3>${tr("First screen checklist", "首屏检查")}</h3><ul class="checks">${l.checks.map((c) => `<li><span>${esc(zh ? ZH_ITEMS[c.item] ?? c.item : c.item)}${c.note ? `<span class="sm" style="display:block;font-size:12.5px;color:var(--muted)">${esc(clean(S(c.note)))}</span>` : ""}</span>${st(RES[c.result]?.[0] ?? "info", RES[c.result]?.[1] ?? c.result)}</li>`).join("")}</ul></div>` : ""}</div>`).join("");
  const fbBtn = fact("fb_button");

  // --- 06 creative -----------------------------------------------------------------------------
  const maxM = Math.max(1, ...months.map((m) => m.count));
  const datedReels = d.reels.filter((r) => r.posted_on).length;
  const datedTt = d.tiktok.filter((t) => t.posted_on).length;
  const monthChart = months.length
    ? `<div class="chart" role="img" aria-label="${tr(`${postsLabel} posted per month`, `每个月发的 ${postsLabel}`)}: ${months.map((m) => `${monthLabel(m)} ${m.count}`).join(", ")}"><div class="chart-head"><b>${tr(`${postsLabel} posted per month`, `每个月发的 ${postsLabel}`)}</b><span class="eyebrow">${tr(
        `Post dates of the ${datedReels} newest Reels${datedTt ? ` and ${datedTt} newest TikTok videos` : ""}`,
        `根据最新 ${datedReels} 个 Reels${datedTt ? ` 和 ${datedTt} 个 TikTok video` : ""} 的发布日期`)}</span></div><div class="bars m7" style="grid-template-columns:repeat(${months.length},minmax(0,1fr))">${months
        .map((m) => (m.count ? `<div class="bar"><span>${m.count}</span><i style="height:${Math.round((112 * m.count) / maxM * 10) / 10}px"></i></div>` : `<div class="bar zero"><span>0</span></div>`))
        .join("")}</div><div class="months m7" style="grid-template-columns:repeat(${months.length},minmax(0,1fr))">${months.map((m) => `<span>${monthLabel(m)}</span>`).join("")}</div></div>`
    : "";
  const HOOK: Record<string, [string, string]> = { strong: ["ok", tr("Strong hook", "开头很强")], ok: ["info", tr("OK hook", "开头还可以")], weak: ["weak", tr("Weak hook", "开头偏弱")] };
  const hp = (label: string, text: string | null) => `<p style="font-size:13.5px;color:var(--ink-2)"><b style="color:var(--ink)">${label}:</b> ${esc(clean(S(text)))}</p>`;
  const hookBoxes = d.hooks.map((h) => {
    const a = h.ad_id ? d.ads.find((x) => x.id === h.ad_id) : null;
    const who = h.reel_id ? `${name}: Reel` : a?.own ? `${name}: ${tr("ad", "广告")}` : `${tr("Competitor", "同行")}: ${a?.page_name ?? tr("ad", "广告")}`;
    return `<div class="box"><h3>${esc(who)}</h3>${st(HOOK[h.rating]?.[0] ?? "info", HOOK[h.rating]?.[1] ?? h.rating)}${fig(h.frames_shot_id, `${tr("First 4 seconds", "开头 4 秒")}: ${who}`, tr("0, 1, 2 and 3 seconds", "第 0, 1, 2, 3 秒"), false, "strip")}${hp(tr("Shows", "画面"), h.shows)}${hp(tr("Why", "原因"), h.why)}${hp(tr("Change", "可以改"), h.fix)}</div>`;
  }).join("");
  const dec = (k: string) => esc(clean(T.t("creative", `decision.${k}`)));
  const routine = zh
    ? [["计划", `团队选这个星期的优惠和 3 到 5 个素材, 每个都先决定好 4 件事. ${consultant("zh")}检查方向.`], ["拍摄", "团队用手机拍, 在店里或做事的地方拍. 不需要大制作."], ["剪辑和写文案", "video 用 CapCut, 图片用 Canva. AI 可以先写文案草稿, 团队再改成自己的话."], ["投放广告", "团队在 Meta Ads Manager 设定, 每个优惠做几个版本."], ["看数字", `每周跟${consultant("zh")}检讨. 有效的留下, 没效的停掉.`]]
    : [["Plan", `The team picks this week's offer and 3 to 5 pieces, with the 4 decisions for each. ${Consultant()} checks the direction.`], ["Shoot", "The team shoots on a phone, at the shop or where the work happens. No big production needed."], ["Edit and write", "CapCut for video, Canva for pictures. AI can draft the copy. The team rewrites it in their own words."], ["Run as ads", "The team sets them up in Meta Ads Manager, several versions per offer."], ["Check the numbers", `Weekly review with ${consultant()}. Keep what works, drop what doesn't.`]];

  // --- 07 what to try: the offer, the change, why it works, formats, test order ---------------
  const OFFER: Record<string, [string, string]> = { ok: ["ok", tr("Clear", "清楚")], weak: ["weak", tr("Weak", "需要加强")], none: ["none", tr("No clear offer", "没有清楚的优惠")] };
  const ov = OFFER[T.t("try", "offer.verdict") ?? ""] ?? ["info", ""];
  const msgRows = T.list("try", "msg.now").map((now, i) =>
    `<tr><td>"${esc(clean(now))}"<span class="sm">${esc(clean(T.t("try", "msg.from", i)))}</span></td><td><strong>${esc(clean(T.t("try", "msg.better", i)))}</strong></td></tr>`).join("");
  const fmtBoxes = T.list("try", "fmt.name").map((nm, i) => {
    const seen = T.t("try", "fmt.seen", i);
    const ad = seen ? d.ads.find((a) => a.library_id === seen && !a.own) : null;
    const who = ad?.page_name ?? tr("a competitor", "同行");
    return `<div class="box"><div class="fun-top"><span class="fl">${i + 1}</span><b>${esc(clean(nm))}</b></div><dl class="facts">
      <dt>${tr("Why", "为什么")}</dt><dd>${esc(clean(T.t("try", "fmt.why", i)))}</dd>
      <dt>${tr("First 3 seconds", "开头 3 秒")}</dt><dd>${esc(clean(T.t("try", "fmt.first3", i)))}</dd>
      <dt>${tr("End with", "结尾讲")}</dt><dd>${esc(clean(T.t("try", "fmt.end", i)))}</dd>
    </dl>${ad ? `<div class="seen">${fig(ad.creative_shot_id ?? ad.shot_id, `${who} ad`, null, false, "ad")}<span>${zh ? `${link(`https://www.facebook.com/ads/library/?id=${ad.library_id}`, `${who} 的广告`)}已经在用` : `Seen in ${link(`https://www.facebook.com/ads/library/?id=${ad.library_id}`, `${who}'s ad`)}`}</span></div>` : ""}</div>`;
  }).join("");
  const testOrder = T.list("try", "order.name").map((nm, i) => `<li><div><b>${tr(`Week ${i + 1}`, `第 ${i + 1} 周`)}: ${esc(clean(nm))}</b>${esc(clean(T.t("try", "order.why", i)))}</div></li>`).join("");
  const hasTry = !!T.t("try", "lead");
  const trySection = hasTry ? `
  <section id="try" class="panel sec" aria-labelledby="h-try">${aside("07", "try", tr("What to try", "可以试试看"), tr("Ideas to test, from what we found", "根据检查结果, 值得测试的方向"))}<div class="sec-body">
    <p class="lead">${rich(T.t("try", "lead"))}</p>
    <div class="block"><h3 class="sub">${tr("The offer", "优惠")}</h3><div class="twin">
      <div class="box"><h3>${tr("Today", "现在")}</h3><p style="font-size:14.5px">${esc(clean(T.t("try", "offer.now")))}</p>${st(ov[0], ov[1])}<p class="muted" style="font-size:13px">${esc(clean(T.t("try", "offer.why")))}</p></div>
      <div class="box"><h3>${tr("Try", "试试看")}</h3><p style="font-size:14.5px">${esc(clean(T.t("try", "offer.try")))}</p></div>
    </div></div>
    ${msgRows ? `<div class="block"><h3 class="sub">${tr("Say the change, not the feature", "讲改变, 不讲功能")}</h3><div class="table-wrap"><table class="cmp"><thead><tr><th>${tr("They say now", "现在的讲法")}</th><th>${tr("Say instead", "可以改成")}</th></tr></thead><tbody>${msgRows}</tbody></table></div></div>` : ""}
    ${T.t("try", "mech.line") ? `<div class="block"><h3 class="sub">${tr("Why it works, in one line", "一句话讲为什么有效")}</h3><p class="quote">${esc(clean(T.t("try", "mech.line")))}</p><p class="muted" style="font-size:13px">${tr("From", "来源:")} ${esc(clean(T.t("try", "mech.from")))}</p></div>` : ""}
    ${fmtBoxes ? `<div class="block"><h3 class="sub">${tr(`${T.count("try", "fmt.name")} ad formats to test`, `值得测试的 ${T.count("try", "fmt.name")} 种广告形式`)}</h3><p class="muted" style="font-size:13px">${tr("All shot on a phone by their own team. Casual and real beats polished.", "全部用手机拍, 由你们自己的团队拍. 自然真实, 比拍得很精美更有效.")}</p><div class="twin">${fmtBoxes}</div></div>` : ""}
    ${testOrder ? `<div class="block"><h3 class="sub">${tr("Test order", "测试顺序")}</h3><div class="box"><ol class="stepper">${testOrder}</ol><p class="muted" style="font-size:13px">${tr("One format per week. Keep the one that brings the most chats or orders.", "每个星期测一种形式. 留下带来最多讯息或订单的那个.")}</p></div></div>` : ""}
  </div></section>` : "";

  // --- 08 plan + sources -------------------------------------------------------------------
  const planRows = T.list("plan", "title").map((t, i) => `<div class="plan-row"><span class="phase${T.t("plan", "first", i) === "true" ? " first" : ""}">${esc(clean(T.t("plan", "phase", i)))}</span><h3>${esc(clean(t))}</h3><p>${esc(clean(T.t("plan", "body", i)))}</p></div>`).join("");
  const notChecked = T.list("plan", "not_checked");
  const sources = [...new Map(
    [
      ...(d.biz.website ? [[d.biz.website, shortUrl(d.biz.website)]] : []),
      [d.biz.facebook_url, shortUrl(d.biz.facebook_url)],
      ...d.facts.filter((f) => f.source_url).map((f) => [f.source_url!, zh ? ZH_TRACK[f.label] ?? f.label : f.label]),
      ...d.ads.map((a) => [`https://www.facebook.com/ads/library/?id=${a.library_id}`, `${tr("Ad", "广告")}: ${a.page_name ?? a.library_id}`]),
      ...d.landings.map((l) => [l.url, S(l.label)]),
    ].map(([u, t]) => [u, t] as [string, string]),
  ).entries()].slice(0, 60);

  const body = `
<nav class="topbar" aria-label="${tr("Sections", "章节")}"><div class="in"><div class="brand">${logo ? `<img src="${logo}" alt="">` : ""}${esc(name)} <span>${tr("marketing audit", "营销现况报告")}</span></div><div class="jump">
  <a href="#glance">${tr("Summary", "重点")}</a><a href="#channels">${tr("Channels", "渠道")}</a><a href="#content">${tr("Content", "内容")}</a><a href="#ads">${tr("Ads", "广告")}</a><a href="#competitors">${tr("Competitors", "同行")}</a><a href="#cta">${tr("Call to action", "下单方式")}</a><a href="#creative">${tr("Creative", "素材")}</a>${hasTry ? `<a href="#try">${tr("What to try", "可以试试看")}</a>` : ""}<a href="#plan">${tr("Next steps", "建议")}</a>
</div></div></nav>
<main>
  <header class="panel cover"><div class="cover-top"><div><div class="eyebrow">${tr("Marketing audit", "营销现况报告")}</div><h1>${esc(name)}</h1><p class="company">${esc(clean(T.t("cover", "company_line")))}</p></div>${logo ? `<img class="logo" src="${logo}" alt="${esc(name)} logo">` : ""}</div>
    <p class="verdict">${rich(T.t("cover", "verdict"))}</p>
    <div class="prepared"><div><span class="eyebrow">${tr("Prepared for", "报告对象")}</span><b>${esc(name)}</b><span>${esc(shortUrl(d.biz.website ?? d.biz.facebook_url))}</span></div><div><span class="eyebrow">${tr("Checked on", "检查日期")}</span><b>${checkedOn}</b></div><div><span class="eyebrow">${tr("What we looked at", "检查范围")}</span><span>${esc(looked)}</span></div></div>
  </header>

  <section id="glance" class="panel glance" aria-labelledby="h-gl"><div class="glance-head"><h2 id="h-gl">${tr("At a glance", "重点总结")}</h2><span class="eyebrow">${tr("Click a row for the details and proof", "点击任何一行, 看详细内容和截图")}</span></div><div class="rows">
    ${glanceRow("01", "channels", "channels", tr("Channels", "渠道"), String(okChannels), zh ? "个渠道" : okChannels === 1 ? "channel found" : "channels found", okChannels <= 1)}
    ${glanceRow("02", "content", "content", tr("Content", "自家内容"), avgViews != null ? avgViews.toLocaleString("en-US") : "0", avgViews != null ? tr("average views per Reel", "每个 Reel 平均观看次数") : tr("Reels found", "找到的 Reels"), avgViews == null)}
    ${glanceRow("03", "ads", "ads", tr("Ads", "广告"), libCount ?? "?", libCount ? tr("ads in Meta Ad Library", "Meta 广告库里的广告") : tr("Ad Library not checked", "广告库未检查"), libCount === "0")}
    ${glanceRow("04", "competitors", "competitors", tr("Competitors", "同行广告"), String(rivals.length), zh ? "个同行正在投放" : rivals.length === 1 ? "competitor advertising now" : "competitors advertising now", false)}
    ${glanceRow("05", "cta", "cta", tr("Call to action", "下单方式"), String(brokenN), zh ? "个要修的地方" : brokenN === 1 ? "gap found" : "gaps found", brokenN > 0)}
    ${glanceRow("06", "creative", "creative", tr("Creative", "广告素材"), months.length ? String(zeroMonths) : "0", months.length ? (zh ? "个月没有发 Reel" : zeroMonths === 1 ? "month with no Reel" : "months with no Reel") : tr("Reels dated", "有日期的 Reels"), months.length ? zeroMonths > 0 : true)}
  </div></section>

  <section id="channels" class="panel sec" aria-labelledby="h-channels">${aside("01", "channels", tr("Channels", "渠道"), tr("Where can customers find them?", "客人在哪里找得到他们?"), "channels")}<div class="sec-body">
    <p class="lead">${rich(T.t("channels", "lead"))}</p>
    <div class="chan">${chanFacts.map(chanRow).join("")}</div>
    ${T.list("channels", "point").length ? `<div class="block"><h3 class="sub">${tr("Brand notes", "品牌备注")}</h3>${points("channels")}</div>` : ""}
    ${proof(ch1)}
  </div></section>

  <section id="content" class="panel sec" aria-labelledby="h-content">${aside("02", "content", tr("Own content", "自家内容"), tr("Do they make their own posts and videos?", "他们有没有自己拍内容?"), "content")}<div class="sec-body">
    <p class="lead">${rich(T.t("content", "lead"))}</p>
    ${reelChart}
    ${tiktokCharts}
    ${points("content")}
    ${proof(ch2)}
  </div></section>

  <section id="ads" class="panel sec" aria-labelledby="h-ads">${aside("03", "ads", tr("Ads", "广告"), tr("Have they run ads before?", "他们有没有打过广告?"), "ads")}<div class="sec-body">
    <p class="lead">${rich(T.t("ads", "lead"))}</p>
    ${moneyBlock}
    ${adTiles}
    ${trackTiles}
    ${points("ads")}
    ${own.some((a) => a.opened) ? `<div class="block"><h3 class="sub">${tr("Their live ads", "他们正在跑的广告")}</h3><div class="cards">${own.filter((a) => a.opened).map(adCard).join("")}</div></div>` : ""}
    ${proof(ch3)}
  </div></section>

  <section id="competitors" class="panel sec" aria-labelledby="h-competitors">${aside("04", "competitors", tr("Competitor ads", "同行广告"), tr("Who else sells this with ads, and how?", "还有谁用广告卖同样的东西, 怎么卖?"), "competitors")}<div class="sec-body">
    <p class="lead">${rich(T.t("competitors", "lead"))}</p>
    ${funnels}
    ${whoTable}
    ${rivals.length ? `<div class="block"><h3 class="sub">${tr("The ads", "他们的广告")}</h3><div class="cards">${rivals.map(adCard).join("")}</div></div>` : ""}
    ${words.length ? `<p class="muted" style="font-size:13px">${tr("Searched the Meta Ad Library (Malaysia, live ads) for", "在 Meta 广告库 (马来西亚, 正在投放) 搜寻了")}: ${esc(words.join(", "))}.</p>` : ""}
    ${proof(ch4)}
  </div></section>

  <section id="cta" class="panel sec" aria-labelledby="h-cta">${aside("05", "cta", tr("Call to action", "下单方式"), tr("What do they ask customers to do?", "他们叫客人做什么?"), "cta")}<div class="sec-body">
    <p class="lead">${rich(T.t("cta", "lead"))}</p>
    <div class="twin">
      <div class="box"><h3>${tr("How customers buy today", "客人现在怎样买")}</h3>${buy ? `<ol class="stepper">${buy}</ol>` : ""}<p class="muted" style="font-size:13px">${esc(clean(T.t("cta", "other_ways")))}${fbBtn ? ` ${tr("Facebook page button", "Facebook 专页按钮")}: ${esc(S(fbBtn.value))}.` : ""}</p></div>
      <div class="box"><h3>${tr("What's broken or missing", "有问题或缺少的地方")}</h3>${broken ? `<ul class="checks">${broken}</ul>` : `<p class="muted" style="font-size:13.5px">${tr("Nothing broken found.", "没有发现问题.")}</p>`}</div>
    </div>
    ${d.landings.length ? `<div class="block"><h3 class="sub">${tr("Landing pages: the first screen", "着陆页: 首屏")}</h3>${T.t("landing", "lead") ? `<p style="font-size:14.5px;color:var(--ink-2)">${rich(T.t("landing", "lead"))}</p>` : ""}</div>${landingBlocks}` : ""}
    ${cmpRows && cmpWith ? `<div class="block"><h3 class="sub">${tr(`${esc(name)} compared with ${esc(cmpWith)}`, `${esc(name)} 与 ${esc(cmpWith)} 比较`)}</h3><div class="table-wrap"><table class="cmp"><thead><tr><th></th><th>${esc(name)}</th><th>${esc(cmpWith)}</th></tr></thead><tbody>${cmpRows}</tbody></table></div></div>` : ""}
  </div></section>

  <section id="creative" class="panel sec" aria-labelledby="h-creative">${aside("06", "creative", tr("Creative", "广告素材"), tr("Is anyone making new content every week?", "有没有人每个星期出新内容?"), "creative")}<div class="sec-body">
    <p class="lead">${rich(T.t("creative", "lead"))}</p>
    ${monthChart}
    ${hookBoxes ? `<div class="block"><h3 class="sub">${tr("The first 3 seconds", "开头 3 秒")}</h3>${T.t("creative", "hooks_lead") ? `<p style="font-size:14.5px;color:var(--ink-2)">${rich(T.t("creative", "hooks_lead"))}</p>` : ""}<div class="twin">${hookBoxes}</div></div>` : ""}
    <div class="block"><h3 class="sub">${tr("4 things to decide before shooting anything", "拍之前, 先决定 4 件事")}</h3><div class="why4">
      <div><span class="k">1</span><b>${tr("Who it's for", "拍给谁看")}</b><p>${dec("who")}</p></div>
      <div><span class="k">2</span><b>${tr("One selling point", "一个卖点")}</b><p>${dec("point")}</p></div>
      <div><span class="k">3</span><b>${tr("The first 3 seconds", "开头 3 秒")}</b><p>${dec("first3")}</p></div>
      <div><span class="k">4</span><b>${tr("What to do next", "看完要做什么")}</b><p>${dec("action")}</p></div>
    </div></div>
    <div class="block"><h3 class="sub">${tr("Weekly creative routine (run by their team)", "每周素材流程 (由你们的团队执行)")}</h3><ol class="loop">
      ${routine.map(([t, x]) => `<li><b>${t}</b><span>${x}</span></li>`).join("\n      ")}
    </ol></div>
  </div></section>

  ${trySection}

  <section id="plan" class="panel sec" aria-labelledby="h-plan">${aside(hasTry ? "08" : "07", "plan", tr("Recommended next steps", "我们的建议"), tr("What to fix, then what to test", "先修什么, 再测试什么"))}<div class="sec-body">
    <p class="lead">${rich(T.t("plan", "lead"))}</p>
    <div class="plan">${planRows}</div>
    <div class="twin">
      <div class="box"><h3>${tr("Questions for the owner", "想跟你们了解的几件事")}</h3><ul class="plain">${T.list("plan", "question").map((x) => `<li>${esc(clean(x))}</li>`).join("")}</ul></div>
      <div class="box"><h3>${tr("Not checked yet", "还没检查的部分")}</h3><ul class="plain">${notChecked.map((x) => `<li>${esc(clean(x))}</li>`).join("") || `<li>${tr("Nothing", "没有")}</li>`}</ul></div>
    </div>
    <details class="src"><summary>${tr(`Sources (${sources.length} links)`, `资料来源 (${sources.length} 个连结)`)}</summary><ol class="sources">${sources.map(([u, t]) => `<li>${link(u, t)}</li>`).join("")}</ol></details>
  </div></section>

  <footer>${tr(`Checked on ${checkedOn} (Malaysia time) without logging in. Follower and view counts change daily.`, `检查日期: ${checkedOn} (马来西亚时间), 没有登入任何 account. Followers 和观看次数每天都会变.`)}</footer>
</main>
`;
  return `<!doctype html>
<html lang="${zh ? "zh-Hans" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} ${tr("Marketing Check", "营销现况报告")}</title><link rel="icon" href="data:,">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@600;700;800&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
${style}
<style>${ADDED}${mode === "embed" ? EMBED : ""}${mode === "print" ? PRINT : ""}</style>
</head><body>
${icons}
${mode === "print" ? body.replace('<details class="src">', '<details class="src" open>') : body}
${mode === "print" ? "" : zh ? viewer.replace("'Screenshot ' + (i + 1) + ' of ' + links.length", "'第 ' + (i + 1) + ' 张, 共 ' + links.length + ' 张'").replace("Click the picture to zoom in or out. Esc closes.", "点击图片放大或缩小. 按 Esc 关闭.").replace("</svg>Close</button>", "</svg>关闭</button>") : viewer}
${mode === "embed" ? EMBED_SCRIPT : ""}
</body></html>`;
}

// The text check (skill step 8): AI-slop words, mainland words in 中文, done-for-you wording, and numbers that aren't in the data.
// Dashes, semicolons and emoji need no flag: the page swaps them out (clean). Their own quoted lines are never checked for wording.
const escRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SLOP = new RegExp(`\\b(${SLOP_WORDS.map(escRe).join("|")})\\b`, "i");
// "We will run your ads" (or the consultant's name): the service is direction and training, not done-for-you.
const DFY = new RegExp(`\\b(we|the consultant${consultantName ? `|${escRe(consultantName)}` : ""}) (will )?(write|run|set up|manage|create|handle) (the |your |their )?(copy|ads|campaigns?|content)\\b`, "i");
// The whole sentence around a spot in the text, without the ** bold marks, so a flag reads as a sentence.
const sentenceAt = (plain: string, at: number) => {
  const start = Math.max(plain.lastIndexOf(". ", at) + 1, plain.lastIndexOf("? ", at) + 1, 0);
  const ends = [". ", "? ", "! "].map((e) => plain.indexOf(e, at)).filter((x) => x >= 0);
  return plain.slice(start, ends.length ? Math.min(...ends) + 1 : plain.length).trim().slice(0, 220);
};
export function textFlags(texts: { key: string; body: string }[], dataText: string, lang: Lang = "en") {
  const flags: string[] = [];
  const data = dataText.replace(/,/g, "");
  for (const { key, body } of texts) {
    const t = body.replace(/\*\*/g, "");
    const own = key === "msg.now"; // their own words, quoted as written
    if (!own && lang === "en" && SLOP.test(t)) flags.push(`AI-slop word in: "${sentenceAt(t, t.search(SLOP))}"`);
    if (!own && lang === "zh") { const w = MAINLAND.find((x) => t.includes(x)); if (w) flags.push(`Mainland word "${w}" in: "${sentenceAt(t, t.indexOf(w))}"`); }
    if (DFY.test(t)) flags.push(`Done-for-you wording in: "${sentenceAt(t, t.search(DFY))}"`);
    for (const m of t.replace(/,(?=\d{3})/g, "").matchAll(/\d+(?:\.\d+)?[KkM]?/g)) {
      const n = m[0];
      if (/^\d+$/.test(n) && +n <= 12) continue; // small counts (3 seconds, 5 questions) are wording, not data
      if (!data.includes(n) && !data.includes(n.replace(/\.0$/, ""))) flags.push(`Number ${n} isn't in the collected data: "${sentenceAt(t, Math.max(0, t.indexOf(n)))}"`);
    }
  }
  return [...new Set(flags)];
}

const SRC = { shot: (id: string) => `/shots/${id}`, upload: (id: string) => `/files/${id}` };

// One language's page, from the saved words (null when that language isn't written).
async function pageFor(auditId: string, lang: Lang, day: string, mode: Mode) {
  const d = await loadReportData(auditId, lang);
  const T = await loadTexts(auditId, lang);
  if (!d || !T.any) return null;
  const Z = lang === "zh" ? await loadZhStrings(auditId) : new Map<string, string>();
  return { d, html: buildHtml(d, T, SRC, day, mode, lang, Z) };
}

export async function renderReport(c: Ctx) {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const made: Lang[] = [];
  let flagCount = 0;
  for (const lang of ["en", "zh"] as Lang[]) {
    const p = await pageFor(c.auditId, lang, today, "page");
    if (!p) { if (lang === "en") throw new Skipped("The report words were not written yet."); continue; }
    const rows = await q<{ key: string; body: string }>(`select key, body from texts where audit_id = $1 and lang = $2`, [c.auditId, lang]);
    const flags = textFlags(rows, brief(p.d, today) + moneyBrief(moneyOf(p.d)) + JSON.stringify(p.d.facts) + JSON.stringify(p.d.amRows), lang);
    flagCount += flags.length;
    await q(
      `insert into reports (audit_id, kind, lang, html, flags) values ($1, 'internal', $2, $3, $4)
       on conflict (audit_id, kind, lang) do update set html = excluded.html, flags = excluded.flags, made_at = now()`,
      [c.auditId, lang, p.html, flags.join("\n") || null],
    );
    made.push(lang);
  }
  await c.fact({ key: "report", label: "Report", value: made.includes("zh") ? "Ready in English and 中文" : "Ready", note: flagCount ? `${flagCount} things for you to check.` : "The text check found nothing.", status: flagCount ? "weak" : "ok" });
  // Make the PDF of the picked language now, so Download PDF is instant. If it fails here it is made on the first click instead.
  const [a] = await q<{ report_lang: Lang }>(`select report_lang from audits where id = $1`, [c.auditId]);
  const lang: Lang = a?.report_lang === "zh" && made.includes("zh") ? "zh" : "en";
  const [r] = await q<{ made_at: string }>(`select made_at from reports where audit_id = $1 and kind = 'internal' and lang = $2`, [c.auditId, lang]);
  if (r) await reportPdf(c.auditId, r.made_at, lang).catch((e) => console.error("report pdf", e));
}

// The report page as the code draws it now, from the saved words and data (so a fix to the page shows on old reports too).
// Dates count from the day the report was made, not today.
export async function currentHtml(auditId: string, madeAt: string, mode: Mode = "page", lang: Lang = "en") {
  const day = new Date(Date.parse(madeAt) + 8 * 3600e3).toISOString().slice(0, 10);
  return (await pageFor(auditId, lang, day, mode))?.html ?? null;
}

// The PDF: the same report printed by Chrome on this PC, A4, every photo inside. Kept next to the screenshots,
// made again when the report is newer or the app was restarted (a restart is how a new version of the page arrives).
const BOOT = Date.now();
const making = new Map<string, Promise<string | null>>();
export function reportPdf(auditId: string, madeAt: string, lang: Lang = "en"): Promise<string | null> {
  const file = path.join(uploadsDir(), auditId, "pdf", `report-${lang}.pdf`);
  if (fs.existsSync(file) && fs.statSync(file).mtimeMs > Math.max(Date.parse(madeAt), BOOT)) return Promise.resolve(file);
  const job = `${auditId}:${lang}`;
  if (!making.has(job)) {
    making.set(job, (async () => {
      const html = await currentHtml(auditId, madeAt, "print", lang);
      if (!html) return null;
      const full = await inlineImages(auditId, html);
      const { launch } = await import("../collect/kit");
      const browser = await launch();
      try {
        const page = await browser.newPage();
        await page.setContent(full, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
        await page.evaluate(() => document.fonts.ready);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await page.pdf({ path: `${file}.tmp`, format: "A4", printBackground: true, preferCSSPageSize: true });
        fs.renameSync(`${file}.tmp`, file);
        return file;
      } finally {
        await browser.close();
      }
    })().finally(() => making.delete(job)));
  }
  return making.get(job)!;
}

// One file to send or keep: every picture inside the HTML.
export function inlineImages(auditId: string, html: string) {
  const dir = uploadsDir();
  return q<{ id: string; file: string }>(`select id::text, file from shots where audit_id = $1`, [auditId]).then(async (shots) => {
    const ups = await q<{ id: string; file: string; mime: string }>(`select id::text, file, mime from uploads where audit_id = $1`, [auditId]);
    const data = (file: string, mime: string) => {
      const full = path.join(dir, file);
      return fs.existsSync(full) ? `data:${mime};base64,${fs.readFileSync(full).toString("base64")}` : "";
    };
    return html
      .replace(/\/shots\/(\d+)/g, (m, id) => { const s = shots.find((x) => x.id === id); return s ? data(s.file, "image/jpeg") : m; })
      .replace(/\/files\/(\d+)/g, (m, id) => { const u = ups.find((x) => x.id === id); return u ? data(u.file, u.mime) : m; });
  });
}
