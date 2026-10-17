import fs from "node:fs";
import { q } from "../db";
import { shortUrl } from "../format";
import { dayIn } from "../settings";
import { renderReport } from "../report/render";
import { writeReport } from "../report/write";
import { writeReportZh } from "../report/write-zh";
import { adsManager, ownAds } from "./ads";
import { competitorAds, competitorPick, competitorSearch, searchWords } from "./competitors";
import { hooks } from "./creative";
import { buying, foldReview, landings } from "./cta";
import { tiktok as tiktokStep } from "./tiktok";
import { clearFbPopup, countOf, fbPage, isCaptcha, isLoginWall, nameKey, NotChecked, pageSetup, Skipped, type Ctx } from "./kit";

// The steps of checks 1 to 6 and the report (7), in run order.
// noBrowser: the step only reads what was collected (AI or code), so no browser is opened for it.
export type StepDef = { key: string; check: 1 | 2 | 3 | 4 | 5 | 6 | 7; label: string; needsWebsite?: boolean; noBrowser?: boolean; run: (c: Ctx) => Promise<unknown> };

const SOCIAL = /https?:\/\/[^"'\s<>]*(facebook\.com|instagram\.com|tiktok\.com|youtube\.com|wa\.me|api\.whatsapp\.com|xiaohongshu\.com|play\.google\.com|apps\.apple\.com|itunes\.apple\.com|shopee\.com\.my|lazada\.com\.my)[^"'\s<>]*/gi;
const platformOf = (u: string) =>
  /instagram/.test(u) ? "Instagram" : /tiktok/.test(u) ? "TikTok" : /youtube/.test(u) ? "YouTube" : /wa\.me|whatsapp/.test(u) ? "WhatsApp"
  : /xiaohongshu/.test(u) ? "小红书" : /play\.google/.test(u) ? "Google Play" : /apple\.com/.test(u) ? "App Store"
  : /shopee/.test(u) ? "Shopee" : /lazada/.test(u) ? "Lazada" : /facebook\.com|fb\.com/.test(u) ? "Facebook" : "Website";

// --- Check 1: channels -----------------------------------------------------------------

async function website(c: Ctx) {
  const url = c.biz.website!;
  let status = 0;
  try { status = await c.open(url, 3000); } catch { status = 0; }
  const shotId = await c.shot("Website homepage", { sourceUrl: url }).catch(() => null);
  if (!status || status >= 400) {
    await c.fact({ key: "website", label: "Website", value: shortUrl(url), note: status ? `The site answers with error ${status}.` : "The site did not load.", status: "none", sourceUrl: url, shotId });
    return;
  }
  // Title, social links in the HTML, platform, a shop or cart.
  const info = await c.page.evaluate((re) => {
    const html = document.documentElement.innerHTML;
    const social = [...new Set(html.match(new RegExp(re, "gi")) || [])];
    const cart = /add to cart|checkout|cart/i.test(document.body.innerText);
    return { title: document.title.slice(0, 120), social, cart };
  }, SOCIAL.source);
  const { platform } = await c.page.evaluate(pageSetup);
  const bits = [platform && `Built on ${platform}.`, info.cart ? "Has a shop or cart." : "", info.title && `Title: ${info.title}`].filter(Boolean);
  await c.fact({ key: "website", label: "Website", value: shortUrl(url), note: bits.join(" "), status: "ok", sourceUrl: url, shotId });
  for (const link of info.social.filter((l) => !/facebook\.com\/(sharer|tr|plugins|dialog)/.test(l)).slice(0, 20)) {
    await c.fact({ key: "site_link", label: platformOf(link), value: link, note: "Found on the website", status: "info", sourceUrl: url });
  }
}

async function facebook(c: Ctx) {
  const url = c.biz.facebook_url;
  await c.open(url, 3500);
  const text = await c.text();
  if (isLoginWall(text, c.page.url())) throw new NotChecked("Facebook asked to log in.");
  if (/This content isn't available|Page not found/i.test(text)) {
    const shotId = await c.shot("Facebook: page not available", { sourceUrl: url });
    await c.fact({ key: "facebook", label: "Facebook", value: shortUrl(url), note: "Facebook says this page isn't available. Check the link.", status: "none", sourceUrl: url, shotId });
    return;
  }
  const html = await c.page.content();
  // The page ID the Ad Library needs is in the page itself (no search clicks).
  const pageId = (html.match(/"associated_page_id":"(\d+)"/) || html.match(/"delegate_page":\{"id":"(\d+)"/) || html.match(/"pageID":"(\d+)"/) || [])[1];
  if (pageId) await q(`update businesses set facebook_page_id = $1 where facebook_url = $2`, [pageId, url]);
  const desc = await c.page.evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute("content") || "");
  const followers = (text.match(/([\d.,]+[KM]?) followers/i) || [])[1];
  const exact = (desc.match(/([\d,]+) followers/i) || [])[1];
  const category = (text.match(/Page · ([^\n]+)/) || [])[1];
  const recommend = (text.match(/(\d+% recommend \([\d,]+ reviews?\))/i) || [])[1];
  // Links in the page's intro (website, Instagram, WhatsApp ...), through Facebook's redirect.
  const outs = await c.page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="l.facebook.com/l.php"]')].map((a) => decodeURIComponent(((a as HTMLAnchorElement).href.match(/u=([^&]+)/) || [])[1] || "")))].filter(Boolean).slice(0, 12));
  await clearFbPopup(c.page);
  const shotId = await c.shot("Facebook page", { sourceUrl: url });
  // The round profile picture (the first big one), for the report's logo.
  const pics = c.page.locator("svg:has(image)");
  for (let i = 0; i < Math.min(await pics.count(), 4); i++) {
    const box = await pics.nth(i).boundingBox();
    if (box && box.width >= 120) {
      await c.shot("Logo (Facebook profile picture)", { kind: "logo", element: pics.nth(i), sourceUrl: url }).catch(() => null);
      break;
    }
  }
  const note = [category && `Category: ${category}.`, recommend && `${recommend}.`, exact && `Exact count: ${exact}.`, pageId && `Page ID ${pageId}.`].filter(Boolean).join(" ");
  await c.fact({ key: "facebook", label: "Facebook", value: followers ? `${followers} followers` : shortUrl(url), note: note || null, status: "ok", sourceUrl: url, shotId });
  for (const link of outs.filter((l) => /^https?:\/\//.test(l))) {
    await c.fact({ key: "site_link", label: platformOf(link), value: link, note: "Found on the Facebook page", status: "info", sourceUrl: url });
  }
  // The page's own button (Send message, WhatsApp, Shop now ...), for check 5.
  const button = (text.match(/\n(Send message|Send WhatsApp message|WhatsApp|Shop now|Book now|Order now|Call now|Contact us|Sign up|Learn more|Get quote)\n/) || [])[1];
  await c.fact({ check: 5, key: "fb_button", label: "Facebook page button", value: button ?? "None shown", note: button ? null : "Logged out, no action button was shown next to Follow.", status: button ? "info" : "weak", sourceUrl: url, shotId });
  // The newest post: its reactions, first words and whether Facebook labels it as AI content.
  const at = text.indexOf("All reactions:");
  if (at > 0) {
    const before = text.slice(Math.max(0, at - 500), at).split("\n").map((s) => s.trim()).filter((s) => s && s !== "·");
    const words = before.filter((s) => s.length > 25 && !/^\d+:\d+ \/ /.test(s)).slice(-1)[0];
    const reactions = (text.slice(at).match(/All reactions:\s*\n?([\d.,KM]+)/) || [])[1];
    const ai = /AI info|AI content|Made with AI/i.test(text.slice(Math.max(0, at - 800), at));
    await c.fact({ check: 2, key: "newest_post", label: "Newest post", value: reactions ? `${reactions} reactions` : null, note: [words, ai ? "Labelled as AI content." : ""].filter(Boolean).join(" "), status: "info", sourceUrl: url, shotId });
  }
}

// Handles to try: links found so far, then the Facebook name and the company name.
// linked = handles their website or Facebook page links to; the rest are guesses that may belong to someone else.
async function handles(c: Ctx, host: RegExp, skip: string[]) {
  const found = (await c.siteLinks()).map((u) => (u.match(host) || [])[1]).filter((h): h is string => !!h && !skip.includes(h.toLowerCase())).map((h) => h.toLowerCase());
  const fb = fbPage(c.biz.facebook_url).slug?.toLowerCase().replace(/[^a-z0-9_.]/g, "");
  const list = [...new Set([...found, fb, nameKey(c.biz.name)].filter((h): h is string => !!h && h.length >= 3))].slice(0, 4);
  return { list, linked: new Set(found) };
}
export const whose = (linked: Set<string>, h: string) =>
  linked.has(h) ? "Linked from their website or Facebook page." : "Not linked from their website or Facebook page: the name was guessed, so it may belong to someone else.";

async function instagram(c: Ctx) {
  const { list, linked } = await handles(c, /instagram\.com\/([A-Za-z0-9_.]+)/, ["p", "reel", "reels", "explore", "accounts", "stories"]);
  for (const h of list) {
    const url = `https://www.instagram.com/${h}/`;
    await c.open(url, 3500);
    const text = await c.text();
    if (/\/accounts\/login/.test(c.page.url())) { await c.fact({ key: "instagram", label: `Instagram @${h}`, note: "Instagram asked to log in.", status: "not_checked", sourceUrl: url }); continue; }
    if (isCaptcha(text)) { await c.fact({ key: "instagram", label: `Instagram @${h}`, note: "Instagram showed a check for robots.", status: "not_checked", sourceUrl: url }); continue; }
    await clearFbPopup(c.page);
    const shotId = await c.shot(`Instagram @${h}`, { sourceUrl: url });
    if (/Profile isn't available|Sorry, this page isn't available/i.test(text)) {
      await c.fact({ key: "instagram", label: `Instagram @${h}`, value: "No profile", note: "Instagram says this profile isn't available.", status: "none", sourceUrl: url, shotId });
      continue;
    }
    const desc = await c.page.evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute("content") || "");
    const m = desc.match(/([\d.,]+[KM]?) Followers, ([\d.,]+[KM]?) Following, ([\d.,]+[KM]?) Posts/i);
    await c.fact({ key: "instagram", label: `Instagram @${h}`, value: m ? `${m[1]} followers` : "Profile found", note: [m ? `${m[3]} posts.` : "", whose(linked, h)].filter(Boolean).join(" "), status: "ok", sourceUrl: url, shotId });
  }
}

