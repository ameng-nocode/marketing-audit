import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Browser, Locator, Page } from "playwright-core";
import { q } from "../db";
import { uploadsDir } from "../checks";
import { TIME_ZONE } from "../settings";

// Runs ffmpeg (quiet, overwrite) on a video or picture link. ffmpeg must be on the PATH.
export function ffmpeg(args: string[], timeoutMs = 60000) {
  return new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", ["-y", "-loglevel", "error", ...args], { timeout: timeoutMs, windowsHide: true }, (e) => (e ? reject(e) : resolve()));
  });
}

// What a page has installed: tracking pixels, WhatsApp links and the site builder.
// Runs inside the page (pass it to page.evaluate), so it may only use the browser's own globals.
export function pageSetup() {
  const w = window as unknown as Record<string, unknown>;
  const s = [...document.scripts].map((x) => x.src + " " + x.text.slice(0, 500)).join("\n");
  const html = document.documentElement.innerHTML;
  const gen = document.querySelector('meta[name="generator"]')?.getAttribute("content") || "";
  return {
    meta: typeof w.fbq === "function" || /fbevents/i.test(s),
    ga: typeof w.gtag === "function" || !!w.google_tag_manager || /googletagmanager|google-analytics/i.test(s),
    tiktok: typeof w.ttq === "object" || /analytics\.tiktok/i.test(s),
    whatsapp: [...document.querySelectorAll('a[href*="wa.me"],a[href*="whatsapp"]')].map((a) => (a as HTMLAnchorElement).href).slice(0, 2),
    platform: w.Shopify ? "Shopify" : /wp-content|wp-includes/.test(html) ? "WordPress" : /wixstatic|wix\.com/.test(html) ? "Wix" : /squarespace/.test(html) ? "Squarespace" : gen.split(" ")[0] || null,
  };
}

// A login wall or CAPTCHA: the step is marked Not checked. Never solved or worked around.
export class NotChecked extends Error {}
// The step does not apply (no website, no app links ...).
export class Skipped extends Error {}

export type Biz = { name: string; facebook_url: string; website: string | null; description: string | null; facebook_page_id: string | null };
export type FactIn = { key: string; label: string; value?: string | null; note?: string | null; status: "ok" | "none" | "weak" | "info" | "not_checked"; sourceUrl?: string | null; shotId?: string | null; check?: number };

export type ShotKind = "page" | "logo" | "ad" | "frames" | "fold" | "thumb" | "creative";
export type Ctx = {
  auditId: string;
  stepId: string;
  checkNo: number;
  biz: Biz;
  page: Page;
  open: (url: string, waitMs?: number) => Promise<number>;
  text: () => Promise<string>;
  shot: (caption: string, opts?: { sourceUrl?: string; kind?: ShotKind; element?: Locator; fullPage?: boolean }) => Promise<string>;
  // A picture made another way (ffmpeg, a canvas): write it to `full`, then it is saved like a screenshot.
  shotFile: (caption: string, write: (full: string) => Promise<void>, opts?: { sourceUrl?: string | null; kind?: ShotKind }) => Promise<string>;
  fact: (f: FactIn) => Promise<void>;
  siteLinks: () => Promise<string[]>;
};

// Same browser every step uses: your installed Chrome, logged out, no window.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
export async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  return chromium.launch({ channel: "chrome", headless: true });
}
export async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ userAgent: UA, locale: "en-US", timezoneId: TIME_ZONE, viewport: { width: 1366, height: 900 } });
  return ctx.newPage();
}

