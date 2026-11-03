// tests/risk-flags-refine-prose.test.js — pins #4618's /backlog refine wiring for the
// record flag line: refine-mode.md's `## Step 3.7: Unconfirmed risk flags` (a human
// confirms or narrows a headless-kept set through `risk-flags.js confirm`), the record
// contract's `## Risk flag lines` section in _shared/work-record.md, and the two risk
// policy rows in _shared/policy-schema.md. Reads the live skill files — this pins prose
// we just wrote (skill-prose-conformance-tests' live-vs-fixture distinction), the same
// house style as tests/risk-flags-prose-conformance.test.js: one assertion function per
// concern, and every literal pin has a go-red control that runs the same function
// against text with that literal removed, plus a scoping control with the literal moved
// to the end of its file. The verb scan matches the quoted house command form
// (`node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" confirm …`). Step 3.7's bash fence
// and its two local-files inline commands are bound by extract-and-run below
// (docs/skill-authoring.md, "Executable snippets in skill prose").
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
const REFINE_HEADLESS = 'plugin/skills/backlog/refine-headless.md';
const WORK_RECORD = 'plugin/skills/_shared/work-record.md';
const POLICY_SCHEMA = 'plugin/skills/_shared/policy-schema.md';
const read = (rel) => readText(path.join(ROOT, rel));

const LIVE = { refine: read(REFINE), headless: read(REFINE_HEADLESS), workRecord: read(WORK_RECORD), policy: read(POLICY_SCHEMA) };

const CONFIRM_CALL = '"${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" confirm';
const CLASSIFY_CALL = '"${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" classify';
// A closing `"`, `'` or backtick may sit between the script name and the verb.
const VERB_RE = /risk-flags\.js["'`]?\s+(classify|settle|confirm)/g;
const STEP_HEADING = '\n## Step 3.7: Unconfirmed risk flags\n';

// Region helpers. A region that cannot be found yields '' so its pins fail by name.
function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = text.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? '' : text.slice(start, end);
}
const lineStarting = (text, prefix) => text.split('\n').find((l) => l.startsWith(prefix)) || '';
const step37 = (refine) => between(refine, STEP_HEADING, '\n## Step 4: Decision lanes\n');
const refusedParagraph = (refine) => lineStarting(step37(refine), '**When `confirm` returns a non-null `refused`');
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

const s37 = (t) => step37(t.refine);
// [label, file key, region(texts), literal]
const REFINE_PINS = [
  ['Step 3.7', 'refine', s37, CONFIRM_CALL],
  ['Step 3.7', 'refine', s37, CLASSIFY_CALL],
  ['Step 3.7', 'refine', s37, 'allRows'],
  ['Step 3.7', 'refine', s37, 'local-files'],
  ['Step 3.7', 'refine', s37, 'writeRecord'],
  ['Step 3.7', 'refine', s37, 'readRecord'],
  ['Step 3.7', 'refine', s37, 'entry.unconfirmed'],
  ['Step 3.7', 'refine', s37, 'Every open record in Step 1\'s `allRows` snapshot'],
  ['Step 3.7', 'refine', s37, 'under both drivers'],
  ['Step 3.7', 'refine', s37, '`blocked` and `inProgress` included'],
  ['Step 3.7', 'refine', s37, '`#N[,#M...]` filter'],
  ['Step 3.7', 'refine', s37, 'the literal `Risk-flags-unconfirmed:`'],
  ['Step 3.7', 'refine', s37, "only narrows, and `classify`'s `entry` decides"],
  ['Step 3.7', 'refine', s37, 'Human-present only'],
  ['Step 3.7', 'refine', s37, '`refine-headless.md` never runs it'],
  ['Step 3.7', 'refine', s37, "`shaping-mode-stamping.md`'s `### Risk flags` step 3"],
  ['Step 3.7', 'refine', s37, 'one batch table and one `AskUserQuestion`'],
  ['Step 3.7', 'refine', s37, 'errors, times out or is auto-answered writes nothing'],
  ['Step 3.7', 'refine', s37, "Step 5's Body pre-write reverify"],
  ['Step 3.7', 'refine', s37, 'gh issue view {n} --json body -q .body > "{tmp-risk-body}"'],
  ['Step 3.7', 'refine', s37, 'cmp -s "{tmp-risk-snapshot}" "{tmp-risk-body}"'],
  ['Step 3.7', 'refine', s37, 'gh issue edit {n} --body-file "{tmp-risk-body}"'],
  ['Step 3.7', 'refine', s37, '`live-state fetch failed: {error}`'],
  ['Step 3.7', 'refine', s37, '`record body changed since Step 1 fetch`'],
  ['Step 3.7', 'refine', s37, '`facets.unsynced === true`'],
  ['Step 3.7', 'refine', s37, 'its title and `facets` unchanged'],
  ['Step 3.7', 'refine', s37, '--run "$PIPELINE_RUN_DIR"'],
  ['Step 3.7', 'refine', s37, "`shaping-mode-stamping.md`'s `### Risk flags` step 5"],
  ['Step 3.7', 'refine', s37, '`logFailures`'],
];
// Re-read, compare, confirm, write, in that order: the reverify must precede the write.
const ORDER = ['gh issue view {n} --json body -q .body', 'cmp -s "{tmp-risk-snapshot}"', CONFIRM_CALL, 'gh issue edit {n} --body-file'];
function refineFailures(texts) {
  const out = missing(REFINE_PINS, texts);
  const s36 = texts.refine.indexOf('\n## Step 3.6');
  const at = texts.refine.indexOf(STEP_HEADING);
  const s4 = texts.refine.indexOf('\n## Step 4: Decision lanes\n');
  if (at === -1 || s36 === -1 || s4 === -1 || !(s36 < at && at < s4)) out.push('order: ## Step 3.7 sits between ## Step 3.6 and ## Step 4');
  const step = step37(texts.refine);
  const idx = ORDER.map((literal) => step.indexOf(literal));
  for (let i = 1; i < ORDER.length; i++) {
    if (idx[i - 1] === -1 || idx[i] === -1 || !(idx[i - 1] < idx[i])) out.push(`order: ${ORDER[i - 1]} before ${ORDER[i]}`);
  }
  if (texts.headless.includes('risk-flags.js')) out.push(`${REFINE_HEADLESS} names risk-flags.js`);
  return out;
}
function assertRefine(refine, headless) { fail('refine Step 3.7 prose', refineFailures({ refine, headless })); }

