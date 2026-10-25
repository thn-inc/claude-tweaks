'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('../helpers/read-skill');
const { RULE_IDS } = require('../../plugin/bin/lib/hooks/guard-rewrite');

// #4028 AC3: the PreToolUse `updatedInput` vs worktree-isolation-guard probe outcome lives in
// docs/reference/pretooluse-updatedinput-worktree-guard.md. Every line below is copied from that doc,
// and each is pinned with a stripped-doc control (the same text with that line removed), so a line the
// check cannot miss is proven by the check going red without it.

const ROOT = path.join(__dirname, '..', '..');
const REF_PATH = 'docs/reference/pretooluse-updatedinput-worktree-guard.md';
const REF = readText(path.join(ROOT, REF_PATH));

const PINNED = [
  '- **Claude Code version:** 2.1.302',
  '- **Date measured:** 2026-10-24',
  '- **Setup (as recorded):** Claude Code 2.1.302, `claude -p -w`, model `haiku`, a scratch `PreToolUse` hook, 2026-10-24.',
  '- **(a) Applied before the guard:** `updatedInput` is applied **before** the isolation guard: a refused `echo complete PROBE_MARKER` rewritten to `echo REWRITTEN_BY_HOOK` ran.',
  '- **(b) The guard re-checks the rewritten command:** the guard re-checks the **rewritten** command: a plain `echo hello …` rewritten into `echo complete …` was refused.',
  '- **(c) No `permissionDecision`:** `updatedInput` applies with **no** `permissionDecision` field.',
  '- **Not recorded:** a separate no-hook control run. The "refused" in (a) is the guard\'s documented refusal of `echo complete` (`plugin/skills/_shared/scratch-worktree.md` §7, the `complete` row: "runs a string through complete, which can\'t be verified to stay inside the worktree").',
  '- The decision-log entry and the Probe 2 evidence files live in a pipeline run directory, which is ephemeral and gets archived. The quoted findings above are the durable record.',
  '- **Ordering:** a PreToolUse `updatedInput` is applied before the isolation guard, and the guard re-checks the rewritten command.',
  '- **Consequence:** a rewrite can normalize, never bypass. The plugin never emits `permissionDecision: \'allow\'` alongside a rewrite.',
  '- **Plugin probe (Task 8, 2026-10-24):** with the plugin, `P=/bin; $P/echo ok` and `node -e \'console.log(process.argv[1])\' "$HOME"` both ran, and no hook output carried a `permissionDecision`.',
  '- **Not measured:** interactive mode, how a prompt in a non-bypass permission mode evaluates the rewritten input, and other Claude Code versions.',
];

function hasLine(doc, line) {
  return doc.split(/\r?\n/).includes(line);
}

test('AC3.1: the probe outcome doc records each variant result, the version and the date', () => {
  assert.ok(PINNED.length >= 11, 'the pinned set must not shrink silently');
  for (const line of PINNED) {
    assert.ok(hasLine(REF, line), `${REF_PATH} lost the pinned line: ${line}`);
    const stripped = REF.split(/\r?\n/).filter((l) => l !== line).join('\n');
    assert.ok(!hasLine(stripped, line), `control did not strip: ${line}`);
    assert.throws(
      () => assert.ok(hasLine(stripped, line), 'missing'),
      /missing/,
      `the stripped-doc control must go red for: ${line}`,
    );
  }
});

test('AC3.1: the doc is found through CRLF line endings too', () => {
  const crlf = REF.replace(/\n/g, '\r\n');
  for (const line of PINNED) assert.ok(hasLine(crlf, line), `CRLF doc lost: ${line}`);
});

test('AC3.1: docs/hooks.md carries the measured ordering and the shipped doc points at the reference', () => {
  const hooks = readText(path.join(ROOT, 'docs', 'hooks.md'));
  const scratch = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'scratch-worktree.md'));
  const skillAuthoring = readText(path.join(ROOT, 'docs', 'skill-authoring.md'));
  assert.ok(!hooks.includes('nothing here can alter it'), 'docs/hooks.md still carries the pre-probe claim');
  assert.ok(!skillAuthoring.includes('cannot alter from `plugin/bin/hooks.js` or any hook'),
    'docs/skill-authoring.md still carries the pre-probe claim');
  for (const [name, doc] of [['docs/hooks.md', hooks], ['_shared/scratch-worktree.md', scratch], ['docs/skill-authoring.md', skillAuthoring]]) {
    assert.ok(doc.includes(REF_PATH), `${name} must cite ${REF_PATH}`);
    // control: the same doc with the citation removed must fail the same check
    assert.ok(!doc.split(REF_PATH).join('').includes(REF_PATH), `${name} control did not strip the citation`);
  }
  assert.ok(hooks.includes('guard-rewrite.js'), 'docs/hooks.md must name guard-rewrite.js');
});

test('AC3.1: the rule ids the prose lists are the rule ids the normalizer runs', () => {
  const hooks = readText(path.join(ROOT, 'docs', 'hooks.md'));
  // Derived from the code, not retyped: a sixth rule, or a rename, goes red here until the prose follows.
  assert.strictEqual(RULE_IDS.length, 5,
    'docs/hooks.md, the probe reference doc and scratch-worktree.md section 7 say "five shapes" — update them with the rule count');
  for (const id of RULE_IDS) {
    assert.ok(hooks.includes(id), `docs/hooks.md must name the rule id ${id}`);
    assert.ok(REF.includes(id), `${REF_PATH} must name the rule id ${id}`);
    // control: the same doc without the id must fail the same check
    assert.ok(!hooks.split(id).join('').includes(id), `control did not strip ${id}`);
  }
  assert.ok(RULE_IDS.length === new Set(RULE_IDS).size, 'rule ids are unique');
});
