'use strict';
// tests/bin-lib/wrap-up/engine-record.test.js — validated judgment payloads,
// uniform SCANNED decision lines, outcome telemetry, and engine-state.json
// lifecycle. Uses real buildWorklist() output (Task 3) as the worklist fed
// into initState, rather than a hand-shaped stand-in, so a shape drift
// between engine-plan.js and this module fails here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildWorklist } = require('../../../plugin/bin/lib/wrap-up/engine-plan');
const { initState, recordResult, amendResult } = require('../../../plugin/bin/lib/wrap-up/engine-record');

// Same fixture as engine-plan.test.js: 'skills' and 'journeys' open (via
// multiFileDiff / journeysExist), 'docs' closed (no docs/ tree).
const FACTS = {
  isRepo: true, changedFiles: ['src/a.js', 'src/b.js'], renamedDeleted: [],
  skillsLibraryExists: false, multiFileDiff: true, docsTreeNonEmpty: false,
  journeysExist: true, journeyFiles: ['docs/journeys/j1.md', 'docs/journeys/j2.md'],
  claudeMdCommandRenamed: false, renamedOrDeleted: false,
};

const FIXED_NOW = '2026-08-08T12:00:00.000Z';

function makeRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-engine-record-'));
}

function makeWorklist() {
  return buildWorklist({ facts: FACTS, signals: {}, ceremonyProfile: 'standard', budgets: {} });
}

function statePath(runDir) {
  return path.join(runDir, 'engine-state.json');
}

function readState(runDir) {
  return JSON.parse(fs.readFileSync(statePath(runDir), 'utf8'));
}

function decisionsPath(runDir) {
  return path.join(runDir, 'decisions.md');
}

test('initState pre-resolves closed rows and writes their telemetry', () => {
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  const worklist = makeWorklist();

  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });

  assert.ok(fs.existsSync(statePath(runDir)));
  const state = readState(runDir);
  assert.strictEqual(state.results.docs.result, 'na');
  assert.strictEqual(state.results.docs.detail, 'no docs/ tree');

  const tsv = fs.readFileSync(telemetryPath, 'utf8');
  assert.match(tsv, /\tdocs\tclosed\t/);
});

test('initState writes a SCANNED line for closed rows: read 0, gap detection not run, n/a', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();

  initState({ runDir, worklist, now: FIXED_NOW });

  const decisions = fs.readFileSync(decisionsPath(runDir), 'utf8');
  assert.match(
    decisions,
    /SCANNED .* — Docs: gate closed \(no docs\/ tree\); read 0 \(none\); gap detection: not run\. Result: n\/a\. Reversibility: N\/A\./
  );
});

test('recordResult accepts a valid clean payload and appends exactly one new SCANNED line', () => {
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });
  // With this FACTS fixture, 6 of 8 rows are closed (docs, claude-md,
  // decision-records, references, memory, upstream) — each gets a SCANNED
  // line from initState. Only 'skills' and 'journeys' are open.
  const before = fs.readFileSync(decisionsPath(runDir), 'utf8').trim().split('\n').length;
  assert.strictEqual(before, 6);

  const payload = {
    version: 1, rowId: 'skills', result: 'clean',
    read: [{ path: '.claude/skills/upstream-drift.md', mode: 'full' }],
    findings: [], gapDetection: 'run', detail: 'Read 1: upstream-drift',
  };
  recordResult({ runDir, payload, now: FIXED_NOW, telemetryPath });

  const after = fs.readFileSync(decisionsPath(runDir), 'utf8').trim().split('\n');
  assert.strictEqual(after.length, 7);
});

test('recordResult SCANNED line for an open clean row matches the required shape', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  // Use a run dir where only one closed row exists ('docs'); assert on the
  // specific line for the 'skills' row rather than line count.
  initState({ runDir, worklist, now: FIXED_NOW });

  const payload = {
    version: 1, rowId: 'skills', result: 'clean',
    read: [{ path: '.claude/skills/upstream-drift.md', mode: 'full' }],
    findings: [], gapDetection: 'run', detail: 'Read 1: upstream-drift',
  };
  recordResult({ runDir, payload, now: FIXED_NOW });

  const decisions = fs.readFileSync(decisionsPath(runDir), 'utf8');
  assert.match(decisions, /^SCANNED .* — Skills: gate open/m);
  assert.match(
    decisions,
    /Skills: gate open \(.*\); read 1 \(\.claude\/skills\/upstream-drift\.md\); gap detection: run\. Result: clean\. Reversibility: N\/A\./
  );
});

