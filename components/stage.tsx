"use client";
import { useRef } from "react";
import { useLang } from "./lang";

// One glossy 3D object per audit check. The object for the current question lights up (all = the answers screen).
const OBJECTS = [
  { pos: "g-p1", src: "/3d/globe.webp", steps: [1] },
  { pos: "g-p3", src: "/3d/sparkle.webp", steps: [2] },
  { pos: "g-p2", src: "/3d/cursor.webp", steps: [3] },
  { pos: "g-p4", src: "/3d/binoculars.webp", steps: [4] },
  { pos: "g-p5", src: "/3d/play.webp", steps: [5, 6] },
  { pos: "g-p6", src: "/3d/megaphone.webp", steps: [7] },
];

// The page frame for the question flow: objects drift with the mouse behind the content.
export function Stage({ step, all, children }: { step: number; all?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    el.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  return (
    <div ref={ref} className="g-page" onMouseMove={move}>
      <div className="g-fx" aria-hidden="true">
        {OBJECTS.map((o) => (
          <div key={o.src} className={`g-fw ${o.pos} ${o.steps.includes(step) || all ? "on" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.src} alt="" />
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}

const LEN = 364.42; // circumference of the ring (r = 58)

// Step number inside a ring that fills from the last step to this one. step > total = all answered.
export function Ring({ step, total, label }: { step: number; total: number; label?: string }) {
  const { tr } = useLang();
  const all = step > total;
  const from = all ? 0 : LEN * (1 - (step - 1) / total);
  const to = all ? 0 : LEN * (1 - step / total);
  return (
    <div className="g-ring" style={{ ["--from" as string]: from.toFixed(2), ["--to" as string]: to.toFixed(2) }}>
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
        <circle className="g-ring-t" cx="66" cy="66" r="58" />
        <circle className="g-ring-p" cx="66" cy="66" r="58" />
      </svg>
      <b>{all ? "OK" : String(step).padStart(2, "0")}</b>
      <span>{label ?? (all ? tr(`ALL ${total}`, `全部 ${total}`) : tr(`OF ${total}`, `共 ${total}`))}</span>
    </div>
  );
}
