import fs from "node:fs";
import { getShot } from "@/lib/runs";

// One screenshot taken by a check, by its id. The path comes from the database, never from the address.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getShot(id);
  if (!full) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(full), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
