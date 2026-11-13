'use strict';
// tests/wrap-up-learned-skills-pr.test.js — #5290: wrap-up's auto-applied Skills-row edits leave the
// run branch through plugin/skills/wrap-up/learned-skills-pr.md, so merge-check's agent-instruction
// floor judges only the record's own change. Pins the procedure prose that drives
// bin/learned-skills-pr.js (capture per finding, then land or stage after the serial-commit pass and
// before any record call), the payload contract row for findings[].pr, skill-curation.md's AUTO and
// STAGED shapes, and the short-circuit FYI. The prose is new in this change, so every fact list is
// proved red by stripping one fact from the live text in memory (assertEachPatternGoesRed), and the
// ordering pin by permuting it. The fences are run through the CLI's own run() for their flags, the
// log-line templates' fixed segments are checked against the library's comment-stripped code, and
// the PR URL is asserted end to end through wrap-up-engine.js record and render.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');
const { gitRepo } = require('./helpers/git-fixtures');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { STEP } = require('../plugin/bin/lib/learned-skills/learned-skills');

const ROOT = path.join(__dirname, '..');
const WRAP = path.join(ROOT, 'plugin', 'skills', 'wrap-up');
const PROC = readText(path.join(WRAP, 'learned-skills-pr.md'));
const ENGINE = readText(path.join(WRAP, 'curation-engine.md'));
const CURATION = readText(path.join(WRAP, 'skill-curation.md'));
const SHORT_CIRCUIT = readText(path.join(WRAP, 'auto-merge-short-circuit.md'));
const SCRATCH = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'scratch-worktree.md'));
const collapse = (s) => s.replace(/\s+/g, ' ');

// ---- learned-skills-pr.md --------------------------------------------------

