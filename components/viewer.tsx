"use client";
import { useCallback, useEffect, useState } from "react";
import { IconLeft, IconRight, IconX } from "./icons";
import { useLang } from "./lang";

export type Shot = { src: string; name: string };

// The viewer state: which picture is open (null = closed), with Esc and arrow keys while open.
export function useViewer(count: number) {
  const [at, setAt] = useState<number | null>(null);
  const close = useCallback(() => setAt(null), []);
  const step = useCallback((d: number) => setAt((i) => (i === null ? i : (i + d + count) % count)), [count]);
  useEffect(() => {
    if (at === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
    };
  }, [at, close, step]);
  return { at, setAt, close, step };
}

// Thumbnails that open in the page (Close, Esc, arrow keys). Never a new tab.
// small = a row of little proof thumbnails (check results), no file names.
export function Shots({ shots, small }: { shots: Shot[]; small?: boolean }) {
  const { at, setAt, close, step } = useViewer(shots.length);
  const { tr } = useLang();
  return (
    <>
      {small ? (
        <div className="g-thumbs">
          {shots.map((s, i) => (
            <button key={s.src} type="button" className="g-thumb" onClick={() => setAt(i)} aria-label={tr(`Open ${s.name}`, `打开 ${s.name}`)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={s.name} loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-6">
        {shots.map((s, i) => (
          <li key={s.src} className="g-file">
            <button type="button" onClick={() => setAt(i)} className="block cursor-zoom-in rounded-2xl transition-transform hover:-translate-y-1" aria-label={tr(`Open ${s.name}`, `打开 ${s.name}`)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={s.name} loading="lazy" />
            </button>
            <span className="truncate font-mono text-sm text-navy-2">{s.name}</span>
          </li>
        ))}
      </ul>
      )}

      {at !== null && <ViewerDialog shots={shots} at={at} close={close} step={step} />}
    </>
  );
}

export function ViewerDialog({ shots, at, close, step }: { shots: Shot[]; at: number; close: () => void; step: (d: number) => void }) {
  const { tr } = useLang();
  return (
    <div role="dialog" aria-modal="true" aria-label={tr("Screenshot viewer", "看截图")} className="fixed inset-0 z-50 flex flex-col gap-3 bg-viewer p-4">
      <div className="flex items-center gap-3 text-panel">
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold">{shots[at].name}</div>
          <div className="font-mono text-sm text-muted">{tr(`Screenshot ${at + 1} of ${shots.length}. Esc closes.`, `第 ${at + 1} 张, 共 ${shots.length} 张. 按 Esc 关闭.`)}</div>
        </div>
        {shots.length > 1 && (
          <>
            <button type="button" className="g-pill w-10 px-0" onClick={() => step(-1)} aria-label={tr("Previous screenshot", "上一张")}><IconLeft size={16} /></button>
            <button type="button" className="g-pill w-10 px-0" onClick={() => step(1)} aria-label={tr("Next screenshot", "下一张")}><IconRight size={16} /></button>
          </>
        )}
        <button type="button" className="g-pill" onClick={close} autoFocus><IconX size={16} />{tr("Close", "关闭")}</button>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shots[at].src} alt={shots[at].name} className="max-h-full max-w-full rounded-2xl bg-panel object-contain" />
      </div>
    </div>
  );
}
