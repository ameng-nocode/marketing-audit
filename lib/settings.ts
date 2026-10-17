// Settings from .env.local (see .env.example). Read on the server; the browser bundle gets the defaults.
import type { Lang } from "./i18n";

// The consultant who uses the reports. The AI writes for them, and the report's routine names them.
// Empty = "the consultant" / "顾问".
const NAME = (typeof process !== "undefined" ? process.env.CONSULTANT_NAME ?? "" : "").trim();
export const consultant = (lang: Lang = "en") => NAME || (lang === "zh" ? "顾问" : "the consultant");
// The same at the start of a sentence ("The consultant checks ...").
export const Consultant = (lang: Lang = "en") => { const c = consultant(lang); return c[0].toUpperCase() + c.slice(1); };
export const consultantName = NAME;

// Dates on screen and in the report, and the time zone the browser pretends to be in.
export const TIME_ZONE = (typeof process !== "undefined" && process.env.APP_TIMEZONE) || "Asia/Kuala_Lumpur";
// A date as YYYY-MM-DD in that time zone: today, or the time given.
export const dayIn = (t: Date | number | string = Date.now()) => new Date(t).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
// The time zone the way the report says it.
export const tzName = (lang: Lang = "en") => (TIME_ZONE === "Asia/Kuala_Lumpur" ? (lang === "zh" ? "马来西亚时间" : "Malaysia time") : TIME_ZONE);