const rp = (t) => refusedParagraph(t.refine);
const REFUSED_PINS = [
  ['refused paragraph', 'refine', rp, 'non-null `refused`'],
  ['refused paragraph', 'refine', rp, 'must be repaired first'],
  ['refused paragraph', 'refine', rp, 'nothing was removed or confirmed'],
  ['refused paragraph', 'refine', rp, 'every flag stays kept and unconfirmed'],
  ['refused paragraph', 'refine', rp, 'write nothing for that record and log nothing'],
  ['refused paragraph', 'refine', rp, '`refused.reason`'],
  ['refused paragraph', 'refine', rp, '`malformed`'],
  ['refused paragraph', 'refine', rp, '`/claude-tweaks:specify #{n}`'],
  ['refused paragraph', 'refine', rp, '`unknown-slug`'],
  ['refused paragraph', 'refine', rp, '`risk-categories`'],
  ['refused paragraph', 'refine', rp, '`/claude-tweaks:backlog refine #{n}`'],
  ['refused paragraph', 'refine', rp, 'A `null` reason'],
  ['refused paragraph', 'refine', rp, 'say only that the line must be repaired first'],
  ['Step 3.7', 'refine', s37, "A record whose `entry.status` is `unknown` takes no option and no `confirm`"],
];
function assertRefusedRefine(refine) { fail('refused-confirm prose', missing(REFUSED_PINS, { refine })); }

// C9: refine reads `entry` through classify (which writes nothing) and writes through
// confirm (which runs no classifier and adds nothing); settle classifies and widens.
const NO_CLASSIFIER_PINS = [
  ['Step 3.7', 'refine', s37, 'This step applies no classification'],
  ['Step 3.7', 'refine', s37, "it reads only `classify`'s `entry`"],
  ['Step 3.7', 'refine', s37, 'never its `flags` or `kept`'],
  ['Step 3.7', 'refine', s37, 'A record with no flag line is never touched'],
  ['Step 3.7', 'refine', s37, '`entry.status` is not `unclassified`'],
];
function noClassifierFailures(texts) {
  const out = missing(NO_CLASSIFIER_PINS, texts);
  for (const m of texts.refine.matchAll(VERB_RE)) if (m[1] === 'settle') out.push(`${REFINE}: risk-flags.js settle`);
  return out;
}
function assertNoClassifier(refine) { fail('refine runs no classifier', noClassifierFailures({ refine })); }

const rs = (t) => riskSection(t.workRecord);
const WORK_RECORD_PINS = [
  ['Risk flag lines', 'workRecord', rs, '`parseRiskFlags`'],
  ['Risk flag lines', 'workRecord', rs, 'the one reader'],
  ['Risk flag lines', 'workRecord', rs, '`bin/risk-flags.js`'],
  ['Risk flag lines', 'workRecord', rs, 'the one writer path'],
  ['Risk flag lines', 'workRecord', rs, 'never in `facets`'],
  ['Risk flag lines', 'workRecord', rs, '`Risk-flags-unconfirmed: true`'],
];
function assertWorkRecord(workRecord) { fail('record contract Risk flag lines', missing(WORK_RECORD_PINS, { workRecord })); }

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
function assertPolicyRows(policy) { fail('risk policy rows', policyFailures({ policy })); }

