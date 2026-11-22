'use strict';
// #6001: /claude-tweaks:review Step 3's opt-in adaptive lens selection. step3-lens-dispatch.md's tier table
// is the prose twin of select.js's TIER_LENSES (prose-code-twin-pin); the pointer, the new sub-file
// step3-lens-selection.md, step3-workflow-dispatch.md and step3-tier-variants.md carry the rest. Each prose
// assertion is proven red against a mutated in-memory copy (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');
const { TIER_LENSES } = require('../plugin/bin/lib/review-lens/select');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const LENS_DISPATCH = 'plugin/skills/review/step3-lens-dispatch.md';
const SUB_FILE = 'plugin/skills/review/step3-lens-selection.md';
const WORKFLOW = 'plugin/skills/review/step3-workflow-dispatch.md';
const VARIANTS = 'plugin/skills/review/step3-tier-variants.md';

// ---- AC1.2: the tier table equals TIER_LENSES ----

const TABLE_HEADING = '**Lens scope by `review-effort` tier**';

// { tier: [lens ids] } from the table rows under the heading; "Same lens set as `high`" copies the high row.
function parseTierTable(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(TABLE_HEADING));
  assert.notEqual(start, -1, 'tier table heading missing');
  const table = {};
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^\| `(\w+)` \| (.*) \|$/.exec(lines[i]);
    if (m) {
      const same = /^Same lens set as `(\w+)`/.exec(m[2]);
      if (same) table[m[1]] = table[same[1]];
      else table[m[1]] = [...m[2].split(' — ')[0].matchAll(/\b3[a-h]\b/g)].map((x) => x[0]);
    } else if (Object.keys(table).length > 0 && !lines[i].startsWith('|')) break;
  }
  return table;
}

test("AC1.2: step3-lens-dispatch.md's tier table equals select.js TIER_LENSES", () => {
  const table = parseTierTable(read(LENS_DISPATCH));
  assert.deepEqual(table, JSON.parse(JSON.stringify(TIER_LENSES)));
  const live = read(LENS_DISPATCH);
  const mutated = live.replace('| `medium` | 3b, 3c, 3a, 3f |', '| `medium` | 3b, 3c, 3a |');
  assert.notEqual(mutated, live);
  assert.notDeepEqual(parseTierTable(mutated), JSON.parse(JSON.stringify(TIER_LENSES)), 'a changed row must break the equality');
});

// ---- the pointer ----

const POINTER_ANCHOR = '**Adaptive selection (opt-in, #6001).**';
const POINTER_MAX_BYTES = 450;
const POINTER_NEEDLES = [
  [/resolve-policy\.js" --values review-lens-selection/, 'pointer must resolve review-lens-selection with resolve-policy.js --values'],
  [/`step3-lens-selection\.md`/, 'pointer must name step3-lens-selection.md'],
  [/only when[^.]*`adaptive`/, 'pointer must read the sub-file only when the key resolves `adaptive`'],
];

function pointerParagraph(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(POINTER_ANCHOR));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== '') end++;
  return lines.slice(start, end).join('\n');
}

function checkPointer(text) {
  const p = pointerParagraph(text);
  assert.ok(p !== null, 'pointer paragraph missing');
  const bytes = Buffer.byteLength(p);
  assert.ok(bytes <= POINTER_MAX_BYTES, `pointer paragraph is ${bytes} bytes, over ${POINTER_MAX_BYTES}`);
  for (const [needle, message] of POINTER_NEEDLES) assert.match(p, needle, message);
}