async function tiktok(c: Ctx) {
  const { list, linked } = await handles(c, /tiktok\.com\/@([A-Za-z0-9_.]+)/, []);
  await tiktokStep(c, list, (h) => whose(linked, h));
}

async function maps(c: Ctx) {
  const url = `https://www.google.com/maps/search/${encodeURIComponent(c.biz.name)}?hl=en`;
  await c.open(url, 5000);
  const text = await c.text();
  if (isCaptcha(text)) throw new NotChecked("Google showed a check for robots.");
  // One match opens the place itself instead of a list. Each place: name + rating (reviews).
  const places = await c.page.evaluate(() => {
    const rate = (t: string) => { const m = t.match(/(\d\.\d)\s*\(([\d,]+)\)/); return m ? `${m[1]} (${m[2]} reviews)` : /No reviews/i.test(t) ? "no reviews" : ""; };
    const list = [...document.querySelectorAll('[role="feed"] > div > div[jsaction], [role="article"]')].map((e) => (e as HTMLElement).innerText);
    if (list.length) return list.map((t) => ({ name: t.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "", rating: rate(t.replace(/\n/g, " ")) })).filter((p) => p.name).slice(0, 8);
    const h1 = document.querySelector("h1")?.textContent?.trim();
    return h1 ? [{ name: h1, rating: rate(document.body.innerText.replace(/\n/g, " ")) }] : [];
  });
  const shotId = await c.shot(`Google Maps: ${c.biz.name}`, { sourceUrl: url });
  // Only places with their name count; the rest are other businesses the search also showed.
  const key = nameKey(c.biz.name);
  const mine = places.filter((p) => { const k = nameKey(p.name); return key.length >= 3 && k.length >= 3 && (k.includes(key) || key.includes(k)); });
  const others = places.filter((p) => !mine.includes(p));
  const fmt = (p: { name: string; rating: string }) => (p.rating ? `${p.name}, ${p.rating}` : p.name);
  await c.fact({
    key: "maps", label: "Google Maps",
    value: mine.length ? `${mine.length} ${mine.length === 1 ? "place" : "places"} found` : "Not found",
    note: mine.length
      ? `${mine.map(fmt).join(". ")}.`
      : `No place named "${c.biz.name}".${others.length ? ` The search showed other businesses: ${others.slice(0, 3).map((p) => p.name).join(", ")}.` : ""}`,
    status: mine.length ? "ok" : "none", sourceUrl: url, shotId,
  });
}

