import { one, q } from "./db";
import type { Lang } from "./i18n";

export type ReportRow = { html: string; flags: string | null; made_at: string };
export type ReportLang = Lang;
export { isLang } from "./i18n";

export async function getReport(auditId: string, lang: ReportLang = "en"): Promise<ReportRow | undefined> {
  if (!/^\d+$/.test(auditId)) return undefined;
  return one<ReportRow>(`select html, flags, made_at from reports where audit_id = $1 and kind = 'internal' and lang = $2`, [auditId, lang]);
}

// What the AI cost on the latest run of one check (the Claude app's own count, in US dollars).
export async function aiCost(auditId: string) {
  const [r] = await q<{ calls: number; usd: number | null; failed: number }>(
    `select count(*)::int calls, sum(c.cost_usd)::float8 usd, count(*) filter (where not c.ok)::int failed
       from ai_calls c join audits a on a.id = c.audit_id
      where c.audit_id = $1 and c.made_at >= coalesce(a.started_at, a.created_at)`, [auditId]);
  return r;
}

// File name for the download: the business name in plain letters (the 中文 one says 营销现况报告).
export const reportFileName = (name: string, lang: ReportLang = "en") => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
  return lang === "zh" ? `${base}-营销现况报告.pdf` : `${base}-marketing-check.pdf`;
};
