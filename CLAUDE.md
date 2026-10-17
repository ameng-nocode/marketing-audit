@AGENTS.md

# Marketing Audit

A local web app: a short form in, a marketing audit report out. Runs on 127.0.0.1:3130, no login. See README.md for what it does and how to set it up.

Look: "Glossy". A light page, glossy navy and cyan 3D objects, one question per screen in the start flow, real brand logos for the channels.

## How the app is split

- `lib/collect/`: the 26 run steps. Code opens the pages (Playwright, logged out), takes screenshots and saves facts.
- `lib/ai.ts`: every AI call goes through the Claude Code app (`claude -p`, a JSON schema in, typed JSON out). Every call is logged in the `ai_calls` table.
- `lib/report/`: `money.ts` works out the ad money numbers, `write.ts` and `write-zh.ts` ask the AI for the words, `render.ts` builds the page and the PDF.
- `lib/i18n.ts`: English and 中文 for every screen. Platform names stay in English.
- `db/migrations/`: the database (PGlite, on this PC). Run once each, in file order.

Rule of the house: code collects and writes the numbers, the AI only writes words. A text check flags any number in the AI's words that is not in the collected data.

## Design rules (read before any UI change)

AI-built pages drift because every edit invents new numbers. These rules plus `npm run check:design` stop that.

1. Text sizes: only text-xs (12), text-sm (13), text-base (14), text-lg (16), text-xl (18), text-2xl (28), and for big titles text-3xl (32), text-4xl (54), text-5xl (72). Defined in globals.css `@theme`; Tailwind's defaults are cleared. Never text-[..px], leading-[..], tracking-[..].
2. Weights (Plus Jakarta Sans): font-medium or font-semibold for text, font-bold for labels and buttons, font-extrabold for titles. No light, thin or black.
3. Spacing: 4px grid only. Steps 1, 2, 3, 4, 5, 6, 8, 10, 12, 16 (7 = page gutter; 20, 24 for big layout gaps). Never 1.5, 2.5, 3.5, never p-[..px] or gap-[..px]; calc()/env() for safe areas is fine.
4. Width: pages are fluid, from phone to a 2800px monitor; never a fixed, centred box with empty sides. The question flow is centred on purpose and scales up on wide screens. Check every UI change at 390, 1440, 1920 and 2788 wide.
5. Reuse first: components/ui.tsx (TopBar, PageHeader, Panel, Fact), components/stage.tsx (Stage, Ring), components/brand.tsx (channel logos, strip) and the g-* classes in globals.css (.g-btn, .g-pill, .g-card, .g-tag, .g-bar, .g-choice, .g-drop ...). Missing a part? Add it there once, then use it.
6. Colours: named colours only (text-navy, text-navy-2, text-muted, bg-panel, border-line, text-cyan-ink, text-red ...), mapped in globals.css `@theme inline`. No hex, rgb or text-[var(..)] in TSX; brand logos in components/brand.tsx are the one reviewed exception. Cyan = progress and focus. Red = a problem or a delete. No yellow, orange, indigo, purple.
7. No emoji. Stroke SVG icons from components/icons.tsx, real brand logos from components/brand.tsx.
8. One primary (navy) button per screen. In the question flow the Continue button sits right under the question.
9. Inputs start empty: the hint goes under the box, never an example inside it. One question per screen in the flow.
10. Pop-ups are the app's own (components/modal.tsx), never confirm/alert/prompt. Screenshots open in the in-page viewer, never a new tab.
11. Screen words: standard app words (Save, Edit, Delete). No em dash. Every screen word has its 中文 (lib/i18n.ts `pick`, or `useLang().tr` in the browser).
12. Motion: fades and short rises only, no zoom or push-in. Everything stops under prefers-reduced-motion.

Done = `npm run check:design` passes, `npm run test:flow` passes, screenshots at 390, 1440, 1920 and 2788 looked at and fixed.
