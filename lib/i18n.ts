// The app's language: English or 中文 (大马华语). One switch changes every screen and the report.
// Platform names (Facebook, Instagram, TikTok, WhatsApp, Google Maps ...) stay in English in both.
// Shared by the server and the browser, so nothing here may import server-only code.

export type Lang = "en" | "zh";
export const LANG_COOKIE = "ma_lang";
export const isLang = (x: unknown): x is Lang => x === "en" || x === "zh";
export const pick = (lang: Lang, en: string, zh: string) => (lang === "zh" ? zh : en);

// The run steps in 中文 (their English names live in lib/collect/steps.ts).
export const STEP_ZH: Record<string, string> = {
  website: "网站", facebook: "Facebook 专页", instagram: "Instagram", tiktok: "TikTok", maps: "Google Maps", apps: "App 连结",
  reels: "Facebook Reels", reel_dates: "Reels 日期和开头几秒",
  transparency: "专页透明度", ad_library: "Meta 广告库", ad_domain: "广告库里提到网站的广告", same_name: "同名专页", tracking: "网站追踪",
  own_ads: "他们正在跑的广告", ads_manager: "Ads Manager 截图 (AI 读)",
  search_words: "搜寻关键字 (AI)", competitor_search: "广告库搜寻", competitor_pick: "挑出真正的同行 (AI)", competitor_ads: "同行的广告",
  landings: "着陆页, 电脑和手机", fold_review: "首屏检查 (AI)", buying: "购买步骤和失效连结",
  hooks: "video 开头 3 秒 (AI)", write: "写报告 (AI)", write_zh: "写中文报告 (AI)", render: "做报告页面",
};

// The notes a step can end with, in 中文. Exact lines first, then the ones that start the same way.
const NOTE_ZH: Record<string, string> = {
  "No website given.": "没有填网站.",
  "Not run in the test copy.": "测试版不跑这一步.",
  "No app links on the website or Facebook page.": "网站和 Facebook 专页上没有 app 连结.",
  "No Ads Manager screenshots were added.": "没有放 Ads Manager 截图.",
  "TikTok asked to solve a puzzle, so this was not checked.": "TikTok 要求解拼图, 所以没有检查.",
  "TikTok asked to solve a puzzle, and no Apify key is set, so this was not checked.": "TikTok 要求解拼图, 也没有设 Apify key, 所以没有检查.",
  "Facebook asked to log in.": "Facebook 要求登入.",
  "Instagram asked to log in.": "Instagram 要求登入.",
  "Instagram showed a check for robots.": "Instagram 出现机器人检查.",
  "Google showed a check for robots.": "Google 出现机器人检查.",
  "Stopped when the app restarted. Press Retry.": "app 重开时停了. 请按重试.",
  "No live ads right now.": "目前没有正在跑的广告.",
  "The website did not load.": "网站打不开.",
  "No Reels to date.": "没有 Reels 可以看日期.",
  "No search words.": "没有搜寻关键字.",
  "The searches found no live ads.": "搜寻没有找到正在跑的广告.",
  "No competitors picked.": "没有挑到同行.",
  "No website, and no competitor ad leads to a website.": "没有网站, 同行的广告也没有带去网站.",
  "No landing pages were loaded.": "没有打开任何着陆页.",
  "No video frames to look at.": "没有 video 画面可以看.",
  "The report words were not written yet.": "报告文字还没写.",
  "The English report is not written yet.": "英文报告还没写.",
  "Only the English report was asked for. Switch the app to 中文 to write that one.": "这个检查只做了英文报告. 换去中文就可以写中文版.",
  "The page showed a check for robots.": "网页出现机器人检查.",
  "Couldn't find the Facebook page ID.": "找不到 Facebook 专页的 ID.",
  "Couldn't find the Facebook page ID, so the Ad Library search was not run.": "找不到 Facebook 专页的 ID, 所以没有搜寻广告库.",
  "The check is gone.": "这个检查已经不在了.",
};
const NOTE_START_ZH: [string, string][] = [
  ["Something went wrong: ", "出了问题: "],
  ["TikTok asked to solve a puzzle, and Apify could not read it either: ", "TikTok 要求解拼图, Apify 也读不到: "],
];
export function noteText(note: string | null, lang: Lang) {
  if (!note || lang === "en") return note;
  if (NOTE_ZH[note]) return NOTE_ZH[note];
  const hit = NOTE_START_ZH.find(([en]) => note.startsWith(en));
  return hit ? hit[1] + note.slice(hit[0].length) : note;
}

// The report's "check before you send" lines are saved in English; this shows them in 中文.
const FLAG_ZH: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^AI-slop word in: ([^]*)$/, (m) => `有 AI 腔的字: ${m[1]}`],
  [/^Mainland word "(.+?)" in: ([^]*)$/, (m) => `中国用词 "${m[1]}": ${m[2]}`],
  [/^Done-for-you wording in: ([^]*)$/, (m) => `写成我们帮他们做: ${m[1]}`],
  [/^Number (\S+) isn't in the collected data: ([^]*)$/, (m) => `数字 ${m[1]} 在收集到的资料里找不到: ${m[2]}`],
];
export function flagText(flag: string, lang: Lang) {
  if (lang === "en") return flag;
  for (const [re, f] of FLAG_ZH) { const m = flag.match(re); if (m) return f(m); }
  return flag;
}
