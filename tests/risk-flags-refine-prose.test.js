// tests/risk-flags-refine-prose.test.js — pins #4618's /backlog refine wiring for the
// record flag line: refine-mode.md's `## Step 3.7: Unconfirmed risk flags` stub (the
// headless skip, the population and its pre-filter fence, the read of the lazy
// sub-file) and backlog/refine-risk-flags.md (classify, the one batch question, the
// reverified `risk-flags.js confirm` write, the Step 1 snapshot refresh), the record
// contract's `## Risk flag lines` section in _shared/work-record.md, and the two risk
// policy rows in _shared/policy-schema.md. Reads the live skill files — this pins prose
// we just wrote (skill-prose-conformance-tests' live-vs-fixture distinction), the same
// house style as tests/risk-flags-prose-conformance.test.js: one assertion function per
// concern, and every literal pin has a go-red control that runs the same function
// against text with that literal removed, plus a scoping control with the literal moved
// to the end of its file. The verb scan matches the quoted house command form
// (`node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" confirm …`). Both fences and the two
// local-files inline commands are bound by extract-and-run below, with a frozen negative
// control (docs/skill-authoring.md, "Executable snippets in skill prose").
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const REFINE = 'plugin/skills/backlog/refine-mode.md';
const SUBFILE = 'plugin/skills/backlog/refine-risk-flags.md';
const REFINE_HEADLESS = 'plugin/skills/backlog/refine-headless.md';
const WORK_RECORD = 'plugin/skills/_shared/work-record.md';
const POLICY_SCHEMA = 'plugin/skills/_shared/policy-schema.md';
const read = (rel) => readText(path.join(ROOT, rel));

const LIVE = {
  refine: read(REFINE), sub: read(SUBFILE), headless: read(REFINE_HEADLESS),
  workRecord: read(WORK_RECORD), policy: read(POLICY_SCHEMA),
};

const CONFIRM_CALL = '"${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" confirm';
const CLASSIFY_CALL = '"${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" classify';
// A closing `"`, `'` or backtick may sit between the script name and the verb.
const VERB_RE = /risk-flags\.js["'`]?\s+(classify|settle|confirm)/g;
const STEP_HEADING = '\n## Step 3.7: Unconfirmed risk flags\n';
const HEADLESS_SKIP = 'Human-present only';
const READ_SUBFILE = "read `refine-risk-flags.md` in this skill's directory";

// Region helpers. A region that cannot be found yields '' so its pins fail by name.
function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = text.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? '' : text.slice(start, end);
}
const lineStarting = (text, prefix) => text.split('\n').find((l) => l.startsWith(prefix)) || '';
const step37 = (refine) => between(refine, STEP_HEADING, '\n## Step 4: Decision lanes\n');
// The sub-file's intro (before its first `##`) and one `## {name}` section of it.
const subIntro = (sub) => between(sub, '# Backlog Refine — Unconfirmed Risk Flags\n', '\n## Classify\n');
const subSection = (sub, name) => between(sub, `\n## ${name}\n`, '\n## ');
const refusedParagraph = (sub) => lineStarting(subSection(sub, 'Refused'), '**When `confirm` returns a non-null `refused`');
const riskSection = (workRecord) => between(workRecord, '\n## Risk flag lines\n', '\n## ');
const policyRow = (policy, key) => lineStarting(policy, `| \`${key}\` |`);
const ownerCell = (row) => (row.split('|')[3] || '').trim();
const controlIntro = (policy) => lineStarting(between(policy, '\n## Control mode\n', '\n| Key |'), 'Inert');

function missing(pins, texts) {
  const out = [];
  for (const [label, , region, literal] of pins) {
    if (!region(texts).includes(literal)) out.push(`${label}: ${literal}`);
  }
  return out;
}
function fail(concern, failures) {
  assert.deepStrictEqual(failures, [], `${concern}: ${failures.join('; ')}`);
}