async function apps(c: Ctx) {
  const links = [...new Set((await c.siteLinks()).filter((u) => /play\.google\.com\/store\/apps|apps\.apple\.com|itunes\.apple\.com/.test(u)))].slice(0, 4);
  if (!links.length) throw new Skipped("No app links on the website or Facebook page.");
  for (const link of links) {
    let status = 0;
    try { status = await c.open(link, 2500); } catch { status = 0; }
    const shotId = await c.shot(`${platformOf(link)} link`, { sourceUrl: link });
    const ok = status > 0 && status < 400;
    await c.fact({ key: "app", label: platformOf(link), value: ok ? "Live" : status ? `Not found (${status})` : "Did not load", note: ok ? null : "The link on their site leads nowhere.", status: ok ? "ok" : "none", sourceUrl: link, shotId });
  }
}

// --- Check 2: own content ----------------------------------------------------------------

async function reels(c: Ctx) {
  const url = fbPage(c.biz.facebook_url).reels;
  await c.open(url, 4000);
  const text = await c.text();
  if (isLoginWall(text, c.page.url())) throw new NotChecked("Facebook asked to log in.");
  // Views per Reel from the grid.
  const list = await c.page.evaluate(() => {
    const r = [...document.querySelectorAll('a[href*="/reel/"]')].map((a) => ({ h: (a as HTMLAnchorElement).href.split("?")[0], v: (a as HTMLElement).innerText.trim() }));
    return [...new Map(r.map((x) => [x.h, x])).values()].slice(0, 10);
  });
  await clearFbPopup(c.page);
  await c.page.locator('a[href*="/reel/"]').first().scrollIntoViewIfNeeded().catch(() => null);
  const shotId = await c.shot("Facebook Reels with views", { sourceUrl: url });
  if (!list.length) {
    await c.fact({ key: "reels", label: "Facebook Reels", value: "No Reels found", status: "none", sourceUrl: url, shotId });
    return;
  }
  let i = 0;
  for (const r of list) {
    const id = (r.h.match(/\/reel\/(\d+)/) || [])[1];
    if (!id) continue;
    await q(`insert into reels (audit_id, step_id, reel_id, url, views_text, views, position) values ($1, $2, $3, $4, $5, $6, $7) on conflict (audit_id, reel_id) do nothing`,
      [c.auditId, c.stepId, id, r.h, r.v || null, countOf(r.v), i++]);
  }
  const views = list.map((r) => countOf(r.v)).filter((n): n is number => n !== null);
  const avg = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : null;
  await c.fact({
    key: "reels", label: "Facebook Reels", value: `${list.length} newest Reels`,
    note: views.length ? `Views from ${Math.min(...views).toLocaleString("en-US")} to ${Math.max(...views).toLocaleString("en-US")}, average ${avg!.toLocaleString("en-US")}.` : null,
    status: "info", sourceUrl: url, shotId,
  });
}

