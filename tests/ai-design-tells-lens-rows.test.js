'use strict';
// Pins #2667's new AI Design Tells lens: the checklist's row set, the
// code-inspectable/judgment marking every row carries, and the wiring into
// page-mode.md / SKILL.md / docs/plugin-structure.md that makes the lens
// actually invoked rather than an orphaned file. Mirrors the shape
// tests/ux-heuristics-lens-rows.test.js already established for the sibling
// lens.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const LENS = read('plugin', 'skills', 'visual-review', 'ai-design-tells-lens.md');
const PAGE_MODE = read('plugin', 'skills', 'visual-review', 'page-mode.md');
const VR_SKILL = read('plugin', 'skills', 'visual-review', 'SKILL.md');
const PLUGIN_STRUCTURE = read('docs', 'plugin-structure.md');

function checklistRows() {
  const start = LENS.indexOf('## The checklist');
  const end = LENS.indexOf('\n## ', start + 1);
  assert.ok(start >= 0 && end > start, 'ai-design-tells-lens.md must keep its "## The checklist" section');
  return LENS.slice(start, end).split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Tell') && !l.startsWith('|---'));
}

function row(tell) {
  const found = checklistRows().find((l) => l.startsWith(`| ${tell} |`));
  assert.ok(found, `no checklist row for "${tell}"`);
  return found;
}

test('the checklist has one row per deduplicated tell from both source Reels (18 items from the first, 4 from the second, merged into 13 rows)', () => {
  assert.strictEqual(checklistRows().length, 13);
});

test('every row is marked code-inspectable or judgment in its Detection column', () => {
  for (const r of checklistRows()) {
    assert.match(r, /\|\s*(Code-inspectable|Judgment)\s*—/, `row missing a Detection marking: ${r}`);
  }
});

test('the gradient row folds in gradient blobs from the second Reel', () => {
  assert.match(row('Purple-to-blue gradients, gradient hero text, and gradient blobs'), /purple → blue. sweep/);
});

test('the icon row folds in circle icons from the second Reel', () => {
  assert.match(row('Lucide icons everywhere, untouched shadcn components, and circle icon containers'), /lucide-react/);
});

test('bento grids and fake testimonials each get their own row (not merged into an existing one)', () => {
  assert.match(row('Bento grids'), /asymmetric grid/);
  assert.match(row('Fake testimonials'), /stock-photo avatars/);
});

test('every row\'s "Swap it for" cell names product-specific corrective content, not only "avoid this"', () => {
  for (const r of checklistRows()) {
    const cells = r.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
    // Tell | Why it reads as generic | Swap it for | Detection
    const swapCell = cells[2];
    assert.ok(swapCell && swapCell.length > 10 && !/^avoid this\.?$/i.test(swapCell), `"Swap it for" cell too vague: ${swapCell}`);
  }
});

test('the lens states the list is time-bound and needs periodic refresh', () => {
  assert.match(LENS, /time-bound and needs periodic refresh/);
});

test('the lens states the fix framing: swap for product-specific content, not polish the same pattern', () => {
  assert.match(LENS, /real photos, real numbers, real copy/);
});

test('page-mode.md Step 4 applies the lens right after the UX heuristics lens, with Source = AI Design Tells', () => {
  const uxIdx = PAGE_MODE.indexOf('#### UX Heuristics');
  const tellsIdx = PAGE_MODE.indexOf('#### AI Design Tells');
  assert.ok(uxIdx >= 0 && tellsIdx > uxIdx, 'the AI Design Tells subsection must come after the UX Heuristics subsection');
  const section = PAGE_MODE.slice(tellsIdx, PAGE_MODE.indexOf('\n#### ', tellsIdx + 1));
  assert.match(section, /ai-design-tells-lens\.md/);
  assert.match(section, /Source = AI Design Tells/);
});

test('visual-review/SKILL.md names the new lens in its Page mode bullet', () => {
  assert.match(VR_SKILL, /ai-design-tells-lens\.md.*#2667/);
});

test('docs/plugin-structure.md lists ai-design-tells-lens.md in the visual-review row', () => {
  const rowLine = PLUGIN_STRUCTURE.split('\n').find((l) => l.startsWith('| visual-review |'));
  assert.ok(rowLine, 'docs/plugin-structure.md must have a visual-review row');
  assert.match(rowLine, /ai-design-tells-lens\.md/);
});
