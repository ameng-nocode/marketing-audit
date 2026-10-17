import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandIcon, CHANNELS, facebook } from "@/components/brand";
import { DeleteCheck } from "@/components/delete-check";
import { IconDownload, IconEdit, IconOut, IconPlus } from "@/components/icons";
import { ReportFrame } from "@/components/report-frame";
import { RunPanel } from "@/components/run-panel";
import { StartCheck } from "@/components/start-check";
import { Body, Fact, PageHeader, Panel, StatusTag, TopBar } from "@/components/ui";
import { Shots } from "@/components/viewer";
import { getCheck } from "@/lib/checks";
import { myDateTime, priceText, profitText, runningAdsLabel, shortUrl } from "@/lib/format";
import { flagText, pick } from "@/lib/i18n";
import { getLang } from "@/lib/lang-server";
import { apifyCost } from "@/lib/apify";
import { aiCost, getReport } from "@/lib/reports";
import { MakeChinese } from "@/components/make-chinese";
import { getLogo, getProgress } from "@/lib/runs";

const website = CHANNELS.find((c) => c.key === "website")!;

function Out({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="g-out inline-flex items-center gap-1">
      {shortUrl(href)}<IconOut size={14} />
    </a>
  );
}

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCheck(id);
  if (!c) notFound();
  // The report shows in the app's language. 中文 not written yet: the English one shows, with a button to write it.
  const lang = await getLang();
  const t = (en: string, zh: string) => pick(lang, en, zh);
  const progress = await getProgress(c.id);
  const logoId = await getLogo(c.id);
  const reportEn = c.status !== "running" ? await getReport(c.id, "en") : undefined;
  const reportZh = lang === "zh" && c.status !== "running" ? await getReport(c.id, "zh") : undefined;
  const report = lang === "zh" ? reportZh ?? reportEn : reportEn;
  const shown = lang === "zh" && reportZh ? "zh" : "en";
  const cost = await aiCost(c.id);
  const apify = await apifyCost(c.id);
  const spend = [cost.calls ? t(`AI about US$${(cost.usd ?? 0).toFixed(2)}`, `AI 大约 US$${(cost.usd ?? 0).toFixed(2)}`) : "", apify.runs ? t(`Apify about US$${(apify.usd ?? 0).toFixed(2)}`, `Apify 大约 US$${(apify.usd ?? 0).toFixed(2)}`) : ""].filter(Boolean).join(", ");
  const flags = report?.flags ? report.flags.split("\n").filter(Boolean) : [];
  const uploads = c.uploads.map((u) => ({ src: `/files/${u.id}`, name: u.original_name }));
  const ran = (progress?.steps.length ?? 0) > 0;
  const none = <span className="text-muted">{t("None", "没有")}</span>;
  return (
    <div className="g-page">
      <TopBar>
        <Link href="/" className="g-pill">{t("All checks", "所有检查")}</Link>
        {/* One navy button per screen: once the report is there, Download PDF is it. */}
        <Link href="/new" className={`${reportEn ? "g-pill" : "g-btn g-btn-sm"} hidden md:inline-flex`}><IconPlus size={16} />{t("New check", "新检查")}</Link>
      </TopBar>
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoId && <img src={`/shots/${logoId}`} alt="" className="h-14 w-14 flex-none rounded-full border border-line bg-panel" />}
            <span className="min-w-0 truncate">{c.name}</span>
          </span>
        }
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusTag status={c.status} lang={lang} />
            <span className="font-mono text-sm text-muted">{t("Added", "加入于")} {myDateTime(c.created_at, lang)}</span>
            {report && <span className="font-mono text-sm text-muted">{t("Report made", "报告做好于")} {myDateTime(report.made_at, lang)}{spend ? `, ${spend}` : ""}</span>}
          </span>
        }
        actions={
          <>
            {report && <a href={`/checks/${c.id}/report/pdf?lang=${shown}`} className="g-btn g-btn-sm"><IconDownload size={16} />{t("Download PDF", "下载 PDF")}</a>}
            {ran && c.status !== "running" && <StartCheck id={c.id} again hasReport={!!report} />}
            <Link href={`/checks/${c.id}/edit`} className="g-pill"><IconEdit size={16} />{t("Edit", "编辑")}</Link>
            <DeleteCheck id={c.id} name={c.name} shots={c.shots} />
          </>
        }
      />
      <Body>
        <div className="flex flex-col gap-6">
          {flags.length > 0 && (
            <details className="g-card g-flags">
              <summary>{t(flags.length === 1 ? "1 thing to check before you send the report" : `${flags.length} things to check before you send the report`, `发报告前, 有 ${flags.length} 个地方要看一下`)}</summary>
              <ul>{flags.map((f) => <li key={f}>{flagText(f, lang)}</li>)}</ul>
            </details>
          )}
          {ran && progress ? (
            <RunPanel auditId={c.id} initial={progress} />
          ) : (
            <div className="g-card flex flex-wrap items-center gap-4 p-6">
              <div className="flex-1">
                <div className="text-xl font-extrabold">{t("Check not started", "检查还没开始")}</div>
                <div className="text-base font-medium text-navy-2">{t("Start the 6 checks and the report: channels, content, ads, competitors, call to action and creative, with a screenshot for every fact.", "开始 6 项检查和报告: 渠道, 内容, 广告, 同行, call to action 和 creative, 每一点都有截图做证明.")}</div>
              </div>
              <StartCheck id={c.id} />
            </div>
          )}

          {lang === "zh" && reportEn && !reportZh && <MakeChinese id={c.id} />}
          {report && <ReportFrame id={c.id} stamp={report.made_at} lang={shown} />}

          <Panel title={t("What you entered", "你填的资料")}>
            <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-6">
              <Fact label={t("Facebook page", "Facebook 专页")}><span className="flex items-center gap-2"><BrandIcon c={facebook} size={18} /><Out href={c.facebook_url} /></span></Fact>
              <Fact label={t("Website", "网站")}>{c.website ? <span className="flex items-center gap-2"><BrandIcon c={website} size={18} /><Out href={c.website} /></span> : none}</Fact>
              <Fact label={t("What they sell", "卖什么")}>{c.description ? <span className="whitespace-pre-line">{c.description}</span> : none}</Fact>
              <Fact label={t("Price", "售价")}>{priceText(c.price_low, c.price_high, c.price_unit, lang) || <span className="text-muted">{t("Not sure", "不确定")}</span>}</Fact>
              <Fact label={t("Profit per sale", "每单利润")}>{profitText(c.profit_rm, c.profit_pct, lang) || <span className="text-muted">{t("Not sure", "不确定")}</span>}</Fact>
              <Fact label={t("Running ads", "有跑广告吗")}>{runningAdsLabel(c.running_ads, lang)}{c.running_ads === "yes" ? t(`, ${uploads.length} ${uploads.length === 1 ? "screenshot" : "screenshots"}`, `, ${uploads.length} 张截图`) : ""}</Fact>
            </div>
            {c.running_ads === "yes" && uploads.length > 0 && <Shots shots={uploads} />}
          </Panel>
        </div>
      </Body>
    </div>
  );
}
