'use strict';

// Pins plugin/skills/dispatch/task-prompt.md's per-call model profile (#3224, #3212):
// the FIRST Task call (build,test) runs on Capable, the SECOND (review,polish,wrap-up)
// stays on Standard. Standard-profile first calls bypassed /flow in 6 of 10 observed
// firings against 0 of 3 on Capable (#3212) — a flip back on either line goes red here.
// Live-file read, not a frozen fixture: the template IS the contract being enforced
// (skill-prose-conformance-tests' declared-contract carve-out).

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'task-prompt.md');
const FIRST_HEADING = '## First call — build,test';
const SECOND_HEADING = '## Second call — review,polish,wrap-up';

function read() {
  return readText(FILE);
}

function sections(text) {
  const a = text.indexOf(FIRST_HEADING);
  const b = text.indexOf(SECOND_HEADING);
  if (a === -1 || b === -1 || b < a) {
    throw new Error('task-prompt.md: first/second call headings not found in order');
  }
  return { contextPack: text.slice(0, a), first: text.slice(a, b), second: text.slice(b) };
}

// The first fenced block in a section — the operative template inlined verbatim into
// that call's Task() prompt.
function fencedBlock(section) {
  const m = section.match(/^```\n([\s\S]*?)^```$/m);
  if (!m) throw new Error('no fenced template block in section');
  return m[1];
}

function profileOf(block) {
  const use = [...block.matchAll(/\[Use: (\w+)\]/g)].map((m) => m[1]);
  const arg = [...block.matchAll(/node "\{plugin-root\}\/bin\/resolve-profile\.js" (\w+)/g)].map((m) => m[1]);
  return { use, arg };
}

// --- Proof the extractor can go red (synthetic fixture) ---

test('profileOf distinguishes a Standard template from a Capable one', () => {
  const standard = '[Use: Standard] -- x. Resolve via `node "{plugin-root}/bin/resolve-profile.js" standard`';
  const capable = '[Use: Capable] -- x. Resolve via `node "{plugin-root}/bin/resolve-profile.js" capable`';
  assert.deepStrictEqual(profileOf(standard), { use: ['Standard'], arg: ['standard'] });
  assert.deepStrictEqual(profileOf(capable), { use: ['Capable'], arg: ['capable'] });
});

// --- Live file ---

test('FIRST-call template resolves the Capable profile', () => {
  const block = fencedBlock(sections(read()).first);
  assert.deepStrictEqual(profileOf(block), { use: ['Capable'], arg: ['capable'] });
});

test('FIRST-call [Use: Capable] line carries its #3212 rationale on the same line', () => {
  const block = fencedBlock(sections(read()).first);
  const line = block.split('\n').find((l) => l.includes('[Use: Capable]'));
  assert.ok(line, 'no [Use: Capable] line in the first-call template');
  assert.match(line, /#3212/);
});

test('SECOND-call template stays on Standard, byte-identical', () => {
  const block = fencedBlock(sections(read()).second);
  assert.deepStrictEqual(profileOf(block), { use: ['Standard'], arg: ['standard'] });
  const pinned = [
    "[Use: Standard] -- this dispatch wraps review+polish+wrap-up execution, not analysis; the",
    "pipeline's own steps select their own models as usual. Resolve via",
    '`node "{plugin-root}/bin/resolve-profile.js" standard` (contract § Model Selection).',
  ].join('\n');
  assert.ok(block.includes(pinned), 'second-call model lines changed');
});

test('FIRST-call section names the model-ceiling clamp beside the template', () => {
  const { first } = sections(read());
  const block = fencedBlock(first);
  const afterFence = first.slice(first.indexOf(block) + block.length);
  const caveat = afterFence.slice(0, 1500);
  assert.match(caveat, /model-ceiling: standard/);
  assert.match(caveat, /`sonnet`/);
  assert.match(caveat, /plugin\/bin\/lib\/model-profiles\/profiles\.js/);
  assert.match(caveat, /source: 'ceiling'/);
});

test('Context pack instructs the dispatching session to log the resolved first-call model', () => {
  const { contextPack } = sections(read());
  const MARKER = "**Log each group's resolved first-call model";
  const start = contextPack.indexOf(MARKER);
  assert.ok(start !== -1, 'log-instruction paragraph start marker not found');
  const end = contextPack.indexOf('\n\n', start);
  const slice = contextPack.slice(start, end === -1 ? undefined : end);
  assert.ok(
    slice.includes(
      '`- AUTO {time} — Dispatch group {group}: first-call model resolved to {model} (source: {source}). Reversibility: n/a.`',
    ),
    'missing the per-group first-call model log line produced by log-decision.js',
  );
  assert.match(slice, /_shared\/auto-decision-log\.md/);
  // Logged only after the first call returns: a pre-dispatch line in the minted dir's
  // decisions.md would make /flow Step 3 classify it as case 3, not case 2
  // (bin/lib/flow/preflight.js + bin/lib/log-decision/claim-log.js's classifyDecisions).
  assert.match(slice, /after the first call returns/);
  assert.match(slice, /--reversibility n\/a/);
});

module.exports = { sections, fencedBlock, profileOf };
