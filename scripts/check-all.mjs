/**
 * 綜合檢查（HTML/SEO + 水平捲動）
 * - 只輸出分數與每條規則的結果，不讓 CI fail（exit code 0）
 * - 會把結果寫進 $GITHUB_STEP_SUMMARY（Checks -> Summary）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";          // <-- 修正：使用 namespace import
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) 找 index.html（支援根目錄或 docs/）
const CANDIDATES = ["index.html", "docs/index.html"];
const htmlFile = CANDIDATES.find(p => fs.existsSync(path.join(process.cwd(), p)));

if (!htmlFile) {
  output({
    results: [],
    score: 0,
    note: "找不到 index.html 或 docs/index.html"
  });
  process.exit(0);
}

const raw = fs.readFileSync(htmlFile, "utf8");
const $ = cheerio.load(raw);

// 2) 規則（HTML/SEO）
const rules = [
  {
    label: "基本結構 <html><head><body>",
    check: () => $("html").length && $("head").length && $("body").length
  },
  { label: "<html lang>", check: () => $("html").attr("lang") },
  { label: "<meta charset>", check: () => $("meta[charset]").length > 0 },
  { label: "<title> 非空", check: () => $("title").text().trim().length > 0 },
  {
    label: "<meta name=description> 50~160",
    check: () => {
      const d = $('meta[name="description"]').attr("content");
      return d && d.length >= 50 && d.length <= 160;
    }
  },
  { label: "<h1> 有且僅一個", check: () => $("h1").length === 1 },
  {
    label: "<img> 皆有非空 alt",
    check: () => $("img").toArray().every(el => ($(el).attr("alt") || "").trim().length > 0)
  },
  {
    label: "<a> href 合法（非空/非 #）",
    check: () => $("a").toArray().every(el => {
      const h = ($(el).attr("href") || "").trim();
      return h && h !== "#";
    })
  }
];

// 3) 計分（含水平捲動 3 項）
const scrollTargets = [320, 768, 1440];
const totalItems = rules.length + scrollTargets.length;
const each = 100 / totalItems;

let score = 0;
const results = [];

for (const r of rules) {
  const passed = !!r.check();
  if (passed) score += each;
  results.push({ label: r.label, passed });
}

// 4) 水平捲動檢查（以本機檔案載入）
async function checkScroll(width) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.goto("file://" + path.join(process.cwd(), htmlFile));
  const ok = await page.evaluate(() => {
    return document.documentElement.scrollWidth <= window.innerWidth;
  });
  await browser.close();
  return ok;
}

for (const w of scrollTargets) {
  const ok = await checkScroll(w).catch(() => false);
  if (ok) score += each;
  results.push({ label: `${w}px 無水平捲動`, passed: ok });
}

const finalScore = Math.round(score);

// 5) 輸出（console + Step Summary）
output({ results, score: finalScore });

function output({ results, score, note }) {
  console.log(`🎯 本次檢查：${score}/100 分`);
  if (note) console.log(`ℹ️ ${note}`);
  for (const r of results) {
    console.log(`${r.passed ? "✅" : "❌"} ${r.label}`);
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const lines = [];
    lines.push(`# 網站檢查結果`);
    lines.push(`**總分：${score}/100**`);
    if (note) lines.push(`\n> ${note}\n`);
    lines.push("\n| 規則 | 結果 |");
    lines.push("|------|------|");
    for (const r of results) {
      lines.push(`| ${r.label} | ${r.passed ? "✅" : "❌"} |`);
    }
    fs.appendFileSync(summary, lines.join("\n"));
  }
}