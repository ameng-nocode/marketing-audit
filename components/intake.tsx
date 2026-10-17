"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { saveCheckAction, type FormState } from "@/lib/actions";
import { bareUnit, checkFields, checkFile, MAX_FILES, normalizeFacebook, normalizeWebsite, parseMoney, parsePct, PRICE_UNITS, priceText, profitText, RUNNING_ADS, runningAdsLabel, shortUrl, type FieldErrors } from "@/lib/format";
import { BrandIcon, ChannelStrip, facebook } from "./brand";
import { IconArrow, IconCheck, IconUpload, IconX } from "./icons";
import { Modal } from "./modal";
import { Ring, Stage } from "./stage";
import { useLang } from "./lang";
import { TopBar } from "./ui";

export type FormValues = {
  facebook: string; name: string; website: string; description: string;
  price_low: string; price_high: string; price_unit: string; profit: string; profit_kind: string; running_ads: string;
};
export type Existing = { id: string; name: string; size: number; src: string };
type NewFile = { key: string; file: File; url: string };

const EMPTY: FormValues = { facebook: "", name: "", website: "", description: "", price_low: "", price_high: "", price_unit: "", profit: "", profit_kind: "rm", running_ads: "" };
// 7 questions, then the answers screen.
const TOTAL = 7;
const DONE = TOTAL + 1;
// Which question each kind of problem belongs to (server errors send you back there).
const STEP_OF: [keyof FieldErrors, number][] = [["facebook", 1], ["name", 2], ["website", 3], ["price", 5], ["profit", 6], ["running_ads", 7], ["files", 7]];
const KEYS = ["A", "B", "C"];

