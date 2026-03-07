/**
 * Build test/parser.test.mjs by extracting the live parser functions from app.js.
 * Run: node test/build_test.js && node test/parser.test.mjs
 */
const fs = require("fs");
const path = require("path");

const appSrc = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const start = appSrc.indexOf("// ---------- Word Text Parser ----------");
const end = appSrc.indexOf("\n// ---------- Custom Word List Options ----------");
if (start === -1 || end === -1) {
  console.error("Could not locate parser section in app.js");
  process.exit(1);
}
const parserFns = appSrc.slice(start, end);

const testBody = `
// ---- Test harness ----
function sortKeys(o) {
  const sorted = {};
  Object.keys(o).sort().forEach((k) => { sorted[k] = o[k]; });
  return sorted;
}
function deepEq(a, b) {
  return JSON.stringify(a.map(sortKeys)) === JSON.stringify(b.map(sortKeys));
}
let passed = 0, failed = 0;
function test(label, input, expected) {
  const got = parseWordListText(input);
  const ok = deepEq(got, expected);
  console.log((ok ? "\\u2713" : "\\u2717") + " " + label);
  if (!ok) {
    console.log("  expected:", JSON.stringify(expected, null, 2));
    console.log("  got:     ", JSON.stringify(got, null, 2));
    failed++;
  } else {
    passed++;
  }
}

// ---- Test cases (examples from development history) ----

test(
  "achieve multi-line compound POS + page num",
  "achieve /o'tfi:v/ vt. & vi. \\u8fbe\\u5230 ( \\u67d0 \\u76ee\\n\\u6807 \\u3001 \\u5730 \\u4f4d \\u3001 \\u6807 \\u51c6 ); \\u5b8c\\u6210 4",
  [{ en: "achieve", phonetic: "o'tfi:v", pos: "vt. & vi.", cn: "\\u8fbe\\u5230\\uff08\\u67d0\\u76ee\\u6807\\u3001\\u5730\\u4f4d\\u3001\\u6807\\u51c6\\uff09\\uff1b\\u5b8c\\u6210" }]
);

test(
  "*dull prefix preserved",
  "*dull adj. \\u65e0\\u804a\\u7684",
  [{ en: "*dull", pos: "adj.", cn: "\\u65e0\\u804a\\u7684" }]
);

test(
  "page num after quote stripped",
  'beautiful \\u7f8e\\u4e3d\\u7684"42',
  [{ en: "beautiful", cn: "\\u7f8e\\u4e3d\\u7684" }]
);

test(
  "pure-Chinese continuation line",
  "go v.\\n\\u53bb\\uff1b\\u5230\\u8fbe",
  [{ en: "go", pos: "v.", cn: "\\u53bb\\uff1b\\u5230\\u8fbe" }]
);

test(
  "dedup by English key",
  "run \\u8dd1\\nrun \\u5954\\u8dd1",
  [{ en: "run", cn: "\\u8dd1" }]
);

test(
  "standalone POS line",
  "achieve\\nvt. & vi.\\n\\u8fbe\\u5230\\u76ee\\u6807",
  [{ en: "achieve", pos: "vt. & vi.", cn: "\\u8fbe\\u5230\\u76ee\\u6807" }]
);

test(
  "half-width punctuation normalized",
  "pretty \\u6f02\\u4eae\\u7684;\\u7f8e\\u4e3d\\u7684",
  [{ en: "pretty", cn: "\\u6f02\\u4eae\\u7684\\uff1b\\u7f8e\\u4e3d\\u7684" }]
);

test(
  "trailing punctuation stripped",
  "smart \\u806a\\u660e\\u7684\\uff1b",
  [{ en: "smart", cn: "\\u806a\\u660e\\u7684" }]
);

// ---- Summary ----
console.log(\`\\n\${passed} passed, \${failed} failed\`);
if (failed > 0) process.exit(1);
`;

const outPath = path.join(__dirname, "parser.test.mjs");
fs.writeFileSync(outPath, parserFns + testBody);
console.log("Written: " + outPath);