// The Reel playing on this page: one preview frame (at 0.5 s), and for the newest ones the first 4 seconds
// as one strip of 4 frames (0, 1, 2, 3 s).
async function reelFrames(c: Ctx, strip: boolean): Promise<{ thumb: string | null; strip: string | null }> {
  return c.page.evaluate(async (withStrip) => {
    const v = document.querySelector("video");
    if (!v || !v.videoWidth) return { thumb: null, strip: null };
    v.muted = true;
    v.pause();
    const seek = async (t: number) => { v.currentTime = t; await new Promise((r) => { v.addEventListener("seeked", r, { once: true }); setTimeout(r, 4000); }); };
    const ratio = v.videoHeight / v.videoWidth;
    await seek(0.5);
    const one = document.createElement("canvas");
    one.width = 360;
    one.height = Math.round(360 * ratio);
    one.getContext("2d")!.drawImage(v, 0, 0, one.width, one.height);
    const thumb = one.toDataURL("image/jpeg", 0.85);
    if (!withStrip) return { thumb, strip: null };
    const W = 300, H = Math.round(W * ratio), GAP = 8;
    const cv = document.createElement("canvas");
    cv.width = W * 4 + GAP * 3;
    cv.height = H;
    const x = cv.getContext("2d")!;
    x.fillStyle = "#fff";
    x.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < 4; i++) {
      await seek(i === 0 ? 0.1 : i);
      x.drawImage(v, i * (W + GAP), 0, W, H);
    }
    return { thumb, strip: cv.toDataURL("image/jpeg", 0.85) };
  }, strip).catch(() => ({ thumb: null, strip: null }));
}

