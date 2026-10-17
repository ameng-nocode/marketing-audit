import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright-core";
import { q, tx } from "./db";
import { uploadsDir } from "./checks";
import { launch, makeCtx, newPage, NotChecked, Skipped, type Biz } from "./collect/kit";
import { DEPENDS, REPORT_KEYS, STEPS } from "./collect/steps";

// Runs checks inside the app's own server: one check at a time, one browser, no retry loops.
// A step that fails waits for the Retry button.

type Job = { auditId: string; only?: string[] };
const g = globalThis as unknown as { __runner?: { queue: Job[]; busy: boolean; booted: boolean } };
const R = (g.__runner ??= { queue: [], busy: false, booted: false });

// Test copy: only these steps run; the rest are skipped (tests never touch Facebook or Google).
const ONLY = process.env.COLLECT_ONLY ? process.env.COLLECT_ONLY.split(",").map((s) => s.trim()) : null;
const RESTARTED = "Stopped when the app restarted. Press Retry.";

// A run cut off by an app restart shows as failed, never as stuck on "Running".
export async function boot() {
  if (R.booted) return;
  R.booted = true;
  await q(`update audit_steps set status = 'failed', note = $1, finished_at = now() where status in ('running', 'waiting') and audit_id in (select id from audits where status = 'running')`, [RESTARTED]);
  await q(`update audits set status = 'needs_retry', finished_at = now() where status = 'running'`);
}

function removeShotFiles(files: string[]) {
  for (const f of files) fs.rmSync(path.join(uploadsDir(), f), { force: true });
}

// Start (or start again): fresh steps for checks 1 to 3.
// lang = the app language of the person pressing Start: 中文 adds the 中文 report (a check that has one keeps it).
export async function startRun(auditId: string, lang?: "en" | "zh") {
  await boot();
  const old = await tx(async (t) => {
    const files = await t<{ file: string }>(`select file from shots where audit_id = $1`, [auditId]);
    await t(`delete from audit_steps where audit_id = $1`, [auditId]);
    for (const table of ["texts", "funnels", "reports", "ads_manager_rows"]) await t(`delete from ${table} where audit_id = $1`, [auditId]);
    for (const [i, s] of STEPS.entries()) {
      await t(`insert into audit_steps (audit_id, check_no, key, label, position) values ($1, $2, $3, $4, $5)`, [auditId, s.check, s.key, s.label, i]);
    }
    await t(`update audits set status = 'running', started_at = now(), finished_at = null, report_lang = case when $2::text = 'zh' then 'zh' else report_lang end, updated_at = now() where id = $1`, [auditId, lang ?? null]);
    return files.map((f) => f.file);
  });
  removeShotFiles(old);
  R.queue.push({ auditId });
  void pump();
}

// Retry one step (and the steps that use its results).
export async function retryStep(stepId: string) {
  await boot();
  const [s] = await q<{ audit_id: string; key: string }>(`select audit_id::text, key from audit_steps where id = $1`, [stepId]);
  if (!s) return;
  // The step, the steps that use its results, and the report (always rebuilt from the new results).
  const keys = [...new Set([s.key, ...(DEPENDS[s.key] ?? []), ...REPORT_KEYS.slice(Math.max(0, REPORT_KEYS.indexOf(s.key)))])];
  const old = await tx(async (t) => {
    const files = await t<{ file: string }>(`select sh.file from shots sh join audit_steps st on st.id = sh.step_id where st.audit_id = $1 and st.key = any($2::text[])`, [s.audit_id, keys]);
    for (const table of ["shots", "facts", "reels", "ads", "landings", "hooks", "tiktok_videos"]) {
      await t(`delete from ${table} where step_id in (select id from audit_steps where audit_id = $1 and key = any($2::text[]))`, [s.audit_id, keys]);
    }
    await t(`update audit_steps set status = 'waiting', note = null, started_at = null, finished_at = null where audit_id = $1 and key = any($2::text[])`, [s.audit_id, keys]);
    await t(`update audits set status = 'running', finished_at = null where id = $1`, [s.audit_id]);
    return files.map((f) => f.file);
  });
  removeShotFiles(old);
  R.queue.push({ auditId: s.audit_id, only: keys });
  void pump();
}

