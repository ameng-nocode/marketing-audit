import { bareUnit, rm } from "../format";
import { leadsTo } from "../collect/adlib";
import type { ReportData, RAmRow } from "./data";

// "Is the ad money working?" Code works out every number here from their own answers (price, profit) and
// the Ads Manager rows. Nothing is guessed: no fixed share of the price, no assumed close rate.
// Break-even = profit per sale ÷ cost per result: how many chats or leads they can afford for one sale.

export type Unit = "chat" | "lead" | "purchase" | "click" | "other";
export type Funnel = "chat" | "lead" | "checkout";
type Two = [string, string]; // [English, 中文]

// one = "chat" / "每个聊天", many = "chats" / "个聊天".
export const UNIT_WORD: Record<Unit, { one: Two; many: Two }> = {
  chat: { one: ["chat", "每个聊天"], many: ["chats", "个聊天"] },
  lead: { one: ["lead", "每个 lead"], many: ["leads", "个 lead"] },
  purchase: { one: ["purchase", "一单购买"], many: ["purchases", "单购买"] },
  click: { one: ["click", "每次点击"], many: ["clicks", "次点击"] },
  other: { one: ["result", "每个成效"], many: ["results", "个成效"] },
};
const CUSTOMER: Unit[] = ["chat", "lead", "purchase"];

// What one result is: the AI's label, else the words in the Results column.
export function unitOf(r: Pick<RAmRow, "result_type" | "results" | "kind">): Unit {
  if (r.result_type && r.result_type in UNIT_WORD) return r.result_type as Unit;
  const t = (r.results ?? "").toLowerCase();
  if (/messag|conversation|对话|讯息|消息/.test(t)) return "chat";
  if (/lead|潜在客户|registration/.test(t)) return "lead";
  if (/purchase|购买|购物|checkout/.test(t)) return "purchase";
  if (/click|landing page view|点击/.test(t)) return "click";
  return "other";
}

export type MoneyRow = { campaign: string; unit: Unit; spent: number; count: number | null; cpr: number | null; read: string | null; kind: string };
export type Money = ReturnType<typeof moneyOf>;

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => Math.round(n * 100);

export function moneyOf(d: ReportData) {
  const b = d.biz;
  const price = b.price_low ? { lo: b.price_low, hi: b.price_high ?? b.price_low, unit: b.price_unit } : null;
  // Profit per sale in RM: their own number, or their margin applied to their own price.
  const profit = b.profit_rm ? { lo: b.profit_rm, hi: b.profit_rm }
    : b.profit_pct && price ? { lo: round((price.lo * b.profit_pct) / 100), hi: round((price.hi * b.profit_pct) / 100) } : null;

  const rows: MoneyRow[] = d.amRows.filter((r) => r.spent).map((r) => {
    const count = r.result_count && r.result_count > 0 ? r.result_count : null;
    return { campaign: r.campaign, unit: unitOf(r), spent: r.spent!, count, cpr: count ? round(r.spent! / count) : null, read: r.read, kind: r.kind };
  });
  const total = rows.reduce((s, r) => s + r.spent, 0);

  // Their main result: the customer result (chat, lead, purchase) with the most money behind it.
  const byUnit = new Map<Unit, number>();
  for (const r of rows) if (CUSTOMER.includes(r.unit) && r.count) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + r.spent);
  const unit = [...byUnit.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  const main = rows.filter((r) => r.unit === unit && r.count);
  const mainSpent = main.reduce((s, r) => s + r.spent, 0);
  const mainCount = main.reduce((s, r) => s + (r.count ?? 0), 0);
  const cpr = mainCount ? round(mainSpent / mainCount) : null;

  // Their sale funnel: from the main result, else from where their own ads lead.
  // Lead ads whose button opens a chat (Send message, WhatsApp) sell through the chat, not a form.
  const toChat = d.ads.some((a) => a.own && /^(Messenger|WhatsApp|Instagram)$/.test(leadsTo(a.landing_url, a.cta) ?? ""));
  const funnel: Funnel | null = unit === "purchase" ? "checkout"
    : unit === "chat" || (toChat && (unit === "lead" || !unit)) ? "chat" : unit === "lead" ? "lead" : null;

  // Break-even: chats or leads they can afford per sale (whole numbers, rounded down to stay safe).
  const breakEven = profit && cpr && unit !== "purchase" ? { lo: Math.floor(profit.lo / cpr), hi: Math.floor(profit.hi / cpr) } : null;
  // Purchases: what each sale costs in ads next to what it leaves.
  const perSale = profit && cpr && unit === "purchase" ? { cost: cpr, left: { lo: round(profit.lo - cpr), hi: round(profit.hi - cpr) } } : null;
  // ROAS: the real one when the screenshot shows it, and the one they need (price ÷ profit).
  const roasRows = d.amRows.filter((r) => r.roas && r.spent);
  const roas = roasRows.length ? round(roasRows.reduce((s, r) => s + r.roas! * r.spent!, 0) / roasRows.reduce((s, r) => s + r.spent!, 0)) : null;
  const roasNeed = price && profit ? { lo: round(Math.min(price.lo / profit.lo, price.hi / profit.hi)), hi: round(Math.max(price.lo / profit.lo, price.hi / profit.hi)) } : null;

  // Insight checks on the same rows.
  const wastedSpent = rows.filter((r) => r.read === "Costly" || r.read === "No result").reduce((s, r) => s + r.spent, 0);
  const wasted = total && wastedSpent ? { spent: round(wastedSpent), share: pct(wastedSpent / total) } : null;
  const priced = main.filter((r) => r.cpr).sort((x, y) => x.cpr! - y.cpr!);
  const spread = priced.length >= 2 && priced[priced.length - 1].cpr! >= 2 * priced[0].cpr!
    ? { cheap: priced[0], dear: priced[priced.length - 1], times: round(priced[priced.length - 1].cpr! / priced[0].cpr!) } : null;
  const offSpent = rows.filter((r) => !CUSTOMER.includes(r.unit)).reduce((s, r) => s + r.spent, 0);
  const offGoal = funnel && total && offSpent ? { spent: round(offSpent), share: pct(offSpent / total) } : null;

  return { price, profit, profitFrom: b.profit_rm ? "rm" : b.profit_pct ? "pct" : null, margin: b.profit_pct, rows, total: round(total), unit, mainCount, mainSpent: round(mainSpent), cpr, funnel, breakEven, perSale, roas, roasNeed, wasted, spread, offGoal };
}

