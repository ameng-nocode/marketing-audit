import { execFile } from "node:child_process";
import { apifyKey, runActor } from "../apify";
import { q } from "../db";
import { isCaptcha, type Ctx } from "./kit";

// TikTok: the free browser check first. When TikTok shows its slider puzzle (it usually does), the app never
// solves it; Apify's TikTok Profile Scraper reads the profile and the newest 10 videos instead (at most 2 handles).

const ACTOR = "clockworks~tiktok-profile-scraper";
const MAX_APIFY_HANDLES = 2;

type Author = { name: string; nickName?: string; signature?: string; fans?: number; heart?: number; video?: number; profileUrl?: string };
type Item = {
  error?: string; errorCode?: string;
  id?: string; text?: string; createTimeISO?: string; playCount?: number; diggCount?: number; webVideoUrl?: string;
  videoMeta?: { coverUrl?: string; duration?: number };
  authorMeta?: Author;
};

const n = (x: number | undefined) => (x ?? 0).toLocaleString("en-US");

// A video cover from TikTok's picture server, made into a small JPEG (covers can be WebP).
function cover(src: string, out: string) {
  return new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "3", out], { timeout: 30000, windowsHide: true }, (e) => (e ? reject(e) : resolve()));
  });
}

async function viaApify(c: Ctx, h: string, url: string, puzzleShotId: string | null, owner: string) {
  let items: Item[];
  try {
    items = await runActor<Item>({
      auditId: c.auditId, actor: ACTOR, target: `@${h}`, maxItems: 10,
      input: { profiles: [h], resultsPerPage: 10, profileScrapeSections: ["videos"], profileSorting: "latest", shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadAvatars: false, shouldDownloadSubtitles: false, shouldDownloadSlideshowImages: false },
    });
  } catch (e) {
    await c.fact({ key: "tiktok", label: `TikTok @${h}`, note: `TikTok asked to solve a puzzle, and Apify could not read it either: ${e instanceof Error ? e.message : String(e)}`, status: "not_checked", sourceUrl: url, shotId: puzzleShotId });
    return;
  }
  if (!items.length || items.every((i) => i.errorCode === "NOT_FOUND" || (i.error && !i.authorMeta))) {
    await c.fact({ key: "tiktok", label: `TikTok @${h}`, value: "No account", note: "TikTok showed a puzzle. Apify found no account with this name.", status: "none", sourceUrl: url, shotId: puzzleShotId });
    return;
  }
  const a = items.find((i) => i.authorMeta?.name)?.authorMeta;
  const videos = items.filter((i) => i.id && i.webVideoUrl);
  const newest = videos.map((v) => v.createTimeISO?.slice(0, 10)).filter(Boolean).sort().pop();
  for (const [i, v] of videos.slice(0, 10).entries()) {
    const thumb = v.videoMeta?.coverUrl
      ? await c.shotFile(`TikTok video preview @${h}`, (full) => cover(v.videoMeta!.coverUrl!, full), { kind: "thumb", sourceUrl: v.webVideoUrl! }).catch(() => null)
      : null;
    await q(
      `insert into tiktok_videos (audit_id, step_id, handle, video_id, url, views, likes, posted_on, caption, seconds, thumb_shot_id, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (audit_id, video_id) do nothing`,
      [c.auditId, c.stepId, h, v.id, v.webVideoUrl, v.playCount ?? null, v.diggCount ?? null, v.createTimeISO?.slice(0, 10) ?? null, (v.text ?? "").slice(0, 300) || null, v.videoMeta?.duration ?? null, thumb, i],
    );
  }
  const note = [
    a?.nickName ? `Name on TikTok: "${a.nickName}".` : "",
    `${n(a?.video ?? videos.length)} videos, ${n(a?.heart)} likes in total.`,
    newest ? `Newest video posted ${newest}.` : "No videos.",
    a?.signature ? `Bio: "${a.signature.replace(/\s+/g, " ").slice(0, 160)}".` : "",
    "Read through Apify because TikTok showed a puzzle.",
    owner,
  ].filter(Boolean).join(" ");
  await c.fact({ key: "tiktok", label: `TikTok @${h}`, value: `${n(a?.fans)} followers`, note, status: "ok", sourceUrl: a?.profileUrl ?? url, shotId: puzzleShotId });
}

export async function tiktok(c: Ctx, list: string[], whose: (h: string) => string) {
  let apifyUsed = 0;
  for (const h of list) {
    const url = `https://www.tiktok.com/@${h}`;
    await c.open(url, 4500);
    const text = await c.text();
    if (/Couldn't find this account/i.test(text)) {
      const shotId = await c.shot(`TikTok @${h}`, { sourceUrl: url });
      await c.fact({ key: "tiktok", label: `TikTok @${h}`, value: "No account", note: "TikTok says it couldn't find this account.", status: "none", sourceUrl: url, shotId });
      continue;
    }
    if (isCaptcha(text)) {
      const shotId = await c.shot(`TikTok @${h}: TikTok showed a puzzle`, { sourceUrl: url });
      if (apifyKey() && apifyUsed < MAX_APIFY_HANDLES) {
        apifyUsed++;
        await viaApify(c, h, url, shotId, whose(h));
      } else {
        await c.fact({ key: "tiktok", label: `TikTok @${h}`, note: apifyKey() ? "TikTok asked to solve a puzzle, so this was not checked." : "TikTok asked to solve a puzzle, and no Apify key is set, so this was not checked.", status: "not_checked", sourceUrl: url, shotId });
      }
      continue;
    }
    const shotId = await c.shot(`TikTok @${h}`, { sourceUrl: url });
    const html = await c.page.content();
    const fol = (html.match(/"followerCount":(\d+)/) || [])[1];
    const vids = (html.match(/"videoCount":(\d+)/) || [])[1];
    await c.fact({ key: "tiktok", label: `TikTok @${h}`, value: fol ? `${Number(fol).toLocaleString("en-US")} followers` : "Account found", note: [vids ? `${vids} videos.` : "", whose(h)].filter(Boolean).join(" "), status: "ok", sourceUrl: url, shotId });
  }
}
