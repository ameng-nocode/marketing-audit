import { askJson } from "../ai";
import { HOUSE } from "../ai-rules";
import { q } from "../db";
import { shotPath, Skipped, type Ctx } from "./kit";

// Check 6: the first 3 seconds of their videos (Reels and ads) and of competitors' video ads.
// The Reels-per-month chart needs no step: it comes from the Reel dates of check 2.

type Video = { kind: "reel" | "ad"; id: string; own: boolean; who: string; words: string | null; frames: string; framesId: string };
type Hooks = { videos: { video: number; shows: string; rating: "strong" | "ok" | "weak"; why: string; fix: string }[] };

export async function hooks(c: Ctx) {
  const reels = await q<{ id: string; caption: string | null; frames_shot_id: string }>(
    `select id::text, caption, frames_shot_id::text from reels where audit_id = $1 and frames_shot_id is not null order by position limit 4`, [c.auditId]);
  const ads = await q<{ id: string; own: boolean; page_name: string | null; full_text: string | null; body: string | null; frames_shot_id: string }>(
    `select id::text, own, page_name, full_text, body, frames_shot_id::text from ads where audit_id = $1 and frames_shot_id is not null and (own or picked) order by own desc, closest desc, position`, [c.auditId]);
  const vids: Video[] = [];
  for (const r of reels) {
    const f = await shotPath(r.frames_shot_id);
    if (f) vids.push({ kind: "reel", id: r.id, own: true, who: `${c.biz.name} Reel`, words: r.caption, frames: f, framesId: r.frames_shot_id });
  }
  for (const a of [...ads.filter((x) => x.own).slice(0, 3), ...ads.filter((x) => !x.own).slice(0, 4)]) {
    const f = await shotPath(a.frames_shot_id);
    const first = (a.full_text ?? a.body ?? "").split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? null;
    if (f) vids.push({ kind: "ad", id: a.id, own: a.own, who: a.own ? `${c.biz.name} ad` : `Competitor ad: ${a.page_name ?? "?"}`, words: first, frames: f, framesId: a.frames_shot_id });
  }
  if (!vids.length) throw new Skipped("No video frames to look at.");
  const a = await askJson<Hooks>({
    auditId: c.auditId, task: "hooks", model: "sonnet", system: HOUSE, images: vids.map((v) => v.frames),
    prompt: `Each picture is the first 4 seconds of a short video: 4 frames side by side at 0, 1, 2 and 3 seconds.
${vids.map((v, i) => `Video ${i + 1}: ${v.who}. Picture: ${v.frames}. First line of the caption or ad copy: ${v.words ?? "none"}`).join("\n")}

For each video, judge the hook: do the first 3 seconds make a scrolling person stop?
A strong hook shows the product or the result straight away, has big readable text or a clear question, and moves (hands, cutting, pouring, a face talking).
A weak hook opens on a logo, a slow wide shot, a blank or busy screen, or small text.
- shows: what the first 3 seconds show, in one plain line.
- rating: strong, ok or weak.
- why: one short line.
- fix: one short line on what to change in the first 3 seconds of this video. Only about the opening, not a new content idea.`,
    schema: {
      type: "object",
      properties: {
        videos: {
          type: "array",
          items: { type: "object", properties: { video: { type: "integer" }, shows: { type: "string" }, rating: { type: "string", enum: ["strong", "ok", "weak"] }, why: { type: "string" }, fix: { type: "string" } }, required: ["video", "shows", "rating", "why", "fix"] },
        },
      },
      required: ["videos"],
    },
  });
  for (const [i, h] of a.videos.entries()) {
    const v = vids[h.video - 1];
    if (!v) continue;
    await q(
      `insert into hooks (audit_id, step_id, ad_id, reel_id, own, frames_shot_id, shows, rating, why, fix, position) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [c.auditId, c.stepId, v.kind === "ad" ? v.id : null, v.kind === "reel" ? v.id : null, v.own, v.framesId, h.shows, h.rating, h.why, h.fix, i],
    );
  }
  const own = a.videos.filter((h) => vids[h.video - 1]?.own);
  if (own.length) {
    const weak = own.filter((h) => h.rating === "weak").length;
    await c.fact({ key: "hooks", label: "Hooks on their videos", value: `${own.length - weak} of ${own.length} hold attention`, status: weak > own.length / 2 ? "weak" : "info" });
  }
}