test('recordResult rejects: unknown row, closed row, double record, empty findings', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW });

  assert.throws(
    () => recordResult({ runDir, payload: { version: 1, rowId: 'nonexistent', result: 'clean', gapDetection: 'run' }, now: FIXED_NOW }),
    /rowId/
  );

  assert.throws(
    () => recordResult({ runDir, payload: { version: 1, rowId: 'docs', result: 'clean', gapDetection: 'run' }, now: FIXED_NOW }),
    /closed/
  );

  const okPayload = { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run' };
  recordResult({ runDir, payload: okPayload, now: FIXED_NOW });
  assert.throws(
    () => recordResult({ runDir, payload: okPayload, now: FIXED_NOW }),
    /already/
  );

  assert.throws(
    () => recordResult({ runDir, payload: { version: 1, rowId: 'journeys', result: 'findings', findings: [], gapDetection: 'run' }, now: FIXED_NOW }),
    /findings/
  );
});

test('recordResult rejects missing/mistyped required fields', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW });

  assert.throws(
    () => recordResult({ runDir, payload: { version: 1, rowId: 'skills', gapDetection: 'run' }, now: FIXED_NOW }),
    /result/
  );
  assert.throws(
    () => recordResult({ runDir, payload: { version: 1, rowId: 'skills', result: 'clean' }, now: FIXED_NOW }),
    /gapDetection/
  );
  assert.throws(
    () => recordResult({ runDir, payload: { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run', read: 'not-an-array' }, now: FIXED_NOW }),
    /read/
  );
});

test('recordResult rejects a findings entry with a missing/malformed action, naming the entry', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW });

  const payload = {
    version: 1, rowId: 'journeys', result: 'findings', gapDetection: 'run',
    findings: [
      { kind: 'additive', summary: 'valid entry', targetPath: 'docs/journeys/j1.md', action: 'applied', stagePath: null, commit: null },
      { kind: 'new', summary: 'missing action', targetPath: 'docs/journeys/j2.md' /* no action */ },
    ],
  };

  assert.throws(
    () => recordResult({ runDir, payload, now: FIXED_NOW }),
    /findings\[1\]\.action/
  );

  // Rejected outright — nothing partially recorded for the row.
  const state = readState(runDir);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(state.results, 'journeys'), false);
});

test('recordResult rejects a findings entry with an invalid kind or summary', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW });

  assert.throws(
    () => recordResult({
      runDir, now: FIXED_NOW,
      payload: {
        version: 1, rowId: 'journeys', result: 'findings', gapDetection: 'run',
        findings: [{ kind: '', summary: 'x', targetPath: 'p', action: 'applied' }],
      },
    }),
    /findings\[0\]\.kind/
  );

  assert.throws(
    () => recordResult({
      runDir, now: FIXED_NOW,
      payload: {
        version: 1, rowId: 'journeys', result: 'findings', gapDetection: 'run',
        findings: [{ kind: 'additive', summary: '', targetPath: 'p', action: 'applied' }],
      },
    }),
    /findings\[0\]\.summary/
  );
});

test("recordResult rejects action:'applied' on a stage-only row (claude-md) — nothing recorded", () => {
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  // Open the claude-md gate (normally closed under the shared FACTS fixture)
  // via its fact trigger, so the disposition check — not the gate check — is
  // what's under test here. claude-md's disposition is 'stage-only'.
  const worklist = buildWorklist({
    facts: { ...FACTS, claudeMdCommandRenamed: true }, signals: {}, ceremonyProfile: 'standard', budgets: {},
  });
  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });

  const payload = {
    version: 1, rowId: 'claude-md', result: 'findings', gapDetection: 'run',
    findings: [{ kind: 'additive', summary: 'update a rule', targetPath: 'CLAUDE.md', action: 'applied', stagePath: null, commit: null }],
  };

  assert.throws(
    () => recordResult({ runDir, payload, now: FIXED_NOW, telemetryPath }),
    /stage-only/
  );

  // Nothing partially recorded: no state entry, no SCANNED line, no telemetry.
  const state = readState(runDir);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(state.results, 'claude-md'), false);

  const decisionsBefore = fs.readFileSync(decisionsPath(runDir), 'utf8');
  assert.doesNotMatch(decisionsBefore, /CLAUDE\.md & rules: gate open/);

  const tsv = fs.readFileSync(telemetryPath, 'utf8');
  assert.doesNotMatch(tsv, /\tclaude-md\topen\t/);
});

