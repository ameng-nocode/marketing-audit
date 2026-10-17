import { currentHtml } from "@/lib/report/render";
import { isLang } from "@/lib/i18n";
import { getReport } from "@/lib/reports";

// The report page itself: its own locked look, so it is served as a whole HTML page, not inside the app's layout.
// ?embed=1 is the copy shown inside the check page (no top bar; photos open in the app's viewer). ?lang=zh = 中文.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const embed = sp.get("embed") === "1";
  const l = sp.get("lang");
  const lang = isLang(l) ? l : "en";
  const r = await getReport(id, lang);
  const html = r ? (await currentHtml(id, r.made_at, embed ? "embed" : "page", lang)) ?? r.html : null;
  if (!html) return new Response("No report yet for this check.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
