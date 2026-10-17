import crypto from "node:crypto";
import { askJson } from "../ai";
import { q } from "../db";
import { Skipped, type Ctx } from "../collect/kit";
import { loadReportData, type ReportData } from "./data";
import { brief, FORMATS, loadTexts, saveWritten, WRITE_SCHEMA, zhPunct, type Written } from "./write";
import { consultant, Consultant, dayIn } from "../settings";

// The 中文 (大马华语) report: written natively from the same facts by the AI (Opus), plus the 中文 of the
// code's own words on the page (notes, photo captions, hook notes), by a second, cheaper call (Sonnet).

export const MAINLAND = ["视频", "软件", "硬件", "信息", "网络", "智能手机", "数据库", "服务器", "屏幕", "鼠标", "打印", "默认", "反馈", "质量", "水平", "立马", "靠谱", "给力", "性价比", "运行", "创建", "搜索", "账号", "粉丝", "链接", "小伙伴", "赋能", "闭环", "抓手", "颗粒度", "打法", "落地", "一站式", "全方位", "极致", "助力", "打造"];

export const FORMATS_ZH: Record<string, string> = {
  "A real customer talking (UGC)": "真实客人分享 (UGC)",
  "Before and after story": "前后对比故事",
  "A day in the life": "一天的日常",
  "Problem, fix, offer": "问题, 解决方法, 优惠",
  "Product demo": "产品示范",
  "Behind the scenes": "幕后花絮",
  "The owner talking": "老板亲自讲",
};

export const HOUSE_ZH = `You write the 中文 version of a marketing audit report for a Malaysian business owner, in 大马华语 (Malaysian Chinese, simplified characters).
Rules:
- Write it in 华语 from the start, from the facts. Never translate the English word for word. Same facts, same numbers, same order.
- Formal but plain. Short sentences, one idea each. No 语气词 (啦, 咯, 哦, 嘛).
- Half-width comma and full stop with a space after: ", " and ". ". Never a semicolon (; or ；), never a dash (— or ——), never emoji.
- Names and office words stay in English: Facebook, Instagram, TikTok, Reels, WhatsApp, Messenger, Google Maps, Meta pixel, Google Analytics, Shop now, Order now, video, account, followers, app, template, file, link names.
- Malaysian words, never mainland ones: video (not 视频), 讯息 (not 信息), 搜寻 (not 搜索), account (not 账号), followers (not 粉丝), 品质 (not 质量), 水准 (not 水平), 马上 (not 立马), 可靠 (not 靠谱), 划算 (not 性价比), 跑 (not 运行), app (not 软件), 荧幕 (not 屏幕), 连结 (not 链接), 做 or 弄 (not 打造).
- Never use these words: 赋能, 闭环, 抓手, 颗粒度, 打法, 落地, 一站式, 全方位, 极致, 助力, 小伙伴, 解锁, 颠覆, 家人们.
- Problems are things to fix, said with respect: 需要加强, 有几处要修, 还没开始, 未安装, 连结失效, 触及偏低.
- Quote their ad copy exactly as written (Chinese or English), minus emoji.
- Never invent a number. Use only numbers in the data or the English report. RM goes right before the number (RM200). Dates like 2026年9月28日.
- ${Consultant()}'s service is consultation: the business's own team shoots, edits, writes and runs the ads. ${Consultant()} gives direction, teaches the tools and reviews every week. Never write that ${consultant()} or "我们" will make the content or run the ads. In 中文, call them ${consultant("zh")}.
- Return only what the JSON schema asks for.`;

// Same shape as the English writer, but the format names are free text (their 中文 names).
const ZH_SCHEMA = (() => {
  const s = JSON.parse(JSON.stringify(WRITE_SCHEMA));
  delete s.properties.try.properties.formats.items.properties.name.enum;
  delete s.properties.try.properties.order.items.properties.name.enum;
  return s;
})();

export const strKey = (en: string) => crypto.createHash("sha1").update(en).digest("hex").slice(0, 16);

// The English words the code itself puts on the page, to get their 中文.
export function displayStrings(d: ReportData) {
  const out = new Set<string>();
  const add = (s: string | null | undefined) => { if (s && /[A-Za-z]{3,}/.test(s) && s.length < 600) out.add(s.trim()); };
  for (const f of d.facts) { add(f.note); if (f.value && !/^~?[\d.,]+[KM]?\s*(followers|ads|places)?$/i.test(f.value)) add(f.value); }
  for (const s of d.shots) add(s.caption);
  for (const h of d.hooks) { add(h.shows); add(h.why); add(h.fix); }
  for (const l of d.landings) { add(l.label); for (const c of l.checks) add(c.note); }
  for (const a of d.ads) { add(a.pick_reason); add(a.sells_to); add(a.offer); }
  return [...out];
}

