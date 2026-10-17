// Shared by the form (in the browser) and the server, so both apply the same rules.
import { pick, type Lang } from "./i18n";

export const RUNNING_ADS = [
  { value: "yes", label: "Yes", zh: "有" },
  { value: "no", label: "No", zh: "没有" },
  { value: "not_sure", label: "Not sure", zh: "不确定" },
] as const;
export type RunningAds = (typeof RUNNING_ADS)[number]["value"];
export const runningAdsLabel = (v: string, lang: Lang = "en") => {
  const r = RUNNING_ADS.find((x) => x.value === v);
  return r ? pick(lang, r.label, r.zh) : v;
};

const STATUS_LABEL: Record<string, [string, string]> = {
  not_started: ["Not started", "还没开始"], running: ["Running", "检查中"], done: ["Report ready", "报告好了"], needs_retry: ["Needs a retry", "需要重试"],
};
export const statusLabel = (s: string, lang: Lang = "en") => (STATUS_LABEL[s] ? pick(lang, ...STATUS_LABEL[s]) : s);

export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function toUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

// Any Facebook page link (www, m., web., fb.com, with or without https) becomes one clean form,
// so the same page entered twice is the same business.
export function normalizeFacebook(raw: string): string | null {
  const u = toUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (!(host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com" || host === "www.fb.com")) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (!path) return null;
  if (path.toLowerCase() === "/profile.php") {
    const id = u.searchParams.get("id");
    return id && /^\d+$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  return `https://www.facebook.com${path}`;
}

export function normalizeWebsite(raw: string): string | null {
  const u = toUrl(raw);
  if (!u || !u.hostname.includes(".")) return null;
  return u.toString().replace(/\/$/, "");
}

// What a link looks like in a list: no https://, no www.
export const shortUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/^www\./, "");

// All dates show in Malaysia time, whatever the computer's own clock is set to.
// APP_TIMEZONE in .env.local changes it (the browser bundle always uses the default).
const MY = (typeof process !== "undefined" && process.env.APP_TIMEZONE) || "Asia/Kuala_Lumpur";
export function myDateTime(iso: string, lang: Lang = "en") {
  const d = new Date(iso);
  if (lang === "zh") {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: MY, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}年${p.month}月${p.day}日 ${p.dayPeriod?.toLowerCase() === "pm" ? "下午" : "上午"}${p.hour}:${p.minute}`;
  }
  const date = d.toLocaleDateString("en-GB", { timeZone: MY, day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: MY, hour: "numeric", minute: "2-digit" }).toLowerCase();
  return `${date}, ${time}`;
}

export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export type FieldErrors = Partial<Record<"facebook" | "name" | "website" | "price" | "profit" | "running_ads" | "files", string>>;

// A money amount as people type it: "16000", "16,000", "RM16k", "1.5k". Null when it isn't one.
export function parseMoney(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/^rm\s*/, "").replace(/[,\s]/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(k)?$/);
  if (!m) return null;
  const n = +m[1] * (m[2] ? 1000 : 1);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}
export const parsePct = (raw: string): number | null => {
  const m = raw.trim().replace(/%$/, "").trim().match(/^\d+(?:\.\d+)?$/);
  return m && +m[0] > 0 && +m[0] <= 100 ? +m[0] : null;
};
export type Money = { price_low: string; price_high: string; profit: string; profit_kind: string };
export const PROFIT_KINDS = ["rm", "pct"] as const;
// RM16,000 (whole ringgit, or 2 decimals when there are cents).
export const rm = (n: number) => `RM${n.toLocaleString("en-US", { maximumFractionDigits: n % 1 ? 2 : 0 })}`;

// The checks both sides run before saving. Files are checked separately (the browser and server see them differently).
export function checkFields(v: { facebook: string; name: string; website: string; running_ads: string } & Partial<Money>, lang: Lang = "en"): FieldErrors {
  const t = (en: string, zh: string) => pick(lang, en, zh);
  const e: FieldErrors = {};
  const lo = v.price_low?.trim() ? parseMoney(v.price_low) : null;
  const hi = v.price_high?.trim() ? parseMoney(v.price_high) : null;
  if (v.price_low?.trim() && lo === null) e.price = t("Write the lowest price as a number, like 16000.", "最低价请写数字, 例如 16000.");
  else if (v.price_high?.trim() && hi === null) e.price = t("Write the highest price as a number, like 16000.", "最高价请写数字, 例如 16000.");
  else if (hi !== null && lo === null) e.price = t("Add the lowest price first.", "请先填最低价.");
  else if (hi !== null && lo !== null && hi < lo) e.price = t("The highest price is lower than the lowest one.", "最高价比最低价还低.");
  if (v.profit?.trim()) {
    if (v.profit_kind === "pct") {
      if (parsePct(v.profit) === null) e.profit = t("Write the margin as a number from 1 to 100.", "利润率请写 1 到 100 的数字.");
    } else {
      const p = parseMoney(v.profit);
      if (p === null) e.profit = t("Write the profit as a number, like 2000.", "利润请写数字, 例如 2000.");
      else if (p > (hi ?? lo ?? Infinity)) e.profit = t("The profit is more than the price.", "利润比售价还高.");
    }
  }
  if (!v.facebook.trim()) e.facebook = t("Add the Facebook page link.", "请放上 Facebook 专页的连结.");
  else if (!normalizeFacebook(v.facebook)) e.facebook = t("This isn't a Facebook page link. Copy it from the page's address bar.", "这不是 Facebook 专页的连结. 请从专页的网址栏 copy.");
  if (!v.name.trim()) e.name = t("Add the company name.", "请填公司名字.");
  if (v.website.trim() && !normalizeWebsite(v.website)) e.website = t("This isn't a website link.", "这不是网站连结.");
  if (!RUNNING_ADS.some((r) => r.value === v.running_ads)) e.running_ads = t("Choose Yes, No or Not sure.", "请选 有, 没有 或 不确定.");
  return e;
}

export function checkFile(f: { type: string; size: number; name: string }, lang: Lang = "en"): string | null {
  if (!IMAGE_TYPES[f.type]) return pick(lang, `${f.name} isn't a PNG, JPG or WebP picture.`, `${f.name} 不是 PNG, JPG 或 WebP 图片.`);
  if (f.size > MAX_FILE_BYTES) return pick(lang, `${f.name} is over 10 MB.`, `${f.name} 超过 10 MB.`);
  return null;
}

// How the price and profit answers read on the answers screen, the check page and the report.
// The "per what" word without its own "per" or 每 (the box already shows it).
export const bareUnit = (unit: string | null | undefined) => (unit ?? "").trim().replace(/^(per\s+|每\s*)/i, "").trim();
export function priceText(lo: number | null, hi: number | null, unit: string | null, lang: Lang = "en") {
  if (!lo) return "";
  const range = hi && hi !== lo ? `${rm(lo)} ${pick(lang, "to", "到")} ${rm(hi)}` : rm(lo);
  const u = bareUnit(unit);
  return u ? `${range} ${lang === "zh" ? `每${/^[一-鿿]/.test(u) ? "" : " "}${u}` : `per ${u}`}` : range;
}
export function profitText(rmAmount: number | null, pct: number | null, lang: Lang = "en") {
  if (rmAmount) return pick(lang, `${rm(rmAmount)} per sale`, `每单 ${rm(rmAmount)}`);
  if (pct) return pick(lang, `${pct}% margin`, `利润率 ${pct}%`);
  return "";
}
