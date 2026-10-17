// Fixed answers for the test copy (AI_FAKE=1), so tests never call Claude.

const ITEMS = ["Headline says what they sell", "Headline is short", "Offer or price on the first screen", "Button on the first screen", "Reviews or proof on the first screen", "WhatsApp or chat", "Clear on a phone"];

export function fakeAnswer(task: string, prompt: string): unknown {
  switch (task) {
    case "ads-manager":
      // 2 chat campaigns (RM10 and RM45 a chat) and one for likes: total 12 chats for RM190, RM15.83 a chat.
      return {
        rows: [
          { screenshot: 1, campaign: "TEST campaign", kind: "sales", delivery: "Active", spent: 100, spent_text: "RM100.00", results: "10 Messaging conversations", result_count: 10, result_type: "chat", cost_per_result: "RM10.00", roas: null, read: "Middle" },
          { screenshot: 1, campaign: "TEST campaign B", kind: "sales", delivery: "Active", spent: 90, spent_text: "RM90.00", results: "2 Messaging conversations", result_count: 2, result_type: "chat", cost_per_result: "RM45.00", roas: null, read: "Costly" },
          { screenshot: 2, campaign: "TEST likes", kind: "engagement", delivery: "Off", spent: 50, spent_text: "RM50.00", results: "300 Post engagements", result_count: 300, result_type: "other", cost_per_result: "RM0.17", roas: null, read: "Not for customers" },
        ],
        currency: "RM", date_range: null, note: null,
      };
    case "search-words":
      return { words: [{ word: "test goods", lang: "English", why: "Test copy." }] };
    case "competitor-pick":
      return { picks: [], none_reason: "Test copy: no search." };
    case "fold-review": {
      const n = (prompt.match(/^Page \d+:/gm) || []).length;
      return { pages: Array.from({ length: n }, (_, i) => ({ page: i + 1, checks: ITEMS.map((item, j) => ({ item, result: j === 4 ? "none" : "ok", note: "TEST note." })) })) };
    }
    case "hooks":
      return { videos: [] };
    case "write-report":
      return {
        company_line: "TEST goods, Klang Valley",
        verdict: "TEST Shop has a **working shop** and tracking, but **no reviews on the first screen**.",
        glance: Object.fromEntries(["channels", "content", "ads", "competitors", "cta", "creative"].map((k) => [k, { status: k === "cta" ? "weak" : "info", word: k === "cta" ? "Gaps" : "TEST", finding: `TEST finding for ${k}.` }])),
        channels: { lead: "TEST channels lead with **bold**.", points: ["**TEST point** one."] },
        content: { lead: "TEST content lead.", points: [] },
        ads: { lead: "TEST ads lead.", points: [] },
        money: { verdict: "TEST the chats pay for themselves if **1 in 126** buys.", insights: ["**TEST move money** from TEST campaign B (RM45 a chat) to TEST campaign (RM10 a chat)."] },
        competitors: { lead: "TEST competitors lead." },
        funnels: [],
        ad_labels: [],
        cta: { lead: "TEST call to action lead.", buy_steps: [{ title: "Add to cart", detail: "On the TEST shop" }], other_ways: "TEST other ways.", broken: [{ item: "Reviews on the first screen", word: "Missing", status: "none" }], compare_with: null, compare: [] },
        landing: { lead: "TEST landing lead." },
        creative: { lead: "TEST creative lead.", hooks_lead: null, decisions: { who: "TEST who.", point: "TEST point.", first3: "TEST first 3 seconds.", action: "TEST action." } },
        // The semicolon and the dash are on purpose: the page must swap them out.
        try: {
          lead: "TEST try lead; test one offer — then one format.",
          offer: { now: "TEST free delivery over RM100", verdict: "weak", why: "TEST why.", try: "TEST one starter set at one clear price" },
          messages: [{ now: "TEST 2x protein", from: "Ad", better: "TEST eat well and still lose weight" }, { now: "TEST 0 sugar", from: "Website headline", better: "TEST sweet taste, no guilt" }],
          mechanism: { line: "TEST oven-baked, then frozen fast.", from: "their website" },
          formats: ["A real customer talking (UGC)", "Before and after story", "Problem, fix, offer", "Product demo"].map((name) => ({ name, why: "TEST why.", first3: "TEST first 3 seconds.", end: "TEST WhatsApp us.", seen_in: null })),
          order: ["A real customer talking (UGC)", "Before and after story", "Problem, fix, offer"].map((name) => ({ name, why: "TEST reason." })),
        },
        plan: { lead: "TEST plan lead.", steps: [{ phase: "Fix first", title: "TEST fix", body: "TEST body.", first: true }, { phase: "Start now", title: "Set up a weekly creative routine", body: "TEST body.", first: false }, { phase: "Test 1", title: "TEST test", body: "TEST body.", first: false }] },
        questions: ["TEST question 1?", "TEST question 2?", "TEST question 3?", "TEST question 4?", "TEST question 5?"],
        not_checked: ["TEST not checked"],
      };
    case "write-report-zh": {
      // The English test answer with 中文 words (and full-width punctuation, which the page must turn half-width).
      const en = fakeAnswer("write-report", prompt) as Record<string, unknown>;
      return {
        ...en,
        company_line: "TEST 货品, 巴生谷",
        verdict: "TEST Shop 有**能用的网店**和追踪，可是**首屏没有评价**。",
        channels: { lead: "TEST 渠道重点，**很清楚**。", points: ["**TEST 备注** 一。"] },
        content: { lead: "TEST 内容重点。", points: [] },
        ads: { lead: "TEST 广告重点。", points: [] },
        money: { verdict: "TEST 每 126 个聊天成交 1 个就**回本**。", insights: ["**TEST 把钱移过去**，TEST campaign 每个聊天 RM10。"] },
        competitors: { lead: "TEST 同行重点。" },
        cta: { lead: "TEST 下单方式重点。", buy_steps: [{ title: "加进购物车", detail: "在 TEST 网店" }], other_ways: "TEST 其他方式。", broken: [{ item: "首屏的评价", word: "没有", status: "none" }], compare_with: null, compare: [] },
        landing: { lead: "TEST 着陆页重点。" },
        creative: { lead: "TEST 素材重点。", hooks_lead: null, decisions: { who: "TEST 拍给谁。", point: "TEST 卖点。", first3: "TEST 开头。", action: "TEST 行动。" } },
        try: {
          lead: "TEST 试试看重点；先测一个优惠。",
          offer: { now: "TEST 满 RM100 免运费", verdict: "weak", why: "TEST 原因。", try: "TEST 一个入门套餐" },
          messages: [{ now: "TEST 2x protein", from: "广告", better: "TEST 吃得好也能瘦" }],
          mechanism: null,
          formats: ["A", "B", "C"].map((x) => ({ name: x, why: "TEST 原因。", first3: "TEST 开头。", end: "TEST WhatsApp 我们。", seen_in: null })),
          order: ["A", "B", "C"].map((x) => ({ name: x, why: "TEST 原因。" })),
        },
        plan: { lead: "TEST 建议重点。", steps: [{ phase: "先修好", title: "TEST 修", body: "TEST 内容。", first: true }, { phase: "马上开始", title: "每周素材流程", body: "TEST 内容。", first: false }, { phase: "测试 1", title: "TEST 测试", body: "TEST 内容。", first: false }] },
        questions: ["TEST 问题 1?", "TEST 问题 2?", "TEST 问题 3?", "TEST 问题 4?", "TEST 问题 5?"],
        not_checked: ["TEST 未检查"],
      };
    }
    case "localize-zh": {
      const n = (prompt.match(/^\d+\. /gm) || []).length;
      return { items: Array.from({ length: n }, (_, i) => ({ n: i + 1, zh: `TEST 中文 ${i + 1}` })) };
    }
    default:
      throw new Error(`No test answer for ${task}`);
  }
}