export async function loadZhStrings(auditId: string) {
  const rows = await q<{ key: string; body: string }>(`select key, body from texts where audit_id = $1 and lang = 'zh' and section = 'str'`, [auditId]);
  return new Map(rows.map((r) => [r.key, r.body]));
}

type Localized = { items: { n: number; zh: string }[] };

async function localize(auditId: string, list: string[]) {
  const done = new Map<string, string>();
  for (let i = 0; i < list.length; i += 80) {
    const part = list.slice(i, i + 80);
    const a = await askJson<Localized>({
      auditId, task: "localize-zh", model: "sonnet", system: HOUSE_ZH, timeoutMs: 300000,
      prompt: `These short English lines are on the report page (notes, photo captions, ad notes). Give each one in 大马华语, same meaning, same length or shorter.
Keep names, handles (@...), links, numbers and quoted ad copy exactly as they are.

${part.map((s, n) => `${n + 1}. ${s}`).join("\n")}`,
      schema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, zh: { type: "string" } }, required: ["n", "zh"] } } }, required: ["items"] },
    });
    for (const it of a.items) { const en = part[it.n - 1]; if (en && it.zh.trim()) done.set(en, zhPunct(it.zh)); }
  }
  return done;
}

export async function writeReportZh(c: Ctx) {
  const [a] = await q<{ report_lang: string }>(`select report_lang from audits where id = $1`, [c.auditId]);
  if (a?.report_lang !== "zh") throw new Skipped("Only the English report was asked for. Switch the app to 中文 to write that one.");
  const d = await loadReportData(c.auditId);
  const en = await loadTexts(c.auditId, "en");
  if (!d || !en.any) throw new Skipped("The English report is not written yet.");
  const rows = await q<{ section: string; key: string; position: number; body: string }>(
    `select section, key, position, body from texts where audit_id = $1 and lang = 'en' and section <> 'str' order by section, key, position`, [c.auditId]);
  const today = dayIn();
  const w = await askJson<Written>({
    auditId: c.auditId, task: "write-report-zh", model: "opus", system: HOUSE_ZH, schema: ZH_SCHEMA, timeoutMs: 600000,
    prompt: `Write the 中文 report for ${d.biz.name}, for the owner to read. Cover the same points as the English report below, in the same JSON shape, written natively in 大马华语.

THE DATA (the facts):
${brief(d, today)}

THE ENGLISH REPORT (what to cover, section.key[position]: text):
${rows.map((r) => `${r.section}.${r.key}[${r.position}]: ${r.body}`).join("\n")}

NOTES
- Keep **double stars** around the 1 or 2 key phrases of each lead (they become bold).
- Keep the codes as they are: glance status, offer.verdict, broken.status, compare *_ok, library_id, seen_in, funnel letters.
- glance word and broken word: short 中文 status words (需要加强, 有几处要修, 还没开始, 未安装, 已在投放, 不错).
- Format names: use these 中文 names: ${Object.values(FORMATS_ZH).join(", ")} (same choice as the English: ${FORMATS.join(", ")}).
- Phase labels in plan.steps: 先修好, 马上开始, 测试 1 · Type B, 测试 2 · Type A, 如果有批发 · Type C (follow the English).`,
  });
  // Format names: keep the 中文 name the English pick maps to, so both reports match.
  const enNames = rows.filter((r) => r.section === "try" && r.key === "fmt.name").map((r) => r.body);
  w.try.formats = w.try.formats.map((f, i) => ({ ...f, name: FORMATS_ZH[enNames[i]] ?? f.name }));
  await saveWritten(c.auditId, w, d, "zh");
  const map = await localize(c.auditId, displayStrings(d));
  await q(`delete from texts where audit_id = $1 and lang = 'zh' and section = 'str'`, [c.auditId]);
  for (const [enText, zh] of map) {
    await q(`insert into texts (audit_id, lang, section, key, position, body) values ($1, 'zh', 'str', $2, 0, $3) on conflict do nothing`, [c.auditId, strKey(enText), zh.slice(0, 2000)]);
  }
}
