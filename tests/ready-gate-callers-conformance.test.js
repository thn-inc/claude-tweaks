// tests/ready-gate-callers-conformance.test.js — #6374.
//
// Every prose path that adds `ready` to a record runs the ready-grant gate first, so a body that
// carries a symbolic `Blocked by: … (left for owner/name)` line, an Open Questions section or a
// missing spec section never gets `ready` back from a prose step that restated only part of the
// check. Each region's facts are a fact list, proven red on its own with the shared helpers.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { scratchDir } = require('./helpers/tmp-dir');
const { SYMBOLIC_LINE, symbolicBody } = require('./helpers/symbolic-blocker-fixture');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');
const { sessionTmpPath } = require('../plugin/bin/lib/session-tmp');

const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin');
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
    [/A bare-drain shape that gets exit 1 still adds `--add-label "shaped:headless"`, as a held record does, so the record is left without `ready` but stamped/, 'a bare-drain exit 1 keeps the shaped:headless stamp'],
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
    [/on exit 2 the write-back fails for that issue, which Step 9's report names with its number/, 'exit 2 fails the write-back and is named in Step 9'],
    [/an issue this check keeps without `ready` is named in Step 9's summary with its number and the reason\. The reason is the printed `reasons`/, 'exit 1 keeps ready off and names the reasons in Step 9'],
  ]],
  ['decomposition-mode-closeout Step 9 readyRestorable', region(CLOSE, 'Exit 3 means the text is not in the body'), [
    [/`"readyRestorable":true`, the ready-grant gate's verdict \(`readyGate`, the gate `bin\/ready-gate\.js` runs\)/, 'readyRestorable is named as the ready-grant gate verdict'],
    [/no `## Open Questions` heading is left, and no `Blocked by: … \(left for …\)` line remains/, 'the gate keeps its three named conditions'],
  ]],
  ['decomposition-mode-closeout Step 9 summary', region(CLOSE, '**Under the approved branch**'), [
    [/each issue whose `ready` Step 4 kept off \(`\{owner\/name\}#\{n\} — ready stays off: \{each of the gate's printed `reasons`\} remains`\)/, 'a kept-off issue is named with the gate\'s printed reasons'],
    [/each issue whose write-back failed on `ready-gate\.js` exit 2 \(`\{owner\/name\}#\{n\} — write-back failed: "\{the gate's stderr line\}"`\)/, 'an exit-2 write-back failure is named with its number and the quoted stderr line'],
  ]],
  ['record-creation-subissues local-files create', region(SUB, '**`work-backend: local-files`** — use `createRecord`'), [
    [/`stage: 'ready'` \(only on `ready-gate\.js` exit 0, above\)/, 'the local-files create paragraph conditions stage ready on the gate'],
  ]],
  ['shaping-mode-stamping local-files write', region(STAMPING, '**`work-backend: local-files`:** write'), [
    [/setting `facets.stage: 'ready'` \(only on `ready-gate\.js` exit 0, above;/, 'the local-files write conditions stage ready on the gate'],
  ]],
  ['record-creation-subissues symbolic blocker', region(SUB, '**No `ready` on a symbolic blocker.**'), [
    [/`recordPayload` withholds `ready` from a body that carries such a line and returns `readyWithheld`, and `compose-record\.js` prints one `Warning: ready withheld` line, so under `github-issues` a missed drop still files the sub-issue without `ready`/, 'recordPayload withholds ready and compose-record warns, scoped to github-issues'],
    [/Under `local-files`, `createRecord` never goes through `recordPayload`: run `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ready-gate\.js" "\$SPECIFY_SUB_ISSUE_BODY"` and set `stage: 'ready'` only on exit 0/, 'local-files sub-issue stage ready only on gate exit 0'],
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

// The pre-fix Step 9 alternatives and the pre-fix repetition (4eff44164c): frozen controls so each
// absence check below is shown to match the text it bans.
const OLD_STEP9_ALTERNATIVES = '`{owner/name}#{n} — ready stays off: {an ambiguity marker | an Open Questions heading | another left-for line} remains`';
const OLD_LOCAL_STAGE_REPEAT = "pass `ready: false` in its payload; under `local-files`, leave `stage: 'ready'` out of its facets.";

test('Step 9 names the gate\'s printed reasons, not a fixed list of three', () => {
  const step9 = region(CLOSE, '**Under the approved branch**');
  const alternatives = /\{an ambiguity marker \| an Open Questions heading \| another left-for line\}/;
  assert.equal(alternatives.test(step9), false, 'the fixed alternatives have no slot for a missing spec section');
  assert.equal(alternatives.test(OLD_STEP9_ALTERNATIVES), true, 'control: the old alternatives are matched');
});

test('record-creation-subissues states the local-files ready rule once', () => {
  const para = region(SUB, '**No `ready` on a symbolic blocker.**');
  const repeat = /under `local-files`, leave `stage: 'ready'` out of its facets/;
  assert.equal(repeat.test(para), false, 'the trailing clause repeats the gate sentence earlier in the paragraph');
  assert.equal(repeat.test(OLD_LOCAL_STAGE_REPEAT), true, 'control: the old clause is matched');
  assert.equal(para.split("`stage: 'ready'`").length - 1, 1, 'the paragraph names the ready stage once');
});

// The local-files createRecord fence takes `stage` from the gate's exit code. Pinned byte-wise, then run.
const FENCE = /```bash\n([\s\S]*?)```/;
function createFence(text) {
  const at = text.indexOf('**`work-backend: local-files`** — use `createRecord`');
  assert.notEqual(at, -1, 'the local-files createRecord paragraph is missing');
  const m = FENCE.exec(text.slice(at));
  assert.ok(m, 'no bash fence follows the local-files createRecord paragraph');
  return m[1];
}
const FENCE_FACTS = [
  [/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ready-gate\.js" "\$SPECIFY_SUB_ISSUE_BODY" SUB_ISSUE_GATE=\$\?/, 'the fence runs ready-gate.js on the body file and keeps its exit code'],
  [/if \(process\.argv\[8\] === '2'\) throw new Error\('ready-gate\.js exited 2: the create fails'\);/, 'gate exit 2 fails the create'],
  [/\.\.\.\(process\.argv\[8\] === '0' \? \{ stage: 'ready' \} : \{\}\)/, 'the ready stage joins the facets only on gate exit 0'],
  [/"\$SPECIFY_SUB_ISSUE_BODY" "\$SUB_ISSUE_GATE"\)/, 'the exit code is passed to the create as argv'],
];
const OLD_FENCE_FACETS = "facets: { type: process.argv[3], risk: process.argv[4], size: process.argv[5], ceremony: process.argv[6], stage: 'ready' }";

test('the local-files createRecord fence takes stage from the gate exit code (byte pins)', () => {
  const fence = collapse(createFence(SUB));
  const missing = missingFactsOf(FENCE_FACTS);
  assert.deepEqual(missing(fence), []);
  assertEachPatternGoesRed(fence, FENCE_FACTS, missing);
  const unconditional = /ceremony: process\.argv\[6\], stage: 'ready' \}/;
  assert.equal(unconditional.test(fence), false, 'an ungated stage ready is back in the facets');
  assert.equal(unconditional.test(collapse(OLD_FENCE_FACETS)), true, 'control: the old facets are matched');
});

const SKIP_RUN = process.platform === 'win32' ? 'bash fence' : false;
function runFence(body) {
  const dir = scratchDir('ready-gate-fence-');
  const sessionId = 'ready-gate-fence-test';
  const bodyPath = sessionTmpPath(sessionId, 'specify-sub-issue-body.md', { tmpdir: dir });
  if (body !== null) fs.writeFileSync(bodyPath, body);
  fs.writeFileSync(path.join(dir, 'fingerprints.json'), '{}');
  const env = {
    ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, CLAUDE_CODE_SESSION_ID: sessionId,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, DESIGN_DOC_SLUG: 'doc', UNIT_SLUG: 'unit-a', SUB_ISSUE_TITLE: 'Unit A',
    SUB_ISSUE_TYPE: 'task', SUB_ISSUE_RISK: 'low', SUB_ISSUE_SIZE: 'small', SUB_ISSUE_CEREMONY: 'standard',
    SPECIFY_SUB_ISSUE_EXISTING: '', SPECIFY_EXISTING_FINGERPRINTS: path.join(dir, 'fingerprints.json'),
  };
  const r = spawnSync('bash', ['-c', createFence(SUB)], { cwd: dir, env, encoding: 'utf8' });
  const specs = path.join(dir, 'specs');
  const files = fs.existsSync(specs) ? fs.readdirSync(specs).filter((f) => f.endsWith('.md')) : [];
  return { r, files, text: files.map((f) => fs.readFileSync(path.join(specs, f), 'utf8')).join('\n') };
}

test('run: the fence files a ready stage only when the gate exits 0', { skip: SKIP_RUN }, () => {
  const ok = runFence(symbolicBody().replace(SYMBOLIC_LINE, 'Blocked by thn-inc/other#7004'));
  assert.equal(ok.files.length, 1, ok.r.stderr);
  assert.match(ok.text, /stage: ready/, 'gate exit 0 files the ready stage');

  const held = runFence(symbolicBody());
  assert.equal(held.files.length, 1, held.r.stderr);
  assert.doesNotMatch(held.text, /stage: ready/, 'gate exit 1 files the record without the ready stage');
  assert.match(held.r.stdout, /symbolic-blocker: /, 'the gate prints its reasons');

  const broken = runFence(null);
  assert.equal(broken.files.length, 0, 'gate exit 2 creates nothing');
  assert.match(broken.r.stderr, /ready-gate\.js exited 2: the create fails/);
});
