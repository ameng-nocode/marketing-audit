import { execFile } from "node:child_process";
import { q } from "../db";
import { clearFbPopup, dayOf, isLoginWall, NotChecked, type Ctx } from "./kit";

// Meta Ad Library, logged out: the search results list (skill snippet S7) and one ad in its box (S8).

export type FoundAd = { id: string; started: string | null; versions: number | null; page: string | null; text: string | null; cta: string | null };

const CTAS = "Learn more|Shop now|Send message|Order now|Send WhatsApp message|WhatsApp|Book now|Sign up|Contact us|Get offer|Install now|Call now|Get quote|Apply now|Subscribe|Watch more|Download|Get directions|Buy now|See menu|Get started|Message|Get promotions|Request time|Listen now|Play game|Use app|Install app|Donate now|See more|Get access|Send Instagram message";

// Where an ad sends people, in plain words. The Ad Library shows a Messenger ad's link as fb.com/messenger_doc,
// which opens an error page when logged out: that is not a broken ad.
export function leadsTo(url: string | null, cta: string | null) {
  if (url && /messenger_doc|m\.me\/|messenger\.com/i.test(url)) return "Messenger";
  if (url && /wa\.me|whatsapp\.com/i.test(url)) return "WhatsApp";
  if (url && /instagram\.com|ig\.me/i.test(url)) return "Instagram";
  if (url && /facebook\.com|fb\.com|fb\.me|fb\.watch/i.test(url)) return "Facebook";
  if (url) return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  if (cta && /whatsapp/i.test(cta)) return "WhatsApp";
  if (cta && /message/i.test(cta)) return "Messenger";
  return null;
}

export async function readResults(c: Ctx, url: string, scrolls = 3): Promise<{ count: string | null; ads: FoundAd[]; none: boolean }> {
  await c.open(url, 4500);
  const text0 = await c.text();
  if (isLoginWall(text0, c.page.url())) throw new NotChecked("Facebook asked to log in.");
  for (let i = 0; i < scrolls; i++) {
    await c.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await c.page.waitForTimeout(2000);
  }
  const r = await c.page.evaluate((ctas) => {
    const t = document.body.innerText;
    const count = (t.match(/~?[\d,.]+[KM]? results?/) || [])[0] ?? null;
    const re = new RegExp(`See (?:ad|summary) details\\n([^\\n]+)\\nSponsored\\n([\\s\\S]*?)(?:\\n(${ctas})\\n|$)`);
    const ads = t.split("Library ID: ").slice(1).map((b) => {
      const id = b.split("\n")[0].trim();
      const started = (b.match(/Started running on ([^\n]+)/) || [])[1] ?? null;
      const m = b.match(re);
      const versions = (b.match(/(\d+) ads use this creative and text/) || [])[1];
      return { id, started, versions: versions ? +versions : null, page: m ? m[1] : null, text: m ? m[2].slice(0, 400) : null, cta: m ? m[3] ?? null : null };
    });
    return { count, ads, none: /No ads match/i.test(t) };
  }, CTAS);
  await c.page.evaluate(() => window.scrollTo(0, 0));
  return r;
}

export async function saveFound(c: Ctx, ads: FoundAd[], o: { own: boolean; word?: string | null; start: number }) {
  let pos = o.start;
  for (const a of ads) {
    if (!/^\d+$/.test(a.id)) continue;
    await q(
      `insert into ads (audit_id, step_id, own, library_id, page_name, started_on, versions, body, cta, search_word, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (audit_id, library_id) do nothing`,
      [c.auditId, c.stepId, o.own, a.id, a.page, dayOf(a.started), a.versions, a.text, a.cta, o.word ?? null, pos++],
    );
  }
  return pos;
}

// First 4 seconds of a video as one strip of 4 frames (0, 1, 2, 3 s). The video link is only good for a while, so it runs now.
export function frameStrip(src: string, out: string) {
  return new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", ["-y", "-loglevel", "error", "-t", "4", "-i", src, "-vf", "fps=1,scale=300:-2,tile=4x1:padding=8:color=white", "-frames:v", "1", "-q:v", "3", out],
      { timeout: 60000, windowsHide: true }, (e) => (e ? reject(e) : resolve()));
  });
}

// One clear frame of a video ad (at 0.5 s), as the ad's picture.
export function firstFrame(src: string, out: string) {
  return new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.5", "-i", src, "-frames:v", "1", "-vf", "scale=600:-2", "-q:v", "3", out],
      { timeout: 60000, windowsHide: true }, (e) => (e ? reject(e) : resolve()));
  });
}