export function makeCtx(base: { auditId: string; stepId: string; checkNo: number; biz: Biz; page: Page }): Ctx {
  const { auditId, stepId, checkNo, page } = base;
  let pos = 0;
  const dir = path.join(uploadsDir(), auditId, "shots");
  return {
    ...base,
    open: async (url, waitMs = 3500) => {
      const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(waitMs);
      return r?.status() ?? 0;
    },
    text: () => page.evaluate(() => document.body?.innerText ?? ""),
    shot: async (caption, opts = {}) => {
      fs.mkdirSync(dir, { recursive: true });
      const name = `${crypto.randomUUID()}.jpg`;
      const full = path.join(dir, name);
      if (opts.element) await opts.element.screenshot({ path: full, type: "jpeg", quality: 88 });
      else await page.screenshot({ path: full, type: "jpeg", quality: 80, fullPage: !!opts.fullPage });
      return saveShot(auditId, stepId, name, caption, opts.kind ?? "page", opts.sourceUrl ?? page.url());
    },
    shotFile: async (caption, write, opts = {}) => {
      fs.mkdirSync(dir, { recursive: true });
      const name = `${crypto.randomUUID()}.jpg`;
      await write(path.join(dir, name));
      if (!fs.existsSync(path.join(dir, name))) throw new Error("The picture was not made.");
      return saveShot(auditId, stepId, name, caption, opts.kind ?? "page", opts.sourceUrl ?? null);
    },
    fact: async (f) => {
      await q(
        `insert into facts (audit_id, step_id, check_no, key, label, value, note, status, source_url, shot_id, position)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [auditId, stepId, f.check ?? checkNo, f.key, f.label.slice(0, 200), f.value?.slice(0, 300) ?? null, f.note?.slice(0, 600) ?? null, f.status, f.sourceUrl ?? null, f.shotId ?? null, pos++],
      );
    },
    // Links to other channels found so far (on the website or the Facebook page).
    siteLinks: async () => (await q<{ value: string }>(`select value from facts where audit_id = $1 and key = 'site_link' order by id`, [auditId])).map((r) => r.value),
  };
}

async function saveShot(auditId: string, stepId: string, name: string, caption: string, kind: ShotKind, sourceUrl: string | null) {
  const [row] = await q<{ id: string }>(
    `insert into shots (audit_id, step_id, kind, file, caption, source_url) values ($1, $2, $3, $4, $5, $6) returning id::text`,
    [auditId, stepId, kind, `${auditId}/shots/${name}`, caption.slice(0, 200), sourceUrl],
  );
  return row.id;
}

// Full path of a saved screenshot, for the AI to open.
export async function shotPath(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const [s] = await q<{ file: string }>(`select file from shots where id = $1`, [id]);
  return s ? path.join(uploadsDir(), s.file) : null;
}

// "23 Oct 2025" -> "2025-10-23"
export function dayOf(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(`${s} 12:00 UTC`);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// --- Facebook helpers ---------------------------------------------------------------

export function fbPage(url: string) {
  const u = new URL(url);
  const id = u.searchParams.get("id");
  const slug = id ? null : u.pathname.replace(/^\/+|\/+$/g, "");
  return {
    slug,
    id,
    reels: id ? `https://www.facebook.com/profile.php?id=${id}&sk=reels_tab` : `https://www.facebook.com/${slug}/reels/`,
    transparency: id ? `https://www.facebook.com/profile.php?id=${id}&sk=about_profile_transparency` : `https://www.facebook.com/${slug}/about_profile_transparency`,
  };
}

// The "log in or sign up" pop-up Facebook and Instagram lay over pages for logged-out visitors,
// plus the see-through layer behind it that greys out the page (and the logo).
export async function clearFbPopup(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('[role="dialog"]').forEach((d) => d.remove());
    document.querySelectorAll("div").forEach((d) => {
      const s = getComputedStyle(d);
      if (s.position !== "fixed") return;
      const r = d.getBoundingClientRect();
      const covers = r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
      if (/Log in or sign up|See more from|See more on Facebook|Sign up for Instagram|See photos and videos/.test(d.innerText || "") || (covers && !d.querySelector("video, [role='main']"))) d.remove();
    });
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "auto";
  });
  await page.waitForTimeout(500);
}

export function isLoginWall(text: string, url: string) {
  return /\/login\b|\/checkpoint\//.test(url) || /You must log in to continue|Log in to continue|log into Facebook to/i.test(text);
}
export function isCaptcha(text: string) {
  return /Drag the slider|captcha|verify you are human|unusual traffic/i.test(text);
}

// "11K" -> 11000, "1.2M" -> 1200000, "345" -> 345
export function countOf(s: string | null | undefined): number | null {
  const m = (s ?? "").replace(/,/g, "").match(/([\d.]+)\s*([KkMm])?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Math.round(m[2] ? n * (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : n);
}

// Company names lose "Sdn Bhd", "PLT" and the like when we guess a handle.
export function nameKey(name: string) {
  return name.toLowerCase().replace(/\b(sdn\.?\s*bhd\.?|bhd|berhad|plt|enterprise|trading|ent|co|company)\b/g, "").replace(/[^a-z0-9]/g, "");
}