const stub = (t) => step37(t.refine);
const classifySec = (t) => subSection(t.sub, 'Classify');
const askSec = (t) => subSection(t.sub, 'Ask once');
const writeSec = (t) => subSection(t.sub, 'Write each answered record');
// [label, file key, region(texts), literal]
const REFINE_PINS = [
  ['Step 3.7 stub', 'refine', stub, 'allRows'],
  ['Step 3.7 stub', 'refine', stub, "Every open record in Step 1's `allRows` snapshot"],
  ['Step 3.7 stub', 'refine', stub, 'under both drivers'],
  ['Step 3.7 stub', 'refine', stub, '`blocked` and `inProgress` included'],
  ['Step 3.7 stub', 'refine', stub, '`#N[,#M...]` filter'],
  ['Step 3.7 stub', 'refine', stub, 'the literal `Risk-flags-unconfirmed:`'],
  ['Step 3.7 stub', 'refine', stub, "only narrows, and `classify`'s `entry` decides"],
  ['Step 3.7 stub', 'refine', stub, HEADLESS_SKIP],
  ['Step 3.7 stub', 'refine', stub, 'never read its sub-file'],
  ['Step 3.7 stub', 'refine', stub, '`refine-headless.md` never runs it'],
  ['Step 3.7 stub', 'refine', stub, "a local record's `key` is `local-` plus its file stem"],
  ['Step 3.7 stub', 'refine', stub, 'If the block printed no line, this step ends here'],
  ['Step 3.7 stub', 'refine', stub, READ_SUBFILE],
  ['sub-file Classify', 'sub', classifySec, CLASSIFY_CALL],
  ['sub-file Classify', 'sub', classifySec, 'entry.unconfirmed'],
  ['sub-file Ask once', 'sub', askSec, "`shaping-mode-stamping.md`'s `### Risk flags` step 3"],
  ['sub-file Ask once', 'sub', askSec, 'one batch table and one `AskUserQuestion`'],
  ['sub-file Ask once', 'sub', askSec, 'errors, times out or is auto-answered writes nothing'],
  ['sub-file Ask once', 'sub', askSec, 'When no kept record has an option (each is `none` or `unknown`), skip the batch question'],
  ['sub-file Ask once', 'sub', askSec, '`Confirm no risk flags (Recommended)`'],
  ['sub-file Ask once', 'sub', askSec, 'any answers file, `{}` included, clears the marker'],
  ['sub-file Ask once', 'sub', askSec, 'With only `unknown` records, ask nothing'],
  ['sub-file Write', 'sub', writeSec, CONFIRM_CALL],
  ['sub-file Write', 'sub', writeSec, 'local-files'],
  ['sub-file Write', 'sub', writeSec, 'writeRecord'],
  ['sub-file Write', 'sub', writeSec, 'readRecord'],
  ['sub-file Write', 'sub', writeSec, "Step 5's Body pre-write reverify"],
  ['sub-file Write', 'sub', writeSec, 'logged, tallied and reported exactly as that rule states for a body'],
  ['sub-file Write', 'sub', writeSec, 'gh issue view {n} --json body -q .body > "{tmp-risk-body}"'],
  ['sub-file Write', 'sub', writeSec, 'cmp -s "{tmp-risk-snapshot}" "{tmp-risk-body}"'],
  ['sub-file Write', 'sub', writeSec, 'gh issue edit {n} --body-file "{tmp-risk-body}"'],
  ['sub-file Write', 'sub', writeSec, '`facets.unsynced === true`'],
  ['sub-file Write', 'sub', writeSec, 'its title and `facets` unchanged'],
  ['sub-file Write', 'sub', writeSec, '--run "$PIPELINE_RUN_DIR"'],
  ['sub-file Write', 'sub', writeSec, "Refresh Step 1's snapshot"],
  ['sub-file Write', 'sub', writeSec, 'leaves the snapshot stale, so Step 5 skips'],
  ['sub-file Write', 'sub', writeSec, "`shaping-mode-stamping.md`'s `### Risk flags` step 5"],
  ['sub-file Write', 'sub', writeSec, '`logFailures`'],
  ['sub-file Write', 'sub', writeSec, "`confirm` logs under `/backlog`'s `Refine risk flags` step"],
];
// Re-read, compare, confirm, write, refresh, in that order: the reverify precedes the write,
// and the snapshot is refreshed only after it.
const ORDER = ['gh issue view {n} --json body -q .body', 'cmp -s "{tmp-risk-snapshot}"', CONFIRM_CALL, 'gh issue edit {n} --body-file', "Refresh Step 1's snapshot"];
function refineFailures(texts) {
  const out = missing(REFINE_PINS, texts);
  const s36 = texts.refine.indexOf('\n## Step 3.6');
  const at = texts.refine.indexOf(STEP_HEADING);
  const s4 = texts.refine.indexOf('\n## Step 4: Decision lanes\n');
  if (at === -1 || s36 === -1 || s4 === -1 || !(s36 < at && at < s4)) out.push('order: ## Step 3.7 sits between ## Step 3.6 and ## Step 4');
  // The sub-file is never loaded headless: the skip comes before the read instruction.
  const step = step37(texts.refine);
  const skip = step.indexOf(HEADLESS_SKIP);
  const readAt = step.indexOf(READ_SUBFILE);
  if (skip === -1 || readAt === -1 || !(skip < readAt)) out.push('order: the headless skip precedes the sub-file read');
  const write = subSection(texts.sub, 'Write each answered record');
  const idx = ORDER.map((literal) => write.indexOf(literal));
  for (let i = 1; i < ORDER.length; i++) {
    if (idx[i - 1] === -1 || idx[i] === -1 || !(idx[i - 1] < idx[i])) out.push(`order: ${ORDER[i - 1]} before ${ORDER[i]}`);
  }
  if (texts.headless.includes('risk-flags.js')) out.push(`${REFINE_HEADLESS} names risk-flags.js`);
  if (texts.headless.includes('refine-risk-flags.md')) out.push(`${REFINE_HEADLESS} names refine-risk-flags.md`);
  return out;
}
function assertRefine(texts) { fail('refine Step 3.7 prose', refineFailures(texts)); }