// The 中文 report for a check that has the English one: pick 中文, then run the 中文 writer and the page again.
// A check made before this step existed gets the step added just before "Build the report page".
export async function makeChinese(auditId: string) {
  await boot();
  await q(`update audits set report_lang = 'zh' where id = $1`, [auditId]);
  let [s] = await q<{ id: string }>(`select id::text from audit_steps where audit_id = $1 and key = 'write_zh'`, [auditId]);
  if (!s) {
    const [r] = await q<{ position: number }>(`select position from audit_steps where audit_id = $1 and key = 'render'`, [auditId]);
    if (!r) return;
    const def = STEPS.find((x) => x.key === "write_zh")!;
    await q(`update audit_steps set position = position + 1 where audit_id = $1 and position >= $2`, [auditId, r.position]);
    [s] = await q<{ id: string }>(`insert into audit_steps (audit_id, check_no, key, label, position, status) values ($1, 7, 'write_zh', $2, $3, 'skipped') returning id::text`, [auditId, def.label, r.position]);
  }
  await retryStep(s.id);
}

// New price or profit on a finished check: only the report is written again (the AI writer, 中文 if picked, the page).
export async function rewriteReport(auditId: string) {
  await boot();
  const [a] = await q<{ status: string }>(`select status from audits where id = $1`, [auditId]);
  if (!a || a.status === "running" || a.status === "not_started") return false;
  const [s] = await q<{ id: string }>(`select id::text from audit_steps where audit_id = $1 and key = 'write'`, [auditId]);
  if (!s) return false;
  await retryStep(s.id);
  return true;
}

async function pump() {
  if (R.busy) return;
  R.busy = true;
  try {
    while (R.queue.length) {
      const job = R.queue.shift()!;
      await runJob(job).catch((e) => console.error("check run failed", job.auditId, e));
    }
  } finally {
    R.busy = false;
  }
}

async function runJob(job: Job) {
  const [biz] = await q<Biz>(
    `select b.name, b.facebook_url, b.website, a.description, b.facebook_page_id from audits a join businesses b on b.id = a.business_id where a.id = $1`,
    [job.auditId],
  );
  if (!biz) return;
  let steps = await q<{ id: string; key: string; check_no: number }>(`select id::text, key, check_no from audit_steps where audit_id = $1 and status = 'waiting' order by position`, [job.auditId]);
  if (job.only) steps = steps.filter((s) => job.only!.includes(s.key));
  let browser: Browser | null = null;
  let page: Page | null = null;
  try {
    for (const s of steps) {
      const def = STEPS.find((d) => d.key === s.key);
      const still = await q(`update audit_steps set status = 'running', started_at = now() where id = $1 returning id`, [s.id]);
      if (!def || !still.length) continue; // the check was deleted mid-run
      let status = "done";
      let note: string | null = null;
      if (ONLY && !ONLY.includes(s.key)) { status = "skipped"; note = "Not run in the test copy."; }
      else if (def.needsWebsite && !biz.website) { status = "skipped"; note = "No website given."; }
      else {
        try {
          if (!def.noBrowser && !browser) { browser = await launch(); page = await newPage(browser); }
          await def.run(makeCtx({ auditId: job.auditId, stepId: s.id, checkNo: s.check_no, biz, page: page! }));
          // Every fact of the step was blocked (e.g. all TikTok handles hit a puzzle): the step is Not checked.
          const [f] = await q<{ n: number; nc: number; note: string | null }>(
            `select count(*)::int n, count(*) filter (where status = 'not_checked')::int nc, max(note) filter (where status = 'not_checked') note from facts where step_id = $1`, [s.id]);
          if (f.n > 0 && f.n === f.nc) { status = "not_checked"; note = f.note; }
        } catch (e) {
          if (e instanceof NotChecked) { status = "not_checked"; note = e.message; }
          else if (e instanceof Skipped) { status = "skipped"; note = e.message; }
          else { status = "failed"; note = `Something went wrong: ${(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 200)}`; }
        }
      }
      await q(`update audit_steps set status = $2, note = $3, finished_at = now() where id = $1`, [s.id, status, note]);
    }
  } finally {
    await browser?.close().catch(() => null);
  }
  const [left] = await q<{ failed: number; waiting: number }>(
    `select count(*) filter (where status = 'failed')::int failed, count(*) filter (where status in ('waiting', 'running'))::int waiting from audit_steps where audit_id = $1`, [job.auditId]);
  if (left && left.waiting === 0) {
    await q(`update audits set status = $2, finished_at = now() where id = $1`, [job.auditId, left.failed ? "needs_retry" : "done"]);
  }
}
