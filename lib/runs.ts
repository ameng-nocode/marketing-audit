import fs from "node:fs";
import path from "node:path";
import { one, q } from "./db";
import { uploadsDir } from "./checks";
import { boot } from "./runner";

export type StepShot = { id: string; caption: string; kind: string };
export type StepRow = { id: string; check_no: number; key: string; label: string; status: string; note: string | null; shots: StepShot[] };
export type Progress = { status: string; steps: StepRow[] };

// What the check page polls while a run is going.
export async function getProgress(auditId: string): Promise<Progress | null> {
  if (!/^\d+$/.test(auditId)) return null;
  await boot();
  const a = await one<{ status: string }>(`select status from audits where id = $1`, [auditId]);
  if (!a) return null;
  const steps = await q<Omit<StepRow, "shots">>(`select id::text, check_no, key, label, status, note from audit_steps where audit_id = $1 order by position`, [auditId]);
  const shots = await q<StepShot & { step_id: string }>(`select id::text, step_id::text, caption, kind from shots where audit_id = $1 order by id`, [auditId]);
  return { status: a.status, steps: steps.map((s) => ({ ...s, shots: shots.filter((x) => x.step_id === s.id && x.kind === "page") })) };
}

// The business logo (Facebook profile picture) from the latest run, for the page title.
export async function getLogo(auditId: string) {
  const logo = await one<{ id: string }>(`select id::text from shots where audit_id = $1 and kind = 'logo' order by id desc limit 1`, [auditId]);
  return logo?.id ?? null;
}

export async function getShot(id: string) {
  if (!/^\d+$/.test(id)) return undefined;
  const s = await one<{ file: string }>(`select file from shots where id = $1`, [id]);
  if (!s) return undefined;
  const full = path.resolve(uploadsDir(), s.file);
  if (!full.startsWith(uploadsDir() + path.sep) || !fs.existsSync(full)) return undefined;
  return full;
}