const saveData = (c: Ctx, caption: string, data: string | null, kind: "thumb" | "frames", url: string) =>
  data ? c.shotFile(caption, async (full) => fs.writeFileSync(full, Buffer.from(data.split(",")[1], "base64")), { kind, sourceUrl: url }).catch(() => null) : Promise.resolve(null);

async function reelDates(c: Ctx) {
  const rows = await q<{ id: string; url: string }>(`select id::text, url from reels where audit_id = $1 order by position`, [c.auditId]);
  if (!rows.length) throw new Skipped("No Reels to date.");
  // The first creation_time on a Reel page is its post time.
  // The 4 newest also keep their first seconds and caption, for the hook check in check 6.
  let dated = 0;
  for (const [i, r] of rows.entries()) {
    await c.open(r.url, 3000);
    const text = await c.text();
    if (isLoginWall(text, c.page.url())) throw new NotChecked("Facebook asked to log in.");
    const m = (await c.page.content()).match(/"creation_time":(\d{10})/);
    if (m) {
      const day = dayIn(+m[1] * 1000);
      await q(`update reels set posted_on = $2 where id = $1`, [r.id, day]);
      dated++;
    }
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    const at = lines.indexOf("Forgotten account?");
    const caption = at >= 0 ? lines.slice(at + 1, at + 3).join(" ").replace(/… See more$/, "").slice(0, 300) : null;
    const f = await reelFrames(c, i < 4);
    const thumbId = await saveData(c, "Reel preview", f.thumb, "thumb", r.url);
    const framesId = await saveData(c, "First 4 seconds of a Reel", f.strip, "frames", r.url);
    await q(`update reels set caption = $2, thumb_shot_id = $3, frames_shot_id = $4 where id = $1`, [r.id, caption, thumbId, framesId]);
  }
  await c.fact({ key: "reel_dates", label: "Reel post dates", value: `${dated} of ${rows.length} dated`, status: dated ? "info" : "none", sourceUrl: rows[0].url });
}

// --- Check 3: ads ------------------------------------------------------------------------

async function transparency(c: Ctx) {
  const url = fbPage(c.biz.facebook_url).transparency;
  await c.open(url, 3500);
  const text = await c.text();
  if (isLoginWall(text, c.page.url())) throw new NotChecked("Facebook asked to log in.");
  await clearFbPopup(c.page);
  const shotId = await c.shot("Facebook page transparency", { sourceUrl: url });
  const running = (text.match(/This Page is (?:currently|not currently) running ads/i) || [])[0];
  const pageId = (text.match(/(\d{6,})\s*\n\s*Page ID/) || [])[1];
  const created = (text.match(/([^\n]+)\s*\n\s*Creation date/) || [])[1];
  if (pageId) await q(`update businesses set facebook_page_id = coalesce(facebook_page_id, $1) where facebook_url = $2`, [pageId, c.biz.facebook_url]);
  await c.fact({
    key: "transparency", label: "Page transparency", value: running ? (/not currently/i.test(running) ? "Not running ads" : "Running ads now") : "No ads line shown",
    note: [running && `Facebook says: "${running}."`, created && `Page created ${created}.`].filter(Boolean).join(" ") || null,
    status: running ? (/not currently/i.test(running) ? "none" : "ok") : "info", sourceUrl: url, shotId,
  });
}

