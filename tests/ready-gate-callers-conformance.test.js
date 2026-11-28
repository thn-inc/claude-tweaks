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
    [/on exit 1 add nothing \(the read-back expects `ready` absent then, and its outcome names the gate's `reasons`\)/, 'exit 1 adds nothing; the read-back expects ready absent and names the reasons'],
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
  ['record-creation-subissues github-issues create', region(SUB, '**`work-backend: github-issues`** — same Type expression branch'), [
    [/The `--label` flags below are that set, with `ready` added only on `ready-gate\.js` exit 0 \(the fence's `SUB_ISSUE_READY` array\)/, 'the github-issues flags carry ready only on gate exit 0'],
  ]],
  ['record-creation-subissues no-number unit', region(SUB, '**A unit with no record number is not accumulated.**'), [
    [/A unit whose create failed on `ready-gate\.js\` exit 2 has no \`\$SUB_ISSUE_NUM\`\/\`\$SUB_ISSUE_ID\`, under either backend, and is not accumulated/, 'a unit with no number is not accumulated, under either backend'],
    [/Report it as a failed create with the gate's stderr verbatim and continue with the next unit, as a \`classify\`, \`settle\` or \`confirm\` that exits non-zero is reported/, 'it is reported as a failed create with stderr verbatim and the loop continues'],
  ]],
  ['record-creation-subissues symbolic blocker', region(SUB, '**No `ready` on a symbolic blocker.**'), [
    [/`recordPayload` withholds `ready` from a body that carries such a line and `compose-record\.js` prints one `Warning: ready withheld` line, but neither create call below reads that payload's printed `labels`/, 'the payload withhold exists, and neither create reads its labels'],
    [/each runs `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ready-gate\.js" "\$SPECIFY_SUB_ISSUE_BODY"` and adds `ready` \(the `--label ready` flag under `github-issues`, `stage: 'ready'` under `local-files`\) only on exit 0/, 'both creates add ready only on gate exit 0'],
    [/on exit 1 it files the sub-issue without `ready` and names the printed `reasons` in the run's summary, on exit 2 the create fails and files nothing/, 'exit 1 files without ready and names the reasons, exit 2 files nothing'],
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

// The born-ready paths that compose with recordPayload({ ..., ready: true }) and file without a
// ready-gate.js call are covered only while the create applies the payload's labels. Each region's
// facts go red when that application is removed; the absence test goes red when a typed ready
// label returns (rule 7 of .claude/skills/blocker-surface-parity).
const SKILLS_DIR = path.join(PLUGIN_ROOT, 'skills');
const CAPTURE = readText(path.join(SKILLS_DIR, 'capture', 'SKILL.md'));
const REVIEW_ROUTING = readText(path.join(SKILLS_DIR, 'review', 'step3-routing.md'));
const REFLECT = readText(path.join(SKILLS_DIR, 'reflect', 'full-mode.md'));
const LEFTOVER = readText(path.join(SKILLS_DIR, 'wrap-up', 'leftover-routing.md'));
const PARITY = readText(path.join(__dirname, '..', '.claude', 'skills', 'blocker-surface-parity', 'SKILL.md'));

const BORN_READY_PATHS = [
  ['capture shaped branch create', region(CAPTURE, '3. **Score, judge ceremony, and file born-ready.**'), [
    [/`recordPayload\(\{ …, origin: 'capture', risk, size, ready: true, deferReason \}\)`/, 'the shaped branch composes a born-ready payload'],
    [/The create call applies every label in the `labels` that `compose-record\.js` prints, in place of its typed `--label by:capture`/, 'the create applies the printed labels in place of the typed origin label'],
    [/`ready` unless `recordPayload` withheld it for a symbolic `Blocked by: … \(left for …\)` line/, 'the printed labels carry ready only when recordPayload did not withhold it'],
    [/never types a `ready` label by hand/, 'ready is never typed by hand'],
  ]],
  ['review Step 3 Defer create', region(REVIEW_ROUTING, '- **Defer** (new work record'), [
    [/`recordPayload\(\{ …, risk, size, ready: true \}\)`/, 'the Defer composes a born-ready payload'],
    [/the create applies every label in `payload\.labels`, so `recordPayload`'s ready withhold decides and no `ready` label is ever typed by hand/, 'the create applies payload.labels so the withhold decides'],
  ]],
  ['reflect Defer is parked, not ready', region(REFLECT, '- **Defer** (new work record, `parked`)'), [
    [/`recordPayload\(\{ …, type: 'task', risk, size, parked: true \}\)`/, 'the Defer passes parked: true'],
  ]],
  ['wrap-up leftover staging', collapse(LEFTOVER), [
    [/Labels: ' \+ \(\(p\.labels\.concat\(process\.argv\[3\]==='true'\?\['needs:definition'\]:\[\]\)\.join\(', '\)\) \|\| 'none'\)/, 'the staged Labels: header is the payload labels plus needs:definition'],
    [/the record is created via: `gh issue create` \(`work-backend: github-issues`\) or `local-store\.js`'s `writeRecord` \(`work-backend: local-files`\), reading the `Title:`\/`Type:`\/`Labels:` header and the body back out of the staged file/, 'the console creates from the staged Labels: header'],
  ]],
  ['blocker-surface-parity rule 7 grep', region(PARITY, '7. **The symbolic blocker is held'), [
    [/-e LABELS\.READY -e "stage: 'ready'" -- plugin/, 'the enumeration grep names the constant and the local-files stage forms'],
    [/-e "add-label ready" -e "label ready" -e readyRestorable -e "ready: true"/, 'the enumeration grep keeps the typed-label and payload forms'],
  ]],
];

test('every born-ready path without a ready-gate.js call applies the payload labels', () => {
  for (const [name, text, facts] of BORN_READY_PATHS) {
    const missing = missingFactsOf(facts);
    assert.deepEqual(missing(text), [], `${name} states every fact`);
    assertEachPatternGoesRed(text, facts, missing);
  }
});

test('no born-ready path types a ready label by hand', () => {
  const typedReady = /--(?:add-)?label[= "]+ready\b/;
  for (const [name, text] of BORN_READY_PATHS.slice(0, 4)) {
    assert.equal(typedReady.test(text), false, `${name} types a ready label`);
  }
  assert.equal(typedReady.test('gh issue create --label by:capture --label ready'), true, 'control: a typed --label ready is matched');
  assert.equal(typedReady.test('gh issue edit 1 --add-label "ready"'), true, 'control: a typed --add-label ready is matched');
});

// Rule 7's enumeration, run as a test. The terms are read out of the rule's own `git grep` line,
// so the rule and this roster cannot name different sets. Each file the terms match under plugin/
// must sit in READY_PATH_ROSTER with its classification, and each roster entry must still match,
// so a new ready path fails here until someone classifies it in rule 7 and below. The review of
// #6374 found three ready paths (bundle.js, capture's shaped create, review's Defer create) that
// the hand-listed regions above had missed. The match is raw text, as `git grep` reads it, so a
// term inside a comment counts. Recall limit: a spelling the terms do not name (`LABELS['READY']`,
// a `ready` label built from a variable) is not seen.
const READY_PATH_ROSTER = {
  'bin/lib/ci-audit/issue-payload.js': 'covered by recordPayload: passes ready: true',
  'bin/lib/code-health/issue-payload.js': 'covered by recordPayload: passes ready: true',
  'bin/lib/docs-health/issue-payload.js': 'covered by recordPayload: passes ready: true',
  'bin/lib/harness-health/issue-payload.js': 'covered by recordPayload: passes ready: true',
  'bin/lib/journey-health/issue-payload.js': 'covered by recordPayload: passes ready: true',
  'bin/lib/console/bundle.js': 'gated in code: composeBundle withholds ready for a symbolic member',
  'bin/lib/issues/record-payload.js': 'defines the gate: withholds ready',
  'bin/lib/issues/ambiguity-resolve.js': 'defines the gate: readyRestorable',
  'bin/resolve-ambiguity.js': 'reports the gate: prints readyRestorable',
  'bin/lib/issues/build-authority.js': 'not a ready path: reads the label',
  'bin/lib/issues/record-vocabulary.js': 'not a ready path: names the label',
  'bin/lib/station-events/stations.js': 'not a ready path: names the label',
  'bin/lib/issues/link.js': 'not a ready path: already: true is a link result',
  'bin/lib/issues/pending-authorization.js': 'not a ready path: a comment names a --label ready list',
  'skills/_shared/github-pr-scan-triage.md': 'not a ready path: gh issue list --label ready',
  'skills/_shared/record-queue-fetch.md': 'not a ready path: a --label ready filtered fetch',
  'skills/_shared/ledger-format.md': 'covered by staged Labels: header (Keep row)',
  'skills/backlog/attention-mode.md': 'not a ready path: gh issue list --label ready',
  'skills/backlog/refine-mode.md': 'not a ready path: lists and clears the label',
  'skills/backlog/refine-record.md': 'not a ready path: clears the label',
  'skills/help/status-scan.md': "not a ready path: queries stage: 'ready'",
  'skills/capture/SKILL.md': 'covered: applies the labels compose-record.js prints (BORN_READY_PATHS)',
  'skills/review/step3-routing.md': 'covered: applies payload.labels (BORN_READY_PATHS)',
  'skills/wrap-up/leftover-routing.md': 'covered by staged Labels: header (BORN_READY_PATHS)',
  'skills/specify/shaping-mode-stamping.md': 'gated by ready-gate.js (AC5.1)',
  'skills/specify/planning-answer.md': 'gated by ready-gate.js (AC5.1)',
  'skills/specify/decomposition-mode-closeout.md': 'gated by ready-gate.js and readyRestorable (AC5.1)',
  'skills/specify/record-creation-subissues.md': 'gated by ready-gate.js (AC5.1)',
  'skills/specify/next-mode-shape.md': "not a ready path: names shaping-mode-stamping's gated call",
  'skills/specify/planning.md': 'not a ready path: omits or clears the label',
  'skills/specify/red-team.md': 'not a ready path: clears the label; the restore cites readyRestorable',
  'skills/specify/record-creation-linking.md': 'not a ready path: already: true is a link result',
};

function rule7Terms(parity) {
  const cmd = /git grep -n -l ((?:-e (?:"[^"]*"|\S+) )+)-- plugin/.exec(parity);
  assert.ok(cmd, "rule 7's `git grep -n -l -e … -- plugin` line is not found -- the parser is out of sync with the rule");
  return [...cmd[1].matchAll(/-e ("[^"]*"|\S+)/g)].map((m) => m[1].replace(/^"|"$/g, ''));
}

function listPluginText(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) listPluginText(abs, out);
    else if (/\.(?:js|md)$/.test(ent.name)) out.push(abs);
  }
  return out;
}

function rosterDrift(texts, terms, roster) {
  const hits = Object.keys(texts).filter((rel) => terms.some((t) => texts[rel].includes(t))).sort();
  return {
    unclassified: hits.filter((rel) => !(rel in roster)),
    stale: Object.keys(roster).filter((rel) => !hits.includes(rel)).sort(),
  };
}

test("every file rule 7's grep finds is classified, and every classified file still matches", () => {
  const terms = rule7Terms(PARITY);
  assert.deepEqual(terms, ['add-label ready', 'label ready', 'readyRestorable', 'ready: true', 'LABELS.READY', "stage: 'ready'"]);
  const files = listPluginText(PLUGIN_ROOT);
  assert.ok(files.length > 500, `walked ${files.length} plugin files -- a short walk means the tree walk broke, not that files went away`);
  const texts = Object.fromEntries(files.map((abs) => [path.relative(PLUGIN_ROOT, abs).split(path.sep).join('/'), readText(abs)]));
  assert.deepEqual(rosterDrift(texts, terms, READY_PATH_ROSTER), { unclassified: [], stale: [] });
  // Go red: a new file that adds ready, and a roster entry whose file no longer matches.
  const planted = { ...texts, 'skills/new/SKILL.md': 'gh issue edit 1 --add-label ready' };
  assert.deepEqual(rosterDrift(planted, terms, READY_PATH_ROSTER).unclassified, ['skills/new/SKILL.md']);
  const dropped = { ...texts, 'bin/lib/console/bundle.js': 'module.exports = {};' };
  assert.deepEqual(rosterDrift(dropped, terms, READY_PATH_ROSTER).stale, ['bin/lib/console/bundle.js']);
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

// The github-issues create fence takes the `ready` label from the gate's exit code. Same shape as above.
function ghCreateFence(text) {
  const at = text.indexOf('**`work-backend: github-issues`** — same Type expression branch');
  assert.notEqual(at, -1, 'the github-issues create paragraph is missing');
  const m = FENCE.exec(text.slice(at));
  assert.ok(m, 'no bash fence follows the github-issues create paragraph');
  return m[1];
}
const GH_FENCE_FACTS = [
  [/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ready-gate\.js" "\$SPECIFY_SUB_ISSUE_BODY" SUB_ISSUE_GATE=\$\?/, 'the fence runs ready-gate.js on the body file and keeps its exit code'],
  [/if \[ "\$SUB_ISSUE_GATE" = "2" \]; then SUB_ISSUE_NUM="" echo "ready-gate\.js exited 2: the create fails" >&2 else/, 'gate exit 2 clears the number, says so, and skips the create'],
  [/SUB_ISSUE_READY=\(\) if \[ "\$SUB_ISSUE_GATE" = "0" \]; then SUB_ISSUE_READY=\(--label ready\); fi/, 'the ready flag is set only on gate exit 0'],
  [/--label "ceremony:\$SUB_ISSUE_CEREMONY" "\$\{SUB_ISSUE_READY\[@\]\}"\)/, 'the work-types: native create passes the gated flag'],
  [/--label "ceremony:\$SUB_ISSUE_CEREMONY" "\$\{SUB_ISSUE_READY\[@\]\}" \\ --label "type:\$SUB_ISSUE_TYPE"\)/, 'the work-types: labels create passes the gated flag'],
];
const OLD_GH_CREATE = '--label "risk:$SUB_ISSUE_RISK" --label "size:$SUB_ISSUE_SIZE" --label "ceremony:$SUB_ISSUE_CEREMONY" --label ready)';
test('the github-issues create fence takes the ready label from the gate exit code (byte pins)', () => {
  const fence = collapse(ghCreateFence(SUB));
  const missing = missingFactsOf(GH_FENCE_FACTS);
  assert.deepEqual(missing(fence), []);
  assertEachPatternGoesRed(fence, GH_FENCE_FACTS, missing);
  const unconditional = /"ceremony:\$SUB_ISSUE_CEREMONY" --label ready/;
  assert.equal(unconditional.test(fence), false, 'a hard-coded --label ready is back in a create call');
  assert.equal(unconditional.test(collapse(OLD_GH_CREATE)), true, 'control: the old create call is matched');
  assert.equal(fence.split('gh issue create').length - 1, 2, 'one create call per work-types branch');
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
  return { r, files, text: files.map((f) => fs.readFileSync(path.join(specs, f), 'utf8')).join('\n'), fingerprints: JSON.parse(fs.readFileSync(path.join(dir, 'fingerprints.json'), 'utf8')) };
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
  assert.deepEqual(broken.fingerprints, {}, 'a create that did not happen records no fingerprint');
  assert.doesNotMatch(broken.r.stderr, /recordFingerprint/, 'and does not try to: no TypeError for a record number that is not a positive integer');
});

// The github-issues fence run under bash with a fake `gh` on PATH that logs each call's arguments.
// The fence holds both work-types alternatives (the reader keeps one), so a run keeps one.
const NATIVE_CALL = /^ *# work-types: native\n[\s\S]*?\n\n/m;
const LABELS_CALL = /^ *# work-types: labels\n[\s\S]*?\n\n/m;
function ghVariant(fence, workTypes) {
  const out = fence.replace(workTypes === 'native' ? LABELS_CALL : NATIVE_CALL, '');
  assert.notEqual(out, fence, `the ${workTypes} variant drops the other branch's create call`);
  return out;
}
function runGhFence(body, workTypes) {
  const dir = scratchDir('ready-gate-gh-fence-');
  const sessionId = 'ready-gate-gh-fence-test';
  const bodyPath = sessionTmpPath(sessionId, 'specify-sub-issue-body.md', { tmpdir: dir });
  if (body !== null) fs.writeFileSync(bodyPath, body);
  const fingerprints = path.join(dir, 'fingerprints.json');
  fs.writeFileSync(fingerprints, '{}');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'gh.log');
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a" >> "$GH_LOG"; done\nprintf \'%s\\n\' "--end-of-call" >> "$GH_LOG"\necho https://github.com/o/r/issues/42\n', { mode: 0o755 });
  const env = {
    ...process.env, PATH: bin + path.delimiter + process.env.PATH, GH_LOG: log, TMPDIR: dir, TMP: dir, TEMP: dir, CLAUDE_CODE_SESSION_ID: sessionId,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, DESIGN_DOC_SLUG: 'doc', UNIT_SLUG: 'unit-a', SUB_ISSUE_TITLE: 'Unit A',
    SUB_ISSUE_TYPE: 'task', SUB_ISSUE_RISK: 'low', SUB_ISSUE_SIZE: 'small', SUB_ISSUE_CEREMONY: 'standard',
    SPECIFY_SUB_ISSUE_EXISTING: '', SPECIFY_EXISTING_FINGERPRINTS: fingerprints, SUB_ISSUE_NUM: 'stale-from-the-previous-unit',
  };
  const script = ghVariant(ghCreateFence(SUB), workTypes) + '\necho "NUM=[$SUB_ISSUE_NUM]"\n';
  const r = spawnSync('bash', ['-c', script], { cwd: dir, env, encoding: 'utf8' });
  const calls = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('--end-of-call\n').filter(Boolean).map((c) => c.split('\n').filter(Boolean))
    : [];
  return { r, calls, fingerprints: JSON.parse(fs.readFileSync(fingerprints, 'utf8')) };
}
const hasLabel = (args, value) => args.some((a, i) => a === '--label' && args[i + 1] === value);

for (const workTypes of ['native', 'labels']) {
  test(`run: the github-issues fence (work-types: ${workTypes}) files the ready label only when the gate exits 0`, { skip: SKIP_RUN }, () => {
    const ok = runGhFence(symbolicBody().replace(SYMBOLIC_LINE, 'Blocked by thn-inc/other#7004'), workTypes);
    assert.equal(ok.calls.length, 1, ok.r.stderr);
    assert.equal(hasLabel(ok.calls[0], 'ready'), true, 'gate exit 0 files the ready label');
    assert.equal(hasLabel(ok.calls[0], 'ceremony:standard'), true, 'the scoring labels are untouched');
    assert.match(ok.r.stdout, /NUM=\[42\]/);
    assert.deepEqual(ok.fingerprints, { 'doc:unit-a': 42 }, 'the created number is recorded');

    const held = runGhFence(symbolicBody(), workTypes);
    assert.equal(held.calls.length, 1, held.r.stderr);
    assert.equal(hasLabel(held.calls[0], 'ready'), false, 'gate exit 1 files the sub-issue without the ready label');
    assert.equal(hasLabel(held.calls[0], 'risk:low'), true, 'the other labels are still filed');
    assert.equal(held.calls[0].includes('ready'), false, 'no stray ready argument either');
    assert.match(held.r.stdout, /symbolic-blocker: /, 'the gate prints its reasons');
    assert.match(held.r.stdout, /NUM=\[42\]/);

    const broken = runGhFence(null, workTypes);
    assert.equal(broken.calls.length, 0, 'gate exit 2 runs no gh call');
    assert.match(broken.r.stderr, /ready-gate\.js exited 2: the create fails/);
    assert.match(broken.r.stdout, /NUM=\[\]/, 'a stale number from the previous unit is cleared');
    assert.deepEqual(broken.fingerprints, {}, 'nothing is recorded for a create that did not happen');
  });
}

// The Accumulate fence, run under bash: a unit with no number appends nothing and says so; a unit with one appends.
function accumulateFence(text) {
  const at = text.indexOf('**Accumulate this unit for the cross-reference pass below.**');
  assert.notEqual(at, -1, 'the Accumulate paragraph is missing');
  const m = FENCE.exec(text.slice(at));
  assert.ok(m, 'no bash fence follows the Accumulate paragraph');
  return m[1];
}
function runAccumulate(env, shell = 'bash') {
  const dir = scratchDir('ready-gate-accumulate-');
  const sessionId = 'ready-gate-accumulate-test';
  const manifest = sessionTmpPath(sessionId, 'specify-decomp-manifest.json', { tmpdir: dir });
  fs.writeFileSync(manifest, '[]');
  const bodyPath = sessionTmpPath(sessionId, 'specify-sub-issue-body.md', { tmpdir: dir });
  fs.writeFileSync(bodyPath, symbolicBody());
  const full = {
    ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    SPECIFY_SUB_ISSUE_BODY: bodyPath, SUB_ISSUE_TITLE: 'Unit A', SUB_ISSUE_CEREMONY: 'standard', SUB_ISSUE_NUM: '', SUB_ISSUE_ID: '', ...env,
  };
  const r = spawnSync(shell, ['-c', accumulateFence(SUB)], { cwd: dir, env: full, encoding: 'utf8' });
  return { r, manifest: JSON.parse(fs.readFileSync(manifest, 'utf8')) };
}

test('run: the Accumulate fence appends a unit that has a number and skips one that has none', { skip: SKIP_RUN }, () => {
  const created = runAccumulate({ SUB_ISSUE_NUM: '42' });
  assert.equal(created.r.status, 0, created.r.stderr);
  assert.deepEqual(created.manifest.map((e) => [e.title, e.num]), [['Unit A', '42']]);
  const local = runAccumulate({ SUB_ISSUE_ID: '7' });
  assert.deepEqual(local.manifest.map((e) => [e.title, e.num]), [['Unit A', '7']], 'the local-files id is accumulated too');

  for (const none of [{}, { SUB_ISSUE_NUM: '', SUB_ISSUE_ID: '' }]) {
    const failed = runAccumulate(none);
    assert.deepEqual(failed.manifest, [], 'a unit with no number is not appended with an empty num');
    assert.match(failed.r.stderr, /create failed for "Unit A": no record number, not accumulated/);
  }
});

// echo reads a backslash sequence in its argument in zsh and not in bash, so a title holding one
// printed two different messages. The fence prints through printf with the title as an argument.
const hasShell = (shell) => spawnSync(shell, ['-c', 'exit 0']).status === 0;
for (const shell of ['bash', 'zsh']) {
  test(`run: the Accumulate fence prints a failed create with a backslash in the title exactly, under ${shell}`, { skip: process.platform === 'win32' ? 'shell fence' : !hasShell(shell) && `no ${shell}` }, () => {
    for (const title of ['Unit \\n A', 'Unit \\\\ B', 'Unit \\c C', '-n']) {
      const failed = runAccumulate({ SUB_ISSUE_TITLE: title }, shell);
      assert.deepEqual(failed.manifest, [], title);
      assert.equal(failed.r.stderr, `create failed for "${title}": no record number, not accumulated\n`, `${shell}: ${title}`);
    }
  });
}
