import fs from "fs";
import cheerio from "cheerio";
import { chromium } from "playwright";

const candidates = ["index.html", "docs/index.html"];
const file = candidates.find(f => fs.existsSync(f));
if (!file) {
  console.log("0/100 ❌ 找不到 index.html 或 docs/index.html");
  process.exit(0);
}
const html = fs.readFileSync(file, "utf8");
const $ = cheerio.load(html);

// 規則清單
const rules = [
  { label: "基本結構 <html><head><body>", check: () => $("html").length && $("head").length && $("body").length },
  { label: "<html lang>", check: () => $("html").attr("lang") },
  { label: "<meta charset>", check: () => $("meta[charset]").length > 0 },
  { label: "<title>", check: () => $("title").text().trim().length > 0 },
  { label: "<meta description> 長度 50~160", check: () => {
      const d = $('meta[name="description"]').attr("content");
      return d && d.length >= 50 && d.length <= 160;
    }},
  { label: "<h1> 有且僅一個", check: () => $("h1").length === 1 },
  { label: "<img> alt 屬性", check: () => $("img").toArray().every(el => $(el).attr("alt")?.trim()) },
  { label: "<a> href 合法", check: () => $("a").toArray().every(el => {
      const h = $(el).attr("href");
      return h && h !== "#";
    })}
];

// 計分
let score = 0;
const weight = 100 / (rules.length + 3); // 多3個是水平捲動檢查
const results = [];

for (const r of rules) {
  const ok = r.check();
  if (ok) score += weight;
  results.push({ ...r, passed: ok });
}

// 水平捲動檢查
async function checkScroll(width) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.goto("file://" + process.cwd() + "/" + file);
  const hasScroll = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth
  );
  await browser.close();
  return !hasScroll;
}

const scrollWidths = [320, 768, 1440];
for (const w of scrollWidths) {
  const ok = await checkScroll(w);
  if (ok) score += weight;
  results.push({ label: `${w}px 無水平捲動`, passed: ok });
}

// 總分
const finalScore = Math.round(score);

// 輸出
console.log(`🎯 本次檢查：${finalScore}/100 分`);
for (const r of results) {
  console.log(`${r.passed ? "✅" : "❌"} ${r.label}`);
}

// GitHub Actions Step Summary
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [];
  lines.push(`# 網站檢查結果`);
  lines.push(`**總分：${finalScore}/100**`);
  lines.push("");
  lines.push("| 規則 | 結果 |");
  lines.push("|------|------|");
  for (const r of results) {
    lines.push(`| ${r.label} | ${r.passed ? "✅" : "❌"} |`);
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}