async function adLibrary(c: Ctx) {
  const [b] = await q<{ facebook_page_id: string | null }>(`select facebook_page_id from businesses where facebook_url = $1`, [c.biz.facebook_url]);
  const pid = b?.facebook_page_id;
  if (!pid) throw new NotChecked("Couldn't find the Facebook page ID, so the Ad Library search was not run.");
  const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&media_type=all&search_type=page&view_all_page_id=${pid}`;
  await c.open(url, 5000);
  const text = await c.text();
  if (isLoginWall(text, c.page.url())) throw new NotChecked("Facebook asked to log in.");
  const none = /No ads match/i.test(text);
  const count = (text.match(/~?[\d,.]+[KM]? results?/) || [])[0];
  const shotId = await c.shot(none ? "Meta Ad Library: no ads match" : `Meta Ad Library: ${count ?? "ads"}`, { sourceUrl: url });
  await c.fact({
    key: "ad_library", label: "Meta Ad Library", value: none ? "0 ads" : count ? count.replace(/results?/, "ads") : "Ads shown",
    note: "All countries, live and past ads of this page.", status: none ? "none" : "ok", sourceUrl: url, shotId,
  });
}

async function adDomain(c: Ctx) {
  const domain = new URL(c.biz.website!).hostname.replace(/^www\./, "");
  const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=MY&media_type=all&q=%22${encodeURIComponent(domain)}%22&search_type=keyword_exact_phrase`;
  await c.open(url, 5000);
  const text = await c.text();
  if (isLoginWall(text, c.page.url())) throw new NotChecked("Facebook asked to log in.");
  const none = /No ads match/i.test(text);
  const count = (text.match(/~?[\d,.]+[KM]? results?/) || [])[0];
  const shotId = await c.shot(`Ad Library search for "${domain}"`, { sourceUrl: url });
  await c.fact({ key: "ad_domain", label: `Ads mentioning ${domain}`, value: none ? "0 ads" : count ? count.replace(/results?/, "ads") : "Ads shown", note: "Malaysia, live and past.", status: none ? "none" : "ok", sourceUrl: url, shotId });
}

async function sameName(c: Ctx) {
  // Choose "All ads", type the name, read the advertiser list.
  const url = "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=MY&media_type=all";
  await c.open(url, 4000);
  await c.page.getByRole("combobox", { name: /Ad category/i }).first().click({ timeout: 10000 });
  await c.page.waitForTimeout(700);
  await c.page.getByRole("gridcell", { name: /All ads/i }).first().click({ timeout: 10000 });
  await c.page.waitForTimeout(1200);
  const box = c.page.getByRole("searchbox", { name: /keyword or advertiser/i }).first();
  await box.click();
  await box.pressSequentially(c.biz.name.slice(0, 60), { delay: 70 });
  await c.page.waitForTimeout(3500);
  const options = await c.page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => (o as HTMLElement).innerText.split("\n").map((s) => s.trim()).filter(Boolean)));
  const shotId = await c.shot(`Ad Library pages named "${c.biz.name}"`, { sourceUrl: url });
  const want = nameKey(c.biz.name);
  const slug = (fbPage(c.biz.facebook_url).slug ?? "").toLowerCase();
  const pages = options.filter((o) => o[1]?.startsWith("@") && want && nameKey(o[0]).includes(want));
  if (!pages.length) {
    await c.fact({ key: "same_name", label: "Same-name pages", value: "None found", note: `No advertiser pages named like "${c.biz.name}".`, status: "info", sourceUrl: url, shotId });
    return;
  }
  for (const o of pages.slice(0, 8)) {
    const handle = o[1].split(/\s/)[0];
    const mine = handle.slice(1).toLowerCase() === slug;
    await c.fact({ key: "same_name", label: `${o[0]} ${handle}`, value: mine ? "This page" : "Other page", note: o.slice(2).join(" ").replace(/^·\s*/, "") || null, status: mine ? "info" : "weak", sourceUrl: url, shotId });
  }
}