test('pointer: resolves review-lens-selection and reads step3-lens-selection.md only when adaptive', () => {
  const live = read(LENS_DISPATCH);
  checkPointer(live);
  assert.throws(() => checkPointer(live.replace(pointerParagraph(live), '')), { message: /pointer paragraph missing/ });
  for (const [needle, message] of POINTER_NEEDLES) {
    const p = pointerParagraph(live);
    const stripped = live.replace(p, p.replace(new RegExp(needle.source), ''));
    assert.notEqual(stripped, live, `anchor for "${message}" not found`);
    assert.throws(() => checkPointer(stripped), { message: new RegExp(message.replace(/[.*+?^${}()|[\]\\`]/g, '\\$&')) });
  }
  const padded = live.replace(pointerParagraph(live), `${pointerParagraph(live)} ${'x'.repeat(100)}`);
  assert.throws(() => checkPointer(padded), { message: /over 450/ });
});

// ---- the sub-file ----

const PROSE_SKIP_REPLACED = [/"skip a lens if it doesn't apply to this change type" and the `low`-tier no-executable-content skip do not apply/, 'the prose skip rule and the low-tier skip are replaced under adaptive'];
const SUB_FACTS = [
  [/only when `review-lens-selection` resolves `adaptive`/, 'the file is read only when the key resolves adaptive'],
  [/bin\/review-lens-select\.js" --run "\$PIPELINE_RUN_DIR" --tier \{tier\} --base \{base\} \[--risk-flags "\{risk-flags\}"\]/, 'the one CLI call with its flags, the risk-flags value quoted'],
  [/leave the flag out when the record has no `Risk-flags:` line; `none` or an empty value reads as no flags too/, '--risk-flags is omitted without a line, and none or empty read as no flags'],
  [/A value holding anything but lowercase letters, digits, `-`, `,` and spaces goes in as `"malformed"`, which reads as flagged/, 'an unsafe value never reaches the shell and reads as flagged'],
  [/Standalone \(no run directory\), skip the CLI, which needs `--run`: dispatch the tier's whole lens set/, 'standalone skips the CLI and dispatches the tier set'],
  [/Dispatch exactly the lenses in `selected`, on every path: the Task dispatch, and the `lenses` the workflow/, 'the Task path and the workflow lenses args read the same selected set (AC6.2)'],
  PROSE_SKIP_REPLACED,
  [/When the CLI exits 1 or 2, or its output is not one parseable JSON line, dispatch the full tier set and log one `AUTO` line, never a `SKIP`/, 'a CLI failure dispatches the full tier set with one AUTO line, never a SKIP'],
  [/--status AUTO --step "Step 3 lens selection" --text "review-lens-select exit \{n\}: full tier set dispatched"/, 'the AUTO line names the exit'],
  [/The CLI is not run again\. The workflow path's Task fallback reads the same output/, 'the CLI runs once per review and the workflow fallback reuses its output'],
  [/Write none of them/, 'the session writes no SKIP or AUTO line the CLI already logged'],
];

test('AC6.2: the Task path and the workflow lenses args read the same CLI output', () => {
  const sub = read(SUB_FILE);
  assert.equal(sub.split('review-lens-select.js"').length - 1, 1, 'the CLI call is stated once for both paths');
  assert.deepEqual(missingFactsOf(SUB_FACTS)(sub), []);
  assertEachPatternGoesRed(sub, SUB_FACTS, missingFactsOf(SUB_FACTS));
  const wf = read(WORKFLOW);
  const WF_FACTS = [
    [/the lenses are the CLI's `selected` set \(3a-3g only\), from the one run `step3-lens-selection\.md` describes/, 'the workflow builds lenses from selected, naming step3-lens-selection.md'],
  ];
  assert.deepEqual(missingFactsOf(WF_FACTS)(wf), []);
  assertEachPatternGoesRed(wf, WF_FACTS, missingFactsOf(WF_FACTS));
});

test('adaptive replaces the prose skip rule', () => {
  const sub = read(SUB_FILE);
  assert.match(sub, PROSE_SKIP_REPLACED[0], PROSE_SKIP_REPLACED[1]);
  const variants = read(VARIANTS);
  const FACTS = [[/Under `review-lens-selection: adaptive` the CLI's `executableContent` fact replaces this skip \(`step3-lens-selection\.md`\); under `tier` it is unchanged\./, 'the low-tier paragraph names adaptive and keeps tier unchanged']];
  assert.deepEqual(missingFactsOf(FACTS)(variants), []);
  assertEachPatternGoesRed(variants, FACTS, missingFactsOf(FACTS));
});

test("code-mode-steps.md's prose skip rule names adaptive as its exception at every site", () => {
  const text = read('plugin/skills/review/code-mode-steps.md');
  const QUALIFIER = '(not under `review-lens-selection: adaptive` — `step3-lens-selection.md`)';
  const sites = text.split('\n').filter((l) => /[Ss]kip (?:review )?lenses that don't apply to the type of change/.test(l));
  assert.equal(sites.length, 2, 'the two prose skip sites');
  for (const l of sites) assert.ok(l.includes(QUALIFIER), `unqualified prose skip rule: ${l}`);
  const mutated = text.replace(` ${QUALIFIER}`, '');
  assert.notEqual(mutated, text);
  assert.ok(mutated.split('\n').filter((l) => /[Ss]kip (?:review )?lenses that don't apply/.test(l)).some((l) => !l.includes(QUALIFIER)), 'dropping one qualifier must be caught');
});

test('fallback: a non-zero CLI exit dispatches the full tier set', () => {
  const section = sectionOf(read(SUB_FILE), '## Fallback');
  const FACTS = [
    [/exits 1 or 2/, 'exits 1 and 2 are named'],
    [/dispatch the full tier set and log one `AUTO` line, never a `SKIP`/, 'full tier set, one AUTO line, never SKIP'],
  ];
  assert.deepEqual(missingFactsOf(FACTS)(section), []);
  assertEachPatternGoesRed(section, FACTS, missingFactsOf(FACTS));
});

test('workflow fallback under adaptive dispatches the selected set', () => {
  const section = sectionOf(read(WORKFLOW), '## Fallback');
  const FACTS = [[/Under `adaptive`, "every lens" and "lenses 3a–3g" mean the CLI's `selected` set \(intersected with 3a–3g under conditions 3–5\), never the full tier set, and the Task path reads that same output rather than running the CLI again/, 'under adaptive the fallback dispatches selected, not the full tier set']];
  assert.deepEqual(missingFactsOf(FACTS)(section), []);
  assertEachPatternGoesRed(section, FACTS, missingFactsOf(FACTS));
});
