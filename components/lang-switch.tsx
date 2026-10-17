"use client";
import type { Lang } from "@/lib/i18n";
import { useLang } from "./lang";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
];

// English | 中文: switches every screen and the report. Sits in the top bar of every page.
export function LangSwitch() {
  const { lang, tr, setLang } = useLang();
  return (
    <div className="g-seg" role="group" aria-label={tr("Language", "语言")}>
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" className="g-seg-btn" aria-pressed={lang === o.value} onClick={() => lang !== o.value && setLang(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