async function tracking(c: Ctx) {
  const url = c.biz.website!;
  let status = 0;
  try { status = await c.open(url, 3500); } catch { status = 0; }
  if (!status || status >= 400) throw new NotChecked("The website did not load.");
  const t = await c.page.evaluate(pageSetup);
  const rows: [string, boolean, string | null][] = [
    ["Meta pixel", t.meta, null],
    ["Google Analytics or Tag Manager", t.ga, null],
    ["TikTok pixel", t.tiktok, null],
    ["WhatsApp button", t.whatsapp.length > 0, t.whatsapp[0] ?? null],
  ];
  for (const [label, ok, note] of rows) {
    await c.fact({ key: "tracking", label, value: ok ? "Found" : "Missing", note, status: ok ? "ok" : "none", sourceUrl: url });
  }
}

export const STEPS: StepDef[] = [
  { key: "website", check: 1, label: "Website", needsWebsite: true, run: website },
  { key: "facebook", check: 1, label: "Facebook page", run: facebook },
  { key: "instagram", check: 1, label: "Instagram", run: instagram },
  { key: "tiktok", check: 1, label: "TikTok", run: tiktok },
  { key: "maps", check: 1, label: "Google Maps", run: maps },
  { key: "apps", check: 1, label: "App links", run: apps },
  { key: "reels", check: 2, label: "Facebook Reels", run: reels },
  { key: "reel_dates", check: 2, label: "Reel post dates and first seconds", run: reelDates },
  { key: "transparency", check: 3, label: "Page transparency", run: transparency },
  { key: "ad_library", check: 3, label: "Meta Ad Library", run: adLibrary },
  { key: "ad_domain", check: 3, label: "Website in the Ad Library", needsWebsite: true, run: adDomain },
  { key: "same_name", check: 3, label: "Same-name pages", run: sameName },
  { key: "tracking", check: 3, label: "Website tracking", needsWebsite: true, run: tracking },
  { key: "own_ads", check: 3, label: "Their live ads, opened", run: ownAds },
  { key: "ads_manager", check: 3, label: "Ads Manager screenshots (AI reads them)", noBrowser: true, run: adsManager },
  { key: "search_words", check: 4, label: "Search words (AI)", noBrowser: true, run: searchWords },
  { key: "competitor_search", check: 4, label: "Ad Library searches", run: competitorSearch },
  { key: "competitor_pick", check: 4, label: "Pick the real competitors (AI)", noBrowser: true, run: competitorPick },
  { key: "competitor_ads", check: 4, label: "Competitor ads, opened", run: competitorAds },
  { key: "landings", check: 5, label: "Landing pages, computer and phone", run: landings },
  { key: "fold_review", check: 5, label: "First screen checklist (AI)", noBrowser: true, run: foldReview },
  { key: "buying", check: 5, label: "Buying steps and dead links", needsWebsite: true, run: buying },
  { key: "hooks", check: 6, label: "First 3 seconds of the videos (AI)", noBrowser: true, run: hooks },
  { key: "write", check: 7, label: "Write the report (AI)", noBrowser: true, run: writeReport },
  { key: "write_zh", check: 7, label: "Write the 中文 report (AI)", noBrowser: true, run: writeReportZh },
  { key: "render", check: 7, label: "Build the report page", noBrowser: true, run: renderReport },
];

// Retrying one of these also redoes the steps that use its results. The report is always rebuilt after a retry.
export const DEPENDS: Record<string, string[]> = {
  reels: ["reel_dates", "hooks"],
  reel_dates: ["hooks"],
  own_ads: ["landings", "fold_review", "hooks"],
  search_words: ["competitor_search", "competitor_pick", "competitor_ads", "landings", "fold_review", "hooks"],
  competitor_search: ["competitor_pick", "competitor_ads", "landings", "fold_review", "hooks"],
  competitor_pick: ["competitor_ads", "landings", "fold_review", "hooks"],
  competitor_ads: ["landings", "fold_review", "hooks"],
  landings: ["fold_review"],
};
export const REPORT_KEYS = ["write", "write_zh", "render"];
