// End-to-end test of the G question flow on a throwaway copy of the app: own database, own uploads folder, port 3131.
// Nothing here touches the real data in .data/pg. Every record it makes is named "TEST ...".
//   npm run test:flow
// Screenshots for the visual check land in .data/shots/ (390, 1440, 1920 and 2788 wide).
// Check runs: only the website steps run (COLLECT_ONLY), against a fake shop on port 3132. Facebook and Google are never touched.
// The AI steps give fixed test answers (AI_FAKE), so the report is built without calling Claude.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.join(import.meta.dirname, "..");
const PORT = 3131;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(ROOT, ".data", "test-pg");
const UP = path.join(ROOT, ".data", "test-uploads");
const FIX = path.join(ROOT, ".data", "test-fixtures");
const SHOTS = path.join(ROOT, ".data", "shots");
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

let pass = 0, failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `: ${detail}` : ""}`); }
};
// Waits briefly for something to appear (questions and pop-ups animate in).
const seen = (loc, timeout = 8000) => loc.waitFor({ state: "visible", timeout }).then(() => true, () => false);
// Uploaded files only (run screenshots live in a "shots" folder next to them).
const filesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).length : 0);

rm(DB); rm(UP); rm(SHOTS);
fs.mkdirSync(FIX, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

// A fake shop: Meta pixel, Google tag, WhatsApp button and an Instagram link, all on this PC.
const SHOP = "http://127.0.0.1:3132";
const shopHtml = `<!doctype html><html><head><title>TEST Shop</title>
<script>window.fbq=function(){};window.gtag=function(){};</script></head>
<body style="font:20px sans-serif;padding:40px"><h1>TEST Shop</h1><p>Fresh test goods. Add to cart.</p>
<a href="https://wa.me/60000000000">WhatsApp us</a> <a href="https://www.instagram.com/test.shop.example/">Instagram</a>
<a href="/shop/contact">Contact us</a> <a href="/old-news">Old news</a></body></html>`;
const shop = http.createServer((req, res) => {
  if (req.url.startsWith("/shop/contact")) return res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Contact</title><p>TEST delivery: free over RM100.</p>");
  if (req.url.startsWith("/shop")) return res.writeHead(200, { "content-type": "text/html" }).end(shopHtml);
  res.writeHead(404).end("not found");
}).listen(3132, "127.0.0.1");

console.log("Starting test server on", BASE);
const server = spawn(`npx next dev -p ${PORT} -H 127.0.0.1`, {
  cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PGLITE_DIR: ".data/test-pg", UPLOADS_DIR: ".data/test-uploads", NEXT_DIST_DIR: ".next-test", COLLECT_ONLY: "website,tracking,ads_manager,landings,fold_review,buying,write,write_zh,render", AI_FAKE: "1" },
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const stop = () => { try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" }); } catch {} shop.close(); };

// Wait for the server's own "Ready" line (no polling).
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`server did not start:\n${log}`)), 120000);
  server.stdout.on("data", () => { if (/Ready/.test(log)) { clearTimeout(t); resolve(); } });
  server.on("exit", () => { clearTimeout(t); reject(new Error(`server exited:\n${log}`)); });
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errs = [];
const watch = (p, tag) => {
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|_next\/hmr|webpack-hmr/.test(m.text())) errs.push(`${tag} ${p.url()}: ${m.text().slice(0, 200)}`); });
  p.on("pageerror", (e) => errs.push(`${tag} ${p.url()}: ${e.message.slice(0, 200)}`));
  // Leaving a half-filled flow by goto triggers the browser's own "leave site?" check; accept it in tests.
  p.on("dialog", (d) => d.accept());
};
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true, caret: "initial", animations: "disabled" });
const heading = (p, text) => p.getByRole("heading", { name: text });
const radio = (p, name) => p.getByRole("radio", { name, exact: true });
// The English | 中文 switch in the top bar (its own name changes with the language, so it is found by its place).
const switchTo = (p, name) => p.locator(".g-top .g-seg").getByRole("button", { name, exact: true }).click();

// Answers the 7 questions in a row. a = { fb, name, website?, about?, ads, pics? } (price and profit: Not sure)
async function answer(p, a) {
  await seen(heading(p, "Which business are we checking?"));
  await p.fill("#q-facebook", a.fb); await p.keyboard.press("Enter");
  await seen(heading(p, "What's the company called?"));
  await p.fill("#q-name", a.name); await p.keyboard.press("Enter");
  await seen(heading(p, "Do they have a website?"));
  if (a.website) { await p.fill("#q-website", a.website); await p.keyboard.press("Enter"); }
  else await p.getByRole("button", { name: "No website" }).click();
  await seen(heading(p, "What do they sell, and where?"));
  if (a.about) { await p.fill("#q-description", a.about); await p.keyboard.press("Enter"); }
  else await p.getByRole("button", { name: "Skip" }).click();
  await seen(heading(p, "What do they charge?"));
  await p.getByRole("button", { name: "Not sure", exact: true }).click();
  await seen(heading(p, "What do they keep from one sale?"));
  await p.getByRole("button", { name: "Not sure", exact: true }).click();
  await seen(heading(p, "Are they running ads right now?"));
  await radio(p, a.ads).click();
  if (a.ads === "Yes") {
    if (a.pics) await p.locator('input[type="file"]').setInputFiles(a.pics);
    await p.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await seen(p.getByRole("heading", { name: /^Ready to check/ }));
}

try {
  // Two test pictures, made here so the test carries no real client files.
  const fx = await browser.newPage({ viewport: { width: 900, height: 600 } });
  for (const n of [1, 2]) {
    await fx.setContent(`<body style="margin:0;font:600 40px sans-serif;display:grid;place-items:center;height:100vh;background:#e8ebf0">TEST screenshot ${n}</body>`);
    await fx.screenshot({ path: path.join(FIX, `test-ads-${n}.png`) });
  }
  await fx.close();
  const pics = [1, 2].map((n) => path.join(FIX, `test-ads-${n}.png`));

  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(p, "1440");

  console.log("\nAll checks, empty");
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  check("empty list shows 'No checks yet'", await p.getByText("No checks yet").isVisible());
  await shot(p, "1440-list-empty");

  console.log("\nQuestion 1: Facebook page");
  await p.getByRole("link", { name: "New check" }).first().click();
  await p.waitForURL(BASE + "/new");
  check("question 1 shows", await seen(heading(p, "Which business are we checking?")));
  check("inputs start empty (no example text)", (await p.locator("input[placeholder], textarea[placeholder]").count()) === 0);
  check("the box has focus", (await p.evaluate(() => document.activeElement?.id)) === "q-facebook");
  await p.keyboard.press("Enter");
  check("needs a Facebook page", await seen(p.getByText("Add the Facebook page link.")));
  await p.fill("#q-facebook", "instagram.com/test");
  await p.keyboard.press("Enter");
  check("refuses a non-Facebook link", await seen(p.getByText("This isn't a Facebook page link.", { exact: false })));
  await p.fill("#q-facebook", "facebook.com/test.company.page/");
  check("valid link shows 'Looks right'", await seen(p.getByText("Looks right")));
  check("chip shows the cleaned link", await p.locator(".g-chip").getByText("facebook.com/test.company.page").isVisible());
  await shot(p, "1440-q1");
  await p.keyboard.press("Enter");

  console.log("\nQuestions 2 to 4");
  check("question 2 shows", await seen(heading(p, "What's the company called?")));
  await p.keyboard.press("Enter");
  check("needs a company name", await seen(p.getByText("Add the company name.")));
  await p.fill("#q-name", "TEST Company Sdn Bhd");
  await p.keyboard.press("Enter");
  check("question 3 shows", await seen(heading(p, "Do they have a website?")));
  await p.fill("#q-website", "testcompany.example");
  await p.getByRole("button", { name: "Continue" }).click();
  check("question 4 shows", await seen(heading(p, "What do they sell, and where?")));
  await p.fill("#q-description", "TEST description: kitchen cabinets, Klang Valley.");
  await p.keyboard.press("Enter");

  console.log("\nQuestions 5 and 6: price and profit");
  check("question 5 (price) shows, first box has focus", await seen(heading(p, "What do they charge?")) && (await p.evaluate(() => document.activeElement?.id)) === "q-price-low");
  await p.fill("#q-price-low", "abc");
  await p.keyboard.press("Enter");
  check("price must be a number", await seen(p.getByText("Write the lowest price as a number", { exact: false })));
  await p.fill("#q-price-low", "16,000");
  await p.fill("#q-price-high", "12000");
  await p.keyboard.press("Enter");
  check("highest can't be below lowest", await seen(p.getByText("The highest price is lower than the lowest one.")));
  await p.fill("#q-price-low", "12,000");
  await p.fill("#q-price-high", "16k");
  await p.fill("#q-price-unit", "per person");
  await shot(p, "1440-q-price");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  check("question 6 (profit) shows", await seen(heading(p, "What do they keep from one sale?")));
  await p.getByRole("button", { name: "Margin %" }).click();
  await p.fill("#q-profit", "150");
  await p.keyboard.press("Enter");
  check("margin must be 1 to 100", await seen(p.getByText("Write the margin as a number from 1 to 100.")));
  await p.fill("#q-profit", "12.5");
  await shot(p, "1440-q-profit");
  await p.keyboard.press("Enter");

  console.log("\nQuestion 7: running ads, 2 screenshots");
  check("question 7 shows", await seen(heading(p, "Are they running ads right now?")));
  check("screenshot box hidden before Yes", !(await p.getByText("Add their Ads Manager screenshots").isVisible()));
  await radio(p, "Yes").click();
  check("screenshot box shows after Yes", await seen(p.getByText("Add their Ads Manager screenshots")));
  await p.locator('input[type="file"]').setInputFiles(pics);
  check("2 thumbnails with remove buttons", (await p.getByRole("button", { name: /Remove test-ads/ }).count()) === 2);
  check("count shows 2 of 20", await p.getByText("2 of 20", { exact: false }).isVisible());
  await shot(p, "1440-q5-yes");
  await p.getByRole("button", { name: "Continue", exact: true }).click();

  console.log("\nAnswers screen");
  check("answers screen shows", await seen(heading(p, "Ready to check TEST Company Sdn Bhd.")));
  const sum = p.locator(".g-sum");
  check("shows the cleaned Facebook link", await sum.getByText("facebook.com/test.company.page").isVisible());
  check("shows the website", await sum.getByText("testcompany.example").isVisible());
  check("shows Yes, 2 screenshots", await sum.getByText("Yes, 2 screenshots").isVisible());
  check("shows the price range, cleaned up", await sum.getByText("RM12,000 to RM16,000 per person").isVisible());
  check("shows the margin", await sum.getByText("12.5% margin").isVisible());
  await shot(p, "1440-summary");
  await p.getByRole("button", { name: "Change Company" }).click();
  check("Change opens that question, filled in", await seen(heading(p, "What's the company called?")) && (await p.inputValue("#q-name")) === "TEST Company Sdn Bhd");
  await p.keyboard.press("Enter");
  check("Enter goes straight back to the answers", await seen(heading(p, "Ready to check TEST Company Sdn Bhd.")));
  await p.getByRole("button", { name: "Start check" }).click();
  await p.waitForURL(/\/checks\/\d+/);
  const id = p.url().match(/checks\/(\d+)/)[1];
  check("toast says Check started", await seen(p.getByText("Check started")));
  check("the run finishes with a report", await seen(p.getByText("Report ready").first(), 120000));
  check("finished steps fold into one line", await seen(p.getByRole("button", { name: "Show all 26 steps" })));
  await p.getByRole("button", { name: "Show all 26 steps" }).click();
  check("the run shows 26 steps", (await p.locator(".g-step").count()) === 26);
  check("Facebook steps skipped in the test copy", await seen(p.locator(".g-step").filter({ hasText: "Facebook page" }).getByText("Skipped")));
  await p.getByRole("button", { name: "Hide steps" }).click();
  check("its tracking step says Not checked, with Retry", await seen(p.locator(".g-step").filter({ hasText: "Website tracking" }).getByRole("button", { name: "Retry" })));
  await p.locator(".g-step").filter({ hasText: "Website tracking" }).getByRole("button", { name: "Retry" }).click();
  check("Retry runs the step again", await seen(p.locator(".g-step").filter({ hasText: "Website tracking" }).getByText("Not checked"), 60000));
  check("the retried run finishes", await seen(p.getByRole("heading", { name: "The checks" }), 60000));
  check("Download PDF is the main button", await seen(p.getByRole("link", { name: "Download PDF" }), 60000));
  const frame = p.frameLocator('iframe[title="Report"]');
  check("the report shows inside the check page", await seen(frame.getByRole("heading", { name: "TEST Company Sdn Bhd", level: 1 }), 20000));
  check("report in the page: a site that doesn't load shows as Dead", await seen(frame.locator(".chan-row").filter({ hasText: "Website" }).getByText("The site did not load.")));
  check("report in the page grows to full height (no inner scroll)", await p.waitForFunction(() => {
    const f = document.querySelector('iframe[title="Report"]');
    const h = f?.contentDocument?.documentElement.scrollHeight ?? 0;
    return h > 2000 && Math.abs(f.getBoundingClientRect().height - h) < 3;
  }, null, { timeout: 20000 }).then(() => true, () => false));
  check("report has the What to try section", await seen(frame.locator("#try h2", { hasText: "What to try" })));
  const tryText = await frame.locator("#try").innerText();
  check("What to try: no semicolons or dashes on the page", !/[;—–]/.test(tryText), tryText.match(/.{0,30}[;—–].{0,30}/)?.[0]);
  check("What to try: 4 formats and a 3-week test order", (await frame.locator("#try .twin .box").filter({ hasText: "First 3 seconds" }).count()) === 4 && (await frame.locator("#try .stepper li").count()) === 3);
  check("Next steps moved to section 08", await frame.locator("#plan .num").innerText() === "08");
  await frame.locator("a.zoom").first().click();
  check("a report photo opens in the app's viewer", await seen(p.getByRole("dialog", { name: "Screenshot viewer" })));
  await p.keyboard.press("Escape");
  check("Esc closes it", !(await p.getByRole("dialog", { name: "Screenshot viewer" }).isVisible()));
  const rep = await p.request.get(`${BASE}/checks/${id}/report`);
  const repHtml = await rep.text();
  check("report page is served", rep.ok() && /<title>TEST Company Sdn Bhd Marketing Check<\/title>/.test(repHtml));
  check("report keeps the locked look (style, icons, viewer)", repHtml.includes("--bad: #B42318") && repHtml.includes('id="i-warn"') && repHtml.includes('id="lb"'));
  console.log("\nIs the ad money working?");
  check("money: cost per chat worked out from the rows (RM190 for 12 chats)", repHtml.includes("RM15.83") && repHtml.includes("per chat, worked out from the screenshots"));
  check("money: break-even from their own margin and price (1 in 94 to 126)", repHtml.includes("The ads pay for themselves as long as 1 in 94 to 126 chats buys."));
  check("money: their chat funnel, first step known, the rest ask the owner", repHtml.includes("<b>Chat started</b><span>RM15.83 per chat</span>") && repHtml.includes("<b>Paid</b><span>Ask the owner</span>"));
  check("money: the question for the call uses the 12 chats", repHtml.includes("Out of the 12 chats in these screenshots"));
  check("money: the AI's insight line shows", repHtml.includes("TEST move money"));
  check("money: the screenshot table and spend bars are gone", !repHtml.includes("<th>Cost per result</th>") && !repHtml.includes('class="hbars"'));
  check("report has no em or en dash", !/[—–]/.test(repHtml.replace(/<style>[\s\S]*?<\/style>/, "")));
  const rp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(rp, "report");
  await rp.goto(`${BASE}/checks/${id}/report`, { waitUntil: "networkidle" });
  const look = await rp.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily }));
  check("report colours and fonts load", look.bg === "rgb(243, 244, 246)" && /Geist/.test(look.font), JSON.stringify(look));
  check("report viewer stays closed until a photo is clicked", !(await rp.locator("#lb").isVisible()));
  await rp.locator("a.zoom").first().click();
  check("report photo opens in the viewer", await seen(rp.locator("#lb")));
  await rp.keyboard.press("Escape");
  check("Esc closes the report viewer", !(await rp.locator("#lb").isVisible()));
  await rp.close();
  const pdf = await p.request.get(`${BASE}/checks/${id}/report/pdf`);
  const pdfBody = await pdf.body();
  check("Download PDF gives a PDF file", pdf.ok() && pdf.headers()["content-type"] === "application/pdf" && pdfBody.subarray(0, 5).toString() === "%PDF-" && /attachment; filename="test-company-sdn-bhd-marketing-check\.pdf"/.test(pdf.headers()["content-disposition"] ?? ""));
  fs.writeFileSync(path.join(SHOTS, "report.pdf"), pdfBody);
  await p.getByRole("button", { name: "Run again" }).click();
  check("Run again asks first", await seen(p.getByText("Run the check again?")));
  check("Run again pop-up: Cancel has focus", (await p.evaluate(() => document.activeElement?.textContent)) === "Cancel");
  await p.getByRole("button", { name: "Cancel" }).click();
  check("Cancel keeps the report", await seen(p.getByRole("link", { name: "Download PDF" })));

  console.log("\n中文: the whole app switches");
  check("one switch in the top bar, English | 中文, no Report label", (await p.locator(".g-top .g-seg").innerText()).replace(/\s+/g, " ").trim() === "English 中文" && (await p.getByText("Report in").count()) === 0);
  await switchTo(p, "中文");
  check("中文: the check page buttons switch (下载 PDF, 编辑, 删除)", await seen(p.getByRole("link", { name: "下载 PDF" })) && await p.getByRole("link", { name: "编辑" }).isVisible() && await p.getByRole("button", { name: "删除", exact: true }).isVisible());
  check("中文: the run panel switches (检查项目, 渠道 step names)", await seen(p.getByRole("heading", { name: "检查项目" })) && (await p.getByRole("button", { name: /显示全部 \d+ 个步骤/ }).isVisible()));
  check("中文: platform names stay English (Facebook 专页)", await p.getByText("Facebook 专页", { exact: true }).first().isVisible());
  check("中文 not written yet: the English report shows, with a button to write it", await seen(p.getByRole("button", { name: "写中文报告" })) && await seen(p.frameLocator('iframe[title="报告"]').getByRole("heading", { name: "At a glance" })));
  await p.getByRole("button", { name: "写中文报告" }).click();
  check("the 中文 report gets written", await seen(p.frameLocator('iframe[title="报告"]').getByRole("heading", { name: "重点总结" }), 60000));
  const zf = p.frameLocator('iframe[title="报告"]');
  check("中文 labels from the approved report (渠道, 我们的建议)", await seen(zf.locator("#channels h2", { hasText: "渠道" })) && await zf.locator("#plan h2", { hasText: "我们的建议" }).isVisible());
  const zhText = await zf.locator("main").innerText();
  check("中文: half-width , and . only, no ； or ， or ——", !/[；，。——]/.test(zhText), zhText.match(/.{0,20}[；，。——].{0,20}/)?.[0]);
  check("中文: the code's own notes come through in 中文", /TEST 中文 \d+/.test(zhText));
  const zpdf = await p.request.get(`${BASE}/checks/${id}/report/pdf?lang=zh`);
  check("中文 PDF downloads with a 营销现况报告 name", zpdf.ok() && (await zpdf.body()).subarray(0, 5).toString() === "%PDF-" && /filename\*=UTF-8''test-company-sdn-bhd-%E8%90%A5/.test(zpdf.headers()["content-disposition"] ?? ""));
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  check("中文 stays on: the list is in 中文 too", await seen(p.getByRole("heading", { name: "所有检查" })) && await p.getByRole("link", { name: "新检查" }).isVisible());
  await p.goto(BASE + "/new", { waitUntil: "networkidle" });
  check("中文: the questions are in 中文", await seen(heading(p, "要检查哪一家?")));
  await p.goto(`${BASE}/checks/${id}`, { waitUntil: "networkidle" });
  await switchTo(p, "English");
  check("English is one click back", await seen(p.frameLocator('iframe[title="Report"]').getByRole("heading", { name: "At a glance" }), 20000) && await p.getByRole("link", { name: "Download PDF" }).isVisible());
  check("check page shows the company", await p.getByRole("heading", { name: "TEST Company Sdn Bhd" }).isVisible());
  check("Facebook link cleaned up", await p.getByRole("link", { name: "facebook.com/test.company.page" }).isVisible());
  check("website got https", (await p.getByRole("link", { name: "testcompany.example" }).getAttribute("href")) === "https://testcompany.example");
  check("2 files on disk", filesIn(path.join(UP, id)) === 2, `found ${filesIn(path.join(UP, id))}`);
  const img = await p.request.get(`${BASE}${await p.locator('img[src^="/files/"]').first().getAttribute("src")}`);
  check("screenshot is served as an image", img.ok() && img.headers()["content-type"] === "image/png");
  await shot(p, "1440-check");

  console.log("\nViewer");
  await p.getByRole("button", { name: /Open test-ads-1/ }).click();
  check("viewer opens in the page", await seen(p.getByText("Screenshot 1 of 2", { exact: false })));
  await p.keyboard.press("ArrowRight");
  check("arrow key goes to the next", await seen(p.getByText("Screenshot 2 of 2", { exact: false })));
  await p.keyboard.press("Escape");
  check("Esc closes the viewer", !(await p.getByRole("dialog", { name: "Screenshot viewer" }).isVisible()));

  console.log("\nNew profit on a finished check: only the report is rewritten");
  // The collected screenshots' ids: a full run would delete and re-make them.
  const shotIds = async () => p.evaluate(async (cid) => {
    const r = await (await fetch(`/api/checks/${cid}/progress`)).json();
    return r.steps.filter((s) => !["write", "write_zh", "render"].includes(s.key)).flatMap((s) => s.shots.map((x) => x.id)).join(",");
  }, id);
  await p.goto(`${BASE}/checks/${id}`, { waitUntil: "networkidle" });
  const before = await shotIds();
  await p.goto(`${BASE}/checks/${id}/edit`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Change Profit per sale" }).click();
  await p.getByRole("button", { name: "RM per sale" }).click();
  await p.fill("#q-profit", "3000");
  await p.keyboard.press("Enter");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.waitForURL(new RegExp(`/checks/${id}(\\?|$)`));
  check("toast says the report is being rewritten", await seen(p.getByText("Changes saved. Rewriting the report")));
  check("the report comes back", await seen(p.getByRole("link", { name: "Download PDF" }), 60000));
  const rew = await (await p.request.get(`${BASE}/checks/${id}/report`)).text();
  check("break-even uses the new profit (RM3,000 ÷ RM15.83 = 1 in 189)", rew.includes("as long as 1 in 189 chats buys"));
  check("only the report steps ran again (collected screenshots untouched)", (await shotIds()) === before, `${before} vs ${await shotIds()}`);

  console.log("\nAll checks, one row");
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  const row = p.getByRole("row").filter({ hasText: "TEST Company Sdn Bhd" });
  check("row is in the list", await row.isVisible());
  check("row shows Yes and 2 screenshots", /Yes/.test(await row.innerText()) && /\b2\b/.test(await row.innerText()));

  console.log("\nLeave halfway");
  await p.goto(BASE + "/new", { waitUntil: "networkidle" });
  await seen(heading(p, "Which business are we checking?"));
  await p.fill("#q-facebook", "TEST unsaved");
  await p.getByRole("link", { name: "All checks" }).click();
  check("asks before leaving", await seen(p.getByText("Leave without saving?")));
  check("Stay has focus, not Leave", (await p.evaluate(() => document.activeElement?.textContent)) === "Stay");
  await shot(p, "1440-leave-modal");
  await p.getByRole("button", { name: "Stay" }).click();
  check("Stay keeps the answer", p.url() === BASE + "/new" && (await p.inputValue("#q-facebook")) === "TEST unsaved");

  console.log("\nSame Facebook page again = same business, new check");
  await p.fill("#q-facebook", "");
  await answer(p, { fb: "https://www.facebook.com/test.company.page", name: "TEST Company Sdn Bhd", ads: "Not sure" });
  check("Not sure goes straight to the answers", await p.locator(".g-sum").getByText("Not sure").isVisible());
  await p.getByRole("button", { name: "Start check" }).click();
  await p.waitForURL(/\/checks\/\d+/);
  const id2 = p.url().match(/checks\/(\d+)/)[1];
  check("second check saved", id2 !== id);
  check("website left empty keeps the saved one", await seen(p.getByRole("link", { name: "testcompany.example" })));

  console.log("\nEdit: switch Running ads to No removes the screenshots");
  await p.goto(`${BASE}/checks/${id}/edit`, { waitUntil: "networkidle" });
  check("edit opens on the answers", await seen(heading(p, "Ready to check TEST Company Sdn Bhd.")));
  check("answers show the 2 saved screenshots", await p.locator(".g-sum").getByText("Yes, 2 screenshots").isVisible());
  await p.getByRole("button", { name: "Change Running ads" }).click();
  check("question 5 shows the saved thumbnails", await seen(p.getByRole("button", { name: /Remove test-ads-1/ })));
  await radio(p, "No").click();
  check("warns the screenshots will go", await seen(p.getByText("The 2 saved screenshots will be removed when you save.")));
  check("No goes back to the answers", await seen(heading(p, "Ready to check TEST Company Sdn Bhd.")));
  await shot(p, "1440-edit-warning");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.waitForURL(new RegExp(`/checks/${id}(\\?|$)`));
  check("toast says Changes saved", await seen(p.getByText("Changes saved")));
  check("files removed from disk", filesIn(path.join(UP, id)) === 0, `found ${filesIn(path.join(UP, id))}`);

  console.log("\nDelete");
  await p.goto(`${BASE}/checks/${id2}`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Delete", exact: true }).click();
  check("asks first, naming the check", await seen(p.getByText("Delete the check for TEST Company Sdn Bhd?")));
  check("Cancel has focus, not Delete", (await p.evaluate(() => document.activeElement?.textContent)) === "Cancel");
  await shot(p, "1440-delete-modal");
  await p.getByRole("button", { name: "Delete check" }).click();
  await p.waitForURL(BASE + "/");
  check("toast says Check deleted", await seen(p.getByText("Check deleted")));
  check("one check left in the list", (await p.getByRole("row").filter({ hasText: "TEST Company" }).count()) === 1);

  console.log("\nA run on the fake shop: website and tracking");
  await p.goto(BASE + "/new", { waitUntil: "networkidle" });
  await answer(p, { fb: "facebook.com/test.shop.example", name: "TEST Shop", website: `${SHOP}/shop`, ads: "No" });
  // Switching on the answers screen keeps the answers; a check started in 中文 gets the 中文 report (and the English one).
  await switchTo(p, "中文");
  check("start page: switching keeps the answers, now in 中文", await seen(heading(p, "准备检查 TEST Shop.")) && await p.locator(".g-sum").getByText("没有", { exact: true }).first().isVisible());
  await p.getByRole("button", { name: "开始检查" }).click();
  await p.waitForURL(/\/checks\/\d+/);
  const id3 = p.url().match(/checks\/(\d+)/)[1];
  check("中文 toast: 检查开始了", await seen(p.getByText("检查开始了")));
  check("shop run finishes with a report", await seen(p.getByText("报告好了").first(), 120000));
  check("shop: the report is in 中文, as the app was at the start", await seen(p.frameLocator('iframe[title="报告"]').getByRole("heading", { name: "重点总结" }), 20000));
  await switchTo(p, "English");
  await seen(p.getByRole("link", { name: "Download PDF" }));
  const shopRep = await (await p.request.get(`${BASE}/checks/${id3}/report`)).text();
  check("report: first screen checklist for the shop", shopRep.includes("First screen checklist") && shopRep.includes("Headline on the first screen"));
  check("report: the dead link is listed with its error", shopRep.includes("Old news") && shopRep.includes("Error 404"));
  check("report: the live contact page is not listed as dead", !shopRep.includes("Contact us</span>"));
  const sf = p.frameLocator('iframe[title="Report"]');
  const site = sf.locator(".chan-row").filter({ hasText: "Website" });
  check("report: website live, shop cart noticed", await seen(site.getByText("Live"), 20000) && (await site.getByText("Has a shop or cart.", { exact: false }).isVisible()));
  const track = (label) => sf.locator(".track > div").filter({ hasText: label });
  check("report: Meta pixel found", await track("Meta pixel").getByText("Found").isVisible());
  check("report: Google found", await track("Google Analytics or Tag Manager").getByText("Found").isVisible());
  check("report: TikTok pixel missing", await track("TikTok pixel").getByText("Missing").isVisible());
  check("report: WhatsApp button found", await track("WhatsApp button").getByText("Found").isVisible());
  check("report: every proof photo has the same 4:3 frame", await sf.locator(".shots figure:not(.tall):not(.phone):not(.strip):not(.ad) a").evaluateAll((as) => as.length > 0 && as.every((x) => { const r = x.getBoundingClientRect(); return Math.abs(r.width / r.height - 4 / 3) < 0.03; })));
  check("report: landing shots side by side at the same height", await sf.locator(".pair").first().evaluate((el) => { const [d, m] = [...el.querySelectorAll("a")].map((x) => x.getBoundingClientRect().height); return !!d && !!m && Math.abs(d - m) < 3; }));
  const proof = await p.request.get(`${BASE}${await sf.locator(".shots a.zoom img").first().getAttribute("src")}`);
  check("run screenshot is served", proof.ok() && proof.headers()["content-type"] === "image/jpeg");
  await shot(p, "1440-run-done");
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  check("list shows the done status", await p.getByRole("row").filter({ hasText: "TEST Shop" }).getByText("Report ready").isVisible());

  // Put screenshots back on the first check, for the size screenshots below.
  await p.goto(`${BASE}/checks/${id}/edit`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Change Running ads" }).click();
  await radio(p, "Yes").click();
  await p.locator('input[type="file"]').setInputFiles(pics);
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.waitForURL(new RegExp(`/checks/${id}(\\?|$)`));
  await p.close();

  console.log("\nScreenshots at 4 widths");
  for (const [w, h] of [[390, 844], [1440, 900], [1920, 1080], [2788, 1300]]) {
    const s = await browser.newPage({ viewport: { width: w, height: h } });
    watch(s, String(w));
    let wide = false;
    for (const [route, name] of [["/", "list"], ["/new", "q1"], [`/checks/${id}`, "check"], [`/checks/${id3}`, "run"], [`/checks/${id3}/report`, "report"], [`/checks/${id3}/report?lang=zh`, "report-zh"], [`/checks/${id}/edit`, "summary"]]) {
      await s.goto(BASE + route, { waitUntil: "networkidle" });
      await s.waitForTimeout(900);
      await shot(s, `w${w}-${name}`);
      wide ||= await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    }
    await s.goto(BASE + "/new", { waitUntil: "networkidle" });
    await answer(s, { fb: "facebook.com/test.company.page", name: "TEST Company Sdn Bhd", website: "testcompany.example", ads: "Yes", pics: undefined });
    await s.getByRole("button", { name: "Change Running ads" }).click();
    await seen(s.getByText("Add their Ads Manager screenshots"));
    await s.waitForTimeout(900);
    await shot(s, `w${w}-q-ads`);
    wide ||= await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    for (const name of ["q-profit", "q-price"]) {
      await s.getByRole("button", { name: "Back" }).click();
      await s.waitForTimeout(900);
      await shot(s, `w${w}-${name}`);
      wide ||= await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    }
    // The same screens in 中文.
    await s.context().addCookies([{ name: "ma_lang", value: "zh", url: BASE }]);
    for (const [route, name] of [["/", "list-zh"], ["/new", "q1-zh"], [`/checks/${id3}`, "run-zh"], [`/checks/${id}/edit`, "summary-zh"]]) {
      await s.goto(BASE + route, { waitUntil: "networkidle" });
      await s.waitForTimeout(900);
      await shot(s, `w${w}-${name}`);
      wide ||= await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    }
    check(`no sideways scroll at ${w}`, !wide);
    await s.close();
  }
} catch (e) {
  failed++;
  console.log("  FAIL test stopped:", e.message);
} finally {
  await browser.close();
  stop();
}

// After the server stops, read the test database straight: one business, one check left.
try {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(DB);
  const [b] = (await db.query("select count(*)::int n from businesses")).rows;
  const [a] = (await db.query("select count(*)::int n from audits")).rows;
  check("database: 2 businesses (same page twice = one)", b.n === 2, `businesses=${b.n}`);
  check("database: 2 checks left after the delete", a.n === 2, `audits=${a.n}`);
  await db.close();
} catch (e) {
  failed++;
  console.log("  FAIL database read:", e.message);
}

check("no browser errors", errs.length === 0, errs.join("\n"));
console.log(`\n${pass} passed, ${failed} failed. Screenshots: .data/shots/`);
process.exit(failed ? 1 : 0);