// Open one ad in its box: full text, start date, link, video length, a screenshot of the box and the first frames.
export async function openAd(c: Ctx, ad: { id: string; library_id: string; page_name: string | null }, opts: { followers?: boolean } = {}) {
  await c.page.setViewportSize({ width: 1366, height: 1300 });
  try {
    const url = `https://www.facebook.com/ads/library/?id=${ad.library_id}`;
    await c.open(url, 4500);
    const box = c.page.locator('[role="dialog"]').filter({ hasText: "Library ID" }).first();
    if (!(await box.count())) {
      await q(`update ads set opened = true, format = 'not shown' where id = $1`, [ad.id]);
      return false;
    }
    const info = await box.evaluate((el, ctas) => {
      const decode = (h: string) => decodeURIComponent((h.match(/u=([^&]+)/) || [])[1] || "");
      // The ad's button is its own line in the box (Shop now, Send message ...); the last match is the button under the picture.
      const btn = new RegExp(`^(${ctas})$`, "i");
      const cta = (el as HTMLElement).innerText.split("\n").map((s) => s.trim()).filter((s) => btn.test(s)).pop() ?? null;
      const links = [...new Set([...el.querySelectorAll('a[href*="l.facebook.com"]')].map((a) => decode((a as HTMLAnchorElement).href)).filter(Boolean))];
      const pageUrl = [...el.querySelectorAll('a[href^="https://www.facebook.com/"]')].map((a) => (a as HTMLAnchorElement).href).find((h) => !/ads\/library|l\.php|\/policies|\/help/.test(h)) ?? null;
      const v = el.querySelector("video");
      const all = [...el.querySelectorAll('img[src*="scontent"]')];
      const imgs = all.length;
      // The ad's own picture = the biggest one (the page's round avatar is tiny).
      let bigImg = -1, area = 120 * 120;
      all.forEach((im, i) => { const r = im.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; bigImg = i; } });
      const text = (el as HTMLElement).innerText;
      const at = text.indexOf("Sponsored\n");
      return {
        links, pageUrl, imgs, bigImg, cta,
        video: v ? { src: v.currentSrc || v.src || "", dur: Number.isFinite(v.duration) ? v.duration : null } : null,
        body: at >= 0 ? text.slice(at + 10, at + 10 + 1500) : text.slice(0, 1500),
        started: (text.match(/Started running on ([^\n]+)/) || [])[1] ?? null,
      };
    }, CTAS);
    const shotId = await c.shot(`Ad: ${ad.page_name ?? ad.library_id}`, { kind: "ad", element: box, sourceUrl: url });
    let framesId: string | null = null;
    let creativeId: string | null = null;
    const who = ad.page_name ?? ad.library_id;
    if (info.video?.src?.startsWith("https://")) {
      framesId = await c.shotFile(`First 4 seconds: ${who}`, (full) => frameStrip(info.video!.src, full), { kind: "frames", sourceUrl: url }).catch(() => null);
      creativeId = await c.shotFile(`Ad picture: ${who}`, (full) => firstFrame(info.video!.src, full), { kind: "creative", sourceUrl: url }).catch(() => null);
    } else if (info.bigImg >= 0) {
      creativeId = await c.shot(`Ad picture: ${who}`, { kind: "creative", element: box.locator('img[src*="scontent"]').nth(info.bigImg), sourceUrl: url }).catch(() => null);
    }
    const landing = info.links.find((l) => !/facebook\.com|messenger\.com|fb\.me/.test(l)) ?? info.links[0] ?? null;
    let followers: string | null = null;
    if (opts.followers && info.pageUrl) {
      try {
        await c.page.setViewportSize({ width: 1366, height: 900 });
        await c.open(info.pageUrl, 3000);
        followers = ((await c.text()).match(/([\d.,]+[KM]?) followers/i) || [])[1] ?? null;
      } catch { /* followers are a nice-to-have */ }
    }
    await q(
      `update ads set opened = true, format = $2, video_seconds = $3, full_text = $4, landing_url = $5, page_url = $6, followers = $7,
              shot_id = $8, frames_shot_id = $9, started_on = coalesce($10, started_on), cta = coalesce($11, cta), creative_shot_id = $12 where id = $1`,
      [ad.id, info.video ? "video" : info.imgs > 1 ? "carousel or several images" : "image", info.video?.dur ? Math.round(info.video.dur) : null,
        info.body, landing, info.pageUrl, followers, shotId, framesId, dayOf(info.started), info.cta, creativeId],
    );
    return true;
  } finally {
    await c.page.setViewportSize({ width: 1366, height: 900 });
    await clearFbPopup(c.page).catch(() => null);
  }
}