const rp = (t) => refusedParagraph(t.sub);
const REFUSED_PINS = [
  ['refused paragraph', 'sub', rp, 'non-null `refused`'],
  ['refused paragraph', 'sub', rp, 'must be repaired first'],
  ['refused paragraph', 'sub', rp, 'write nothing for that record and log nothing'],
  ['refused paragraph', 'sub', rp, "`shaping-mode-stamping.md`'s `### Risk flags` step 3 refused wording"],
  ['refused paragraph', 'sub', rp, '`refused.reason` named when set and none named for a `null` reason'],
  ['refused paragraph', 'sub', rp, '`malformed`'],
  ['refused paragraph', 'sub', rp, '`/claude-tweaks:specify #{n}`'],
  ['refused paragraph', 'sub', rp, '`unknown-slug`'],
  ['refused paragraph', 'sub', rp, '`risk-categories`'],
  ['refused paragraph', 'sub', rp, '`/claude-tweaks:backlog refine #{n}`'],
  ['sub-file Ask once', 'sub', askSec, 'A record whose `entry.status` is `unknown` takes no option and no `confirm`'],
];
function assertRefusedRefine(texts) { fail('refused-confirm prose', missing(REFUSED_PINS, texts)); }

// C9: refine reads `entry` through classify (which writes nothing) and writes through
// confirm (which runs no classifier and adds nothing); settle classifies and widens.
const intro = (t) => subIntro(t.sub);
const NO_CLASSIFIER_PINS = [
  ['sub-file intro', 'sub', intro, 'This step applies no classification'],
  ['sub-file intro', 'sub', intro, "it reads only `classify`'s `entry`"],
  ['sub-file intro', 'sub', intro, 'never its `flags` or `kept`'],
  ['sub-file intro', 'sub', intro, 'A record with no flag line is never touched'],
  ['sub-file Classify', 'sub', classifySec, '`entry.status` is not `unclassified`'],
];
function noClassifierFailures(texts) {
  const out = missing(NO_CLASSIFIER_PINS, texts);
  for (const [rel, key] of [[REFINE, 'refine'], [SUBFILE, 'sub']]) {
    for (const m of texts[key].matchAll(VERB_RE)) if (m[1] === 'settle') out.push(`${rel}: risk-flags.js settle`);
  }
  return out;
}
function assertNoClassifier(texts) { fail('refine runs no classifier', noClassifierFailures(texts)); }

