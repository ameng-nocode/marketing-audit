// Settings from .env.local (see .env.example). Read on the server; the browser never needs them.

// The consultant who uses the reports. The AI writes for them, and the report's routine names them.
// Empty = "the consultant" / "顾问".
const NAME = (process.env.CONSULTANT_NAME ?? "").trim();
export const consultant = (lang: "en" | "zh" = "en") => NAME || (lang === "zh" ? "顾问" : "the consultant");
// The same at the start of a sentence ("The consultant checks ...").
export const Consultant = (lang: "en" | "zh" = "en") => { const c = consultant(lang); return c[0].toUpperCase() + c.slice(1); };
export const consultantName = NAME;

// Dates on screen and in the report, and the time zone the browser pretends to be in.
export const TIME_ZONE = (typeof process !== "undefined" && process.env.APP_TIMEZONE) || "Asia/Kuala_Lumpur";