// The start flow: one question per screen, then the answers with Change, then Save.
// New check starts at question 1; Edit starts on the answers screen.
export function Intake({ id, initial, existing = [] }: { id?: string; initial?: FormValues; existing?: Existing[] }) {
  const editing = !!id;
  const router = useRouter();
  const { lang, tr } = useLang();
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveCheckAction, {});
  const [step, setStep] = useState(editing ? DONE : 1);
  const [v, setV] = useState<FormValues>(initial ?? EMPTY);
  const [files, setFiles] = useState<NewFile[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [toSummary, setToSummary] = useState(editing);
  const [dirty, setDirty] = useState(false);
  const [over, setOver] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  // "Other" price unit: open when a typed unit (not one of the choices) is already there.
  const [otherUnit, setOtherUnit] = useState(() => !!bareUnit(initial?.price_unit) && !PRICE_UNITS.some((u) => u.key === initial?.price_unit));
  const submitting = useRef(false);

  const yes = v.running_ads === "yes";
  const kept = existing.filter((u) => !removed.has(u.id));
  const count = kept.length + files.length;
  // Saved screenshots belong to "Running ads = Yes"; any other answer drops them on save.
  const dropping = yes ? 0 : kept.length;
  const fbClean = normalizeFacebook(v.facebook);

  // A problem the server found sends you back to that question.
  useEffect(() => {
    if (state.errors) {
      const hit = STEP_OF.find(([k]) => state.errors?.[k]);
      if (hit) { setStep(hit[1]); setErr(state.errors[hit[0]] ?? ""); }
      submitting.current = false;
    }
    if (state.message) submitting.current = false;
  }, [state]);

  // Free the picture previews when they go.
  const urls = useMemo(() => files.map((f) => f.url), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  // Warn before leaving with unsaved answers: closing the tab, or a link inside the app.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { if (!submitting.current) e.preventDefault(); };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a || submitting.current || a.target === "_blank" || e.metaKey || e.ctrlKey) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(href);
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const set = (k: keyof FormValues, value: string) => {
    setV((x) => ({ ...x, [k]: value }));
    setDirty(true);
    setErr("");
  };
  const go = (n: number) => { setStep(n); setErr(""); };

  const next = () => {
    const e = checkFields(v, lang);
    const problem = ({ 1: e.facebook, 2: e.name, 3: e.website, 5: e.price, 6: e.profit, 7: e.running_ads } as Record<number, string | undefined>)[step];
    if (problem) { setErr(problem); return; }
    go(toSummary || step >= TOTAL ? DONE : step + 1);
  };
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); next(); }
  };
  // Skip clears what the question asked (price = all 3 boxes).
  const skip = (k: "website" | "description" | "price" | "profit") => {
    setV((x) => (k === "price" ? { ...x, price_low: "", price_high: "", price_unit: "" } : { ...x, [k]: "" }));
    setDirty(true);
    go(toSummary ? DONE : step + 1);
  };
  const pick = (value: string) => {
    set("running_ads", value);
    if (value !== "yes") setTimeout(() => go(DONE), 380);
  };
  const change = (n: number) => { setToSummary(true); go(n); };

  const addFiles = (list: File[]) => {
    const add: NewFile[] = [];
    let problem = "";
    for (const f of list) {
      const bad = checkFile(f, lang);
      if (bad) { problem = bad; continue; }
      if (count + add.length >= MAX_FILES) { problem = tr(`Up to ${MAX_FILES} screenshots per check.`, `每个检查最多 ${MAX_FILES} 张截图.`); break; }
      add.push({ key: `${Date.now()}-${Math.random()}`, file: f, url: URL.createObjectURL(f) });
    }
    if (add.length) { setFiles((x) => [...x, ...add]); setDirty(true); }
    setErr(problem);
  };

  // Paste a screenshot straight from the clipboard (fastest from WhatsApp or a snip).
  useEffect(() => {
    if (step !== 7 || !yes) return;
    const onPaste = (e: ClipboardEvent) => {
      const pics = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!pics.length) return;
      e.preventDefault();
      const t = new Date().toLocaleTimeString("en-GB");
      addFiles(pics.map((f, i) => new File([f], `${tr("Pasted screenshot", "贴上的截图")} ${t}${pics.length > 1 ? ` (${i + 1})` : ""}.${f.type.split("/")[1] || "png"}`, { type: f.type })));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  const save = () => {
    const e = checkFields(v, lang);
    const hit = STEP_OF.find(([k]) => e[k]);
    if (hit) { setStep(hit[1]); setErr(e[hit[0]] ?? ""); return; }
    const fd = new FormData();
    if (id) fd.set("id", id);
    (Object.keys(v) as (keyof FormValues)[]).forEach((k) => fd.set(k, v[k]));
    removed.forEach((r) => fd.append("remove", r));
    if (yes) files.forEach((f) => fd.append("files", f.file, f.file.name));
    fd.set("report_lang", lang); // the report is written in the app's language
    submitting.current = true;
    startTransition(() => formAction(fd));
  };

  const shots = (n: number) => tr(`${n} ${n === 1 ? "screenshot" : "screenshots"}`, `${n} 张截图`);
  const dropNote = tr(`The ${dropping === 1 ? "saved screenshot" : `${dropping} saved screenshots`} will be removed when you save.`, `保存后, 已保存的 ${dropping} 张截图会被删掉.`);
  const sum = [
    { n: 1, label: tr("Facebook page", "Facebook 专页"), value: fbClean ? shortUrl(fbClean) : v.facebook },
    { n: 2, label: tr("Company", "公司"), value: v.name.trim() },
    { n: 3, label: tr("Website", "网站"), value: v.website.trim() ? shortUrl(normalizeWebsite(v.website) ?? v.website) : "" },
    { n: 4, label: tr("What they sell", "卖什么"), value: v.description.trim() },
    { n: 5, label: tr("Price", "售价"), value: priceText(parseMoney(v.price_low), parseMoney(v.price_high), v.price_unit.trim() || null, lang) },
    { n: 6, label: tr("Profit per sale", "一单赚多少"), value: v.profit.trim() ? profitText(v.profit_kind === "rm" ? parseMoney(v.profit) : null, v.profit_kind === "pct" ? parsePct(v.profit) : null, lang) : "" },
    { n: 7, label: tr("Running ads", "有跑广告吗"), value: v.running_ads ? `${runningAdsLabel(v.running_ads, lang)}${yes ? `, ${shots(count)}` : ""}` : "" },
  ];

  return (
    <Stage step={step} all={step === DONE}>
      <TopBar>
        <Link href={editing ? `/checks/${id}` : "/"} className="g-pill">{editing ? tr("Cancel", "取消") : tr("All checks", "所有检查")}</Link>
      </TopBar>

      <main className="g-main">
        <div key={step} className="g-q">
          <Ring step={step} total={TOTAL} />

          {step === 1 && (
            <>
              <h1 className="g-h">{tr("Which business are we checking?", "要检查哪一家?")}</h1>
              <p className="g-sub">{tr("Paste their Facebook page. The check starts there.", "贴上他们的 Facebook 专页, 检查从这里开始.")}</p>
              <Bar id="q-facebook" label={tr("Facebook page link", "Facebook 专页连结")} value={v.facebook} bad={!!err} onChange={(x) => set("facebook", x)} onKeyDown={enter} onGo={next} url />
              {fbClean && !err && (
                <div className="g-chip"><BrandIcon c={facebook} /><span className="t">{shortUrl(fbClean)}</span><span className="ok"><IconCheck size={14} />{tr("Looks right", "没问题")}</span></div>
              )}
              {err ? <p className="g-err" role="alert">{err}</p> : !fbClean && <p className="g-hint">{tr("The link from the page's address bar. Press Enter to go on.", "专页网址栏里的连结. 按 Enter 继续.")}</p>}
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="g-h">{tr("What's the company called?", "公司叫什么名字?")}</h1>
              <p className="g-sub">{tr("This name goes on the report.", "这个名字会放在报告上.")}</p>
              <Bar id="q-name" label={tr("Company name", "公司名字")} value={v.name} bad={!!err} onChange={(x) => set("name", x)} onKeyDown={enter} onGo={next} />
              {err && <p className="g-err" role="alert">{err}</p>}
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="g-h">{tr("Do they have a website?", "他们有网站吗?")}</h1>
              <p className="g-sub">{tr("We look at tracking, WhatsApp and how people buy there.", "我们会看网站的追踪, WhatsApp, 还有客人怎样下单.")}</p>
              <Bar id="q-website" label={tr("Website", "网站")} value={v.website} bad={!!err} onChange={(x) => set("website", x)} onKeyDown={enter} onGo={next} url />
              {err && <p className="g-err" role="alert">{err}</p>}
              <button type="button" className="g-skip" onClick={() => skip("website")}>{tr("No website", "没有网站")}</button>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="g-h">{tr("What do they sell, and where?", "他们卖什么, 在哪里卖?")}</h1>
              <p className="g-sub">{tr("One or two lines. It helps find the right competitors.", "写一两句就好. 这样比较容易找到对的同行.")}</p>
              <Bar id="q-description" label={tr("What they sell and where", "卖什么, 在哪里卖")} value={v.description} onChange={(x) => set("description", x)} onKeyDown={enter} onGo={next} tall />
              <button type="button" className="g-skip" onClick={() => skip("description")}>{tr("Skip", "跳过")}</button>
            </>
          )}

          {step === 5 && (
            <>
              <h1 className="g-h">{tr("What do they charge?", "他们卖多少钱?")}</h1>
              <p className="g-sub">{tr("Their usual selling price. A rough range is fine.", "平时的售价. 大概的范围就可以.")}</p>
              <div className="g-money">
                <Bar id="q-price-low" label={tr("Lowest price in RM", "最低价 (RM)")} value={v.price_low} bad={!!err} onChange={(x) => set("price_low", x)} onKeyDown={enter} pre="RM" num />
                <span className="g-money-to">{tr("to", "到")}</span>
                <Bar id="q-price-high" label={tr("Highest price in RM", "最高价 (RM)")} value={v.price_high} onChange={(x) => set("price_high", x)} onKeyDown={enter} pre="RM" num noFocus />
              </div>
              <div className="g-unit-pick">
                <span className="g-unit-label">{tr("The price is per", "价钱是")}</span>
                <div className="g-seg" role="group" aria-label={tr("The price is per", "价钱是")}>
                  {PRICE_UNITS.map((u) => (
                    <button key={u.key} type="button" className="g-seg-btn" aria-pressed={!otherUnit && v.price_unit === u.key}
                      onClick={() => { setOtherUnit(false); set("price_unit", v.price_unit === u.key && !otherUnit ? "" : u.key); }}>{tr(u.en, u.zh)}</button>
                  ))}
                  <button type="button" className="g-seg-btn" aria-pressed={otherUnit} onClick={() => { setOtherUnit(!otherUnit); set("price_unit", ""); }}>{tr("Other", "其他")}</button>
                </div>
              </div>
              {otherUnit && <Bar id="q-price-unit" label={tr("The price is per", "价钱是每")} value={v.price_unit} onChange={(x) => set("price_unit", x)} onKeyDown={enter} pre={tr("per", "每")} />}
              {err ? <p className="g-err" role="alert">{err}</p> : <p className="g-hint">{tr("One price only: fill the first box. Then pick what the price is for, if you know.", "只有一个价钱的话, 填第一格就好. 然后选价钱是怎么算的, 不确定可以不选.")}</p>}
              <button type="button" className="g-btn" onClick={next}>{tr("Continue", "继续")} <IconArrow size={18} /></button>
              <button type="button" className="g-skip" onClick={() => skip("price")}>{tr("Not sure", "不确定")}</button>
            </>
          )}

          {step === 6 && (
            <>
              <h1 className="g-h">{tr("What do they keep from one sale?", "他们一单赚多少?")}</h1>
              <p className="g-sub">{tr("After the cost of the product or service, before ads. With the cost per lead, this shows if the ads pay.", "扣掉产品或服务的成本, 还没算广告. 配合每个 lead 的成本, 就知道广告有没有赚.")}</p>
              <div className="g-seg" role="group" aria-label={tr("Profit as", "利润用")}>
                <button type="button" className="g-seg-btn" aria-pressed={v.profit_kind !== "pct"} onClick={() => set("profit_kind", "rm")}>{tr("RM per sale", "RM 金额")}</button>
                <button type="button" className="g-seg-btn" aria-pressed={v.profit_kind === "pct"} onClick={() => set("profit_kind", "pct")}>{tr("Margin %", "利润率 %")}</button>
              </div>
              <Bar key={v.profit_kind} id="q-profit" label={v.profit_kind === "pct" ? tr("Margin in %", "利润率 (%)") : tr("Profit per sale in RM", "一单赚多少 (RM)")} value={v.profit} bad={!!err} onChange={(x) => set("profit", x)} onKeyDown={enter} onGo={next} pre={v.profit_kind === "pct" ? undefined : "RM"} post={v.profit_kind === "pct" ? "%" : undefined} num />
              {err ? <p className="g-err" role="alert">{err}</p> : <p className="g-hint">{tr("A rough number is fine. Press Enter to go on.", "大概的数字就可以. 按 Enter 继续.")}</p>}
              <button type="button" className="g-skip" onClick={() => skip("profit")}>{tr("Not sure", "不确定")}</button>
            </>
          )}

          {step === 7 && (
            <>
              <h1 className="g-h">{tr("Are they running ads right now?", "他们现在有在跑广告吗?")}</h1>
              <div className="g-choices" role="radiogroup" aria-label={tr("Running ads", "有跑广告吗")}>
                {RUNNING_ADS.map((r, i) => (
                  <button key={r.value} type="button" role="radio" aria-checked={v.running_ads === r.value} aria-label={runningAdsLabel(r.value, lang)} className="g-choice" onClick={() => pick(r.value)}>
                    <span className="k">{KEYS[i]}</span>
                    <span className="l">{runningAdsLabel(r.value, lang)}</span>
                    <span className="dot" />
                  </button>
                ))}
              </div>
              {yes && (
                <>
                  <label
                    className={`g-drop ${over ? "is-over" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }}
                    onDragLeave={() => setOver(false)}
                    onDrop={(e) => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); }}
                  >
                    <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only" onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
                    <span className="g-drop-icon"><IconUpload size={22} /></span>
                    <span>
                      <b>{tr("Add their Ads Manager screenshots", "放上他们的 Ads Manager 截图")}</b>
                      <span className="t">{tr("Anything with numbers: amount spent, results, cost per result, reach. Add as many as they have.", "有数字的都可以: 花了多少钱, 成果, 每个成果的成本, 触及人数. 有几张就放几张.")}</span>
                      <span className="t">{tr(`Click, drop or paste. PNG, JPG or WebP, up to 10 MB each. ${count} of ${MAX_FILES}.`, `点击, 拖进来或直接贴上. PNG, JPG 或 WebP, 每张最多 10 MB. 已放 ${count} 张, 最多 ${MAX_FILES} 张.`)}</span>
                    </span>
                  </label>
                  {count > 0 && (
                    <div className="g-files">
                      {kept.map((u) => (
                        <Thumb key={u.id} src={u.src} name={u.name} onRemove={() => { setRemoved((s) => new Set(s).add(u.id)); setDirty(true); }} />
                      ))}
                      {files.map((f) => (
                        <Thumb key={f.key} src={f.url} name={f.file.name} onRemove={() => { setFiles((x) => x.filter((y) => y.key !== f.key)); setDirty(true); }} />
                      ))}
                    </div>
                  )}
                  <button type="button" className="g-btn" onClick={next}>{tr("Continue", "继续")} <IconArrow size={18} /></button>
                </>
              )}
              {dropping > 0 && <p className="g-err">{dropNote}</p>}
              {err && <p className="g-err" role="alert">{err}</p>}
            </>
          )}

          {step === DONE && (
            <>
              <h1 className="g-h">{v.name.trim() ? tr(`Ready to check ${v.name.trim()}.`, `准备检查 ${v.name.trim()}.`) : tr("Ready to check.", "准备检查.")}</h1>
              <dl className="g-sum">
                {sum.map((s) => (
                  <div key={s.n} className="g-sum-row">
                    <dt>{s.label}</dt>
                    <dd className={s.value ? "" : "none"}>{s.value || tr("None", "没有")}</dd>
                    <button type="button" className="g-change" onClick={() => change(s.n)} aria-label={tr(`Change ${s.label}`, `更改${s.label}`)}>{tr("Change", "更改")}</button>
                  </div>
                ))}
              </dl>
              {dropping > 0 && <p className="g-err">{dropNote}</p>}
              {state.message && <p className="g-err" role="alert">{state.message}</p>}
              <button type="button" className="g-btn" onClick={save} disabled={pending}>
                {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-panel" aria-hidden="true" />}
                {editing ? tr("Save changes", "保存更改") : tr("Start check", "开始检查")}
                {!pending && <IconArrow size={18} />}
              </button>
            </>
          )}
        </div>
      </main>

      <ChannelStrip lang={lang} />

      <footer className="g-bottom">
        <div>{step > 1 && step < DONE && <button type="button" className="g-pill" onClick={() => go(step - 1)}>{tr("Back", "上一步")}</button>}</div>
        <div className="g-dots" aria-label={step === DONE ? tr(`All ${TOTAL} answered`, `${TOTAL} 题都答好了`) : tr(`Question ${step} of ${TOTAL}`, `第 ${step} 题, 共 ${TOTAL} 题`)}>
          {Array.from({ length: TOTAL }, (_, i) => i + 1).map((i) => (
            <span key={i} className={`g-pip ${i < step ? "is-done" : i === step ? "is-now" : ""}`} />
          ))}
        </div>
        <span />
      </footer>

      <Modal
        open={leaveTo !== null}
        title={tr("Leave without saving?", "不保存就离开?")}
        onClose={() => setLeaveTo(null)}
        actions={
          <>
            <button type="button" className="g-ghost" onClick={() => setLeaveTo(null)} autoFocus>{tr("Stay", "留下")}</button>
            <button type="button" className="g-danger-solid" onClick={() => { const to = leaveTo!; setDirty(false); setLeaveTo(null); router.push(to); }}>{tr("Leave", "离开")}</button>
          </>
        }
      >
        {tr("Your answers on this page will be lost.", "这一页填的答案会不见.")}
      </Modal>
    </Stage>
  );
}

// The input bar: the box and its round Continue button (none when the screen has its own). Starts empty; the hint sits under it.
// pre / post = a unit shown in the box (RM, %, per). num = number keyboard on phones.
function Bar({ id, label, value, onChange, onKeyDown, onGo, bad, url, tall, pre, post, num, noFocus }: {
  id: string; label: string; value: string; onChange: (v: string) => void; onKeyDown: (e: React.KeyboardEvent) => void; onGo?: () => void;
  bad?: boolean; url?: boolean; tall?: boolean; pre?: string; post?: string; num?: boolean; noFocus?: boolean;
}) {
  const { tr } = useLang();
  return (
    <div className={`g-bar ${tall ? "tall" : ""} ${bad ? "is-bad" : ""} ${onGo ? "" : "no-go"}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      {pre && <span className="g-unit" aria-hidden="true">{pre}</span>}
      {tall ? (
        <textarea id={id} className="g-input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} autoFocus aria-invalid={bad} />
      ) : (
        <input id={id} className="g-input" type={url ? "url" : "text"} inputMode={url ? "url" : num ? "decimal" : undefined} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} autoFocus={!noFocus} aria-invalid={bad} />
      )}
      {post && <span className="g-unit" aria-hidden="true">{post}</span>}
      {onGo && <button type="button" className="g-go" onClick={onGo} aria-label={tr("Continue", "继续")}><IconArrow size={20} /></button>}
    </div>
  );
}

function Thumb({ src, name, onRemove }: { src: string; name: string; onRemove: () => void }) {
  const { tr } = useLang();
  return (
    <figure className="g-file">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={name} />
      <figcaption>{name}</figcaption>
      <button type="button" className="g-file-x" onClick={onRemove} aria-label={tr(`Remove ${name}`, `删除 ${name}`)}><IconX size={14} /></button>
    </figure>
  );
}