const rs = (t) => riskSection(t.workRecord);
const WORK_RECORD_PINS = [
  ['Risk flag lines', 'workRecord', rs, '`parseRiskFlags`'],
  ['Risk flag lines', 'workRecord', rs, 'the one reader'],
  ['Risk flag lines', 'workRecord', rs, '`bin/risk-flags.js`'],
  ['Risk flag lines', 'workRecord', rs, 'the one writer path'],
  ['Risk flag lines', 'workRecord', rs, 'never in `facets`'],
  ['Risk flag lines', 'workRecord', rs, '`Risk-flags-unconfirmed: true`'],
];
function assertWorkRecord(texts) { fail('record contract Risk flag lines', missing(WORK_RECORD_PINS, texts)); }

const cats = (t) => ownerCell(policyRow(t.policy, 'risk-categories'));
const globs = (t) => ownerCell(policyRow(t.policy, 'risk-path-globs'));
const POLICY_PINS = [
  ['risk-categories owner cell', 'policy', cats, '`risk-flags.js`'],
  ['risk-categories owner cell', 'policy', cats, '`plan-audit.js`'],
  ['risk-path-globs owner cell', 'policy', globs, '`risk-flags.js`'],
  ['Control mode intro', 'policy', (t) => controlIntro(t.policy), 'Inert unless a row names its owner'],
];
function policyFailures(texts) {
  const out = missing(POLICY_PINS, texts);
  for (const key of ['risk-categories', 'risk-path-globs']) {
    const cell = ownerCell(policyRow(texts.policy, key));
    if (cell === '' || cell.includes('none yet (#4608)')) out.push(`${key} owner cell: names no consumer`);
  }
  return out;
}
function assertPolicyRows(texts) { fail('risk policy rows', policyFailures(texts)); }

const names = (label) => (err) => err.message.includes(label);

test('refine surfaces unconfirmed flags through confirm, human-present only', () => assertRefine(LIVE));
test('Reading A: a refused confirm tells the human the line must be repaired first and logs nothing', () => assertRefusedRefine(LIVE));
test('AC6.1: refine runs no classifier, so a record with no flag line is never touched', () => assertNoClassifier(LIVE));
test('the record contract names the one reader and the one writer path', () => assertWorkRecord(LIVE));
test('the two risk policy keys name their consumers', () => assertPolicyRows(LIVE));

// Go-red controls for every literal pin: removed from its file, and moved to its end.
const PIN_CONCERNS = [
  ['refine', REFINE_PINS, assertRefine],
  ['refused', REFUSED_PINS, assertRefusedRefine],
  ['no classifier', NO_CLASSIFIER_PINS, assertNoClassifier],
  ['work record', WORK_RECORD_PINS, assertWorkRecord],
  ['policy', POLICY_PINS, assertPolicyRows],
];
const without = (text, literal) => text.split(literal).join('');
const movedToEnd = (text, literal) => `${without(text, literal)}\n\n${literal}\n`;
for (const [concern, pins, assertFn] of PIN_CONCERNS) {
  for (const [label, key, , literal] of pins) {
    test(`go-red (${concern}): removing "${literal}" from ${label} fails, naming it`, () => {
      const mutated = { ...LIVE, [key]: without(LIVE[key], literal) };
      assert.notStrictEqual(mutated[key], LIVE[key]);
      assert.throws(() => assertFn(mutated), names(`${label}: ${literal}`));
    });
    test(`go-red (${concern}): "${literal}" moved out of ${label} to the end of the file still fails`, () => {
      const mutated = { ...LIVE, [key]: movedToEnd(LIVE[key], literal) };
      assert.throws(() => assertFn(mutated), names(`${label}: ${literal}`));
    });
  }
}

