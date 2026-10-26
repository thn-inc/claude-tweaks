// tests/auto-mode-flow-two-stop-budget.test.js — #688: pins the two-stop bookend contract
// (`_shared/auto-mode-contract.md`: "skills MUST NOT invent new mid-flow stops in auto mode")
// against the actual auto-mode /flow prose path: flow/SKILL.md, flow/manifesto.md,
// wrap-up/review-console.md, flow/multispec-review-console.md.
//
// A real scan, not a shape match: it looks for genuine `AskUserQuestion` INVOCATION
// instructions ("call `AskUserQuestion`"), not every prose mention of the tool's name — a file
// can discuss the tool at length without adding a decision point. flow/manifesto.md,
// wrap-up/review-console.md, and flow/multispec-review-console.md are each wholesale-tagged
// (Manifesto / Review Console respectively) — their entire content IS one of the two contracted
// bookends, so every invocation inside them (terminal call, Override-drill sub-calls, the
// console-on-PR live-session accelerator) belongs to that one bookend, never a new stop.
// flow/SKILL.md is the mixed orchestration file: HARD-GATE stops and failure cards are real,
// permitted mid-flow stops (`_shared/auto-mode-contract.md`'s "What auto does NOT silence"), so
// an invocation near either marker is exempt too — anything else there is the invented third
// stop the contract forbids.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const FLOW_SKILL = path.join(SKILLS, 'flow', 'SKILL.md');
const MANIFESTO = path.join(SKILLS, 'flow', 'manifesto.md');
// #657 split the confirm/hybrid-only AskUserQuestion mechanics out of manifesto.md into this
// companion file (never loaded by an auto-mode run) — same Manifesto bookend, just relocated.
const MANIFESTO_CONFIRM = path.join(SKILLS, 'flow', 'manifesto-confirm.md');
const REVIEW_CONSOLE = path.join(SKILLS, 'wrap-up', 'review-console.md');
const MULTISPEC_CONSOLE = path.join(SKILLS, 'flow', 'multispec-review-console.md');

const FOUR_FILES = [FLOW_SKILL, MANIFESTO, MANIFESTO_CONFIRM, REVIEW_CONSOLE, MULTISPEC_CONSOLE];

// Files whose entire content IS one of the two contracted bookends by definition — every
// AskUserQuestion invocation inside them belongs to that bookend, never a new stop.
const WHOLE_FILE_EXEMPT = new Set([MANIFESTO, MANIFESTO_CONFIRM, REVIEW_CONSOLE, MULTISPEC_CONSOLE]);

// A genuine decision-point invocation ("call `AskUserQuestion`" / "call AskUserQuestion with"),
// not a passing mention of the tool's name elsewhere in a sentence.
const INVOKE_RE = /\bcall\b[^\n]{0,40}`?AskUserQuestion/gi;

const TAG_WINDOW = 400; // chars of context scanned before/after a hit for HARD-GATE/failure-card

/**
 * Returns every AskUserQuestion invocation in `text` that is NOT inside a whole-file-exempt
 * file and NOT near a HARD-GATE / failure-card marker. Takes raw text + a label rather than a
 * path so the proof test below can run it against injected content without touching real files.
 */
function untaggedInvocations(text, label, exemptWholeFile) {
  if (exemptWholeFile) return [];
  const hits = [];
  for (const m of text.matchAll(INVOKE_RE)) {
    const context = text.slice(Math.max(0, m.index - TAG_WINDOW), m.index + m[0].length + TAG_WINDOW);
    if (/HARD-GATE|failure.?card/i.test(context)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    hits.push({ file: label, line, snippet: m[0] });
  }
  return hits;
}

function scanFile(filePath) {
  const text = readText(filePath);
  return untaggedInvocations(text, path.relative(SKILLS, filePath), WHOLE_FILE_EXEMPT.has(filePath));
}

test('negative control: INVOKE_RE does not fire on a bare mention of the tool name', () => {
  const text = 'Their `AskUserQuestion` call(s) are skipped in this mode.';
  assert.deepEqual(untaggedInvocations(text, 'x', false), []);
});

test('negative control: an invocation inside a HARD-GATE window is exempt', () => {
  const text = 'This is a HARD-GATE. ' + 'x'.repeat(50) + '\ncall `AskUserQuestion` with the failure options.';
  assert.deepEqual(untaggedInvocations(text, 'x', false), []);
});

test('positive control: an untagged invocation is counted', () => {
  const text = 'Midway through the run, call `AskUserQuestion` to check in.';
  const hits = untaggedInvocations(text, 'x', false);
  assert.equal(hits.length, 1);
});

test('positive control: an invocation inside a whole-file-exempt file is skipped regardless of tagging', () => {
  const text = 'call `AskUserQuestion` with no HARD-GATE nearby at all.';
  assert.deepEqual(untaggedInvocations(text, 'x', true), []);
});

test('flow/manifesto.md, flow/manifesto-confirm.md, wrap-up/review-console.md, and flow/multispec-review-console.md are wholesale-exempt (Manifesto / Review Console bookends)', () => {
  for (const f of [MANIFESTO, MANIFESTO_CONFIRM, REVIEW_CONSOLE, MULTISPEC_CONSOLE]) {
    assert.deepEqual(scanFile(f), [], `${path.relative(SKILLS, f)} must be treated as wholesale-exempt`);
  }
});

test('auto-mode /flow prose path has at most two AskUserQuestion decision points outside HARD-GATE/failure-card/Manifesto/Review Console', () => {
  // The two contracted bookends (Manifesto, Review Console) are the wholesale-exempt files
  // above — always present, always allowed, never counted against the budget. Anything found
  // by scanning the remaining, non-exempt surface (flow/SKILL.md) is a third, invented stop.
  const BASELINE_BOOKENDS = 2;
  const extra = FOUR_FILES.flatMap(scanFile);
  const total = BASELINE_BOOKENDS + extra.length;
  assert.ok(
    total <= 2,
    `found ${extra.length} untagged AskUserQuestion invocation(s) beyond the two contracted `
      + `bookends: ${extra.map((h) => `${h.file}:${h.line} (${h.snippet})`).join(', ')}`,
  );
});

test('proof: a third untagged AskUserQuestion block inserted into flow/SKILL.md is caught (goes red)', () => {
  const original = readText(FLOW_SKILL);
  const injected = `${original}\n\n## Step 9: Improvised mid-flow check\n\nBefore continuing, call `
    + '`AskUserQuestion` to confirm the plan looks right.\n';
  const hits = untaggedInvocations(injected, 'flow/SKILL.md (injected)', WHOLE_FILE_EXEMPT.has(FLOW_SKILL));
  assert.equal(hits.length, 1, 'the injected block must be counted as an untagged decision point');
  const totalWithInjection = 2 + hits.length;
  assert.ok(totalWithInjection > 2, 'the injected block must push the total over the two-stop budget');
});

test('proof: the same injected block, tagged HARD-GATE, is exempt (does not regress the budget)', () => {
  const original = readText(FLOW_SKILL);
  const injected = `${original}\n\n## Step 9: A real HARD-GATE\n\nThis is a HARD-GATE. Before continuing, call `
    + '`AskUserQuestion` to present the failure options.\n';
  const hits = untaggedInvocations(injected, 'flow/SKILL.md (injected, tagged)', WHOLE_FILE_EXEMPT.has(FLOW_SKILL));
  assert.deepEqual(hits, [], 'a genuinely HARD-GATE-tagged invocation must not be flagged');
});
