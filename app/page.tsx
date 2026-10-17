import Link from "next/link";
import { BrandIcon, facebook } from "@/components/brand";
import { IconPlus } from "@/components/icons";
import { Body, PageHeader, StatusTag, TopBar } from "@/components/ui";
import { listChecks } from "@/lib/checks";
import { myDateTime, runningAdsLabel, shortUrl } from "@/lib/format";
import { pick } from "@/lib/i18n";
import { getLang } from "@/lib/lang-server";

// Company, Facebook page, Website, Running ads, Screenshots, Status, Added
const COLS = "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,1.2fr)]";

export default async function AllChecks() {
  const lang = await getLang();
  const t = (en: string, zh: string) => pick(lang, en, zh);
  const rows = await listChecks();
  const newBtn = <Link href="/new" className="g-btn g-btn-sm"><IconPlus size={16} />{t("New check", "新检查")}</Link>;
  return (
    <div className="g-page">
      <TopBar>{newBtn}</TopBar>
      <PageHeader title={t("All checks", "所有检查")} sub={rows.length ? t(`${rows.length} ${rows.length === 1 ? "check" : "checks"}, newest first`, `${rows.length} 个检查, 最新的在上面`) : undefined} />
      <Body>
        {rows.length === 0 ? (
          <div className="g-card flex flex-col items-center gap-3 px-6 py-16 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/3d/globe.webp" alt="" className="mb-2 w-40" />
            <div className="text-2xl font-extrabold">{t("No checks yet", "还没有检查")}</div>
            <div className="text-lg font-medium text-navy-2">{t("Paste a Facebook page to start the first one.", "贴上一个 Facebook 专页, 开始第一个检查.")}</div>
            <div className="mt-4">{newBtn}</div>
          </div>
        ) : (
          <div className="g-card overflow-hidden" role="table" aria-label={t("All checks", "所有检查")}>
            <div role="row" className={`hidden gap-4 border-b border-line px-6 py-4 md:grid ${COLS}`}>
              <span role="columnheader" className="g-label">{t("Company", "公司")}</span>
              <span role="columnheader" className="g-label">{t("Facebook page", "Facebook 专页")}</span>
              <span role="columnheader" className="g-label">{t("Website", "网站")}</span>
              <span role="columnheader" className="g-label">{t("Running ads", "有跑广告")}</span>
              <span role="columnheader" className="g-label">{t("Screenshots", "截图")}</span>
              <span role="columnheader" className="g-label">{t("Status", "状态")}</span>
              <span role="columnheader" className="g-label">{t("Added", "加入日期")}</span>
            </div>
            {rows.map((r) => (
              <Link key={r.id} href={`/checks/${r.id}`} role="row" className={`g-row grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-line px-6 py-5 last:border-b-0 md:gap-y-0 ${COLS}`}>
                <span role="cell" className="truncate text-lg font-extrabold">{r.name}</span>
                <span role="cell" className="col-start-1 flex min-w-0 items-center gap-2 text-base font-semibold text-navy-2 md:col-start-auto">
                  <BrandIcon c={facebook} size={16} /><span className="truncate">{shortUrl(r.facebook_url)}</span>
                </span>
                <span role="cell" className="hidden truncate text-base font-semibold text-navy-2 md:block">{r.website ? shortUrl(r.website) : <span className="text-muted">{t("None", "没有")}</span>}</span>
                <span role="cell" className="hidden text-base font-semibold text-navy-2 md:block">{runningAdsLabel(r.running_ads, lang)}</span>
                <span role="cell" className="num hidden text-base font-semibold text-navy-2 md:block">{r.shots || <span className="text-muted">0</span>}</span>
                <span role="cell" className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto"><StatusTag status={r.status} lang={lang} /></span>
                <span role="cell" className="col-span-2 whitespace-nowrap font-mono text-sm text-muted md:col-span-1">{myDateTime(r.created_at, lang)}</span>
              </Link>
            ))}
          </div>
        )}
      </Body>
    </div>
  );
}
