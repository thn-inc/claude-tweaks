// tests/ready-gate-callers-conformance.test.js — #6374.
//
// Every prose path that adds `ready` to a record runs the ready-grant gate first, so a body that
// carries a symbolic `Blocked by: … (left for owner/name)` line, an Open Questions section or a
// missing spec section never gets `ready` back from a prose step that restated only part of the
// check. Each region's facts are a fact list, proven red on its own with the shared helpers.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');

const SPECIFY_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'specify');
const collapse = (text) => text.replace(/\s+/g, ' ');
const STAMPING = readText(path.join(SPECIFY_DIR, 'shaping-mode-stamping.md'));
const ANSWER = readText(path.join(SPECIFY_DIR, 'planning-answer.md'));
const CLOSE = readText(path.join(SPECIFY_DIR, 'decomposition-mode-closeout.md'));
const SUB = readText(path.join(SPECIFY_DIR, 'record-creation-subissues.md'));

const region = (text, prefix) => {
  const line = lineStartingWith(text, prefix);
  assert.notEqual(line, '', `no line starts with ${JSON.stringify(prefix)} -- the region anchor is out of sync with the live file`);
  return collapse(line);
};

const REGIONS = [
  ['shaping-mode-stamping write', region(STAMPING, '**Ready gate (#6374).**'), [
    [/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ready-gate\.js" "\$SPECIFY_SHAPED_BODY"`/, 'it runs ready-gate.js on the shaped body file'],
    [/After `compose-record\.js --check` passes and before the `gh issue edit`/, 'it runs after the check and before the write'],
    [/Exit 1 drops `--add-label ready` from that call \(and adds `--remove-label ready` when the record carries it\)/, 'exit 1 drops the ready add and removes a carried ready'],
    [/names the printed `reasons` in the run's summary/, 'exit 1 names the printed reasons in the summary'],
    [/Exit 2 stops/, 'exit 2 stops'],
    [/The `gh`-absent write and the `local-files` `writeRecord` follow the same rule \(`facets\.stage` stays out of the facets on exit 1\)/, 'the gh-absent and local-files variants follow the same rule'],
  ]],
  ['planning-answer (d)', region(ANSWER, '- **(d) Ready.**'), [
    [/--add-label ready/, 'the region holds the write that adds ready'],
    [/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ready-gate\.js" "\{body\}"` exits 0/, 'it adds ready only when ready-gate.js exits 0 on the body'],
    [/on exit 1 add nothing and name the printed `reasons` in the outcome/, 'exit 1 adds nothing and names the reasons in the outcome'],
  ]],
  ['decomposition-mode-closeout Step 4 write-back', region(CLOSE, "**Approved parts list (Step 2's approved branch) — write back"), [
    [/--add-label ready/, 'the region holds the write that adds ready'],
    [/add `ready` back only when `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ready-gate\.js"` exits 0 on the composed body/, 'ready comes back only when ready-gate.js exits 0 on the composed body'],
    [/an issue this check keeps without `ready` is named in Step 9's summary with its number and the reason\. The reason is the printed `reasons`/, 'exit 1 keeps ready off and names the reasons in Step 9'],
  ]],
  ['decomposition-mode-closeout Step 9 readyRestorable', region(CLOSE, 'Exit 3 means the text is not in the body'), [
    [/`"readyRestorable":true`, the ready-grant gate's verdict \(`readyGate`, the gate `bin\/ready-gate\.js` runs\)/, 'readyRestorable is named as the ready-grant gate verdict'],
    [/no `## Open Questions` heading is left, and no `Blocked by: … \(left for …\)` line remains/, 'the gate keeps its three named conditions'],
  ]],
  ['record-creation-subissues symbolic blocker', region(SUB, '**No `ready` on a symbolic blocker.**'), [
    [/`recordPayload` withholds `ready` from a body that carries such a line and returns `readyWithheld`, and `compose-record\.js` prints one `Warning: ready withheld` line, so a missed drop still files the sub-issue without `ready`/, 'recordPayload withholds ready and compose-record warns'],
    [/the line names no issue and no resolvable state, so `ready` stays off until a later run rewrites it to `owner\/name#N`/, 'the lasting reason ready stays off'],
  ]],
];

test('AC5.1: every prose path that adds ready runs ready-gate.js', () => {
  for (const [name, text, facts] of REGIONS) {
    const missing = missingFactsOf(facts);
    assert.deepEqual(missing(text), [], `${name} states every fact`);
    assertEachPatternGoesRed(text, facts, missing);
  }
});

test('no prose still says a blocker surface cannot read the symbolic line', () => {
  const stale = /No blocker surface reads|no blocker surface reads that line/;
  const DECOMP = readText(path.join(SPECIFY_DIR, 'decomposition-mode.md'));
  assert.equal(stale.test(SUB), false, 'record-creation-subissues.md');
  assert.equal(stale.test(DECOMP), false, 'decomposition-mode.md');
  assert.equal(stale.test('No blocker surface reads a `symbolic` line'), true, 'control: the stale phrase is matched');
});