// The steps of their funnel, each with the number from the screenshots or "ask the owner".
export function funnelSteps(m: Money, zh: boolean): { label: string; value: string | null }[] {
  const t = (x: Two) => (zh ? x[1] : x[0]);
  // The cost per result goes on the step where that result happens (the first step, or Purchase).
  const cost = m.cpr && m.unit ? (zh ? `${UNIT_WORD[m.unit].one[1]} ${rm(m.cpr)}` : `${rm(m.cpr)} per ${UNIT_WORD[m.unit].one[0]}`) : null;
  const per = (u: Unit | "first") => (u === "first" ? (m.unit !== "purchase" ? cost : null) : m.unit === u ? cost : null);
  const steps: Record<Funnel, [Two, string | null][]> = {
    chat: [[["Chat started", "开始聊天"], per("first")], [["Replied", "有回复"], null], [["Got a quote", "拿到报价"], null], [["Paid", "付款"], null]],
    lead: [[["Form filled", "填表格"], per("first")], [["Answered the call", "接到电话"], null], [["Meeting", "见面"], null], [["Sale", "成交"], null]],
    checkout: [[["Click", "点击"], null], [["Page view", "看页面"], null], [["Add to cart", "加入购物车"], null], [["Purchase", "购买"], per("purchase")]],
  };
  return m.funnel ? steps[m.funnel].map(([l, v]) => ({ label: t(l), value: v })) : [];
}

// The sentence the owner reads: break-even from their own numbers. Null when a number is missing.
export function breakEvenLine(m: Money, zh: boolean): string | null {
  if (!m.cpr || !m.unit || !m.profit) return null;
  const w = UNIT_WORD[m.unit];
  const left = m.profit.lo === m.profit.hi ? rm(m.profit.lo) : `${rm(m.profit.lo)} ${zh ? "到" : "to"} ${rm(m.profit.hi)}`;
  if (m.perSale) {
    const after = m.perSale.left.lo === m.perSale.left.hi ? rm(m.perSale.left.lo) : `${rm(m.perSale.left.lo)} ${zh ? "到" : "to"} ${rm(m.perSale.left.hi)}`;
    if (m.perSale.left.hi <= 0) return zh ? `卖一单要花 ${rm(m.cpr)} 广告费, 一单只赚 ${left}. 卖越多亏越多.` : `Each purchase costs ${rm(m.cpr)} in ads and leaves ${left}. Every sale loses money.`;
    return zh ? `卖一单要花 ${rm(m.cpr)} 广告费, 一单赚 ${left}. 扣掉广告还剩 ${after}.` : `Each purchase costs ${rm(m.cpr)} in ads and leaves ${left}. After ads, ${after} is left.`;
  }
  const be = m.breakEven!;
  if (be.hi < 1) return zh ? `${w.one[1]}要 ${rm(m.cpr)}, 比一单的利润 ${left} 还多. 就算每个都成交, 广告也是亏.` : `Each ${w.one[0]} costs ${rm(m.cpr)}, more than one sale leaves (${left}). The ads lose money even if every ${w.one[0]} buys.`;
  const n = be.lo === be.hi ? `${be.lo}` : `${be.lo} ${zh ? "到" : "to"} ${be.hi}`;
  return zh
    ? `${w.one[1]}要 ${rm(m.cpr)}, 一单赚 ${left}. 只要 ${n} ${w.many[1]}里有 1 个成交, 广告就回本.`
    : `Each ${w.one[0]} costs ${rm(m.cpr)}. Each sale leaves ${left}. The ads pay for themselves as long as 1 in ${n} ${w.many[0]} buys.`;
}