test("recordResult still records action:'applied' fine on an apply-or-stage row (skills) — inversion guard", () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist(); // skills is 'apply-or-stage' and open under the shared FACTS
  initState({ runDir, worklist, now: FIXED_NOW });

  const payload = {
    version: 1, rowId: 'skills', result: 'findings', gapDetection: 'run',
    findings: [{ kind: 'additive', summary: 'add a note', targetPath: 'skills/x/SKILL.md', action: 'applied', stagePath: null, commit: 'abc1234' }],
  };

  assert.doesNotThrow(() => recordResult({ runDir, payload, now: FIXED_NOW }));

  const state = readState(runDir);
  assert.strictEqual(state.results.skills.result, 'findings');
  assert.strictEqual(state.results.skills.findings[0].action, 'applied');
});

// #5290 final review I2: a captured Skills-row edit gets its commit from land. An applied finding with
// none never left capture, and the console would render it as `applied (undefined)`.
for (const commit of [undefined, null, '', '  ']) {
  test(`recordResult refuses an applied skills-row finding with commit ${JSON.stringify(commit)} — nothing recorded`, () => {
    const runDir = makeRunDir();
    initState({ runDir, worklist: makeWorklist(), now: FIXED_NOW });
    const finding = { kind: 'additive', summary: 'add a note', targetPath: '.claude/skills/x/SKILL.md', action: 'applied', stagePath: null };
    if (commit !== undefined) finding.commit = commit;
    const payload = { version: 1, rowId: 'skills', result: 'findings', gapDetection: 'run', findings: [finding] };
    assert.throws(() => recordResult({ runDir, payload, now: FIXED_NOW }),
      /payload\.findings\[0\] is an applied skills-row finding with no commit — run learned-skills-pr\.js land or stage first/);
    assert.strictEqual(readState(runDir).results.skills, undefined);
  });
}

test('recordResult still accepts a staged skills-row finding with no commit', () => {
  const runDir = makeRunDir();
  initState({ runDir, worklist: makeWorklist(), now: FIXED_NOW });
  const payload = {
    version: 1, rowId: 'skills', result: 'findings', gapDetection: 'run',
    findings: [{ kind: 'additive', summary: 'add a note', targetPath: '.claude/skills/x/SKILL.md', action: 'staged', stagePath: '/abs/staged/wrap-up-skill-1.md' }],
  };
  assert.doesNotThrow(() => recordResult({ runDir, payload, now: FIXED_NOW }));
});

test('recordResult still accepts a fully valid mixed applied+staged findings payload', () => {
  // Inverted check: confirms the new per-entry validation doesn't reject the
  // previously-passing mixed applied+staged case.
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });

  const payload = {
    version: 1, rowId: 'journeys', result: 'findings',
    read: [{ path: 'docs/journeys/j1.md', mode: 'full' }],
    findings: [
      { kind: 'additive', summary: 'x', targetPath: 'docs/journeys/j1.md', action: 'applied', stagePath: null, commit: null },
      { kind: 'new', summary: 'y', targetPath: 'docs/journeys/j2.md', action: 'staged', stagePath: 'staged/x.md', commit: null },
    ],
    gapDetection: 'not-run', detail: 'two changes',
  };

  assert.doesNotThrow(() => recordResult({ runDir, payload, now: FIXED_NOW, telemetryPath }));

  const state = readState(runDir);
  assert.strictEqual(state.results.journeys.result, 'findings');
  assert.strictEqual(state.results.journeys.findings.length, 2);
});

test('derived fields cannot be clobbered by the payload (no {...payload} spread)', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW });

  const payload = {
    version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run',
    extra: 'x', target: 'HACK',
  };
  const stored = recordResult({ runDir, payload, now: FIXED_NOW });

  assert.strictEqual(stored.target, 'Skills'); // from REGISTRY, not the payload's 'HACK'
  assert.strictEqual(Object.prototype.hasOwnProperty.call(stored, 'extra'), false);

  const state = readState(runDir);
  assert.strictEqual(state.results.skills.target, 'Skills');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(state.results.skills, 'extra'), false);
});

