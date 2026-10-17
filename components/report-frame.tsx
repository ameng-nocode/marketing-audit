"use client";
import { useEffect, useRef, useState } from "react";
import { useLang } from "./lang";
import { ViewerDialog, useViewer, type Shot } from "./viewer";

// The finished report, shown in the check page in its own look. It grows to its full height (no inner scroll);
// a photo click opens the app's viewer, a jump link scrolls this page.
export function ReportFrame({ id, stamp, lang }: { id: string; stamp: string; lang: "en" | "zh" }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1200);
  const [shots, setShots] = useState<Shot[]>([]);
  const { at, setAt, close, step } = useViewer(shots.length);
  const { tr } = useLang();

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const fit = () => {
      const doc = frame.contentDocument;
      const win = frame.contentWindow as (Window & { ResizeObserver: typeof ResizeObserver }) | null;
      if (!doc?.body || !win) return;
      setHeight(doc.documentElement.scrollHeight);
      ro?.disconnect();
      // The frame's own observer: it sees its page grow as fonts and photos load.
      ro = new win.ResizeObserver(() => setHeight(doc.documentElement.scrollHeight));
      ro.observe(doc.body);
    };
    frame.addEventListener("load", fit);
    fit();
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
      if (e.data?.type === "report-zoom") { setShots(e.data.list); setAt(e.data.at); }
      if (e.data?.type === "report-scroll") window.scrollTo({ top: frame.getBoundingClientRect().top + window.scrollY + e.data.y - 96, behavior: "smooth" });
    };
    window.addEventListener("message", onMsg);
    return () => { frame.removeEventListener("load", fit); window.removeEventListener("message", onMsg); ro?.disconnect(); };
  }, [setAt]);

  return (
    <>
      <iframe ref={ref} src={`/checks/${id}/report?embed=1&lang=${lang}&v=${encodeURIComponent(stamp)}`} title={tr("Report", "报告")} className="g-report-frame" style={{ height }} />
      {at !== null && shots[at] && <ViewerDialog shots={shots} at={at} close={close} step={step} />}
    </>
  );
}
