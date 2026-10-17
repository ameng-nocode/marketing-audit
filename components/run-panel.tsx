"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { retryStepAction } from "@/lib/actions";
import { noteText, STEP_ZH } from "@/lib/i18n";
import type { Progress } from "@/lib/runs";
import { IconCheck, IconX } from "./icons";
import { useLang } from "./lang";
import { Shots } from "./viewer";

const CHECKS = [
  { no: 1, title: ["Channels", "渠道"], q: ["Where can customers find them?", "客人可以在哪里找到他们?"], img: "/3d/globe.webp" },
  { no: 2, title: ["Own content", "自己的内容"], q: ["Do they post their own videos?", "他们有自己拍 video 吗?"], img: "/3d/play.webp" },
  { no: 3, title: ["Ads", "广告"], q: ["Have they run ads?", "他们有跑过广告吗?"], img: "/3d/megaphone.webp" },
  { no: 4, title: ["Competitors", "同行"], q: ["Who else sells this with ads?", "还有谁在卖这个, 也有跑广告?"], img: "/3d/binoculars.webp" },
  { no: 5, title: ["Call to action", "Call to action"], q: ["What do they ask customers to do?", "他们叫客人做什么?"], img: "/3d/cursor.webp" },
  { no: 6, title: ["Creative", "Creative"], q: ["Do their first 3 seconds stop the scroll?", "开头 3 秒能不能让人停下来?"], img: "/3d/sparkle.webp" },
  { no: 7, title: ["Report", "报告"], q: ["Putting it all together", "把全部整理起来"], img: "/3d/report.webp" },
] as const;
const WORD: Record<string, [string, string]> = {
  waiting: ["Waiting", "等待中"], running: ["Running", "进行中"], done: ["Done", "完成"], not_checked: ["Not checked", "没检查到"], skipped: ["Skipped", "跳过"], failed: ["Failed", "失败"],
};

