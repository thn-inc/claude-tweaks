// tests/specify-staged-for-caller.test.js
// Pins the #2699/#2700/#2703 bundle's prose: the delegated decomposition's
// `### Staged for caller` return channel and its resolve-ambiguity.js
// procedure, the delegate-or-continue decision placed before either branch's
// files, and the strangler-fig blast-radius qualifier.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const read = (rel) => readText(path.join(__dirname, '..', rel));
const CLOSEOUT = read('plugin/skills/specify/decomposition-mode-closeout.md');
const HANDOFF = read('plugin/skills/specify/mechanical-handoff.md');
const DECOMPOSITION = read('plugin/skills/specify/decomposition-mode.md');

test('Step 9 template and the handoff OUTPUT FORMAT both carry the Staged for caller section (#2699)', () => {
  assert.match(CLOSEOUT, /### Staged for caller/);
  assert.match(HANDOFF, /### Staged for caller/);
});

test('the resolve procedure passes record text by file, never inside shell quotes (#2699 review)', () => {
  assert.match(CLOSEOUT, /resolve-ambiguity\.js" "\$RA_BODY" --marker-file "\$RA_MARKER" --resolution-file "\$RA_RESOLUTION"/);
  assert.doesNotMatch(CLOSEOUT, /--marker "\{/);
  assert.doesNotMatch(CLOSEOUT, /\/tmp\/body-/);
});

test('every fence that uses the $RA_* paths resolves them itself — shell variables do not survive between Bash calls (#2699 review)', () => {
  const fences = CLOSEOUT.match(/```bash\r?\n[\s\S]*?```/g).filter((f) => f.includes('$RA_'));
  assert.ok(fences.length >= 2, 'the fetch and apply fences both use $RA_* paths');
  for (const fence of fences) assert.match(fence, /eval "\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/session-tmp-resolve\.js" RA_BODY=/);
});

test('the write-back only runs when the CLI succeeds, and exit 3 is documented (#2699 review)', () => {
  assert.match(CLOSEOUT, /--out "\$RA_OUT" && gh issue edit \{n\} --body-file "\$RA_OUT"/);
  assert.match(CLOSEOUT, /Exit 3 means the text is not in the body, or occurs more than once/);
});

test('the delegated no-run-dir fallback leaves plain interactive /specify asking per red-team.md (#2699 review)', () => {
  assert.match(CLOSEOUT, /Plain interactive `\/specify` is unaffected: it still asks per `red-team\.md`/);
});

test('the delegate-or-continue decision precedes the continuing branch\'s pointer (#2700)', () => {
  const decision = DECOMPOSITION.indexOf('## Delegate-or-continue decision');
  const cont = DECOMPOSITION.indexOf('Continue at Step 3 in `decomposition-mode-closeout.md`');
  assert.ok(decision !== -1 && cont !== -1, 'both anchors present');
  assert.ok(decision < cont, 'decision comes before the continue pointer');
  assert.match(DECOMPOSITION.slice(decision, cont), /Do \*\*not\*\* open `decomposition-mode-closeout\.md`/);
});

test('the strangler-fig check carries the blast-radius qualifier (#2703)', () => {
  assert.match(DECOMPOSITION, /\*\*Blast-radius qualifier \(#2703\)\.\*\*/);
  assert.match(DECOMPOSITION, /an unclear\/ambiguous doc still falls to the mandate below/);
});
