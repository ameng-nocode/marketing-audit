"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext } from "react";
import { LANG_COOKIE, pick, type Lang } from "@/lib/i18n";

const LangContext = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

// The language in the browser: tr("English", "中文") picks the words, setLang switches the whole app.
export function useLang() {
  const lang = useContext(LangContext);
  const router = useRouter();
  const tr = useCallback((en: string, zh: string) => pick(lang, en, zh), [lang]);
  const setLang = useCallback((l: Lang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);
  return { lang, tr, setLang };
}
