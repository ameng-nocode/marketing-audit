import fs from "node:fs";
import path from "node:path";
import { getUpload, uploadsDir } from "@/lib/checks";

// One saved screenshot, by its upload id. The path comes from the database, never from the address.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getUpload(id);
  if (!u) return new Response("Not found", { status: 404 });
  const root = uploadsDir();
  const full = path.resolve(root, u.file);
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(full), {
    headers: { "Content-Type": u.mime, "Cache-Control": "private, max-age=3600" },
  });
}
