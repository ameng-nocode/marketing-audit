// Design fence: fails when a page uses a size, weight, spacing step or colour outside the
// DESIGN RULES in CLAUDE.md. Every page and component is on the scale.
// Usage: npm run check:design                    (checks every .tsx under app/ and components/)
//        node scripts/check-design.mjs <file...>   (checks the files you name, e.g. one you just edited)
import { readFileSync, readdirSync } from "node:fs";

// Files listed here skip the check (none yet).
const SKIP = new Set();
const ALL = ["app", "components"].flatMap((dir) =>
  readdirSync(dir, { recursive: true })
    .map((f) => `${dir}/${String(f).split("\\").join("/")}`)
    .filter((f) => f.endsWith(".tsx") && !SKIP.has(f)));

const SPACE = "(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)";
// 4px grid steps. 7 (28px) is the page gutter; 20 and 24 are for big layout gaps.
const STEPS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "10", "12", "16", "20", "24"]);

const RULES = [
  { re: /(?<![\w-])text-\[\d[^\]]*\]/g, msg: "made-up text size: use text-xs/sm/base/lg/xl/2xl/3xl/4xl/5xl (rule 1)" },
  { re: /(?<![\w-])font-(?:black|light|thin|extralight|normal)\b/g, msg: "off-scale weight: use font-medium, semibold, bold or extrabold (rule 2)" },
  // Brackets holding calc(), env(), var() or % are layout maths (safe areas, tab bar), not made-up numbers.
  { re: new RegExp(`(?<![\\w-])-?${SPACE}-\\[(?![^\\]]*(?:calc\\(|env\\(|var\\(|%))[^\\]]*\\]`, "g"), msg: "made-up spacing: use a 4px step (rule 3)" },
  { re: /(?<![\w-])(?:leading|tracking)-\[[^\]]*\]/g, msg: "made-up line height or letter spacing: the text size sets it (rule 1)" },
  { re: /(?<![\w-])(?:text|bg|border|ring|fill|stroke|from|to|accent|outline|decoration)-\[(?:var\(|#|rgb)[^\]]*\]/g, msg: "colour by hand: use a named colour like text-navy-2 (rule 6)" },
  { re: /["'\s(]#[0-9a-fA-F]{3,8}(?=["'\s);,])/g, msg: "hex colour in TSX: add a variable in globals.css (rule 6)" },
];

const files = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
let bad = 0;
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("design-ok")) return; // a reviewed exception, explained on the line
    for (const { re, msg } of RULES) {
      for (const m of line.matchAll(re)) { bad++; console.log(`${f}:${i + 1}  ${m[0].trim()}  ${msg}`); }
    }
    for (const m of line.matchAll(new RegExp(`(?<![\\w-])-?${SPACE}-(\\d+(?:\\.\\d+)?)(?![\\w.%])`, "g"))) {
      if (!STEPS.has(m[1])) { bad++; console.log(`${f}:${i + 1}  ${m[0]}  off the 4px grid: use 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20 or 24 (rule 3)`); }
    }
  });
}
if (bad) { console.log(`\n${bad} design problem${bad === 1 ? "" : "s"}. See DESIGN RULES in CLAUDE.md.`); process.exit(1); }
console.log(`Design check passed (${files.length} file${files.length === 1 ? "" : "s"}).`);