// The 3 checks as a live list. Asks the app for progress every 2 seconds while a run is going.
export function RunPanel({ auditId, initial }: { auditId: string; initial: Progress }) {
  const router = useRouter();
  const { lang, tr } = useLang();
  const word = (st: string) => (WORD[st] ? tr(...WORD[st]) : st);
  const label = (s: { key: string; label: string }) => (lang === "zh" && STEP_ZH[s.key]) || s.label;
  const note = (n: string | null) => noteText(n, lang);
  const [p, setP] = useState(initial);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [, start] = useTransition();
  const wasRunning = useRef(initial.status === "running");

  useEffect(() => setP(initial), [initial]);

  useEffect(() => {
    if (p.status !== "running") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/checks/${auditId}/progress`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) setP(await r.json());
    }, 2000);
    return () => clearInterval(t);
  }, [p.status, auditId]);

  // A run just finished: load the results below.
  useEffect(() => {
    if (wasRunning.current && p.status !== "running") router.refresh();
    wasRunning.current = p.status === "running";
  }, [p.status, router]);

  const retry = (stepId: string) => {
    setBusyStep(stepId);
    start(async () => {
      const fd = new FormData();
      fd.set("step", stepId);
      await retryStepAction(fd);
      const r = await fetch(`/api/checks/${auditId}/progress`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) setP(await r.json());
      setBusyStep(null);
    });
  };

  const total = p.steps.length;
  const finished = p.steps.filter((s) => !["waiting", "running"].includes(s.status)).length;
  const running = p.status === "running";
  const attention = p.steps.filter((s) => s.status === "failed" || s.status === "not_checked");
  const count = (st: string) => p.steps.filter((s) => s.status === st).length;
  // When the run is over the results matter more: steps fold away, except the ones to retry.
  const [open, setOpen] = useState(false);
  const showAll = running || open;

  return (
    <section className="g-card overflow-hidden" aria-label={tr("Check progress", "检查进度")}>
      <div className={`flex flex-wrap items-center gap-4 px-6 py-5 ${showAll || attention.length ? "border-b border-line" : ""}`}>
        <div className="flex-1">
          <h2 className="text-xl font-extrabold">{running ? tr("Checking now", "检查中") : tr("The checks", "检查项目")}</h2>
          <p className="font-mono text-sm text-muted">
            {running
              ? tr(`${finished} of ${total} steps finished. Takes about 10 minutes. You can leave this page. It keeps going.`, `${total} 个步骤完成了 ${finished} 个. 大约要 10 分钟. 你可以离开这一页, 它会继续跑.`)
              : [tr(`${count("done")} done`, `${count("done")} 个完成`), count("not_checked") && tr(`${count("not_checked")} not checked`, `${count("not_checked")} 个没检查到`), count("skipped") && tr(`${count("skipped")} skipped`, `${count("skipped")} 个跳过`), count("failed") && tr(`${count("failed")} failed`, `${count("failed")} 个失败`)].filter(Boolean).join(", ") + "."}
          </p>
        </div>
        {running ? (
          <div className="h-2 w-full overflow-hidden rounded-full bg-line md:w-60" aria-hidden="true">
            <div className="h-full rounded-full bg-cyan transition-all duration-500" style={{ width: `${total ? (finished / total) * 100 : 0}%` }} />
          </div>
        ) : (
          <button type="button" className="g-pill" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? tr("Hide steps", "收起步骤") : tr(`Show all ${total} steps`, `显示全部 ${total} 个步骤`)}</button>
        )}
      </div>
      {!showAll && attention.length > 0 && (
        <ul className="px-6 py-2">
          {attention.map((s) => (
            <li key={s.id} className="g-step">
              <span className={`g-step-icon ${s.status}`} aria-hidden="true">{s.status === "failed" ? <IconX size={14} /> : <span className="font-mono text-xs">–</span>}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-lg font-bold">{label(s)}</span>
                  <span className={`font-mono text-sm ${s.status === "failed" ? "text-red" : "text-muted"}`}>{word(s.status)}</span>
                </div>
                {s.note && <p className="text-base font-medium text-navy-2">{note(s.note)}</p>}
              </div>
              <button type="button" className="g-pill" onClick={() => retry(s.id)} disabled={busyStep === s.id}>{busyStep === s.id ? tr("Starting", "开始中") : tr("Retry", "重试")}</button>
            </li>
          ))}
        </ul>
      )}
      {showAll && CHECKS.map((c) => {
        const steps = p.steps.filter((s) => s.check_no === c.no);
        const busy = steps.some((s) => s.status === "running");
        const on = !busy && steps.length > 0 && steps.every((s) => !["waiting", "running"].includes(s.status));
        return (
          <div key={c.no} className="g-run">
            <div className={`g-run-obj ${busy ? "busy" : on ? "on" : ""}`} aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.img} alt="" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-xl font-extrabold">{c.no} · {tr(c.title[0], c.title[1])}</h3>
                <span className="text-base font-medium text-navy-2">{tr(c.q[0], c.q[1])}</span>
              </div>
              <ul className="mt-2">
                {steps.map((s) => (
                  <li key={s.id} className="g-step">
                    <span className={`g-step-icon ${s.status}`} aria-hidden="true">
                      {s.status === "done" && <IconCheck size={14} />}
                      {s.status === "failed" && <IconX size={14} />}
                      {(s.status === "not_checked" || s.status === "skipped") && <span className="font-mono text-xs">–</span>}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className="text-lg font-bold">{label(s)}</span>
                        <span className={`font-mono text-sm ${s.status === "failed" ? "text-red" : "text-muted"}`}>{word(s.status)}</span>
                      </div>
                      {s.note && <p className="text-base font-medium text-navy-2">{note(s.note)}</p>}
                      {s.shots.length > 0 && <Shots small shots={s.shots.map((x) => ({ src: `/shots/${x.id}`, name: x.caption }))} />}
                    </div>
                    {(s.status === "failed" || s.status === "not_checked") && (
                      <button type="button" className="g-pill" onClick={() => retry(s.id)} disabled={busyStep === s.id}>
                        {busyStep === s.id ? tr("Starting", "开始中") : tr("Retry", "重试")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </section>
  );
}