const PROC_FACTS = [
  [/learned-skills-pr\.js" capture --run /, 'runs capture per finding'],
  [/learned-skills-pr\.js" land --run /, 'runs land under pr-first'],
  [/learned-skills-pr\.js" stage --run "\{run\}" --worktree "\{worktree\}" --reason "integration-model is local-merge"/, 'runs stage under local-merge with the fixed reason'],
  [/In a multi-spec consolidated wrap-up it is the \*\*parent\*\* run dir, `\$MULTISPEC_PARENT_DIR`'s path \(`flow\/multispec-batch-curation\.md`\), never `\$PIPELINE_RUN_DIR`/, 'multi-spec --run is the parent run dir, never PIPELINE_RUN_DIR'],
  [/- `\{integration-branch\}`: per `_shared\/integration-branch\.md`\. `land` always takes it, whichever source the merge-base came from/, 'integration-branch is resolved on its own, not only in the merge-base fallback'],
  [/For `stage` \(the direct `local-merge` call or that fallback\): every captured patch still sits only in `\{run\}\/learned-skills\/`\. Handle each as capture's patch-file case: a SKIP line naming its patch file, and an open wrap-up ledger item/, 'a stage exit 1 with no JSON is handled per patch'],
  [/The body carries the `<!-- wrap-up-skills-pr -->` marker and names each record only as `refs #\{n\}`/, 'the PR body marker and refs-only naming'],
  [/The record-owned rule: the record's own commits already touch this file, so the edit stays on the run branch/, 'the record-owned rule'],
  [/\*\*Never armed\.\*\* This file and its CLI run no merge command, and `housekeeping-auto-merge` is never read for this PR/, 'the PR is never armed'],
  [/item 9 excludes a `<!-- wrap-up-skills-pr -->` PR from both of its arm routes/, 'the item 9 exclusion'],
  [/It rides that same patch, and `capture` returns `shared: true` for it/, 'a later row on a captured target rides the same patch'],
  [/`pack\.blastRadius\.value\.mergeBase` from `\{run-dir\}\/wrap-up-pack\.json`/, 'the merge-base comes from the wrap-up pack'],
  [/use the batch merge-base from `flow\/multispec-batch-curation\.md` step 1/, 'multi-spec uses the batch merge-base'],
  [/repeat it once per member \(`--record 5290 --record 5291`\)/, 'multi-spec repeats --record per member'],
  [/This is the one fail-safe exception, and `merge-check`'s floor still holds that run/, 'capture exit 1 is the one fail-safe exception'],
  [/\*\*Ordering\.\*\* Every finding sent back to the run branch above \(`run-branch`, and both exit-1 working-tree cases\) is committed there \*\*before\*\* the `land` or `stage` call below/, 'run-branch commits land before land/stage (ruling 1)'],
  [/logs `_shared\/staged-patch\.md`'s own line for that case instead of the STAGED shape/, 'a degraded stage logs staged-patch.md\'s line (ruling 2)'],
  [/Set `commit` to `landed\[\]\.commit`, shortened to the hash its AUTO line prints, and `pr` to `pr\.url`/, 'a landed finding gets commit and pr (ruling 4)'],
  [/set `action: "staged"` and `stagePath` to the absolute `staged\[\]\.stagePath`, and remove `commit`/, 'a staged finding is rewritten to staged (ruling 4)'],
  [/the FYI `PushNotification` carries that same engine-rendered section/, 'the FYI carries the PR URL'],
  [/appends `learned-skills PR \{url\}` to the Skills row's Detail cell/, 'the final summary trace carries the PR URL'],
  // Final-review I1: every finding on a shared target gets its own AUTO line.
  [/--summary-file "\{tmp-summary-file\}" --row "\{rowId\}"/, 'capture passes the finding\'s own row (I1)'],
  [/Every finding a landed entry carries, each `shared: true` one included, gets its own AUTO line under its own row and summary, all naming that entry's one commit, and the PR body lists every finding's summary/, 'one AUTO line per finding of a landed entry (I1)'],
  [/Match each finding to the output by the `id` its `capture` printed\. Findings that shared one capture share one entry, so they share its commit/, 'the payload rewrite maps by capture id (I1)'],
  [/On `manifestFailed: true` that record could not be written, so `land` logs no AUTO line for this finding: hand-log one/, 'a capture manifestFailed finding is hand-logged (I1)'],
  // Final-review M2: a manifest write failure after the PR opened is reported, never staged.
  [/A top-level `manifestFailed: true` from `land` \(exit 0\) means the manifest write after the push and the PR failed\. Every `landed\[\]` entry is on the PR/, 'land manifestFailed: the entries are on the PR (M2)'],
  [/hand-log the AUTO lines only when `logFailed` is set too, and do not call `stage`, which would stage edits the PR already carries/, 'land manifestFailed: hand-log on logFailed, never stage (M2)'],
  [/re-run the same `land` call once the run dir is writable: it reuses the pushed commits, records them, and writes no AUTO line twice/, 'land manifestFailed: the recovery re-land (M2)'],
  // Final-review I2: the mechanical backstops for a captured patch never landed or staged.
  [/`record` refuses an applied `skills`-row finding with no `commit` \(exit 1\)/, 'record refuses a commit-less applied skills finding (I2)'],
  [/`learned-skills-delivered` row fails while the manifest still holds a `captured` entry, naming each patch file, and that fail blocks the verdict/, 'verify\'s learned-skills-delivered backstop (I2)'],
  [/When it fails, run `land` \(`pr-first`\) or `stage` \(`local-merge`\) with `--run` set to the run dir the row names, which is the archived copy once the run dir is archived, then re-run `verify`/, 'the backstop\'s remedy (I2)'],
];
const missingProc = missingFactsOf(PROC_FACTS);

test('learned-skills-pr.md states every fact of the procedure', () => {
  assert.deepEqual(missingProc(PROC), []);
});

test('learned-skills-pr.md: each procedure fact goes red on its own', () => {
  assertEachPatternGoesRed(PROC, PROC_FACTS, missingProc);
});

// No merge command, no --auto: the PR waits for a human (Global Constraints). The control appends each
// banned form to the live text and the check must catch it.
const BANNED = [/gh pr merge/, /--auto\b/];
const bannedIn = (text) => BANNED.filter((re) => re.test(text)).map(String);

test('learned-skills-pr.md carries no merge command and no --auto', () => {
  assert.deepEqual(bannedIn(PROC), []);
  assert.deepEqual(bannedIn(`${PROC}\ngh pr merge 7 --squash`), ['/gh pr merge/']);
  assert.deepEqual(bannedIn(`${PROC}\narm it with --auto`), ['/--auto\\b/']);
});

// Ruling 3: the branch is built through git plumbing, so wrap-up is not a scratch-worktree caller.
test('scratch-worktree.md does not list the learned-skills PR as a caller', () => {
  assert.ok(SCRATCH.length > 0);
  assert.ok(!/learned-skills/.test(SCRATCH), 'wrap-up must not be added to scratch-worktree.md for this site');
  assert.ok(/learned-skills/.test(`${SCRATCH}\n- /claude-tweaks:wrap-up learned-skills-pr.md`), 'control: the check sees an added caller');
});

// The three fences, flags checked through the CLI's own run(): every required flag present and every
// value taken, so the call reaches the --run anchoring check (stubbed to "missing") instead of a
// usage error about the call's own shape.
const CLI = require('../plugin/bin/learned-skills-pr.js');

function fences(text) {
  return [...text.matchAll(/```bash\r?\n([\s\S]*?)\r?\n\s*```/g)].map((m) => m[1].trim());
}

function argvOf(line) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

function runFence(fence) {
  const argv = argvOf(fence);
  assert.equal(argv[0], 'node');
  assert.equal(argv[1], '${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js');
  let err = '';
  const code = CLI.run(argv.slice(2), {
    cwd: () => ROOT,
    resolveTarget: () => ({ ok: false, reason: 'missing' }),
    stderr: (s) => { err += s; },
    stdout: () => {},
  });
  return { code, err, verb: argv[2] };
}

test('learned-skills-pr.md fences: capture, land and stage each pass the CLI\'s own flag checks', () => {
  const found = fences(PROC);
  assert.equal(found.length, 3, 'three CLI fences');
  assert.deepEqual(found.map((f) => argvOf(f)[2]), ['capture', 'land', 'stage']);
  for (const fence of found) {
    const { code, err, verb } = runFence(fence);
    assert.equal(code, 2, `${verb}: reaches the stubbed --run refusal`);
    assert.match(err, /--run dir does not exist/, `${verb}: the call shape itself is valid (${err.split('\n')[0]})`);
  }
});

// Fix round 1, finding 1: in a multi-spec consolidated wrap-up $PIPELINE_RUN_DIR names one member's
// spec-{N}/ dir, so no fence may hard-code it. Every fence takes the {run} placeholder resolved once.
const runValues = (text) => fences(text).map((f) => { const a = argvOf(f); return a[a.indexOf('--run') + 1]; });

test('learned-skills-pr.md fences: every --run is the {run} placeholder, never $PIPELINE_RUN_DIR', () => {
  assert.deepEqual(runValues(PROC), ['{run}', '{run}', '{run}']);
  const doctored = PROC.replace('land --run "{run}"', 'land --run "$PIPELINE_RUN_DIR"');
  assert.notEqual(doctored, PROC);
  assert.deepEqual(runValues(doctored), ['{run}', '$PIPELINE_RUN_DIR', '{run}'], 'control: a hard-coded fence is seen');
});

test('control: a fence missing --merge-base fails the CLI\'s flag check', () => {
  const land = fences(PROC)[1];
  const doctored = land.replace(/ --merge-base "\{merge-base\}"/, '');
  assert.notEqual(doctored, land);
  const { err } = runFence(doctored);
  assert.match(err, /--merge-base is required/);
});

// ---- curation-engine.md section 4: the serial-commit pass --------------------

function passParagraph(text) {
  const paras = sectionOf(text, '## 4. Parallel dispatch and the learning-capture singleton').split('\n\n')
    .filter((p) => p.includes('the controller runs the serial-commit pass'));
  assert.equal(paras.length, 1, 'exactly one serial-commit pass paragraph');
  return paras[0];
}

const PASS_FACTS = [
  [/an earlier same-pass capture of this same `targetPath` counts like an earlier same-pass commit: run `capture` for it too, which returns `shared: true`, and never treat that as a payload violation/, 'step (1) treats an earlier same-pass capture like an earlier same-pass commit'],
  [/\(2\) \*\*commit\*\* — for a `skills`-row finding, or one whose `targetPath` an earlier same-pass capture took, run `learned-skills-pr\.md`'s `capture` instead/, 'step (2) routes a skills-row finding to learned-skills-pr.md'],
  [/Once the pass ends, the controller runs `learned-skills-pr\.md`'s `land` \(`pr-first`\) or `stage` \(`local-merge`\) call and rewrites the captured findings' payloads from its output, still \*\*before any `record` call\*\*\./, 'land/stage runs after the pass, before any record call'],
  [/— except a captured finding, which has no hash yet: write no AUTO line for it at this step, because it is attributed from `land`'s output instead \(`learned-skills-pr\.md`'s Payload rewrite\) and `land` writes its AUTO line/, 'step (3) does not attribute or log a captured finding'],
];
const missingPass = missingFactsOf(PASS_FACTS);

test('curation-engine.md: the serial-commit pass paragraph routes skills-row findings through learned-skills-pr.md', () => {
  assert.deepEqual(missingPass(passParagraph(ENGINE)), []);
});

test('curation-engine.md: each pass fact goes red on its own', () => {
  assertEachPatternGoesRed(passParagraph(ENGINE), PASS_FACTS, missingPass);
});

test('curation-engine.md step (1) names the same-pass capture beside the same-pass commit', () => {
  const para = passParagraph(ENGINE);
  const audit = para.slice(para.indexOf('(1) **audit**'), para.indexOf('(2) **commit**'));
  assert.ok(audit.length > 0, 'step (1) slice resolves');
  assert.match(audit, /already committed this same `targetPath`/);
  assert.match(audit, /an earlier same-pass capture of this same `targetPath` counts like an earlier same-pass commit/);
});

test('curation-engine.md step (3) carries the captured-finding exception inside its own slice', () => {
  const para = passParagraph(ENGINE);
  const attribute = para.slice(para.indexOf('(3) **attribute**'), para.indexOf('Once the pass ends'));
  assert.ok(attribute.length > 0, 'step (3) slice resolves');
  assert.match(attribute, /except a captured finding, which has no hash yet: write no AUTO line for it at this step/);
});

// Ordering (Reachability): the steps the pass orders, chained end to end. The land/stage sentence must
// sit after step (3) and before the paragraph's closing "before any record call".
const LAST_RECORD = '**before any `record` call**.';
const CHAIN = [
  '(1) **audit**',
  'an earlier same-pass capture of this same `targetPath` counts like',
  '(2) **commit**',
  "run `learned-skills-pr.md`'s `capture` instead",
  '(3) **attribute**',
  '— except a captured finding, which has no hash yet',
  "Once the pass ends, the controller runs `learned-skills-pr.md`'s `land`",
  LAST_RECORD,
];

function requireOrder(text, markers) {
  let last = -1;
  for (const m of markers) {
    const idx = m === LAST_RECORD ? text.lastIndexOf(m) : text.indexOf(m);
    if (idx === -1) throw new Error(`marker missing: ${m}`);
    if (idx <= last) throw new Error(`"${m}" must come after the marker before it`);
    last = idx;
  }
}

test('curation-engine.md: the pass orders audit, capture routing, attribute, then land/stage before record', () => {
  const para = passParagraph(ENGINE);
  requireOrder(para, CHAIN);
  assert.ok(para.indexOf('learned-skills-pr.md') < para.lastIndexOf(LAST_RECORD), 'the citation precedes the closing before-any-record text');
});

test('control: permuting each adjacent pair of the chain throws the ordering message', () => {
  const para = passParagraph(ENGINE);
  // Moving the land/stage sentence ahead of step (1) is the regression the chain guards.
  const sentence = /Once the pass ends,[^\n]*?still \*\*before any `record` call\*\*\./.exec(para)[0];
  const moved = para.replace(sentence, '').replace('(1) **audit**', `${sentence} (1) **audit**`);
  assert.notEqual(moved, para);
  assert.throws(() => requireOrder(moved, CHAIN), /must come after/);
  for (let i = 0; i + 1 < CHAIN.length - 1; i++) {
    const [a, b] = [CHAIN[i], CHAIN[i + 1]];
    const swapped = para.replace(a, '\u0000').replace(b, a).replace('\u0000', b);
    assert.notEqual(swapped, para);
    assert.throws(() => requireOrder(swapped, CHAIN), /must come after/, `swapping "${a}" and "${b}"`);
  }
  const absent = para.replace("Once the pass ends, the controller runs `learned-skills-pr.md`'s `land`", '');
  assert.notEqual(absent, para);
  assert.throws(() => requireOrder(absent, CHAIN), /marker missing/);
});

test('control: the land/stage sentence moved out of the pass paragraph fails the paragraph-scoped check', () => {
  const para = passParagraph(ENGINE);
  const sentence = /Once the pass ends,[^\n]*?still \*\*before any `record` call\*\*\./.exec(para)[0];
  const doctored = ENGINE.replace(` ${sentence}`, '').replace('## 5. Vocabulary rule', `${sentence}\n\n## 5. Vocabulary rule`);
  assert.notEqual(doctored, ENGINE);
  assert.ok(doctored.includes(sentence), 'the sentence is still in the file');
  assert.deepEqual(missingPass(passParagraph(doctored)), ['land/stage runs after the pass, before any record call']);
});

// ---- curation-engine.md section 3: the findings[].pr contract row -------------

const PR_ROW_FACTS = [
  [/^\| `findings\[\]\.pr` \| applied findings that rode a learned-skills PR \|/, 'the row names its field and when it is present'],
  [/The PR's URL \(`land`'s `pr\.url`\), written by the controller beside `commit` after the serial-commit pass \(`learned-skills-pr\.md`'s Payload rewrite\)/, 'the controller writes it from land'],
  [/a judge never fills it/, 'a judge never fills it'],
  [/render it on `applied` findings only/, 'rendered on applied findings only'],
];
const missingPrRow = missingFactsOf(PR_ROW_FACTS);
const prRowOf = (text) => text.split('\n').find((l) => l.startsWith('| `findings[].pr` |')) || '';

test('curation-engine.md section 3 has a findings[].pr row', () => {
  const s3 = sectionOf(ENGINE, '## 3. The payload contract');
  const row = prRowOf(s3);
  assert.ok(row, 'findings[].pr row present in section 3');
  assert.deepEqual(missingPrRow(row), []);
  assertEachPatternGoesRed(row, PR_ROW_FACTS, missingPrRow);
  assert.equal(prRowOf(s3.replace(`${row}\n`, '')), '', 'control: removing the row empties the lookup');
});

// ---- skill-curation.md 7.6 step 2 ---------------------------------------------

function stepTwo(text) {
  const start = text.indexOf('2. **Additive + reversibility:high + confidence:high**');
  const end = text.indexOf('3. **Restructural OR confidence:med-low**');
  assert.ok(start !== -1 && end > start, '7.6 step 2 slice resolves');
  return text.slice(start, end);
}

const CURATION_FACTS = [
  [/AUTO \d\d:\d\d:\d\d — Skills row: applied additive update to \{skill\}\/SKILL\.md \(\{section\}\) on learned-skills PR #\{pr\}\. Reversibility: high; commit: \{hash\}\./, 'the AUTO learned-skills PR shape'],
  [/STAGED \d\d:\d\d:\d\d — Skills row: skill update for \{skill\}\/SKILL\.md \(\{section\}\) could not ride a learned-skills PR \(\{reason\}\); staged instead\. Reversibility: high \(stage path: staged\/wrap-up-skill-\{N\}\.md\)\./, 'the STAGED downgrade shape'],
  [/AUTO \d\d:\d\d:\d\d — Skills row: applied additive update to \{skill\}\/SKILL\.md \(\{section\}\)\. Reversibility: high; commit: \{hash\}\./, 'the run-branch AUTO shape stays'],
  [/`\{skill\}\/SKILL\.md` is the target with its leading `\.claude\/skills\/` stripped \(the whole target path when it has none\), and `\{section\}` is the finding's `summary`/, 'the placeholder mapping'],
  [/a description-only or gate-could-not-run stage logs `_shared\/staged-patch\.md`'s own line instead/, 'the degraded-stage clause (ruling 2)'],
];
const missingCuration = missingFactsOf(CURATION_FACTS);

test('skill-curation.md 7.6 step 2 carries the AUTO and STAGED shapes', () => {
  assert.deepEqual(missingCuration(stepTwo(CURATION)), []);
  assertEachPatternGoesRed(stepTwo(CURATION), CURATION_FACTS, missingCuration);
});

// Fix round 1, finding 5: the prose templates are a second producer (the controller hand-logs from
// them on logFailed), so their fixed segments must also be what the library emits. The library is
// read as text with comments stripped (the shared stripper, bin-source-scan-conformance), so a
// segment surviving only in a comment does not count.
const LIB_FILES = ['land.js', 'learned-skills.js'].map((f) => path.join(ROOT, 'plugin', 'bin', 'lib', 'learned-skills', f));
const SEGMENTS = [
  'applied additive update to ',
  ') on learned-skills PR #',
  'high; commit: ',
  'skill update for ',
  ' could not ride a learned-skills PR (',
  '); staged instead',
  'high (stage path: staged/',
];
const missingSegments = (text) => SEGMENTS.filter((s) => !text.includes(s));

function libraryCode() {
  return LIB_FILES.map((f) => {
    const raw = readText(f);
    const stripped = stripComments(raw);
    assert.equal(stripperVerdict(raw, stripped), 'ok', `${path.basename(f)}: ${STRIPPER_VERDICT_MESSAGES[stripperVerdict(raw, stripped)] || 'stripper verdict not ok'}`);
    return stripped;
  }).join('\n');
}

test('the AUTO and STAGED template segments are both in skill-curation.md and in the library\'s code', () => {
  const code = libraryCode();
  const prose = stepTwo(CURATION);
  assert.deepEqual(missingSegments(prose), [], 'prose carries every segment');
  assert.deepEqual(missingSegments(code), [], 'library code carries every segment');
  assert.equal(STEP, 'Skills row', 'the library step label is the prose\'s "Skills row"');
  for (const s of SEGMENTS) {
    assert.deepEqual(missingSegments(code.split(s).join('')), [s], `control: "${s}" stripped from the library goes red`);
    assert.deepEqual(missingSegments(prose.split(s).join('')), [s], `control: "${s}" stripped from the prose goes red`);
  }
  assert.deepEqual(missingSegments(stripComments('// on learned-skills PR #\n')), SEGMENTS, 'control: a comment-only copy does not count');
});

// ---- I2: the verify check is a blocking check, and record's refusal is in the contract row ----

const TEMPLATE = collapse(readText(path.join(WRAP, 'summary-template.md')));
const blockingChecks = (text) => {
  const m = /Any OTHER failing check \(([^)]*)\)/.exec(text);
  assert.ok(m, 'the blocking-checks sentence resolves');
  return m[1];
};

test('summary-template.md lists learned-skills-delivered among the blocking checks, as verify registers it', () => {
  const { runVerify } = require('../plugin/bin/lib/wrap-up/engine-verify');
  const registered = runVerify({ runDir: null, base: 'main', deps: {} }).rows.map((r) => r.check);
  assert.ok(registered.includes('learned-skills-delivered'), 'verify registers the check');
  assert.ok(blockingChecks(TEMPLATE).includes('`learned-skills-delivered`'));
  const doctored = TEMPLATE.replace('`learned-skills-delivered`, ', '');
  assert.notEqual(doctored, TEMPLATE);
  assert.ok(!blockingChecks(doctored).includes('`learned-skills-delivered`'), 'control: dropping it from the list goes red');
});

test('curation-engine.md section 3 commit row says record refuses a commit-less applied skills finding', () => {
  const row = ENGINE.split('\n').find((l) => l.startsWith('| `findings[].commit` |')) || '';
  const claim = /`record` refuses an applied `skills`-row finding without one \(exit 1\): a captured edit gets its hash from `learned-skills-pr\.md`'s `land`, so run `land` or `stage` first/;
  assert.match(row, claim);
  assert.doesNotMatch(row.replace(claim, ''), claim, 'control: the claim stripped from the row goes red');
});

// ---- auto-merge-short-circuit.md: the pr-first FYI ----------------------------

function prFirstFyi(text) {
  const start = text.indexOf('**`integration-model: pr-first` (`_shared/integration-model.md`):**');
  const end = text.indexOf('**Why no `console.json` (#3297):**');
  assert.ok(start !== -1 && end > start, 'pr-first FYI slice resolves');
  return collapse(text.slice(start, end));
}

const FYI = /When a Skills-row edit rode a learned-skills PR \(`learned-skills-pr\.md`\), the FYI names that PR's URL/;

test('auto-merge-short-circuit.md: the pr-first FYI names the learned-skills PR URL', () => {
  const fyi = prFirstFyi(SHORT_CIRCUIT);
  assert.match(fyi, FYI);
  const doctored = fyi.replace(FYI, '');
  assert.notEqual(doctored, fyi);
  assert.doesNotMatch(doctored, FYI);
});

// ---- the PR URL end to end: record, then render trace and console --------------

const ENGINE_CLI = path.join(ROOT, 'plugin', 'bin', 'wrap-up-engine.js');
const LS_PR = 'https://github.com/o/r/pull/77';

test('AC8.1/AC8.2: a skills payload carrying pr renders the URL in the trace and the console', (t) => {
  const { buildWorklist } = require('../plugin/bin/lib/wrap-up/engine-plan');
  const { initState } = require('../plugin/bin/lib/wrap-up/engine-record');
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-11-13T000000-spec-5290');
  fs.mkdirSync(runDir, { recursive: true });
  const worklist = buildWorklist({
    facts: {
      isRepo: true, changedFiles: ['src/a.js', 'src/b.js'], renamedDeleted: [], skillsLibraryExists: true,
      multiFileDiff: true, docsTreeNonEmpty: false, journeysExist: false, journeyFiles: [],
      claudeMdCommandRenamed: false, renamedOrDeleted: false,
    },
    signals: {}, ceremonyProfile: 'standard', budgets: {},
  });
  initState({ runDir, worklist, now: new Date(2026, 10, 13, 12, 0, 0), telemetryPath: null });

  const payload = {
    version: 1, rowId: 'skills', result: 'findings', gapDetection: 'run', detail: 'Read 1',
    read: [{ path: '.claude/skills/a/SKILL.md', mode: 'full' }],
    findings: [{
      kind: 'patch', summary: 'Add a row', targetPath: '.claude/skills/a/SKILL.md',
      action: 'applied', stagePath: null, commit: 'abc1234', pr: LS_PR,
    }],
  };
  const spawn = (args, input) => spawnSync(process.execPath, [ENGINE_CLI, ...args], { cwd: repo, input, encoding: 'utf8' });
  const rec = spawn(['record', '--run-dir', runDir, '--dry-run'], JSON.stringify(payload));
  assert.equal(rec.status, 0, rec.stderr);

  const trace = spawn(['render', '--run-dir', runDir, '--section', 'trace']);
  assert.equal(trace.status, 0, trace.stderr);
  assert.match(trace.stdout, /\| Skills \| 1 applied \| Read 1 · learned-skills PR https:\/\/github\.com\/o\/r\/pull\/77 \|/);

  const consoleOut = spawn(['render', '--run-dir', runDir, '--section', 'console']);
  assert.equal(consoleOut.status, 0, consoleOut.stderr);
  assert.match(consoleOut.stdout, /applied \(abc1234, learned-skills PR https:\/\/github\.com\/o\/r\/pull\/77\)/);
});
