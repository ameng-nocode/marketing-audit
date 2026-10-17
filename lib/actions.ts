"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteCheck, saveCheck } from "./checks";
import { makeChinese, retryStep, rewriteReport, startRun } from "./runner";
import type { FieldErrors } from "./format";
import { getLang } from "./lang-server";

export type FormState = { errors?: FieldErrors; message?: string };

// New check: save, then start checks 1 to 3. Edit: save only.
export async function saveCheckAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("id") ?? "") || undefined;
  let saved: string;
  let toast = id ? "updated" : "started";
  try {
    const r = await saveCheck(fd, id);
    if ("errors" in r) return { errors: r.errors };
    saved = r.id;
    if (!id) await startRun(saved);
    else if (r.moneyChanged && (await rewriteReport(saved))) toast = "rewriting";
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { message: (await getLang()) === "zh" ? `保存不了: ${why}` : `Couldn't save: ${why}` };
  }
  revalidatePath("/");
  redirect(`/checks/${saved}?toast=${toast}`);
}

export async function startCheckAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!/^\d+$/.test(id)) return;
  await startRun(id, await getLang());
  revalidatePath(`/checks/${id}`);
  revalidatePath("/");
}

export async function retryStepAction(fd: FormData) {
  const stepId = String(fd.get("step") ?? "");
  if (!/^\d+$/.test(stepId)) return;
  await retryStep(stepId);
  revalidatePath("/");
}

// Write the 中文 report for a finished check (about 5 minutes of AI).
export async function makeChineseAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!/^\d+$/.test(id)) return;
  await makeChinese(id);
  revalidatePath(`/checks/${id}`);
  revalidatePath("/");
}

export async function deleteCheckAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  await deleteCheck(id);
  revalidatePath("/");
  redirect("/?toast=deleted");
}