const names = (label) => (err) => err.message.includes(label);

test('refine surfaces unconfirmed flags through confirm, human-present only', () => assertRefine(LIVE.refine, LIVE.headless));
test('Reading A: a refused confirm tells the human the line must be repaired first and logs nothing', () => assertRefusedRefine(LIVE.refine));
test('AC6.1: refine runs no classifier, so a record with no flag line is never touched', () => assertNoClassifier(LIVE.refine));
test('the record contract names the one reader and the one writer path', () => assertWorkRecord(LIVE.workRecord));
test('the two risk policy keys name their consumers', () => assertPolicyRows(LIVE.policy));

// Go-red controls for every literal pin: removed from its file, and moved to its end.
const PIN_CONCERNS = [
  ['refine', REFINE_PINS, (t) => assertRefine(t.refine, t.headless)],
  ['refused', REFUSED_PINS, (t) => assertRefusedRefine(t.refine)],
  ['no classifier', NO_CLASSIFIER_PINS, (t) => assertNoClassifier(t.refine)],
  ['work record', WORK_RECORD_PINS, (t) => assertWorkRecord(t.workRecord)],
  ['policy', POLICY_PINS, (t) => assertPolicyRows(t.policy)],
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
  assert.throws(() => assertRefine(LIVE.refine.split('allRows').join('fresh lane'), LIVE.headless), names('Step 3.7: allRows'));
});

test('go-red (refine): Step 3.7 placed after Step 4 fails the offset check', () => {
  const step = step37(LIVE.refine);
  assert.ok(step.length > 0);
  const moved = `${LIVE.refine.replace(step, '\n')}${step}\n## Step 4: Decision lanes\n`;
  assert.throws(() => assertRefine(moved, LIVE.headless), names('order: ## Step 3.7 sits between ## Step 3.6 and ## Step 4'));
});

test('go-red (refine): the write placed before the reverify fails the order check', () => {
  const step = step37(LIVE.refine);
  const edit = 'gh issue edit {n} --body-file "{tmp-risk-body}"';
  const swapped = step.replace(edit, 'EDIT_SLOT').replace('cmp -s "{tmp-risk-snapshot}" "{tmp-risk-body}"', edit).replace('EDIT_SLOT', 'cmp -s "{tmp-risk-snapshot}" "{tmp-risk-body}"');
  assert.notStrictEqual(swapped, step);
  assert.throws(() => assertRefine(LIVE.refine.replace(step, swapped), LIVE.headless), names('order: cmp -s "{tmp-risk-snapshot}" before'));
});

test('go-red (refine): risk-flags.js named in refine-headless.md fails', () => {
  assert.throws(() => assertRefine(LIVE.refine, `${LIVE.headless}\nRun \`node "\${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" confirm\`.\n`), names(`${REFINE_HEADLESS} names risk-flags.js`));
});

const HOUSE = (verb) => `Run \`node "\${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" ${verb} --body-file "{tmp-body}"\`.`;
test('go-red (no classifier): settle planted in refine-mode.md fails, in the quoted house form', () => {
  assert.throws(() => assertNoClassifier(`${LIVE.refine}\n${HOUSE('settle')}\n`), names(`${REFINE}: risk-flags.js settle`));
});
test('control (no classifier, C9): classify and confirm in refine-mode.md are allowed', () => {
  for (const verb of ['classify', 'confirm']) assertNoClassifier(`${LIVE.refine}\n${HOUSE(verb)}\n`);
});

test('go-red (policy): either owner cell reading none yet (#4608) fails', () => {
  for (const key of ['risk-categories', 'risk-path-globs']) {
    const row = policyRow(LIVE.policy, key);
    const cells = row.split('|');
    cells[3] = ' none yet (#4608) ';
    assert.throws(() => assertPolicyRows(LIVE.policy.replace(row, cells.join('|'))), names(`${key} owner cell: names no consumer`));
  }
});

