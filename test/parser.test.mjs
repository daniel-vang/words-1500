// ---------- Word Text Parser ----------
// Strip trailing page-number references like "美丽的 42" → "美丽的"
function stripPageNum(cn) {
  return (cn || "").replace(/[\s""\u201c\u201d]+\d{1,3}$/, "").trim();
}

// Normalize Chinese meaning: remove spaces, convert half-width punctuation to full-width, strip trailing punctuation
function normalizeCn(cn) {
  if (!cn) return cn;
  return cn
    .replace(/\s+/g, "")           // remove all spaces
    .replace(/,/g, "，")            // , → ，
    .replace(/;/g, "；")            // ; → ；
    .replace(/:/g, "：")            // : → ：
    .replace(/\?/g, "？")           // ? → ？
    .replace(/!/g, "！")            // ! → ！
    .replace(/\(/g, "（")           // ( → （
    .replace(/\)/g, "）")           // ) → ）
    .replace(/[，；：？！、。…]+$/, ""); // strip trailing punctuation
}

function parseWordListText(text) {
  const lines = text.split(/\r?\n/);
  const results = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    // skip pure separator or bullet-only lines
    if (/^[\s\d\-—=*·•◆◇○●]+$/.test(line)) continue;
    // remove leading list number: "1.", "1、", "(1)", "①"
    line = line.replace(/^[（(]?\d+[）)\.、]\s*/, "").trim();
    line = line.replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, "").trim();
    if (!line) continue;

    // Format: word [TAB] meaning
    const tabIdx = line.indexOf("\t");
    if (tabIdx > 0) {
      const en = line.slice(0, tabIdx).trim();
      const rest = line.slice(tabIdx + 1).trim();
      if (/^\*?[a-zA-Z]/.test(en)) {
        const parsed = extractPhoneticAndPos(en, rest);
        results.push(parsed);
        continue;
      }
    }

    // Format: word /phonetic/ pos. meaning  OR  word [phonetic] pos. meaning
    // POS group handles compound forms like "vt. & vi." or "vt.&vi."
    const detailMatch = line.match(
      /^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s*[/\[]([^\]/\[]+)[/\]]\s*((?:[a-z]{1,6}\.(?:\s*[&和]\s*[a-z]{1,6}\.)*\s*))?(.*)$/
    );
    if (detailMatch) {
      const en = detailMatch[1].trim();
      const phonetic = detailMatch[2].trim();
      const pos = (detailMatch[3] || "").trim();
      const cn = (detailMatch[4] || "").trim();
      if (en) {
        results.push({ en, phonetic: phonetic || undefined, pos: pos || undefined, cn });
        continue;
      }
    }

    // Format: word: meaning  OR  word：meaning
    const colonMatch = line.match(/^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s*[：:]\s*(.+)$/);
    if (colonMatch) {
      results.push({
        en: colonMatch[1].trim(),
        cn: colonMatch[2].trim(),
      });
      continue;
    }

    // Format: word  Chinese (space + CJK characters)
    const cjkMatch = line.match(
      /^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s+([\u4e00-\u9fff\u3400-\u4dbf].*)$/
    );
    if (cjkMatch) {
      results.push({
        en: cjkMatch[1].trim(),
        cn: cjkMatch[2].trim(),
      });
      continue;
    }

    // Format: English word only (no Chinese)
    const engOnly = line.match(/^(\*?[a-zA-Z][a-zA-Z '\-]{0,39})$/);
    if (engOnly) {
      results.push({ en: engOnly[1].trim(), cn: "" });
      continue;
    }

    // Format: word pos. Chinese (space + part-of-speech like "n.", "v.")
    const posMatch = line.match(
      /^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s+([a-z]{1,5}\.\s*)(.+)$/
    );
    if (posMatch && /^\*?[a-zA-Z]/.test(posMatch[1])) {
      results.push({
        en: posMatch[1].trim(),
        pos: posMatch[2].trim(),
        cn: posMatch[3].trim(),
      });
      continue;
    }

    // Line starts with a POS marker (vt. vi. adj. adv. n. v. conj. prep. pron. …)
    // Supports combined forms like "vt. & vi." or "vt.&vi."
    // — treat as continuation of the previous word, filling pos and/or cn
    const POS_ATOM = "(?:vt|vi|adj|adv|conj|prep|pron|art|num|interj|n|v|aux|det|pl)\\.";
    const posOnlyMatch = line.match(
      new RegExp(`^((?:${POS_ATOM}\\s*(?:[&和]\\s*)?)*${POS_ATOM}\\s*)(.*)?$`, "i")
    );
    if (posOnlyMatch && results.length > 0) {
      const prev = results[results.length - 1];
      const pos = posOnlyMatch[1].trim();
      const rest = (posOnlyMatch[2] || "").trim();
      if (!prev.pos) prev.pos = pos;
      if (rest) {
        const sep = prev.cn && !/[，；,;]\s*$/.test(prev.cn) ? "；" : "";
        prev.cn = prev.cn ? prev.cn + sep + rest : rest;
      }
      continue;
    }

    // Line starts with Chinese — treat as continuation of the previous word's meaning.
    // Concatenate directly (no auto-separator): OCR often wraps mid-word, and the
    // original text already contains 、；， separators where needed.
    if (/^[\u4e00-\u9fff\u3400-\u4dbf]/.test(line) && results.length > 0) {
      const prev = results[results.length - 1];
      prev.cn = prev.cn ? prev.cn + line : line;
      continue;
    }

    // Format: word pos. — line ends with a POS marker, meaning follows on later lines
    const wordPosOnly = line.match(
      /^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s+((?:[a-z]{1,6}\.(?:\s*[&和]\s*[a-z]{1,6}\.)*)\s*)$/i
    );
    if (wordPosOnly && /^\*?[a-zA-Z]/.test(wordPosOnly[1])) {
      results.push({ en: wordPosOnly[1].trim(), pos: wordPosOnly[2].trim(), cn: "" });
      continue;
    }

    // Fallback: extract a leading English word from lines that matched nothing above
    const fallbackMatch = line.match(/^(\*?[a-zA-Z][a-zA-Z'\-]{0,29})/);
    if (fallbackMatch) {
      results.push({ en: fallbackMatch[1].trim(), cn: "" });
      continue;
    }
  }

  results.forEach((w) => { if (w.cn) w.cn = normalizeCn(stripPageNum(w.cn)); });

  // Deduplicate by English word (case-insensitive); keep first occurrence
  const seen = new Map();
  results.forEach((w) => {
    const key = w.en.toLowerCase();
    if (!seen.has(key)) seen.set(key, w);
  });
  return Array.from(seen.values()).filter((w) => w.en && w.en.length > 0);
}

function extractPhoneticAndPos(en, rest) {
  // rest may start with phonetic in /.../ or [...]
  const phoneticMatch = rest.match(/^[/\[]([^\]/\[]+)[/\]]\s*([a-z]+\.\s*)?(.*)$/);
  if (phoneticMatch) {
    return {
      en,
      phonetic: phoneticMatch[1].trim(),
      pos: (phoneticMatch[2] || "").trim() || undefined,
      cn: (phoneticMatch[3] || "").trim(),
    };
  }
  return { en, cn: rest };
}

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
  console.log((ok ? "\u2713" : "\u2717") + " " + label);
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
  "achieve /o'tfi:v/ vt. & vi. \u8fbe\u5230 ( \u67d0 \u76ee\n\u6807 \u3001 \u5730 \u4f4d \u3001 \u6807 \u51c6 ); \u5b8c\u6210 4",
  [{ en: "achieve", phonetic: "o'tfi:v", pos: "vt. & vi.", cn: "\u8fbe\u5230\uff08\u67d0\u76ee\u6807\u3001\u5730\u4f4d\u3001\u6807\u51c6\uff09\uff1b\u5b8c\u6210" }]
);

test(
  "*dull prefix preserved",
  "*dull adj. \u65e0\u804a\u7684",
  [{ en: "*dull", pos: "adj.", cn: "\u65e0\u804a\u7684" }]
);

test(
  "page num after quote stripped",
  'beautiful \u7f8e\u4e3d\u7684"42',
  [{ en: "beautiful", cn: "\u7f8e\u4e3d\u7684" }]
);

test(
  "pure-Chinese continuation line",
  "go v.\n\u53bb\uff1b\u5230\u8fbe",
  [{ en: "go", pos: "v.", cn: "\u53bb\uff1b\u5230\u8fbe" }]
);

test(
  "dedup by English key",
  "run \u8dd1\nrun \u5954\u8dd1",
  [{ en: "run", cn: "\u8dd1" }]
);

test(
  "standalone POS line",
  "achieve\nvt. & vi.\n\u8fbe\u5230\u76ee\u6807",
  [{ en: "achieve", pos: "vt. & vi.", cn: "\u8fbe\u5230\u76ee\u6807" }]
);

test(
  "half-width punctuation normalized",
  "pretty \u6f02\u4eae\u7684;\u7f8e\u4e3d\u7684",
  [{ en: "pretty", cn: "\u6f02\u4eae\u7684\uff1b\u7f8e\u4e3d\u7684" }]
);

test(
  "trailing punctuation stripped",
  "smart \u806a\u660e\u7684\uff1b",
  [{ en: "smart", cn: "\u806a\u660e\u7684" }]
);

// ---- Summary ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
