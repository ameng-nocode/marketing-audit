"use client";
import Link from "next/link";
import { LangSwitch } from "./lang-switch";
import { useLang } from "./lang";

// Top bar every page shares: the app mark on the left; the language switch and the page's own buttons on the right.
export function TopBar({ children }: { children?: React.ReactNode }) {
  const { tr } = useLang();
  const name = tr("Marketing Audit", "营销检查");
  return (
    <header className="g-top">
      <Link href="/" className="g-brand" aria-label={name}><span className="g-mark" aria-hidden="true" /><span className="g-brand-text">{name}</span></Link>
      <div className="flex items-center gap-2">
        <LangSwitch />
        {children}
      </div>
    </header>
  );
}