// Extract-and-run: Step 3.7's pre-filter fence, then its local-files re-read and write
// commands, against a real local record. Proves the compare is exact (the snapshot and
// the re-read print the same bytes) and the write leaves title and facets as they were.
const SKIP_NO_BASH = spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0 ? false : 'bash not available';
// Forward slashes: the snippet interpolates ${CLAUDE_PLUGIN_ROOT} into JS string literals.
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');
const FENCE_RE = /```bash\n(ST_BACKLOG_REFINE_FACETED="\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/session-tmp-resolve\.js" --value backlog-refine-faceted\.json\)"\nnode -e "[\s\S]*?)\n```/;
const READ_SPAN_RE = /`(node -e "console\.log\(require\('\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/lib\/issues\/local-store\.js'\)\.readRecord[^`]*)`/;
const WRITE_SPAN_RE = /`(node -e "const s=require\('\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/lib\/issues\/local-store\.js'\)[^`]*writeRecord[^`]*)`/;
function extract(re, what) {
  const match = re.exec(step37(LIVE.refine));
  assert.ok(match, `${what}: extraction pattern is out of sync with refine-mode.md Step 3.7 — update this test`);
  return match[1];
}

test('Step 3.7 snippets: pre-filter, exact re-read compare, and a confirm write that keeps title and facets', { skip: SKIP_NO_BASH }, () => {
  const { writeRecord, queryRecords, defaultFacets } = require('../plugin/bin/lib/issues/local-store');
  const sessionId = `risk-refine-${process.pid}-${Date.now()}`;
  const sessionDir = path.join(os.tmpdir(), `ct-session-${sessionId}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-refine-'));
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    const specs = path.join(work, 'specs');
    const flagged = path.join(specs, '0007-flagged.md');
    const plain = path.join(specs, '0008-plain.md');
    const facets = { ...defaultFacets(), type: 'task', risk: 'low', size: 'low', ceremony: 'standard', stage: 'ready' };
    writeRecord(flagged, { title: 'Flagged record', body: 'Origin: test\nRisk-flags: migrations, auth\nRisk-flags-unconfirmed: true\n\n## Current State\n\nSomething.', facets });
    writeRecord(plain, { title: 'Plain record', body: 'Origin: test\n\n## Current State\n\nNothing flagged.', facets });
    const before = fs.readFileSync(flagged, 'utf8');
    fs.writeFileSync(path.join(sessionDir, 'backlog-refine-faceted.json'), JSON.stringify(queryRecords(specs, {})));

    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_CODE_SESSION_ID: sessionId };
    const out = execSync(extract(FENCE_RE, 'pre-filter fence'), { encoding: 'utf8', shell: 'bash', env, windowsHide: true });
    const lines = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.length, 1, `only the body carrying the literal is listed: ${out}`);
    const [line] = lines;
    assert.equal(line.number, null);
    assert.equal(path.resolve(line.path), path.resolve(flagged));
    assert.ok(fs.existsSync(line.snapshot));

    const liveBody = path.join(sessionDir, `backlog-refine-risk-body-${line.key}.md`);
    const answers = path.join(sessionDir, `backlog-refine-risk-answers-${line.key}.json`);
    const sub = (cmd) => cmd.replace(/\{path\}/g, line.path).replace(/\{tmp-risk-body\}/g, liveBody);
    execSync(sub(extract(READ_SPAN_RE, 'local-files re-read')), { encoding: 'utf8', shell: 'bash', env, windowsHide: true });
    assert.equal(fs.readFileSync(liveBody, 'utf8'), fs.readFileSync(line.snapshot, 'utf8'), 'the re-read prints the snapshot bytes, so cmp -s matches an unchanged record');

    fs.writeFileSync(answers, JSON.stringify({ migrations: 'keep', auth: 'remove' }));
    const confirm = spawnSync(process.execPath, [path.join(ROOT, 'plugin', 'bin', 'risk-flags.js'), 'confirm', '--body-file', liveBody, '--answers-file', answers, '--repo-root', work], { encoding: 'utf8', windowsHide: true });
    assert.equal(confirm.status, 0, confirm.stderr);
    const envelope = JSON.parse(confirm.stdout);
    assert.deepEqual(envelope.removed, ['auth']);
    assert.equal(envelope.refused, null);

    execSync(sub(extract(WRITE_SPAN_RE, 'local-files write')), { encoding: 'utf8', shell: 'bash', env, windowsHide: true });
    const after = fs.readFileSync(flagged, 'utf8');
    assert.ok(after.includes('\nRisk-flags: migrations\n'), after);
    assert.ok(!after.includes('Risk-flags-unconfirmed'), after);
    assert.equal(after.split('\n# ')[0], before.split('\n# ')[0], 'frontmatter (facets) unchanged');
    assert.ok(after.includes('\n# Flagged record\n\nOrigin: test\nRisk-flags: migrations\n\n## Current State\n\nSomething.\n'), `title and body kept: ${after}`);
    assert.ok(!after.endsWith('\n\n'), 'the trailing newline the snapshot added is not written back');
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});
