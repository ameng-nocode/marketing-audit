import Link from "next/link";
import { Body, TopBar } from "@/components/ui";
import { pick } from "@/lib/i18n";
import { getLang } from "@/lib/lang-server";

export default async function NotFound() {
  const lang = await getLang();
  const t = (en: string, zh: string) => pick(lang, en, zh);
  return (
    <div className="g-page">
      <TopBar />
      <Body>
        <div className="g-card mx-auto mt-16 flex max-w-xl flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="text-2xl font-extrabold">{t("This check isn't here", "找不到这个检查")}</div>
          <div className="text-lg font-medium text-navy-2">{t("It may have been deleted.", "可能已经被删掉了.")}</div>
          <Link href="/" className="g-btn g-btn-sm mt-4">{t("All checks", "所有检查")}</Link>
        </div>
      </Body>
    </div>
  );
}
