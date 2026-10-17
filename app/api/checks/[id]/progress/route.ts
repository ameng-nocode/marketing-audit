import { getProgress } from "@/lib/runs";

// Live progress of a check run, for the check page (local only).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProgress(id);
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(p, { headers: { "Cache-Control": "no-store" } });
}