test('dryRun skips telemetry but still writes SCANNED + state', () => {
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  const worklist = makeWorklist();
  // initState writes the closed-row ('docs') telemetry line first.
  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });
  const beforeContents = fs.readFileSync(telemetryPath, 'utf8');

  const payload = { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run' };
  recordResult({ runDir, payload, now: FIXED_NOW, dryRun: true, telemetryPath });

  const afterContents = fs.readFileSync(telemetryPath, 'utf8');
  assert.strictEqual(afterContents, beforeContents); // untouched by the dryRun call

  const decisions = fs.readFileSync(decisionsPath(runDir), 'utf8');
  assert.match(decisions, /Skills: gate open/);

  const state = readState(runDir);
  assert.strictEqual(state.results.skills.result, 'clean');
});

test('a row never recorded is visible: state.results lacks the key', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW });

  const state = readState(runDir);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(state.results, 'skills'), false);
  // 'docs' (closed) IS pre-recorded by initState.
  assert.strictEqual(Object.prototype.hasOwnProperty.call(state.results, 'docs'), true);
});

test('findings payload renders applied/staged counts, reversibility, and telemetry outcome', () => {
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });

  const payload = {
    version: 1, rowId: 'journeys', result: 'findings',
    read: [{ path: 'docs/journeys/j1.md', mode: 'full' }],
    findings: [
      { kind: 'additive', summary: 'x', targetPath: 'docs/journeys/j1.md', action: 'applied', stagePath: null, commit: null },
      { kind: 'new', summary: 'y', targetPath: 'docs/journeys/j2.md', action: 'staged', stagePath: 'staged/x.md', commit: null },
    ],
    gapDetection: 'not-run', detail: 'two changes',
  };
  recordResult({ runDir, payload, now: FIXED_NOW, telemetryPath });

  const decisions = fs.readFileSync(decisionsPath(runDir), 'utf8');
  assert.match(
    decisions,
    /Journeys: gate open \(.*\); read 1 \(docs\/journeys\/j1\.md\); gap detection: not run\. Result: 1 applied, 1 staged\. Reversibility: high \(separate commit\)\./
  );

  const tsv = fs.readFileSync(telemetryPath, 'utf8');
  assert.match(tsv, /\tjourneys\topen\t2\tapplied/);
});

test('findings payload with only staged actions renders staged outcome and N/A reversibility', () => {
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });

  const payload = {
    version: 1, rowId: 'journeys', result: 'findings',
    read: [], findings: [
      { kind: 'new', summary: 'y', targetPath: 'docs/journeys/j2.md', action: 'staged', stagePath: 'staged/x.md', commit: null },
    ],
    gapDetection: 'not-run',
  };
  recordResult({ runDir, payload, now: FIXED_NOW, telemetryPath });

  const decisions = fs.readFileSync(decisionsPath(runDir), 'utf8');
  assert.match(
    decisions,
    /Journeys: gate open \(.*\); read 0 \(none\); gap detection: not run\. Result: 0 applied, 1 staged\. Reversibility: N\/A\./
  );

  const tsv = fs.readFileSync(telemetryPath, 'utf8');
  assert.match(tsv, /\tjourneys\topen\t1\tstaged/);
});

test('recordResult with no telemetryPath skips telemetry silently', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW }); // no telemetryPath at all — must not throw
  const payload = { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run' };
  assert.doesNotThrow(() => recordResult({ runDir, payload, now: FIXED_NOW }));
});

test('recordResult rejects a payload.detail matching FORBIDDEN_VOCABULARY — nothing written', () => {
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });
  const decisionsBefore = fs.readFileSync(decisionsPath(runDir), 'utf8');

  const payload = {
    version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run',
    detail: 'saw a domain-overlap issue while scanning',
  };

  assert.throws(
    () => recordResult({ runDir, payload, now: FIXED_NOW, telemetryPath }),
    /payload\.detail matches forbidden vocabulary/
  );

  const state = readState(runDir);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(state.results, 'skills'), false);
  assert.strictEqual(fs.readFileSync(decisionsPath(runDir), 'utf8'), decisionsBefore);
  const tsv = fs.readFileSync(telemetryPath, 'utf8');
  assert.doesNotMatch(tsv, /\tskills\t/);
});