test('go-red (refine): allRows replaced with a lane population fails', () => {
  assert.throws(() => assertRefine({ ...LIVE, refine: LIVE.refine.split('allRows').join('fresh lane') }), names('Step 3.7 stub: allRows'));
});

test('go-red (refine): Step 3.7 placed after Step 4 fails the offset check', () => {
  const step = step37(LIVE.refine);
  assert.ok(step.length > 0);
  const moved = `${LIVE.refine.replace(step, '\n')}${step}\n## Step 4: Decision lanes\n`;
  assert.throws(() => assertRefine({ ...LIVE, refine: moved }), names('order: ## Step 3.7 sits between ## Step 3.6 and ## Step 4'));
});

test('go-red (refine): the headless skip placed after the sub-file read fails, so the sub-file could load headless', () => {
  const step = step37(LIVE.refine);
  const skipLine = lineStarting(step, HEADLESS_SKIP);
  const readLine = lineStarting(step, 'If the block printed no line');
  assert.ok(skipLine && readLine);
  const reordered = step.replace(`${skipLine}\n`, '').replace(readLine, `${readLine}\n\n${skipLine}`);
  assert.throws(() => assertRefine({ ...LIVE, refine: LIVE.refine.replace(step, reordered) }), names('order: the headless skip precedes the sub-file read'));
});

test('go-red (refine): the write placed before the reverify fails the order check', () => {
  const write = subSection(LIVE.sub, 'Write each answered record');
  const edit = 'gh issue edit {n} --body-file "{tmp-risk-body}"';
  const cmp = 'cmp -s "{tmp-risk-snapshot}" "{tmp-risk-body}"';
  const swapped = write.replace(edit, 'EDIT_SLOT').replace(cmp, edit).replace('EDIT_SLOT', cmp);
  assert.notStrictEqual(swapped, write);
  assert.throws(() => assertRefine({ ...LIVE, sub: LIVE.sub.replace(write, swapped) }), names('order: cmp -s "{tmp-risk-snapshot}" before'));
});

test('go-red (refine): the snapshot refresh placed before the write fails the order check', () => {
  const write = subSection(LIVE.sub, 'Write each answered record');
  const refresh = "Refresh Step 1's snapshot";
  const moved = write.replace(refresh, 'Refresh it').replace('1. **Re-read**', `${refresh}. 1. **Re-read**`);
  assert.throws(() => assertRefine({ ...LIVE, sub: LIVE.sub.replace(write, moved) }), names(`order: gh issue edit {n} --body-file before ${refresh}`));
});

test('go-red (refine): risk-flags.js or the sub-file named in refine-headless.md fails', () => {
  const planted = `${LIVE.headless}\nRun \`node "\${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" confirm\`.\n`;
  assert.throws(() => assertRefine({ ...LIVE, headless: planted }), names(`${REFINE_HEADLESS} names risk-flags.js`));
  assert.throws(() => assertRefine({ ...LIVE, headless: `${LIVE.headless}\nRead refine-risk-flags.md.\n` }), names(`${REFINE_HEADLESS} names refine-risk-flags.md`));
});

const HOUSE = (verb) => `Run \`node "\${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" ${verb} --body-file "{tmp-body}"\`.`;
test('go-red (no classifier): settle planted in refine-mode.md or the sub-file fails, in the quoted house form', () => {
  assert.throws(() => assertNoClassifier({ ...LIVE, refine: `${LIVE.refine}\n${HOUSE('settle')}\n` }), names(`${REFINE}: risk-flags.js settle`));
  assert.throws(() => assertNoClassifier({ ...LIVE, sub: `${LIVE.sub}\n${HOUSE('settle')}\n` }), names(`${SUBFILE}: risk-flags.js settle`));
});
test('control (no classifier, C9): classify and confirm in either refine file are allowed', () => {
  for (const verb of ['classify', 'confirm']) {
    assertNoClassifier({ ...LIVE, refine: `${LIVE.refine}\n${HOUSE(verb)}\n`, sub: `${LIVE.sub}\n${HOUSE(verb)}\n` });
  }
});

