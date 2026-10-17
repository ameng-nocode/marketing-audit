import fs from "node:fs";
import { getCheck } from "@/lib/checks";
import { reportPdf } from "@/lib/report/render";
import { getReport, isLang, reportFileName } from "@/lib/reports";

// The report as a PDF (A4, photos inside), to open, keep or send. ?lang=zh = the 中文 one.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = new URL(req.url).searchParams.get("lang");
  const lang = isLang(l) ? l : "en";
  const [r, c] = await Promise.all([getReport(id, lang), getCheck(id)]);
  const file = r && c ? await reportPdf(id, r.made_at, lang).catch(() => null) : null;
  if (!file || !c) return new Response("No report yet for this check.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const fname = reportFileName(c.name, lang);
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      "content-type": "application/pdf",
      // ASCII name for old browsers, the real name (with 中文) for the rest.
      "content-disposition": `attachment; filename="${fname.replace(/[^\x20-\x7e]/g, "").replace(/--+/g, "-")}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
      "cache-control": "no-store",
    },
  });
}
