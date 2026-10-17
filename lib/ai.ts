import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { q } from "./db";
import { fakeAnswer } from "./ai-fake";

// The AI is the Claude app already logged in on this PC, run headless (`claude -p`). No API key.
// Lessons from earlier apps on this PC: no MCP servers, no user settings, an empty working folder,
// "@" swapped for a full-width one (the CLI reads "@word" as a file), and an empty answer is a failure.

export type AiModel = "sonnet" | "opus";
type Ask = {
  auditId: string | null;
  task: string;
  model: AiModel;
  system: string;
  prompt: string;
  schema: object;
  images?: string[]; // absolute paths the AI may open with its Read tool
  timeoutMs?: number;
};

const dataDir = () => path.resolve(process.cwd(), ".data");
// The Claude Code app: CLAUDE_BIN if set, else the Windows npm or native install, else "claude" on the PATH.
const claudeBin = () => {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const found = [
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, ".local", "bin", "claude.exe"),
  ].find((p): p is string => !!p && fs.existsSync(p));
  return found ?? "claude";
};

export class AiError extends Error {}

export async function askJson<T>(a: Ask): Promise<T> {
  // The test copy never calls the real AI.
  if (process.env.AI_FAKE) return fakeAnswer(a.task, a.prompt) as T;
  try {
    return await once<T>(a);
  } catch (e) {
    // One more try for a garbled answer; a timeout or a missing CLI is final.
    if (e instanceof AiError && /no answer|not JSON/.test(e.message)) return once<T>(a);
    throw e;
  }
}

async function once<T>(a: Ask): Promise<T> {
  const work = path.join(dataDir(), "ai-work");
  fs.mkdirSync(work, { recursive: true });
  const sysFile = path.join(work, `system-${a.task}.txt`);
  const mcpFile = path.join(work, "no-mcp.json");
  fs.writeFileSync(sysFile, a.system);
  fs.writeFileSync(mcpFile, `{"mcpServers":{}}`);
  const args = [
    "-p", "--model", a.model, "--output-format", "json", "--json-schema", JSON.stringify(a.schema),
    "--strict-mcp-config", "--mcp-config", mcpFile, "--setting-sources", "project", "--system-prompt-file", sysFile,
  ];
  if (a.images?.length) {
    args.push("--tools", "Read", "--allowedTools", "Read");
    for (const d of [...new Set(a.images.map((f) => path.dirname(f)))]) args.push("--add-dir", d);
  } else {
    args.push("--tools", "");
  }
  const prompt = (a.images?.length ? `${a.prompt}\n\nPictures to open with the Read tool:\n${a.images.join("\n")}` : a.prompt).replace(/@/g, "＠");
  const t0 = Date.now();
  const log = (ok: boolean, cost: number | null, note: string | null) =>
    q(`insert into ai_calls (audit_id, task, model, seconds, cost_usd, ok, note) values ($1, $2, $3, $4, $5, $6, $7)`,
      [a.auditId, a.task, a.model, (Date.now() - t0) / 1000, cost, ok, note?.slice(0, 500) ?? null]).catch(() => null);

  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn(claudeBin(), args, { cwd: work, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { p.kill(); reject(new AiError(`The AI took longer than ${Math.round((a.timeoutMs ?? 300000) / 1000)} seconds.`)); }, a.timeoutMs ?? 300000);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => { clearTimeout(timer); reject(new AiError(`Couldn't start Claude on this PC: ${e.message}`)); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) reject(new AiError(`Claude stopped with code ${code}. ${stderr.slice(0, 200)}`));
      else resolve(stdout);
    });
    p.stdin.end(prompt);
  }).catch(async (e) => { await log(false, null, e.message); throw e; });

  // The raw answer stays on disk, to look at when something odd comes back.
  fs.writeFileSync(path.join(dataDir(), `ai-last-${a.task}.json`), out);
  let j: { structured_output?: unknown; result?: string; total_cost_usd?: number; is_error?: boolean };
  try { j = JSON.parse(out); } catch { await log(false, null, "not JSON"); throw new AiError("The AI answer was not JSON."); }
  let ans = j.structured_output;
  if (ans === undefined && j.result) { try { ans = JSON.parse(j.result); } catch { /* handled below */ } }
  if (!ans || j.is_error) { await log(false, j.total_cost_usd ?? null, j.result ?? "no answer"); throw new AiError(`The AI gave no answer. ${String(j.result ?? "").slice(0, 160)}`); }
  await log(true, j.total_cost_usd ?? null, null);
  return ans as T;
}