// The questions for the call: the steps we can't see, and any answer that was "not sure".
export function ownerQuestions(m: Money, zh: boolean): string[] {
  const out: string[] = [];
  const n = m.mainCount ? `${m.mainCount}` : "";
  const many = m.unit ? UNIT_WORD[m.unit].many : UNIT_WORD.chat.many;
  if (m.funnel === "chat") out.push(zh ? `截图里的 ${n} ${many[1]}, 有几个回复, 几个拿到报价, 几个付了钱?` : `Out of the ${n} ${many[0]} in these screenshots, how many replied, how many got a quote, and how many paid?`);
  if (m.funnel === "lead") out.push(zh ? `截图里的 ${n} 个 lead, 有几个接电话, 几个见面, 几个买了?` : `Out of the ${n} leads in these screenshots, how many answered the call, how many met you, and how many bought?`);
  if (m.funnel === "checkout") out.push(zh ? "Ads Manager 的购买数字, 跟网店后台的订单对得上吗?" : "Do the purchases in Ads Manager match the orders in the shop's own system?");
  if (!m.price) out.push(zh ? "平时一单卖多少钱?" : "What does one sale usually cost the customer?");
  if (!m.profit) out.push(zh ? "扣掉产品或服务的成本, 一单赚多少?" : "After the cost of the product or service, what do you keep from one sale?");
  return out.map((q) => q.replace(/ {2,}/g, " "));
}

// The numbers in plain lines, for the AI writer's brief (it may only quote these).
export function moneyBrief(m: Money) {
  if (!m.rows.length) return "- no Ads Manager numbers";
  const L: string[] = [];
  L.push(`- price: ${m.price ? `${rm(m.price.lo)}${m.price.hi !== m.price.lo ? ` to ${rm(m.price.hi)}` : ""}${bareUnit(m.price.unit) ? ` per ${bareUnit(m.price.unit)}` : ""}` : "not given"}`);
  L.push(`- profit per sale: ${m.profit ? `${rm(m.profit.lo)}${m.profit.hi !== m.profit.lo ? ` to ${rm(m.profit.hi)}` : ""}${m.margin ? ` (${m.margin}% margin)` : ""}` : "not given"}`);
  L.push(`- money in the visible rows: ${rm(m.total)}`);
  L.push(`- main result: ${m.unit ?? "none that leads to a sale"}${m.unit ? `, ${m.mainCount} ${UNIT_WORD[m.unit].many[0]} for ${rm(m.mainSpent)}, ${m.cpr ? rm(m.cpr) : "?"} each` : ""}`);
  L.push(`- their funnel: ${m.funnel ?? "unknown"}`);
  if (m.breakEven) L.push(`- break-even: they can afford ${m.breakEven.lo === m.breakEven.hi ? m.breakEven.lo : `${m.breakEven.lo} to ${m.breakEven.hi}`} ${m.unit ? UNIT_WORD[m.unit].many[0] : "results"} per sale`);
  if (m.perSale) L.push(`- per purchase: ads ${rm(m.perSale.cost)}, left after ads ${rm(m.perSale.left.lo)}${m.perSale.left.hi !== m.perSale.left.lo ? ` to ${rm(m.perSale.left.hi)}` : ""}`);
  if (m.roas) L.push(`- ROAS shown: ${m.roas}x`);
  if (m.roasNeed) L.push(`- ROAS needed to break even (price ÷ profit): ${m.roasNeed.lo === m.roasNeed.hi ? m.roasNeed.lo : `${m.roasNeed.lo} to ${m.roasNeed.hi}`}x`);
  if (m.wasted) L.push(`- money in rows read Costly or No result: ${rm(m.wasted.spent)}, ${m.wasted.share}% of the money`);
  if (m.spread) L.push(`- cheapest vs dearest: "${m.spread.cheap.campaign}" ${rm(m.spread.cheap.cpr!)} each, "${m.spread.dear.campaign}" ${rm(m.spread.dear.cpr!)} each, ${m.spread.times} times more`);
  if (m.offGoal) L.push(`- money on results that are not chats, leads or purchases (likes, views, clicks): ${rm(m.offGoal.spent)}, ${m.offGoal.share}% of the money`);
  L.push("- rows:");
  for (const r of m.rows) L.push(`  - ${r.campaign} | ${r.unit} | spent ${rm(r.spent)} | ${r.count ?? "?"} results | ${r.cpr ? `${rm(r.cpr)} each` : "cost each unknown"} | read: ${r.read ?? "?"}`);
  return L.join("\n");
}