test('go-red (policy): either owner cell reading none yet (#4608) fails', () => {
  for (const key of ['risk-categories', 'risk-path-globs']) {
    const row = policyRow(LIVE.policy, key);
    const cells = row.split('|');
    cells[3] = ' none yet (#4608) ';
    assert.throws(() => assertPolicyRows({ ...LIVE, policy: LIVE.policy.replace(row, cells.join('|')) }), names(`${key} owner cell: names no consumer`));
  }
});

// Extract-and-run: the stub's pre-filter fence, the sub-file's local-files re-read and
// write commands and its snapshot-refresh fence, against a real local record and a GitHub
// row of the same number (the key collision), with a fake `gh` for the GitHub refresh.
const SKIP_NO_BASH = spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0 ? false : 'bash not available';
// The fake `gh` is a sh script, which execFileSync cannot launch on win32.
const SKIP_FAKE_GH = SKIP_NO_BASH || (process.platform === 'win32' ? 'a sh fake gh cannot run on win32' : false);
// Forward slashes: the snippets interpolate ${CLAUDE_PLUGIN_ROOT} into JS string literals.
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');
const PREFILTER_RE = /```bash\n(ST_BACKLOG_REFINE_FACETED="\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/session-tmp-resolve\.js" --value backlog-refine-faceted\.json\)"\nnode -e "\n  const fs = require\('fs'\);\n  const path = require\('path'\);[\s\S]*?)\n```/;
const REFRESH_RE = /```bash\n(ST_BACKLOG_REFINE_FACETED="\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/session-tmp-resolve\.js" --value backlog-refine-faceted\.json\)"\nnode -e "\n  const fs = require\('fs'\);\n  const \{ execFileSync \}[\s\S]*?)\n```/;
const READ_SPAN_RE = /`(node -e "console\.log\(require\('\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/lib\/issues\/local-store\.js'\)\.readRecord[^`]*)`/;
const WRITE_SPAN_RE = /`(node -e "const s=require\('\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/lib\/issues\/local-store\.js'\)[^`]*writeRecord[^`]*)`/;
function extract(text, re, what) {
  const match = re.exec(text);
  assert.ok(match, `${what}: extraction pattern is out of sync with the Step 3.7 prose — update this test`);
  return match[1];
}
const LIVE_SNIPPETS = {
  prefilter: extract(step37(LIVE.refine), PREFILTER_RE, 'pre-filter fence'),
  read: extract(LIVE.sub, READ_SPAN_RE, 'local-files re-read'),
  write: extract(LIVE.sub, WRITE_SPAN_RE, 'local-files write'),
  refresh: extract(LIVE.sub, REFRESH_RE, 'snapshot-refresh fence'),
};

const GITHUB_BODY = 'Origin: test\nRisk-flags: auth\nRisk-flags-unconfirmed: true\n\n## Current State\n\nOn GitHub.';
// One session, one repo dir with a flagged local record (0007), a plain one (0008), and a
// GitHub row #7 in the same faceted file: the two #7s must not share files.
function fixture() {
  const { writeRecord, queryRecords, defaultFacets } = require('../plugin/bin/lib/issues/local-store');
  const sessionId = `risk-refine-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sessionDir = path.join(os.tmpdir(), `ct-session-${sessionId}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-refine-'));
  fs.mkdirSync(sessionDir, { recursive: true });
  const specs = path.join(work, 'specs');
  const flagged = path.join(specs, '0007-flagged.md');
  const facets = { ...defaultFacets(), type: 'task', risk: 'low', size: 'low', ceremony: 'standard', stage: 'ready' };
  writeRecord(flagged, { title: 'Flagged record', body: 'Origin: test\nRisk-flags: migrations, auth\nRisk-flags-unconfirmed: true\n\n## Current State\n\nSomething.', facets });
  writeRecord(path.join(specs, '0008-plain.md'), { title: 'Plain record', body: 'Origin: test\n\n## Current State\n\nNothing flagged.', facets });
  const local = queryRecords(specs, {}).map((r) => ({ ...r, facets: { ...r.facets, unsynced: true } }));
  const faceted = path.join(sessionDir, 'backlog-refine-faceted.json');
  fs.writeFileSync(faceted, JSON.stringify([{ number: 7, title: 'GitHub seven', body: GITHUB_BODY, facets: {} }, ...local]));
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_CODE_SESSION_ID: sessionId };
  const cleanup = () => { fs.rmSync(sessionDir, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true }); };
  return { sessionDir, work, flagged, faceted, env, cleanup };
}
const sh = (cmd, env) => execSync(cmd, { encoding: 'utf8', shell: 'bash', env, windowsHide: true });
// Temp fixture files, read as exact bytes: the compare under test is `cmp -s`, so a CR must
// count (readText would normalize it away). None of these is a tracked repo file.
const bytes = (tmpFile) => String(fs.readFileSync(tmpFile));