test('recordResult rejects a findings[].summary matching FORBIDDEN_VOCABULARY, naming the entry', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW });

  const payload = {
    version: 1, rowId: 'journeys', result: 'findings', gapDetection: 'run',
    findings: [
      { kind: 'additive', summary: 'noted the gap detection result', targetPath: 'docs/journeys/j1.md', action: 'staged', stagePath: null, commit: null },
    ],
  };

  assert.throws(
    () => recordResult({ runDir, payload, now: FIXED_NOW }),
    /findings\[0\]\.summary matches forbidden vocabulary/
  );

  const state = readState(runDir);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(state.results, 'journeys'), false);
});

test('amendResult corrects a previously-recorded row and appends a distinct AMENDED line', () => {
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });

  recordResult({
    runDir, telemetryPath, now: FIXED_NOW,
    payload: { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run', detail: 'original detail' },
  });
  const decisionsAfterRecord = fs.readFileSync(decisionsPath(runDir), 'utf8').trim().split('\n');
  assert.match(decisionsAfterRecord[decisionsAfterRecord.length - 1], /^SCANNED .* — Skills:/);

  const amended = amendResult({
    runDir, telemetryPath, now: FIXED_NOW,
    payload: { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run', detail: 'corrected detail' },
  });
  assert.strictEqual(amended.detail, 'corrected detail');

  const state = readState(runDir);
  assert.strictEqual(state.results.skills.detail, 'corrected detail');

  const decisionsAfterAmend = fs.readFileSync(decisionsPath(runDir), 'utf8').trim().split('\n');
  assert.strictEqual(decisionsAfterAmend.length, decisionsAfterRecord.length + 1);
  assert.match(decisionsAfterAmend[decisionsAfterAmend.length - 1], /^AMENDED .* — Skills: gate open/);
});

test('amendResult does not double-append telemetry for the amended row', () => {
  const runDir = makeRunDir();
  const telemetryPath = path.join(runDir, 'outcomes.tsv');
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW, telemetryPath });

  recordResult({
    runDir, telemetryPath, now: FIXED_NOW,
    payload: { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run' },
  });
  const tsvBefore = fs.readFileSync(telemetryPath, 'utf8');
  const skillsLinesBefore = tsvBefore.split('\n').filter((l) => l.includes('\tskills\t')).length;
  assert.strictEqual(skillsLinesBefore, 1);

  amendResult({
    runDir, telemetryPath, now: FIXED_NOW,
    payload: { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run', detail: 'corrected' },
  });

  const tsvAfter = fs.readFileSync(telemetryPath, 'utf8');
  assert.strictEqual(tsvAfter, tsvBefore); // untouched by amendResult
});

test('amendResult re-runs FORBIDDEN_VOCABULARY validation — a forbidden amend is rejected, original untouched', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW });

  recordResult({
    runDir, now: FIXED_NOW,
    payload: { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run', detail: 'original detail' },
  });

  assert.throws(
    () => amendResult({
      runDir, now: FIXED_NOW,
      payload: { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run', detail: 'a domain-overlap correction' },
    }),
    /payload\.detail matches forbidden vocabulary/
  );

  const state = readState(runDir);
  assert.strictEqual(state.results.skills.detail, 'original detail'); // unchanged
  const decisions = fs.readFileSync(decisionsPath(runDir), 'utf8');
  assert.doesNotMatch(decisions, /^AMENDED/m);
});

test('amendResult throws when the row was never recorded — nothing to amend', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  initState({ runDir, worklist, now: FIXED_NOW });

  assert.throws(
    () => amendResult({
      runDir, now: FIXED_NOW,
      payload: { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run' },
    }),
    /never recorded/
  );
});

test('now defaults to the current time when omitted', () => {
  const runDir = makeRunDir();
  const worklist = makeWorklist();
  const before = Date.now();
  initState({ runDir, worklist });
  const state = readState(runDir);
  assert.ok(state.results.docs);

  const payload = { version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run' };
  recordResult({ runDir, payload });
  const decisions = fs.readFileSync(decisionsPath(runDir), 'utf8');
  const match = decisions.match(/^SCANNED (\S+) — Skills:/m);
  assert.ok(match, 'expected a SCANNED line for Skills');
  const stamped = new Date(match[1]).getTime();
  assert.ok(stamped >= before - 1000 && stamped <= Date.now() + 1000);
});
