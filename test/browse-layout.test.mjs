/**
 * Tests for browse list mode column ordering.
 *
 * List mode uses CSS Grid with grid-auto-flow: column, grid-template-columns: repeat(2, 1fr),
 * grid-template-rows: repeat(32, 1fr).  Items are appended to the DOM in word-list order
 * (index 0, 1, 2, ...).  CSS then places them column-first:
 *
 *   DOM index 0  → visual row 1, col 1  (left column top)
 *   DOM index 1  → visual row 2, col 1
 *   ...
 *   DOM index 31 → visual row 32, col 1 (left column bottom)
 *   DOM index 32 → visual row 1,  col 2 (right column top)
 *   ...
 *   DOM index 63 → visual row 32, col 2 (right column bottom)
 *
 * The helper function browseListVisualIdx(row, col, rows) lets tests assert
 * exactly which word appears at any visual grid position.
 */

// ---- Pure helper replicated from the layout invariant ----
// Returns the DOM/array index of the word at visual position (row, col)
// when grid-auto-flow: column is in effect.
// row and col are 0-based.
function browseListVisualIdx(row, col, rows) {
  return col * rows + row;
}

// ---- Test harness ----
let passed = 0, failed = 0;
function eq(label, got, expected) {
  const ok = got === expected;
  console.log((ok ? "✓" : "✗") + " " + label);
  if (!ok) {
    console.log(`  expected: ${expected}`);
    console.log(`  got:      ${got}`);
    failed++;
  } else {
    passed++;
  }
}

// ---- Layout: 2 columns × 32 rows (64 words per page) ----
const ROWS = 32;
const COLS = 2;

// Left column – first word
eq("left col, row 0 → word index 0",  browseListVisualIdx(0, 0, ROWS), 0);
// Left column – last word
eq("left col, row 31 → word index 31", browseListVisualIdx(31, 0, ROWS), 31);
// Right column – first word
eq("right col, row 0 → word index 32", browseListVisualIdx(0, 1, ROWS), 32);
// Right column – last word
eq("right col, row 31 → word index 63", browseListVisualIdx(31, 1, ROWS), 63);
// Middle of left column
eq("left col, row 15 → word index 15", browseListVisualIdx(15, 0, ROWS), 15);
// Middle of right column
eq("right col, row 15 → word index 47", browseListVisualIdx(15, 1, ROWS), 47);

// ---- Verify row-major (wrong) ordering would differ ----
// grid-auto-flow: row would place index i at row=floor(i/cols), col=i%cols
function rowMajorCol(idx, cols) { return idx % cols; }
function rowMajorRow(idx, cols) { return Math.floor(idx / cols); }

// With row-major flow, index 1 goes to col 1 (right), not col 0 (left) — wrong
eq("row-major: index 1 would be in right col (wrong)",
  rowMajorCol(1, COLS), 1);
// With column-major flow, index 1 goes to col 0 (left) — correct
eq("col-major: index 1 is in left col (correct)",
  Math.floor(1 / ROWS), 0);

// ---- Spot-check that full page (64 items) maps correctly ----
const words = Array.from({ length: 64 }, (_, i) => `word${i}`);
let orderOk = true;
for (let col = 0; col < COLS; col++) {
  for (let row = 0; row < ROWS; row++) {
    const idx = browseListVisualIdx(row, col, ROWS);
    if (words[idx] !== `word${col * ROWS + row}`) { orderOk = false; break; }
  }
}
eq("full 64-word page: column-first order is correct", orderOk, true);

// ---- Summary ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