// The local-files path end to end: pre-filter, re-read, compare, confirm, write.
// -> { lines, equal, after, before, line, liveBody }
function runLocalPipeline(fx, snippets) {
  const before = bytes(fx.flagged);
  const lines = sh(snippets.prefilter, fx.env).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const line = lines.find((l) => l.number === null);
  assert.ok(line, `the local record is listed: ${JSON.stringify(lines)}`);
  const liveBody = path.join(fx.sessionDir, `backlog-refine-risk-body-${line.key}.md`);
  const answers = path.join(fx.sessionDir, `backlog-refine-risk-answers-${line.key}.json`);
  const sub = (cmd) => cmd.replace(/\{path\}/g, line.path).replace(/\{tmp-risk-body\}/g, liveBody);
  sh(sub(snippets.read), fx.env);
  const equal = bytes(liveBody) === bytes(line.snapshot);
  fs.writeFileSync(answers, JSON.stringify({ migrations: 'keep', auth: 'remove' }));
  const confirm = spawnSync(process.execPath, [path.join(ROOT, 'plugin', 'bin', 'risk-flags.js'), 'confirm', '--body-file', liveBody, '--answers-file', answers, '--repo-root', fx.work], { encoding: 'utf8', windowsHide: true });
  assert.equal(confirm.status, 0, confirm.stderr);
  const envelope = JSON.parse(confirm.stdout);
  assert.deepEqual([envelope.removed, envelope.refused], [['auth'], null]);
  sh(sub(snippets.write), fx.env);
  return { lines, equal, after: bytes(fx.flagged), before, line };
}

test('Step 3.7 snippets: pre-filter, exact re-read compare, and a confirm write that keeps title and facets', { skip: SKIP_NO_BASH }, () => {
  const fx = fixture();
  try {
    const { lines, equal, after, before, line } = runLocalPipeline(fx, LIVE_SNIPPETS);
    assert.equal(lines.length, 2, `only the two bodies carrying the literal are listed: ${JSON.stringify(lines)}`);
    assert.equal(path.resolve(line.path), path.resolve(fx.flagged));
    assert.ok(equal, 'the re-read prints the snapshot bytes, so cmp -s matches an unchanged record');
    assert.equal(after.split('\n# ')[0], before.split('\n# ')[0], 'frontmatter (facets) unchanged');
    assert.ok(after.includes('\n# Flagged record\n\nOrigin: test\nRisk-flags: migrations\n\n## Current State\n\nSomething.\n'), `title and body kept: ${after}`);
    assert.ok(!after.endsWith('\n\n'), 'the trailing newline the snapshot added is not written back');
  } finally {
    fx.cleanup();
  }
});

test('Step 3.7 snippets: GitHub #7 and local record 0007 get distinct keys and files', { skip: SKIP_NO_BASH }, () => {
  const fx = fixture();
  try {
    const lines = sh(LIVE_SNIPPETS.prefilter, fx.env).trim().split('\n').map((l) => JSON.parse(l));
    const github = lines.find((l) => l.number === 7);
    const local = lines.find((l) => l.number === null);
    assert.ok(github && local, JSON.stringify(lines));
    assert.equal(github.key, '7');
    assert.equal(local.key, 'local-0007-flagged');
    assert.notEqual(github.snapshot, local.snapshot);
    assert.equal(bytes(github.snapshot), `${GITHUB_BODY}\n`);
    assert.ok(bytes(local.snapshot).includes('Risk-flags: migrations, auth'));
  } finally {
    fx.cleanup();
  }
});

test('Step 3.7 snippets: the refresh replaces the written record\'s Step 1 body, local and GitHub', { skip: SKIP_FAKE_GH }, () => {
  const fx = fixture();
  try {
    const { line } = runLocalPipeline(fx, LIVE_SNIPPETS);
    const { readRecord } = require('../plugin/bin/lib/issues/local-store');
    sh(LIVE_SNIPPETS.refresh.split('"{ref}"').join(JSON.stringify(line.path)), fx.env);
    let rows = JSON.parse(fs.readFileSync(fx.faceted, 'utf8'));
    const localRow = rows.find((r) => r.path === line.path);
    assert.equal(localRow.body, readRecord(fx.flagged).body, 'the local row now holds the written body');
    assert.ok(!localRow.body.includes('Risk-flags-unconfirmed'));
    assert.equal(rows.find((r) => r.number === 7).body, GITHUB_BODY, 'refreshing the local record leaves GitHub #7 alone');

    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-refine-gh-'));
    try {
      const fakeGh = path.join(bin, 'gh');
      fs.writeFileSync(fakeGh, `#!/bin/sh\n[ "$1 $2 $3 $4 $5" = "issue view 7 --json body" ] || exit 9\nprintf '%s\\n' '{"body":"Risk-flags: auth\\n\\n## Current State\\n\\nWritten."}'\n`);
      fs.chmodSync(fakeGh, 0o755); // root-safe: makes the fake gh executable, not a permission-denial simulation
      sh(LIVE_SNIPPETS.refresh.split('"{ref}"').join('"7"'), { ...fx.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
    rows = JSON.parse(fs.readFileSync(fx.faceted, 'utf8'));
    assert.equal(rows.find((r) => r.number === 7).body, 'Risk-flags: auth\n\n## Current State\n\nWritten.');
    assert.equal(rows.find((r) => r.path === line.path).body, localRow.body, 'refreshing #7 leaves the local row alone');
  } finally {
    fx.cleanup();
  }
});

// Negative control (frozen mutations of the live snippets): without the snapshot's added
// newline the compare never matches, and without the write's strip the file gains a blank
// line — the same two mutations proven red by hand when the binding landed.
test('control: the snippets with the newline handling removed fail the same assertions', { skip: SKIP_NO_BASH }, () => {
  const mutated = {
    ...LIVE_SNIPPETS,
    prefilter: LIVE_SNIPPETS.prefilter.replace("r.body + '\\n'", 'r.body'),
    write: LIVE_SNIPPETS.write.replace(".replace(/\\n$/,'')", ''),
  };
  assert.notEqual(mutated.prefilter, LIVE_SNIPPETS.prefilter, 'the pre-filter mutation must apply');
  assert.notEqual(mutated.write, LIVE_SNIPPETS.write, 'the write mutation must apply');
  const fx = fixture();
  try {
    const { equal, after } = runLocalPipeline(fx, mutated);
    assert.equal(equal, false, 'a snapshot without the newline never matches the re-read');
    assert.ok(after.endsWith('\n\n'), 'a write without the strip leaves the re-read newline in the file');
  } finally {
    fx.cleanup();
  }
});
