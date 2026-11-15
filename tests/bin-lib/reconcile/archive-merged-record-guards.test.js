'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
// Destructured at require time, so this binding is a snapshot of the REAL
// implementation — it stays callable as the pass-through inside the
// compound-failure test's `t.mock.method(cp, 'execFileSync', ...)` below.
const { execFileSync } = cp;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  archiveRunDir, decideArchive, decideArchiveCore, readConsoleState, isOrphanedMint,
  archiveMerged, prefetchArchivePrStates, ORPHAN_MINT_TTL_MS,
  isStructurallyStuck, trackStuckSkip, STRUCTURALLY_STUCK_TTL_MS, STRUCTURALLY_STUCK_REASONS,
  isArchivedPendingTrackedMove, archivedPendingTrackedMoveCommand, compareWorkTwin,
  classifyRunDir, isAdHocStandaloneSuperseded, ADHOC_SUPERSEDED_TTL_MS,
  isClosedSlugStuck, recordNumbersFromSlug, refusal, runRecordSet, inFlightRecords,
  consoleResidue, consoleResidueHint, filingRerunRemedy,
  unfiledCantTellFindings, CANT_TELL_UNFILED_HINT, countOwnerlessNonClean,
} = require('../../../plugin/bin/lib/reconcile/archive-merged');
const { unfiledCantTell } = require('../../../plugin/bin/lib/console/finding-outcomes');
const { formatEntry } = require('../../../plugin/bin/lib/log-decision/append');
const { RESIDUE_ESCALATE_THRESHOLD, listResidueFailures, cachePath } = require('../../../plugin/bin/lib/reconcile/cache');
const { gateOriginRepo } = require('../../../plugin/bin/lib/repo-resolve');
const { createPrStateResolver } = require('../../../plugin/bin/lib/reconcile/pr-state-cache');
const { createTimings, withTimings, summarizeTimings } = require('../../../plugin/bin/lib/reconcile/timing');
const { serializeManifestYaml } = require('../../../plugin/bin/lib/flow/manifest');
const { STUB_SKIP } = require('../../helpers/path-stub');
const {
  git, trackedFiles, makeRepo, commitPath, ghJsonHeredoc, installGhWrapper, mergedFeatureBranchRepo,
  fixtureCleanUnarchivedRun, fixtureAbandonedShippedRun, DEAD, mkDirWithMtime, seedStuckDir4180,
  fixtureActiveUnstampedMergedRun, fixtureOrdinaryMergedNoConsole, ref,
} = require('./archive-merged-helpers');

// #1892: stamps `worktree-always: true` in `.claude-tweaks/policy.yml` — the
// flat kebab-case format `bin/lib/policy.js` reads directly (no YAML dep).
function setWorktreeAlways(root, value) {
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), `worktree-always: ${value}\n`);
}

// #3416: argv-dispatching gh wrapper for the run-PR identity tests — `list` is
// printed for `gh pr list ...`; `view` maps a PR number to the JSON printed for
// `gh pr view {n} ...`, and any unmapped number exits 1. `viewMarker`, when
// given, is touched on every `gh pr view` call so a test can prove the
// by-number probe never ran. `graphql`, when given as `{ body, exit }`, makes
// `gh api graphql ...` print `body` and exit `exit` (#3543's NOT_FOUND confirm
// probe — gh exits 1 on a GraphQL error yet still prints the body). Any other
// argv exits 1.
function installGhPrWrapper({ list, view, viewMarker, graphql }) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-ghprwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  const cases = Object.entries(view).map(([n, pr]) => `    ${n}) ${ghJsonHeredoc(pr)}\n      ;;`).join('\n');
  const script = [
    '#!/bin/sh',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
    `  ${ghJsonHeredoc(list)}`,
    'elif [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
    viewMarker ? `  touch '${viewMarker}'` : '',
    '  case "$3" in',
    cases,
    '    *) exit 1 ;;',
    '  esac',
    ...(graphql ? [
      'elif [ "$1" = "api" ] && [ "$2" = "graphql" ]; then',
      `  cat <<'EOF'\n${graphql.body}\nEOF`, // raw body — ghJsonHeredoc would JSON-quote a string
      `  exit ${graphql.exit}`,
    ] : []),
    'else',
    '  exit 1',
    'fi',
    '',
  ].join('\n');
  fs.writeFileSync(wrapperPath, script);
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return { restore: () => { process.env.PATH = originalPath; } };
}

// #1811: resolveIssueStateByNumber (pr-state.js) shells to `gh issue view {n}
// --json state`, bound at archive-merged.js's own require time same as
// resolvePrState — intercept at the process-spawn boundary, argv-dispatching
// on `$1 $2` so this wrapper coexists with a test that ALSO needs `gh pr
// list`/`gh pr view` to keep returning their own canned JSON (installGhWrapper
// above always returns the same body regardless of subcommand).
function installGhIssueStateWrapper(stateByNumber) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-ghissuewrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  const cases = Object.entries(stateByNumber)
    .map(([n, s]) => `    ${n}) echo '${JSON.stringify({ state: s })}' ;;`)
    .join('\n');
  const script = [
    '#!/bin/sh',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    '  case "$3" in',
    cases,
    '    *) echo \'{"state":"OPEN"}\' ;;',
    '  esac',
    'else',
    '  echo \'[]\'',
    'fi',
  ].join('\n');
  fs.writeFileSync(wrapperPath, script);
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return { restore: () => { process.env.PATH = originalPath; } };
}

// #3249: decideArchiveCore's new third parameter — defaults (2-arg calls,
// every pre-existing caller) preserve today's unconditional skip; only an
// explicit `hasStagedPending: false` unlocks the archive path.
test('decideArchiveCore: consoleState none + MERGED + no 3rd arg still skips (unchanged default)', () => {
  const decision = decideArchiveCore({ state: 'MERGED' }, 'none');
  assert.deepStrictEqual(decision, { action: 'skip', reason: 'console-never-rendered' });
});
test('AC1.2: decideArchiveCore: consoleState none + MERGED + hasStagedPending:true skips with the staged-pending reason (#3297)', () => {
  const decision = decideArchiveCore({ state: 'MERGED' }, 'none', true);
  assert.deepStrictEqual(decision, { action: 'skip', reason: 'console-never-rendered-staged-pending' });
});
test('STRUCTURALLY_STUCK_REASONS includes console-never-rendered-staged-pending but not plain console-never-rendered (#3297)', () => {
  assert.equal(STRUCTURALLY_STUCK_REASONS.has('console-never-rendered-staged-pending'), true);
  assert.equal(STRUCTURALLY_STUCK_REASONS.has('console-never-rendered'), false);
});
test('decideArchiveCore: consoleState none + MERGED + hasStagedPending:false archives (#3249)', () => {
  const decision = decideArchiveCore({ state: 'MERGED' }, 'none', false);
  assert.deepStrictEqual(decision, { action: 'archive' });
});
test('decideArchiveCore: consoleState unresolved still skips regardless of hasStagedPending', () => {
  assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'unresolved', false), { action: 'skip', reason: 'console-unresolved' });
});

// #3949: a resolved console holding an unacknowledged unresolved item blocks
// archival — in decideArchiveCore unconditionally, whatever the staged evidence.
test('AC6: decideArchiveCore: consoleState residue skips console-residue, regardless of hasStagedPending', () => {
  for (const staged of [false, true, undefined]) {
    assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'residue', staged), { action: 'skip', reason: 'console-residue' });
  }
});
test('decideArchiveCore: console-residue keeps its place after the PR-state skips and is not a structurally-stuck reason', () => {
  assert.deepStrictEqual(decideArchiveCore({ state: 'OPEN' }, 'residue', false), { action: 'skip', reason: 'pr-open' });
  assert.equal(STRUCTURALLY_STUCK_REASONS.has('console-residue'), false);
});

function residueRunDir(consoleBody, { specBody } = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-residue-'));
  const put = (dir, body) => {
    fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'staged', 'review-debate-deviation.md'), 'x');
    fs.writeFileSync(path.join(dir, 'console.json'), typeof body === 'string' ? body : JSON.stringify(body));
  };
  put(runDir, consoleBody);
  if (specBody !== undefined) put(path.join(runDir, 'spec-4'), specBody);
  return runDir;
}
const heldItem = (resolution) => ({ id: 'review-debate-deviation.md', section: 'Contested findings', resolution, reason: 'r' });

test('AC6: readConsoleState: a resolved console holding a keep-staged item reads residue, and decideArchive refuses it', () => {
  const runDir = residueRunDir({ resolved: true, items: [heldItem('keep-staged')] });
  assert.strictEqual(readConsoleState(runDir), 'residue');
  assert.deepStrictEqual(decideArchive({ state: 'MERGED' }, readConsoleState(runDir)), { action: 'skip', reason: 'console-residue' });
});
test('AC2: readConsoleState: a resolved console holding a pending item reads residue', () => {
  assert.strictEqual(readConsoleState(residueRunDir({ resolved: true, items: [heldItem('pending')] })), 'residue');
});
test('readConsoleState: an acknowledged residue console reads resolved and archives', () => {
  const runDir = residueRunDir({ resolved: true, residueAcknowledgedAt: '2026-10-24T10:00:00Z', items: [heldItem('keep-staged')] });
  assert.strictEqual(readConsoleState(runDir), 'resolved');
  assert.deepStrictEqual(decideArchive({ state: 'MERGED' }, readConsoleState(runDir)), { action: 'archive' });
});
test('readConsoleState: an unresolved item whose staged file is gone is not residue (missing semantics kept)', () => {
  const runDir = residueRunDir({ resolved: true, items: [heldItem('keep-staged')] });
  fs.rmSync(path.join(runDir, 'staged', 'review-debate-deviation.md'));
  assert.strictEqual(readConsoleState(runDir), 'resolved');
});
test('readConsoleState: a spec-N console with residue makes the run residue, even under a clean top-level console', () => {
  const runDir = residueRunDir({ resolved: true, items: [] }, { specBody: { resolved: true, items: [heldItem('pending')] } });
  assert.strictEqual(readConsoleState(runDir), 'residue');
});
test('readConsoleState: an unreadable spec-N console fails closed to residue', () => {
  assert.strictEqual(readConsoleState(residueRunDir({ resolved: true, items: [] }, { specBody: '{not json' })), 'residue');
});
test('readConsoleState: an unresolved top-level console keeps precedence over residue', () => {
  assert.strictEqual(readConsoleState(residueRunDir({ resolved: false, items: [heldItem('pending')] })), 'unresolved');
});
test('readConsoleState: no top-level console.json but a spec-N console holding an unacknowledged keep-staged item reads residue', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-residue-spec-only-'));
  const specDir = path.join(runDir, 'spec-4');
  fs.mkdirSync(path.join(specDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(specDir, 'staged', 'review-debate-deviation.md'), 'x');
  fs.writeFileSync(path.join(specDir, 'console.json'), JSON.stringify({ resolved: true, items: [heldItem('keep-staged')] }));
  assert.strictEqual(fs.existsSync(path.join(runDir, 'console.json')), false, 'fixture: no top-level console.json');
  assert.strictEqual(readConsoleState(runDir), 'residue');
});
test('readConsoleState: no console anywhere still reads none', () => {
  assert.strictEqual(readConsoleState(fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-residue-none-'))), 'none');
});

// #4172: a PR console's failed item is residue; executed/dropped items are not, and
// consoleResidue names each open item as "{id} ({resolution})".
function prConsoleRunDir(items) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-residue-pr-'));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    prNumber: 42, commentIds: ['IC_1'], executedAt: '2026-10-25T10:00:00.000Z', resolved: false,
    items: items.map(([id, outcome]) => ({ id, kind: 'staged', summary: id, outcome })),
  }));
  return runDir;
}
test('consoleResidue: a PR console with a filing-failed item counts and names it; readConsoleState reads residue (#4172)', () => {
  const runDir = prConsoleRunDir([['1', 'executed'], ['f1', 'filing-failed']]);
  assert.deepStrictEqual(consoleResidue(runDir), { items: 1, unreadable: [], names: ['f1 (filing-failed)'] });
  assert.strictEqual(readConsoleState(runDir), 'residue');
});
test('consoleResidue: a PR console with only executed/dropped items is not residue and reads resolved (#4172)', () => {
  const runDir = prConsoleRunDir([['1', 'executed'], ['d1', 'dropped']]);
  assert.deepStrictEqual(consoleResidue(runDir), { items: 0, unreadable: [], names: [] });
  assert.strictEqual(readConsoleState(runDir), 'resolved');
});

test('consoleResidueHint: names the open items and the unreadable console.json when both block (#4172)', () => {
  const runDir = prConsoleRunDir([['1', 'executed'], ['f1', 'filing-failed']]);
  const badPath = path.join(runDir, 'spec-12', 'console.json');
  fs.mkdirSync(path.dirname(badPath), { recursive: true });
  fs.writeFileSync(badPath, '{not json');
  const hint = consoleResidueHint(runDir);
  assert.match(hint, /unresolved: f1 \(filing-failed\) — review them, then run console-residue\.js --ack --run /);
  assert.ok(hint.includes(`repair or remove ${badPath}`), hint);
});
test('consoleResidueHint: names only the unreadable console.json when no item is open (#4172)', () => {
  const runDir = prConsoleRunDir([['1', 'executed']]);
  const badPath = path.join(runDir, 'spec-12', 'console.json');
  fs.mkdirSync(path.dirname(badPath), { recursive: true });
  fs.writeFileSync(badPath, '{not json');
  assert.strictEqual(consoleResidueHint(runDir), `repair or remove ${badPath}`);
});

// #4170: a planned can't-tell filing (`console.json#filings`) with no filed line in decisions.md is
// `filing-pending` residue; the refusal names the `console-filings.js --only` re-run beside the ack.
const PLANNED_FILED_LINE = '- AUTO 10:00:00 — Queue write: tiebreak:aaaaaaaaaaaa filed as #501 (work-fingerprint consolefinding-0123abcd). Reversibility: n/a.\n';
function plannedFilingRunDir() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-residue-filing-'));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    resolved: true,
    mode: 'auto-resolve',
    items: [{ id: 'tiebreak:aaaaaaaaaaaa', section: 'Low-confidence findings', resolution: 'filed', reason: 'r' }],
    filings: [{ item: 'tiebreak:aaaaaaaaaaaa', fingerprint: 'consolefinding-0123abcd', title: 't' }],
  }));
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '## /wrap-up\n');
  return runDir;
}
test('AC3.1: a console holding a planned filing with no record reads residue and the hint names the console-filings.js --only re-run (#4170)', () => {
  const runDir = plannedFilingRunDir();
  assert.strictEqual(readConsoleState(runDir), 'residue');
  assert.deepStrictEqual(consoleResidue(runDir), { items: 1, unreadable: [], names: ['tiebreak:aaaaaaaaaaaa (filing-pending)'] });
  assert.ok(consoleResidueHint(runDir).includes(
    `re-run the planned filing(s): console-filings.js --run "${runDir}" --existing <issues.json> --out-dir <dir> --only 'tiebreak:aaaaaaaaaaaa', then file each printed \`file\` entry and log it as '{item} filed as #{n} (work-fingerprint {fp})', hand-log any \`logFailures\` item as '{item} already filed as #{n} (work-fingerprint {fp})' (the CLI logs each \`deduped\` entry itself), via log-decision.js \`--run\` that console's dir, per wrap-up/review-console.md's Can't-tell filings; or review them, then run console-residue.js --ack --run "${runDir}"`,
  ), consoleResidueHint(runDir));
});
test('filingRerunRemedy is empty for a residue console with no planned filing (#4170)', () => {
  const runDir = prConsoleRunDir([['f1', 'filing-failed']]);
  assert.strictEqual(filingRerunRemedy(runDir), '');
  assert.match(consoleResidueHint(runDir), /unresolved: f1 \(filing-failed\) — review them, then run console-residue\.js --ack --run /);
});
test('AC4.1: once the filed line is logged the run reads resolved (#4170)', () => {
  const runDir = plannedFilingRunDir();
  fs.appendFileSync(path.join(runDir, 'decisions.md'), PLANNED_FILED_LINE);
  assert.strictEqual(readConsoleState(runDir), 'resolved');
});
test('filingRerunRemedy names one re-run per unacknowledged console, each with only its unfiled planned filings (#4170)', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-residue-filings-'));
  const [a, b, c, d] = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', 'dddddddddddd'].map((h) => `tiebreak:${h}`);
  const fp = { [a]: 'consolefinding-0123abcd', [b]: 'consolefinding-4567ef01', [c]: 'consolefinding-89abcdef', [d]: 'consolefinding-02468ace' };
  const item = (id) => ({ id, section: 'Low-confidence findings', resolution: 'filed', reason: 'r' });
  const filing = (id) => ({ item: id, fingerprint: fp[id], title: 't' });
  const filedLine = (id, n) => `- AUTO 10:00:00 — Queue write: ${id} filed as #${n} (work-fingerprint ${fp[id]}). Reversibility: n/a.`;
  const specConsole = (spec, { items, filings, filed = [], acknowledged = false }) => {
    const dir = path.join(parent, `spec-${spec}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ resolved: true, mode: 'auto-resolve', items, filings, ...(acknowledged ? { residueAcknowledgedAt: '2026-10-25T10:00:00.000Z' } : {}) }));
    fs.writeFileSync(path.join(dir, 'decisions.md'), `## /wrap-up\n${filed.join('\n')}\n`);
    return dir;
  };
  // spec-1 mixes a filed filing, an unfiled one, and an unrelated keep-staged item the re-run must not name.
  const one = specConsole(1, { items: [item(a), item(b), { id: 'reflect-1.md', section: 'Pending review', resolution: 'keep-staged', reason: 'r' }], filings: [filing(a), filing(b)], filed: [filedLine(a, 501)] });
  const two = specConsole(2, { items: [item(c)], filings: [filing(c)] });
  const three = specConsole(3, { items: [item(d)], filings: [filing(d)], acknowledged: true });
  const remedy = filingRerunRemedy(parent);
  assert.ok(remedy.includes(`console-filings.js --run "${one}" --existing <issues.json> --out-dir <dir> --only '${b}'`), remedy);
  assert.ok(remedy.includes(`console-filings.js --run "${two}" --existing <issues.json> --out-dir <dir> --only '${c}'`), remedy);
  assert.ok(!remedy.includes(three) && !remedy.includes(d), `an acknowledged console is not named: ${remedy}`);
  assert.ok(!remedy.includes(a) && !remedy.includes('reflect-1.md'), `a filed filing and a non-filing item are not named: ${remedy}`);
});

test('decideArchiveCore: invalid-arguments skips with reason invalid-arguments (#3416)', () => {
  assert.deepStrictEqual(decideArchiveCore('invalid-arguments', 'resolved'), { action: 'skip', reason: 'invalid-arguments' });
});

// #4794: pr-state's by-number lookup answers 'unknown-host' for a refused origin; the closed
// PR-state vocabulary here must skip it under its own reason, never as a closed-unmerged PR.
test('decideArchiveCore (#4794): an unknown-host PR state skips unknown-host, carrying the record check\'s refusal as the hint', () => {
  assert.deepStrictEqual(decideArchiveCore('unknown-host', 'resolved'), { action: 'skip', reason: 'unknown-host' });
  assert.deepStrictEqual(
    decideArchiveCore('unknown-host', 'resolved', false, { records: [5], repoSlug: null, repoRefusal: 'the gate refusal' }),
    { action: 'skip', reason: 'unknown-host', hint: 'the gate refusal' },
  );
  assert.deepStrictEqual(
    decideArchiveCore('unknown-host', 'none', false, { records: [], repoSlug: null, repoRefusal: null }),
    { action: 'skip', reason: 'unknown-host' },
  );
});

test('AC1.1 decideArchiveCore: MERGED + resolved console + a record the PR does not close skips merged-partial naming it', () => {
  const pr = { state: 'MERGED', closingIssuesReferences: [ref(3306), ref(3307)] };
  assert.deepStrictEqual(
    decideArchiveCore(pr, 'resolved', false, { records: [3306, 3307, 3311], repoSlug: 'acme/w' }),
    { action: 'skip', reason: 'merged-partial', unclosed: [3311] });
});
test('AC2.1 decideArchiveCore: MERGED + every record closed archives', () => {
  const pr = { state: 'MERGED', closingIssuesReferences: [ref(3306), ref(3311)] };
  assert.deepStrictEqual(decideArchiveCore(pr, 'none', false, { records: [3311, 3306], repoSlug: 'acme/w' }), { action: 'archive' });
});
test('AC4.1 decideArchiveCore: no closingIssuesReferences array skips closing-issues-unknown, never archives', () => {
  assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'resolved', false, { records: [5], repoSlug: 'acme/w' }),
    { action: 'skip', reason: 'closing-issues-unknown' });
});
test('AC4.1 decideArchiveCore: an unresolvable repo slug skips no-repo-slug (#3503 F3)', () => {
  const pr = { state: 'MERGED', closingIssuesReferences: [ref(5)] };
  assert.deepStrictEqual(decideArchiveCore(pr, 'resolved', false, { records: [5], repoSlug: null }),
    { action: 'skip', reason: 'no-repo-slug' });
});
test('decideArchiveCore: a same-number closing reference in another repo does not count as closing', () => {
  const pr = { state: 'MERGED', closingIssuesReferences: [ref(5, 'other', 'repo')] };
  assert.deepStrictEqual(decideArchiveCore(pr, 'resolved', false, { records: [5], repoSlug: 'acme/w' }),
    { action: 'skip', reason: 'merged-partial', unclosed: [5] });
});
test('AC3.1 decideArchiveCore: records null or recordCheck absent behaves exactly as before', () => {
  const pr = { state: 'MERGED' };
  assert.deepStrictEqual(decideArchiveCore(pr, 'resolved', false, { records: null, repoSlug: 'acme/w' }), { action: 'archive' });
  assert.deepStrictEqual(decideArchiveCore(pr, 'resolved'), { action: 'archive' });
});
test('decideArchiveCore: existing skip reasons keep precedence over the record check', () => {
  const check = { records: [9], repoSlug: 'acme/w' };
  assert.deepStrictEqual(decideArchiveCore({ state: 'OPEN' }, 'resolved', false, check), { action: 'skip', reason: 'pr-open' });
  assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'unresolved', false, check), { action: 'skip', reason: 'console-unresolved' });
  assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'none', true, check), { action: 'skip', reason: 'console-never-rendered-staged-pending' });
  assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'none', undefined, check), { action: 'skip', reason: 'console-never-rendered' });
  assert.deepStrictEqual(decideArchiveCore('network-failure', 'resolved', false, check), { action: 'skip', reason: 'network-failure' });
  assert.deepStrictEqual(decideArchiveCore('gh-absent', 'resolved', false, check), { action: 'skip', reason: 'gh-absent' });
});
test('STRUCTURALLY_STUCK_REASONS includes merged-partial and no-repo-slug but not closing-issues-unknown', () => {
  assert.ok(STRUCTURALLY_STUCK_REASONS.has('merged-partial'));
  assert.ok(STRUCTURALLY_STUCK_REASONS.has('no-repo-slug'));
  assert.ok(STRUCTURALLY_STUCK_REASONS.has('unknown-host'));
  assert.ok(!STRUCTURALLY_STUCK_REASONS.has('closing-issues-unknown'));
});

// #3503: the by-number fallback shape — the branch ref is deleted, so only the
// run-state's pr.number reaches the merged PR. `closes` are the record numbers
// the PR's closingIssuesReferences name.
// `issueStates` answers `gh issue view`; `consoleResolved` writes a resolved
// console.json.
function fixtureByNumberMergedRecordRun({ runId, closes, issueStates = null, consoleResolved = false, findings = null, decisions = null }) {
  const branch = 'feat-3503-bynumber';
  const { root, featureSha } = mergedFeatureBranchRepo(branch);
  git(root, 'remote', 'add', 'origin', 'git@github.com:acme/w.git');
  git(root, 'branch', '-D', branch); // branch ref gone too — nothing for fallbackBranch to recover
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', `gone-${runId}`),
    pr: { number: 3503001, branch },
  }));
  if (consoleResolved) fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  // #3945: an optional review-findings.json body (the tiebreak denominator).
  if (findings !== null) fs.writeFileSync(path.join(runDir, 'review-findings.json'), JSON.stringify(findings));
  // #4171: an optional decisions.md body (the auto-merge line and tiebreak verdicts).
  if (decisions !== null) fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
  const pr = {
    number: 3503001, state: 'MERGED', mergedAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
    mergeCommit: { oid: featureSha }, closingIssuesReferences: closes.map((n) => ref(n)),
  };
  // `rerun` drives a second archiveMerged pass over the same fixture, with the same gh answers.
  const rerun = () => {
    const wrapper = installGhWrapper(pr, issueStates);
    try { return archiveMerged({ cwd: root }); } finally { wrapper.restore(); }
  };
  return { root, runDir, result: rerun(), rerun };
}

// #3503 AC1.1/AC1.2/AC5.1: a multi-spec run (the #3311 incident shape) whose
// merged PR closes 3306 but leaves the still-running 3311 open must stay put.
test('AC1.1/AC1.2/AC5.1 regression: a multi-spec run whose merged PR leaves a running manifest record unclosed is not archived (#3311 shape, branch-joined path)', { skip: STUB_SKIP }, () => {
  const { runDir, runStateBefore, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3311-partial', '2026-10-17T062549-spec-3306-3311', [], {},
    {
      origin: true,
      closes: [3306],
      manifestSpecs: [
        { id: 3306, status: 'complete', subdir: 'spec-3306/' },
        { id: 3311, status: 'running', subdir: 'spec-3311/' },
      ],
    },
  );
  assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), true, 'the run dir must stay in place');
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'merged-partial');
  assert.deepEqual(skip.unclosed, [3311]);
  assert.equal(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'), runStateBefore, 'run-state.json must be byte-identical');
});

test('AC1.1 by-number path: the same partial merge reached via the by-number fallback is not archived', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-19T090000-record-3503-3504';
  const { runDir, result } = fixtureByNumberMergedRecordRun({ runId, closes: [3503] });
  assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), true, 'the run dir must stay in place');
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'merged-partial');
  assert.deepEqual(skip.unclosed, [3504]);
});

test('AC2.1: a merged PR closing every manifest record archives on the branch-joined path', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3311-complete', '2026-10-17T062549-spec-3306-3311', [], {},
    {
      origin: true,
      closes: [3311, 3306],
      manifestSpecs: [
        { id: 3306, status: 'complete', subdir: 'spec-3306/' },
        { id: 3311, status: 'complete', subdir: 'spec-3311/' },
      ],
    },
  );
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');
});

test('AC2.1: a merged PR closing every manifest record archives on the by-number path', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-19T090000-record-3503-3504';
  const root = fixtureByNumberMergedRecordRun({ runId, closes: [3504, 3503] }).root;
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), true);
});

test('AC3.1: a singleton record-{n} run whose PR closes its record archives as before', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-singleton', '2026-10-19T090000-record-3503', [], {}, { origin: true, closes: [3503] },
  );
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');
});

test('AC4.1: a merged PR object without closingIssuesReferences skips closing-issues-unknown and is not archived', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-unknown', '2026-10-19T090000-record-3503', [], {}, { origin: true },
  );
  assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), true, 'the run dir must stay in place');
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'closing-issues-unknown');
});

test('a failed manifest spec does not block archival', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-failed-spec', '2026-10-19T090000-spec-1-2', [], {},
    {
      origin: true,
      closes: [1],
      manifestSpecs: [
        { id: 1, status: 'complete', subdir: 'spec-1/' },
        { id: 2, status: 'failed', subdir: 'spec-2/' },
      ],
    },
  );
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');
});

test('the status:clean sweep is exempt: a clean run whose merged PR closes nothing still archives', { skip: STUB_SKIP }, () => {
  const runId = '2026-08-01T090000-record-77';
  const { root, runDir, featureSha } = fixtureCleanUnarchivedRun({ runId, origin: true });
  const wrapper = installGhWrapper([{
    number: 77, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    // A non-empty list naming some other issue: an empty list would let the
    // empty-linkage fallback archive the run even if the sweep gained the check.
    mergeCommit: { oid: featureSha }, closingIssuesReferences: [ref(5)],
  }]);
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');
});

test('a merged-partial skip past the TTL enters the structurally-stuck residue counter', { skip: STUB_SKIP }, () => {
  const { root, runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-stuck', '2026-10-17T062549-spec-3306-3311', [], {},
    {
      origin: true,
      closes: [3306],
      manifestSpecs: [
        { id: 3306, status: 'complete', subdir: 'spec-3306/' },
        { id: 3311, status: 'running', subdir: 'spec-3311/' },
      ],
      staleMs: STRUCTURALLY_STUCK_TTL_MS * 2,
    },
  );
  assert.equal(result.skipped.find((s) => s.runDir === runDir)?.reason, 'merged-partial');
  const failures = listResidueFailures(root);
  assert.ok(
    failures.some((f) => f.reason === 'structurally-stuck' && f.path === runDir),
    `expected ${runDir} to start accumulating a structurally-stuck residue count, got ${JSON.stringify(failures)}`,
  );
});

// --- #3503 F1: a record closed by another route (a second PR, by hand, at
// /release) satisfies the run; the issue-state probe runs in the caller. ---
const PARTIAL_MANIFEST = [
  { id: 3306, status: 'complete', subdir: 'spec-3306/' },
  { id: 3311, status: 'running', subdir: 'spec-3311/' },
];

test('F1 branch-joined: a record the PR does not close but whose issue is CLOSED lets the run archive', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f1-closed', '2026-10-17T062549-spec-3306-3311', [], {},
    { origin: true, closes: [3306], manifestSpecs: PARTIAL_MANIFEST, issueStates: { 3311: 'CLOSED' } },
  );
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');
});

test('F1 branch-joined: the same shape with the issue OPEN stays merged-partial', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f1-open', '2026-10-17T062549-spec-3306-3311', [], {},
    { origin: true, closes: [3306], manifestSpecs: PARTIAL_MANIFEST, issueStates: { 3311: 'OPEN' } },
  );
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'merged-partial');
  assert.deepEqual(skip.unclosed, [3311]);
  assert.equal(fs.existsSync(runDir), true);
});

test('F1 branch-joined: only the still-open records remain in unclosed after the probe', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f1-narrow', '2026-10-17T062549-spec-1-2-3', [], {},
    {
      origin: true,
      closes: [1],
      manifestSpecs: [
        { id: 1, status: 'complete', subdir: 'spec-1/' },
        { id: 2, status: 'running', subdir: 'spec-2/' },
        { id: 3, status: 'running', subdir: 'spec-3/' },
      ],
      issueStates: { 2: 'CLOSED', 3: 'OPEN' },
    },
  );
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'merged-partial');
  assert.deepEqual(skip.unclosed, [3]);
});

test('F1 branch-joined: an issue-state probe failure keeps the run merged-partial (fails closed)', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f1-probefail', '2026-10-17T062549-spec-3306-3311', [], {},
    { origin: true, closes: [3306], manifestSpecs: PARTIAL_MANIFEST, issueStates: { 3311: 'FAIL' } },
  );
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'merged-partial');
  assert.deepEqual(skip.unclosed, [3311]);
  assert.equal(fs.existsSync(runDir), true);
});

test('F1 by-number: a record the PR does not close but whose issue is CLOSED lets the run archive', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-19T090000-record-3503-3504';
  const { root } = fixtureByNumberMergedRecordRun({ runId, closes: [3503], issueStates: { 3504: 'CLOSED' } });
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', runId)), false, 'the run dir must have been archived away');
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), true);
});

test('F1 by-number: a probe failure keeps the run merged-partial', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-19T090000-record-3503-3504';
  const { runDir, result } = fixtureByNumberMergedRecordRun({ runId, closes: [3503], issueStates: { 3504: 'FAIL' } });
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'merged-partial');
  assert.deepEqual(skip.unclosed, [3504]);
  assert.equal(fs.existsSync(runDir), true);
});

// --- #3503 F2a: work-backend: local-files records are not GitHub issues. ---
test('F2a: work-backend local-files in CLAUDE.md disables the record check (archives as before)', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f2a-local', '2026-10-17T062549-spec-3306-3311', [], {},
    { origin: true, closes: [3306], manifestSpecs: PARTIAL_MANIFEST, claudeMd: '# P\n\nwork-backend: local-files\n' },
  );
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
});

test('F2a: a github-issues work-backend line keeps the record check', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f2a-gh', '2026-10-17T062549-spec-3306-3311', [], {},
    { origin: true, closes: [3306], manifestSpecs: PARTIAL_MANIFEST, claudeMd: 'work-backend: github-issues\n' },
  );
  assert.equal(result.skipped.find((s) => s.runDir === runDir)?.reason, 'merged-partial');
});

// --- #3503 F2b: closingIssuesReferences === [] is uninformative (a PR into a
// non-default base never links closing keywords) — the run's own manifest status
// decides, then the issue-state probe. ---
test('F2b: empty closingIssuesReferences + a running manifest spec (issue OPEN) stays merged-partial for that spec', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f2b-running', '2026-10-17T062549-spec-3306-3311', [], {},
    { origin: true, closes: [], manifestSpecs: PARTIAL_MANIFEST, issueStates: { 3306: 'OPEN', 3311: 'OPEN' } },
  );
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'merged-partial');
  assert.deepEqual(skip.unclosed, [3311]);
});

test('F2b: empty closingIssuesReferences + every manifest spec complete archives (issues OPEN)', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f2b-complete', '2026-10-17T062549-spec-3306-3311', [], {},
    {
      origin: true,
      closes: [],
      manifestSpecs: [
        { id: 3306, status: 'complete', subdir: 'spec-3306/' },
        { id: 3311, status: 'complete', subdir: 'spec-3311/' },
      ],
      issueStates: { 3306: 'OPEN', 3311: 'OPEN' },
    },
  );
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
});

test('F2b: empty closingIssuesReferences on a manifest-less record-N singleton archives', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f2b-singleton', '2026-10-19T090000-record-3503', [], {}, { origin: true, closes: [] },
  );
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
});

test('F2b by-number: empty closingIssuesReferences on a manifest-less run archives through the same helper', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-19T090000-record-3503-3504';
  const { root } = fixtureByNumberMergedRecordRun({ runId, closes: [] });
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), true);
});

// --- #3503 F3: no resolvable repo slug is a tracked reason, not a silent freeze. ---
test('F3: a repo with no resolvable GitHub slug skips no-repo-slug and is not archived', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f3', '2026-10-19T090000-record-3503', [], {}, { origin: false, closes: [3503] },
  );
  assert.ok(!result.archived.includes(runDir));
  assert.equal(result.skipped.find((s) => s.runDir === runDir)?.reason, 'no-repo-slug');
  assert.equal(fs.existsSync(runDir), true);
});

test('F3: a no-repo-slug skip past the TTL enters the structurally-stuck residue counter', { skip: STUB_SKIP }, () => {
  const { root, runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3503-f3-stuck', '2026-10-17T062549-record-3503', [], {},
    { origin: false, closes: [3503], staleMs: STRUCTURALLY_STUCK_TTL_MS * 2 },
  );
  assert.equal(result.skipped.find((s) => s.runDir === runDir)?.reason, 'no-repo-slug');
  const failures = listResidueFailures(root);
  assert.ok(
    failures.some((f) => f.reason === 'structurally-stuck' && f.path === runDir),
    `expected ${runDir} to accumulate a structurally-stuck count, got ${JSON.stringify(failures)}`,
  );
});

// --- #4794: the record check and the residue repo follow the origin gate. ---
// gateDeps keeps a developer's own GH_HOST and ~/.config/gh/hosts.yml out of the verdict.
const ORIGIN_GATE_DEPS = { env: {}, readFile: () => { throw new Error('ENOENT'); } };

test('#4794 Review Focus 3: on a *.ghe.com origin a merged run whose PR closes its record still archives (record check compares the bare slug)', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-4794-ghe', '2026-10-19T090000-record-3503', [], {},
    { origin: 'https://acme.ghe.com/acme/w.git', closes: [3503], gateDeps: ORIGIN_GATE_DEPS },
  );
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');
});

test('#4794: an SSH-alias origin skips the record check unknown-host with the refusal as hint, never no-repo-slug', { skip: STUB_SKIP }, () => {
  const origin = 'git@github-work:acme/w.git';
  const { root, runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-4794-alias', '2026-10-17T062549-record-3503', [], {},
    { origin, closes: [3503], staleMs: STRUCTURALLY_STUCK_TTL_MS * 2, gateDeps: ORIGIN_GATE_DEPS },
  );
  assert.ok(!result.archived.includes(runDir));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.equal(skip?.reason, 'unknown-host', JSON.stringify(result));
  const refusal = gateOriginRepo(origin, ORIGIN_GATE_DEPS).refusal;
  assert.ok(refusal, 'the fixture origin must be refused');
  assert.equal(skip.hint, refusal);
  const failures = listResidueFailures(root);
  assert.ok(
    failures.some((f) => f.reason === 'structurally-stuck' && f.path === runDir),
    `expected ${runDir} to accumulate a structurally-stuck count, got ${JSON.stringify(failures)}`,
  );
});

test('#4794: a run with a stamped pr.number and no branch, whose by-number read says unknown-host on an SSH-alias origin, skips unknown-host with the refusal as hint', { skip: STUB_SKIP }, () => {
  const origin = 'git@github-work:acme/w.git';
  const branch = 'feat-4794-bynumber';
  const { root } = mergedFeatureBranchRepo(branch);
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'branch', '-D', branch); // branch ref gone too — only the stamped number can name the PR
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-10-17T062549-record-4794');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: path.join(root, '.claude', 'worktrees', 'gone-4794'), pr: { number: 4794001 },
  }));
  const prStates = createPrStateResolver({ root, deps: { byNumber: () => 'unknown-host', byBranch: () => null } });
  const result = archiveMerged({ cwd: root, prStates, gateDeps: ORIGIN_GATE_DEPS });
  assert.ok(!result.archived.includes(runDir), JSON.stringify(result));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  const refusal = gateOriginRepo(origin, ORIGIN_GATE_DEPS).refusal;
  assert.ok(refusal, 'the fixture origin must be refused');
  assert.deepStrictEqual(skip, { runDir, reason: 'unknown-host', hint: refusal });
});

test('#4794 decideArchiveCore: a refused origin skips unknown-host ahead of no-repo-slug', () => {
  const pr = { state: 'MERGED', closingIssuesReferences: [ref(1)] };
  assert.deepStrictEqual(decideArchiveCore(pr, 'resolved', false, { records: [1], repoSlug: null, repoRefusal: 'R' }),
    { action: 'skip', reason: 'unknown-host', hint: 'R' });
});

// --- #3503 F4: the by-number path's resolved-console guard. ---
test('F4 by-number: a resolved console.json with a partial PR still skips merged-partial', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-19T090000-record-3503-3504';
  const { runDir, result } = fixtureByNumberMergedRecordRun({ runId, closes: [3503], consoleResolved: true });
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'merged-partial');
  assert.deepEqual(skip.unclosed, [3504]);
  assert.equal(fs.existsSync(runDir), true);
});

test('decideArchiveCore: pr-not-found skips with reason pr-not-found (#3543)', () => {
  assert.deepStrictEqual(decideArchiveCore('pr-not-found', 'resolved'), { action: 'skip', reason: 'pr-not-found' });
});

test('AC4.1 AC4.2: STRUCTURALLY_STUCK_REASONS has pr-not-found and not network-failure (#3543)', () => {
  assert.equal(STRUCTURALLY_STUCK_REASONS.has('pr-not-found'), true);
  assert.equal(STRUCTURALLY_STUCK_REASONS.has('network-failure'), false);
});

// #3416: a run's PR identity is its stamped run-state.json pr.number, not its
// branch name. A live worktree's branch name can be reused from an earlier
// run whose PR already merged, so the branch lookup can name the wrong PR.
// This fixture is that shape: the live worktree is on `worktree-reused`, and
// the earlier merged PR is the one the branch list would return.
function fixtureReusedBranchLiveRun({ runId, prNumber, consoleResolved = false }) {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-reused-branch');
  const wt = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-reusedwt-')));
  git(root, 'worktree', 'add', '-q', wt, '-b', 'worktree-reused');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: wt, pr: { number: prNumber, branch: 'worktree-reused' },
  }));
  if (consoleResolved) fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  return { root, runDir, featureSha };
}

test('AC1.1: archiveMerged skips pr-open a live run whose stamped pr.number is OPEN while its live worktree branch backs an older MERGED PR (#3416)', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-17T090000-record-3416-reused-open';
  const { root, runDir, featureSha } = fixtureReusedBranchLiveRun({ runId, prNumber: 3406 });
  const wrapper = installGhPrWrapper({
    list: [{ number: 3391, state: 'MERGED', mergedAt: '2026-10-17T14:09:02Z', updatedAt: '2026-10-17T14:09:02Z', mergeCommit: { oid: featureSha } }],
    view: { 3406: { number: 3406, state: 'OPEN', mergedAt: null, updatedAt: '2026-10-17T17:00:00Z', mergeCommit: null } },
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir), `a live run must not be archived off a reused branch, got ${JSON.stringify(result)}`);
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'pr-open');
  assert.equal(fs.existsSync(runDir), true);
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), false);
});

test('AC1.1 orthogonal: a stamped pr.number that is MERGED archives even when the branch list returns OPEN — resolution is keyed on the number (#3416)', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-17T090000-record-3416-reused-merged';
  const { root, runDir, featureSha } = fixtureReusedBranchLiveRun({ runId, prNumber: 3406, consoleResolved: true });
  const wrapper = installGhPrWrapper({
    list: [{ number: 7, state: 'OPEN', mergedAt: null, updatedAt: '2026-10-17T17:00:00Z', mergeCommit: null }],
    view: { 3406: { number: 3406, state: 'MERGED', mergedAt: '2026-10-17T14:09:02Z', updatedAt: '2026-10-17T14:09:02Z', mergeCommit: { oid: featureSha } } },
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');
});

test('AC1.1 transport failure: a by-number probe that fails skips network-failure, never falls back to the MERGED branch PR (#3416)', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-17T090000-record-3416-reused-transport';
  const { root, runDir, featureSha } = fixtureReusedBranchLiveRun({ runId, prNumber: 3406 });
  const wrapper = installGhPrWrapper({
    list: [{ number: 3391, state: 'MERGED', mergedAt: '2026-10-17T14:09:02Z', updatedAt: '2026-10-17T14:09:02Z', mergeCommit: { oid: featureSha } }],
    view: {},
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir), `a failed probe must not fall back to the branch PR, got ${JSON.stringify(result)}`);
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'network-failure');
  assert.equal(fs.existsSync(runDir), true);
});

// #3543: a stamped pr.number that GitHub confirms names no PR (the structured
// GraphQL NOT_FOUND probe) is a permanent, human-fixable state — it skips as
// `pr-not-found` and rides the structurally-stuck TTL/escalation path; a bare
// transport failure (no confirming body) stays `network-failure` and never does.
const NOT_FOUND_BODY = '{"data":{"repository":{"pullRequest":null}},"errors":[{"type":"NOT_FOUND","path":["repository","pullRequest"],"message":"x"}]}';

function runStaleStampPass({ runId, graphql }) {
  const { root, runDir, featureSha } = fixtureReusedBranchLiveRun({ runId, prNumber: 3406, consoleResolved: true });
  git(root, 'remote', 'add', 'origin', 'git@github.com:acme/w.git');
  const backdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(runDir, backdated, backdated);
  const wrapper = installGhPrWrapper({
    list: [{ number: 3391, state: 'MERGED', mergedAt: '2026-10-17T14:09:02Z', updatedAt: '2026-10-17T14:09:02Z', mergeCommit: { oid: featureSha } }],
    view: {},
    graphql,
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  return { root, runDir, result };
}

test('AC5.1: a stamped pr.number resolving pr-not-found skips pr-not-found, never archives via the MERGED branch PR, and enters the stuck counter once past the TTL (#3543)', { skip: STUB_SKIP }, () => {
  const { root, runDir, result } = runStaleStampPass({
    runId: '2026-10-17T090000-record-3543-stale-stamp',
    graphql: { body: NOT_FOUND_BODY, exit: 1 },
  });
  assert.ok(!result.archived.includes(runDir), `a nonexistent stamped PR must not fall back to the branch PR, got ${JSON.stringify(result)}`);
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'pr-not-found');
  assert.equal(fs.existsSync(runDir), true);
  const entry = listResidueFailures(root).find((f) => f.reason === 'structurally-stuck' && f.path === runDir);
  assert.ok(entry, 'the stale-stamp run must enter the structurally-stuck counter');
  assert.equal(entry.lastError, 'stuck at pr-not-found');
});

test('AC5.3: the no-branch by-number path skips pr-not-found (not no-branch/no-worktree) for a stale stamp and enters the stuck counter with "stuck at pr-not-found" (#3543)', { skip: STUB_SKIP }, () => {
  const root = fs.realpathSync(makeRepo());
  git(root, 'remote', 'add', 'origin', 'git@github.com:acme/w.git');
  const runId = '2026-10-17T090000-record-3543-nobranch-stale-stamp';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'gone-record-3543'), // stamped, but never created here
    pr: { number: 3406, branch: 'worktree-record-3543-gone' }, // branch does not exist in this repo
  }));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'auto-mode: true\n'); // adopted — keeps the blind orphaned-mint mtime sweep off this dir
  const backdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(runDir, backdated, backdated);

  const wrapper = installGhPrWrapper({ list: [], view: {}, graphql: { body: NOT_FOUND_BODY, exit: 1 } });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir), `a nonexistent stamped PR must not archive, got ${JSON.stringify(result)}`);
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'pr-not-found');
  const entry = listResidueFailures(root).find((f) => f.reason === 'structurally-stuck' && f.path === runDir);
  assert.ok(entry, 'the no-branch stale-stamp run must enter the structurally-stuck counter');
  assert.equal(entry.lastError, 'stuck at pr-not-found');
});

test('AC5.2: trackStuckSkip escalates pr-not-found exactly once past the TTL with "stuck at pr-not-found" (#3543)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-notfound-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const stuckDir = mkDirWithMtime(STRUCTURALLY_STUCK_TTL_MS * 2);

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackStuckSkip(root, 'o/r', stuckDir, 'pr-not-found', { escalate });
  }
  assert.equal(calls.length, 1, `expected exactly one escalation call, got ${calls.length}`);
  assert.equal(calls[0].lastError, 'stuck at pr-not-found');

  trackStuckSkip(root, 'o/r', stuckDir, 'pr-not-found', { escalate });
  assert.equal(calls.length, 1, 'must not re-escalate on a later still-stuck call');
});

test('#3543: a network-failure skip never escalates, even past the TTL', { skip: STUB_SKIP }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-netfail-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const oldDir = mkDirWithMtime(STRUCTURALLY_STUCK_TTL_MS * 2);
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD * 2; i++) {
    trackStuckSkip(root, 'o/r', oldDir, 'network-failure', { escalate });
  }
  assert.equal(calls.length, 0, 'a network-failure skip must never escalate');
  assert.deepEqual(listResidueFailures(root), [], 'a network-failure skip must not enter the residue counter');

  // End to end: a failed probe with no confirming NOT_FOUND body stays network-failure.
  const { root: root2, runDir, result } = runStaleStampPass({
    runId: '2026-10-17T090000-record-3543-transport',
    graphql: { body: '', exit: 1 },
  });
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'network-failure');
  assert.ok(!listResidueFailures(root2).some((f) => f.reason === 'structurally-stuck' && f.path === runDir), 'a transport failure must not enter the structurally-stuck counter');
});

test('AC2.1: the clean-status sweep does not archive a status:clean run whose pr.number is OPEN even when its pr.branch backs a MERGED PR (#3416)', { skip: STUB_SKIP }, () => {
  const runId = '2026-08-01T090000-clean-3416-open';
  const { root, runDir, featureSha } = fixtureCleanUnarchivedRun({ runId, prNumber: 3407 });
  const wrapper = installGhPrWrapper({
    list: [{ number: 99, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', mergeCommit: { oid: featureSha } }],
    view: { 3407: { number: 3407, state: 'OPEN', mergedAt: null, updatedAt: '2026-08-01T00:00:00Z', mergeCommit: null } },
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT archived while its stamped PR is open, got ${JSON.stringify(result)}`);
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'pr-open');
  assert.equal(fs.existsSync(runDir), true);
});

test('AC4.1: a run with no stamped pr.number resolves by branch and never calls gh pr view (#3416)', { skip: STUB_SKIP }, () => {
  const runId = '2026-08-31T090000-spec-3416-unstamped';
  const { root, runDir, featureSha } = fixtureActiveUnstampedMergedRun({ runId });
  const viewMarker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-viewmarker-')), 'pr-view-called');
  const wrapper = installGhPrWrapper({
    list: [{ number: 101, state: 'MERGED', mergedAt: '2026-08-31T00:00:00Z', updatedAt: '2026-08-31T00:00:00Z', mergeCommit: { oid: featureSha } }],
    view: {},
    viewMarker,
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived via the branch lookup, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(viewMarker), false, 'an unstamped run must never probe gh pr view by number');
});

test('#1854: an auto-resolve console.json ({resolved:true, mode:"auto-resolve", …}) reads as resolved and archives, never console-never-rendered (#1932 AC6)', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-auto-resolve-'));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true, mode: 'auto-resolve', at: '2026-09-06T12:00:00.000Z', ceiling: 'unattended', items: [], merge: { resolution: 'merge', reason: 'x' } }));
  assert.strictEqual(readConsoleState(runDir), 'resolved');
  const decision = decideArchive({ state: 'MERGED' }, readConsoleState(runDir));
  assert.notStrictEqual(decision.reason, 'console-never-rendered');
  assert.deepStrictEqual(decision, { action: 'archive' });
});

// --- #1892: split-state (archive twin exists, tracked work/ headers still live) ---

// AC1: an identical spec-{n}/work/{n}-spec.md at the archive twin is
// idempotent — the live copy is redundant and resolves via `git rm` (the
// twin's own copy is already tracked, the ordinary case since every prior
// archival commits it there via `git mv`), never a whole-dir `git mv` onto a
// non-empty destination (the ENOTEMPTY class #1713/#1714 already fixed one
// level up).
test('archiveRunDir: identical spec-{n}/work twin resolves via git rm, spec dir removed, archives cleanly', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-1-1336';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1/work/1-spec.md`, '# spec 1\n');
  // The twin already carries the identical content, tracked (a prior
  // archival's own `git mv` put it there).
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/spec-1/work/1-spec.md`, '# spec 1\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));

  assert.equal(fs.existsSync(path.join(runDir, 'spec-1')), false, 'live spec-1/ must be gone from disk');
  const tracked = trackedFiles(root);
  assert.equal(
    tracked.includes(`.claude-tweaks/pipelines/${runId}/spec-1/work/1-spec.md`),
    false,
    'old path must not remain tracked in the git index',
  );
  assert.ok(
    tracked.includes(`.claude-tweaks/pipelines/archive/${runId}/spec-1/work/1-spec.md`),
    'the twin copy must stay tracked at the archive path',
  );
  assert.equal(fs.existsSync(path.join(archiveDir, 'spec-1', 'work', '1-spec.md')), true);
});

// AC1 continued: a twin whose content genuinely differs must refuse rather
// than guess which copy is canonical — `work-twin-conflict`, naming both
// paths, and nothing moves.
test('archiveRunDir: differing spec-{n}/work twin returns work-twin-conflict and moves nothing', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-1-conflict';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1/work/1-spec.md`, '# spec 1 (live version)\n');
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/spec-1/work/1-spec.md`, '# spec 1 (archived version — DIFFERENT)\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'work-twin-conflict');
  assert.equal(result.conflict.src, path.join(runDir, 'spec-1', 'work'));
  assert.equal(result.conflict.dest, path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'spec-1', 'work'));
  assert.deepEqual(result.conflict.differing, ['1-spec.md']);

  // Nothing moved: both copies stay exactly where they were, both tracked.
  assert.equal(fs.existsSync(path.join(runDir, 'spec-1', 'work', '1-spec.md')), true);
  const tracked = trackedFiles(root);
  assert.ok(tracked.includes(`.claude-tweaks/pipelines/${runId}/spec-1/work/1-spec.md`));
  assert.ok(tracked.includes(`.claude-tweaks/pipelines/archive/${runId}/spec-1/work/1-spec.md`));
  // #2816 follow-up: `tracked` above is a git-index read (git ls-files) —
  // it stays true even if the archive twin's file was deleted from disk,
  // since git does not notice a working-tree deletion until a status/add
  // runs. This call's own `refuseAfterMarker` (added by #2816) must not
  // have swept the pre-existing archive twin off disk while cleaning up
  // its "archiving" marker on this genuinely-content refusal.
  assert.equal(
    fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'spec-1', 'work', '1-spec.md')),
    true,
    'the pre-existing archive twin must still exist on disk, not just in the git index',
  );
});

// Same idempotent-twin fix, single-spec (top-level work/) layout — the more
// common shape than the multi-spec spec-{n}/ nesting the two tests above use.
test('archiveRunDir: identical top-level work/ twin resolves via git rm, archives cleanly', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-99';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/99-spec.md`, '# spec 99\n');
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/work/99-spec.md`, '# spec 99\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(runDir), false, 'run dir must be fully cleaned up');
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/archive/${runId}/work/99-spec.md`),
    'the twin copy must stay tracked at the archive path',
  );
});

// The twin copy can also be genuinely untracked (content matches, but
// nothing has staged it there yet) — resolves via `git mv -f` onto the twin
// path instead of `git rm`.
test('archiveRunDir: identical work twin whose copy is untracked resolves via git mv -f', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-100';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/100-spec.md`, '# spec 100\n');
  fs.mkdirSync(path.join(archiveDir, 'work'), { recursive: true });
  // Same content, but never `git add`/committed at the archive path.
  fs.writeFileSync(path.join(archiveDir, 'work', '100-spec.md'), '# spec 100\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(runDir), false);
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/archive/${runId}/work/100-spec.md`),
    'the resolved copy must now be tracked at the archive path',
  );
});

// Review finding: an untracked-twin resolution (`kind: 'twin-mv'`) is a
// single `git mv -f` — a real filesystem rename, not a copy — so only ONE
// physical file survives the forward op, at destFile. Before this fix,
// `revertStagedOps` undid it with `fs.renameSync(destFile, srcFile)`, which
// restores srcFile but silently deletes destFile — even though destFile
// existed as an independent physical file (that's what made it a twin)
// BEFORE this batch touched anything. A later failure elsewhere in the same
// batch (here: a sibling spec's plain `git mv`) must revert back to that
// exact pre-op state — both files present — not trade one for the other.
test('archiveRunDir: an untracked twin-mv, reverted after a later sibling spec fails, restores BOTH the live file and the twin copy', (t) => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-1501-1502';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  // spec-1501: untracked archive twin, identical content — resolves via the
  // twin-mv branch of resolveIdenticalWorkTwin.
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1501/work/1501-spec.md`, '# spec 1501\n');
  fs.mkdirSync(path.join(archiveDir, 'spec-1501', 'work'), { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'spec-1501', 'work', '1501-spec.md'), '# spec 1501\n');
  // spec-1502: no twin — goes through the ordinary workMoves `git mv`, which
  // is mocked to fail, forcing revertStagedOps to undo the twin-mv above too.
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1502/work/1502-spec.md`, '# spec 1502\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    const isPlainMv = cmd === 'git' && Array.isArray(args) && args[2] === 'mv' && args[3] !== '-f';
    if (isPlainMv) throw new Error('simulated failure: git mv (spec-1502, no twin)');
    return execFileSync(cmd, args, opts);
  });

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));

  // The live copy is back, with its original content.
  const srcFile = path.join(runDir, 'spec-1501', 'work', '1501-spec.md');
  assert.equal(fs.existsSync(srcFile), true, 'srcFile must be restored on revert');
  assert.equal(fs.readFileSync(srcFile, 'utf8'), '# spec 1501\n');
  // The twin's own pre-existing copy must survive the revert too — the bug
  // this test pins deleted it via a rename instead of a copy.
  const destFile = path.join(archiveDir, 'spec-1501', 'work', '1501-spec.md');
  assert.equal(fs.existsSync(destFile), true, 'the twin copy must NOT be deleted by a reverted twin-mv');
  assert.equal(fs.readFileSync(destFile, 'utf8'), '# spec 1501\n');
  // Neither copy is left staged/tracked at the wrong path.
  assert.equal(fs.existsSync(path.join(archiveDir, 'spec-1502', 'work')), false);
  assert.equal(fs.existsSync(path.join(runDir, 'spec-1502', 'work', '1502-spec.md')), true);
});

// compareWorkTwin's own unit coverage: a file missing at the twin path
// counts as differing (it still needs to move, not be silently dropped).
test('compareWorkTwin: a file present at src but missing at the twin counts as differing', () => {
  const root = makeRepo();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-twin-src-'));
  const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-twin-dest-'));
  fs.writeFileSync(path.join(srcDir, '1-spec.md'), '# spec\n');
  const result = compareWorkTwin(root, srcDir, destDir);
  assert.equal(result.identical, false);
  assert.deepEqual(result.differing, ['1-spec.md']);
});

// isArchivedPendingTrackedMove: pure-predicate coverage, independent of the
// full archiveMerged loop.
test('isArchivedPendingTrackedMove: true when the twin exists and the live dir holds only tracked work/ headers', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-1296-1336';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1296/work/1296-spec.md`, '# 1296\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1336/work/1336-spec.md`, '# 1336\n');
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId), { recursive: true });

  assert.equal(isArchivedPendingTrackedMove(root, runDir), true);
});

test('isArchivedPendingTrackedMove: false when no archive twin exists yet', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-42-no-twin';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/42-spec.md`, '# 42\n');
  assert.equal(isArchivedPendingTrackedMove(root, runDir), false);
});

test('isArchivedPendingTrackedMove: false when a gitignored entry still lives alongside the tracked header', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-42-not-split';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/42-spec.md`, '# 42\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n'); // gitignored half still live
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId), { recursive: true });
  assert.equal(isArchivedPendingTrackedMove(root, runDir), false);
});

test('archivedPendingTrackedMoveCommand: a paste-ready archive-run command naming the run dir', () => {
  const command = archivedPendingTrackedMoveCommand('/x/.claude-tweaks/pipelines/2026-01-01T000000-spec-1');
  assert.match(command, /bin\/hooks\.js" archive-run --run/);
  assert.match(command, /2026-01-01T000000-spec-1/);
});

// AC2 (Deliverable 2): under `worktree-always: true`, the split state is a
// distinct, informational skip — never an in-process commit against the
// main checkout — and never counts toward move-failed escalation.
test('archiveMerged: split-state run dir under worktree-always: true reports archived-pending-tracked-move, never archives, residueFailures stays empty', () => {
  const root = fs.realpathSync(makeRepo());
  setWorktreeAlways(root, true);
  const runId = '2026-08-29T153740-spec-1296-1336';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1296/work/1296-spec.md`, '# 1296\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1336/work/1336-spec.md`, '# 1336\n');
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId), { recursive: true });
  const headBefore = git(root, 'rev-parse', 'HEAD').trim();

  const result = archiveMerged({ cwd: root });

  assert.ok(!result.archived.includes(runDir), 'must never archive in-process under worktree-always');
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'archived-pending-tracked-move');
  assert.match(skip.command, /archive-run --run/);
  assert.equal(git(root, 'rev-parse', 'HEAD').trim(), headBefore, 'no commit may land from this sweep under worktree-always');
  assert.equal(fs.existsSync(runDir), true, 'the live run dir is left in place — the completing command handles it');
  assert.deepEqual(listResidueFailures(root), [], 'must never count toward move-failed escalation');
});

// AC1 (Deliverable 2, non-worktree-always half): without worktree-always,
// this sweep completes the split-state archival itself, in one pass.
test('archiveMerged: split-state run dir archives cleanly on one pass when worktree-always is not set', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-29T153740-spec-1296-1336-clean';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1296/work/1296-spec.md`, '# 1296\n');
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/spec-1296/work/1296-spec.md`, '# 1296\n');

  const result = archiveMerged({ cwd: root });

  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false);
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/archive/${runId}/spec-1296/work/1296-spec.md`),
  );
});

// --- #1732: classifyRunDir — the single classifier every one of the five
// lifecycle predicates above (isOrphanedMint, isAbandonedInterrupted,
// isAdHocStandaloneSuperseded, decideArchive, isStructurallyStuck) now
// delegates to. These tests exercise the classifier directly, at the level
// the pre-consolidation predicates' own tests above don't reach: the `kind`
// value itself, and first-match precedence across multiple simultaneously-
// eligible kinds. ---

test('classifyRunDir: none for a fresh, ordinary run dir with no distinguishing evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-classify-'));
  fs.writeFileSync(path.join(dir, 'config.yml'), 'mode: auto\n');
  const result = classifyRunDir({ dir, state: { status: 'active' }, worktrees: [] });
  assert.equal(result.kind, 'none');
  assert.equal(result.ttlMs, null);
});

test('classifyRunDir: orphaned-mint for a config.yml-less mint past the grace window', () => {
  const dir = mkDirWithMtime(ORPHAN_MINT_TTL_MS * 2);
  const result = classifyRunDir({ dir });
  assert.equal(result.kind, 'orphaned-mint');
  assert.equal(result.ttlMs, ORPHAN_MINT_TTL_MS);
});

// Precedence: an ad-hoc-standalone dir whose worktree is definitively gone
// is old enough to ALSO satisfy orphaned-mint's own bare mtime threshold
// (ADHOC_SUPERSEDED_TTL_MS is a strict superset of ORPHAN_MINT_TTL_MS's
// window) — but isOrphanedMint's own precondition (`!isAdHocStandaloneMint`)
// exempts it, so classifyRunDir's full-precedence pass must land on
// 'adhoc-superseded', never 'orphaned-mint', for this exact shape. This is
// the reachable form of the "first-match order" pin the consolidation's own
// acceptance criteria call for: an orphaned-mint-shaped mtime coinciding
// with an ad-hoc-standalone dir's own superseded shape.
test('classifyRunDir: adhoc-superseded takes precedence over orphaned-mint for an ad-hoc-standalone dir old enough for both windows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-classify-adhoc-'));
  const adhocDir = `${dir}-adhoc-standalone`;
  fs.renameSync(dir, adhocDir);
  const state = { status: 'active', worktree: '/nonexistent/torn-down-worktree' };
  // isAdHocStandaloneMint reads run-state.json off DISK (not the ctx `state`
  // object passed to classifyRunDir) — write it before backdating, since
  // writing into the directory bumps its own mtime back to "now".
  fs.writeFileSync(path.join(adhocDir, 'run-state.json'), JSON.stringify(state));
  const backdated = new Date(Date.now() - (ADHOC_SUPERSEDED_TTL_MS * 2));
  fs.utimesSync(adhocDir, backdated, backdated);
  const result = classifyRunDir({ dir: adhocDir, state, worktrees: [] });
  assert.equal(result.kind, 'adhoc-superseded');
  assert.equal(isOrphanedMint(adhocDir), false, 'isOrphanedMint must stay exempt for this same shape');
  assert.equal(isAdHocStandaloneSuperseded(adhocDir, state, []), true);
  fs.rmSync(adhocDir, { recursive: true, force: true });
});

test('classifyRunDir: merged when decideArchiveCore would archive, carrying no TTL', () => {
  const prState = { state: 'MERGED', mergeCommit: { oid: 'a'.repeat(40) } };
  const result = classifyRunDir({ prState, consoleState: 'resolved' });
  assert.equal(result.kind, 'merged');
  assert.equal(result.ttlMs, null);
});

test('classifyRunDir: none with the skip reason carried in evidence when the merged-PR path would skip', () => {
  const result = classifyRunDir({ prState: 'gh-absent', consoleState: 'none' });
  assert.equal(result.kind, 'none');
  assert.equal(result.evidence.skipReason, 'gh-absent');
});

test('classifyRunDir: structurally-stuck for a qualifying skip reason past the TTL', () => {
  // config.yml present (an adopted run, per STRUCTURALLY_STUCK_TTL_MS's own
  // comment: "the dir IS adopted") — without it, orphaned-mint's own
  // higher-precedence, config.yml-absent condition would win first under the
  // full default kind order, which is correct precedence, not a bug (see the
  // "kinds scoping" test below for the scoped, config.yml-less equivalent).
  const dir = mkDirWithMtime(0);
  fs.writeFileSync(path.join(dir, 'config.yml'), 'mode: auto\n');
  // Writing config.yml just now bumped the directory's own mtime back to
  // "now" — backdate again, after the write, so the staleness check below
  // actually sees the intended age.
  const backdated = new Date(Date.now() - (STRUCTURALLY_STUCK_TTL_MS * 2));
  fs.utimesSync(dir, backdated, backdated);
  const result = classifyRunDir({ dir, skipReason: 'no-worktree' });
  assert.equal(result.kind, 'structurally-stuck');
  assert.equal(result.ttlMs, STRUCTURALLY_STUCK_TTL_MS);
});

// --- #1811 Deliverable 3: isClosedSlugStuck / recordNumbersFromSlug — the
// no-run-state.json terminal path for a config.yml-only run dir whose own
// record(s) have all closed. ---

test('recordNumbersFromSlug: parses one or more record numbers off a record-{n}[-{m}] slug', () => {
  assert.deepEqual(recordNumbersFromSlug('/tmp/2026-08-27T105511-record-1378-816'), [1378, 816]);
  assert.deepEqual(recordNumbersFromSlug('/tmp/2026-09-14T175427-record-1732-1811'), [1732, 1811]);
  assert.deepEqual(recordNumbersFromSlug('/tmp/2026-08-01T090000-record-42'), [42]);
});

test('recordNumbersFromSlug: null for a non-record slug (topic name, standalone, multi-spec parent)', () => {
  assert.equal(recordNumbersFromSlug('/tmp/2026-08-01T090000-meal-planning'), null);
  assert.equal(recordNumbersFromSlug('/tmp/2026-08-01T090000-adhoc-standalone'), null);
  assert.equal(recordNumbersFromSlug('/tmp/2026-08-01T090000-tidy-standalone'), null);
});

// --- #3503: runRecordSet — the run's required record ids, the reader the
// merged-partial archive guard feeds to decideArchiveCore's recordCheck. ---

// A run dir named with a real run-dir slug, so the manifest-less path parses
// its basename exactly as the sweep does.
function mkRunRecordDir(slug) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-record-set-'));
  const dir = path.join(base, slug);
  fs.mkdirSync(dir);
  return dir;
}

function writeSpecManifest(dir, specs) {
  fs.writeFileSync(path.join(dir, 'manifest.yml'), serializeManifestYaml({ multispec: { parent: 'parent/', specs } }));
}

function deferredLine(n) {
  return `- AUTO 10:00:00 — spec #${n}: deferred-closure: spec #${n} closing keyword withheld (pending manual step).`;
}

test('runRecordSet: a manifest with a running spec keeps it required (the #3311 incident shape)', () => {
  const dir = mkRunRecordDir('2026-10-17T062549-spec-3307-3311');
  writeSpecManifest(dir, [
    { id: 3307, status: 'complete', subdir: 'spec-3307/' },
    { id: 3311, status: 'running', subdir: 'spec-3311/' },
  ]);
  const result = runRecordSet(dir);
  assert.deepEqual(result, [3307, 3311]);
  assert.ok(result.every((n) => Number.isInteger(n)), `expected integer ids, got ${JSON.stringify(result)}`);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test('runRecordSet: failed and not-run specs are excluded', () => {
  const dir = mkRunRecordDir('2026-10-17T062549-spec-1-2-3');
  writeSpecManifest(dir, [
    { id: 1, status: 'complete', subdir: 'spec-1/' },
    { id: 2, status: 'failed', subdir: 'spec-2/' },
    { id: 3, status: 'not-run', subdir: 'spec-3/' },
  ]);
  assert.deepEqual(runRecordSet(dir), [1]);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test('runRecordSet: a spec with a deferred-closure entry in spec-{id}/decisions.md is excluded', () => {
  const dir = mkRunRecordDir('2026-10-17T062549-spec-1-2');
  writeSpecManifest(dir, [
    { id: 1, status: 'complete', subdir: 'spec-1/' },
    { id: 2, status: 'complete', subdir: 'spec-2/' },
  ]);
  fs.mkdirSync(path.join(dir, 'spec-2'));
  fs.writeFileSync(path.join(dir, 'spec-2', 'decisions.md'), deferredLine(2) + '\n');
  assert.deepEqual(runRecordSet(dir), [1]);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test('runRecordSet: manifest-less record-{n} and spec-{n}-{m} slugs parse to their ids, deduplicated', () => {
  const single = mkRunRecordDir('2026-10-19T185603-record-3503');
  assert.deepEqual(runRecordSet(single), [3503]);
  fs.rmSync(path.dirname(single), { recursive: true, force: true });

  const multi = mkRunRecordDir('2026-08-01T090000-spec-10-11');
  assert.deepEqual(runRecordSet(multi), [10, 11]);
  fs.rmSync(path.dirname(multi), { recursive: true, force: true });

  const repeated = mkRunRecordDir('2026-08-01T090000-record-4-4');
  assert.deepEqual(runRecordSet(repeated), [4]);
  fs.rmSync(path.dirname(repeated), { recursive: true, force: true });
});

test('runRecordSet: a manifest-less singleton with a top-level deferred-closure entry yields []', () => {
  const dir = mkRunRecordDir('2026-10-19T185603-record-3503');
  fs.writeFileSync(path.join(dir, 'decisions.md'), deferredLine(3503) + '\n');
  assert.deepEqual(runRecordSet(dir), []);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test('runRecordSet: topic, standalone and suffixed slugs yield null', () => {
  const slugs = [
    '2026-08-01T090000-meal-planning',
    '2026-08-01T090000-record-42-standalone',
    '2026-08-01T090000-tidy-standalone',
    '2026-08-01T090000-record-3249-ordinary-empty',
  ];
  for (const slug of slugs) {
    const dir = mkRunRecordDir(slug);
    assert.equal(runRecordSet(dir), null, slug);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test('runRecordSet: a manifest spec id that is not a positive-integer string makes the run unchecked (null), never NaN', () => {
  const dir = mkRunRecordDir('2026-10-17T062549-spec-5-abc');
  writeSpecManifest(dir, [
    { id: 5, status: 'complete', subdir: 'spec-5/' },
    { id: 'abc', status: 'complete', subdir: 'spec-abc/' },
  ]);
  assert.equal(runRecordSet(dir), null);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  for (const id of ['0x10', '1e3']) {
    const odd = mkRunRecordDir('2026-10-17T062549-spec-5-6');
    writeSpecManifest(odd, [
      { id: 5, status: 'complete', subdir: 'spec-5/' },
      { id, status: 'complete', subdir: `spec-${id}/` },
    ]);
    assert.equal(runRecordSet(odd), null, id);
    fs.rmSync(path.dirname(odd), { recursive: true, force: true });
  }
});

// --- #3503 F2b: inFlightRecords — the manifest specs the run still has pending or running. ---
test('inFlightRecords: returns the integer ids of pending and running specs only', () => {
  const dir = mkRunRecordDir('2026-10-17T062549-spec-1-2-3-4-5');
  writeSpecManifest(dir, [
    { id: 1, status: 'complete', subdir: 'spec-1/' },
    { id: 2, status: 'running', subdir: 'spec-2/' },
    { id: 3, status: 'pending', subdir: 'spec-3/' },
    { id: 4, status: 'failed', subdir: 'spec-4/' },
    { id: 5, status: 'not-run', subdir: 'spec-5/' },
  ]);
  const result = inFlightRecords(dir);
  assert.deepEqual(result, [2, 3]);
  assert.ok(result.every((n) => Number.isInteger(n)));
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test('inFlightRecords: no manifest yields []', () => {
  const dir = mkRunRecordDir('2026-10-19T185603-record-3503');
  assert.deepEqual(inFlightRecords(dir), []);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

function mkConfigOnlyDir(slugSuffix, ageMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-closedslug-'));
  const named = `${dir}-${slugSuffix}`;
  fs.renameSync(dir, named);
  fs.writeFileSync(path.join(named, 'config.yml'), 'mode: auto\n');
  const backdated = new Date(Date.now() - ageMs);
  fs.utimesSync(named, backdated, backdated);
  return named;
}

test('isClosedSlugStuck: true once every record in the slug resolves CLOSED and the TTL has elapsed', () => {
  const dir = mkConfigOnlyDir('record-1378-816', STRUCTURALLY_STUCK_TTL_MS * 2);
  const resolve = (root, n) => ({ state: 'CLOSED', number: n });
  assert.equal(isClosedSlugStuck('/repo', dir, null, Date.now(), resolve), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isClosedSlugStuck: false when any one record in the slug is still OPEN', () => {
  const dir = mkConfigOnlyDir('record-1378-816', STRUCTURALLY_STUCK_TTL_MS * 2);
  const resolve = (root, n) => ({ state: n === 816 ? 'OPEN' : 'CLOSED', number: n });
  assert.equal(isClosedSlugStuck('/repo', dir, null, Date.now(), resolve), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isClosedSlugStuck: false while still within the TTL, even with every record closed', () => {
  const dir = mkConfigOnlyDir('record-1378-816', 60 * 60 * 1000);
  const resolve = () => ({ state: 'CLOSED' });
  assert.equal(isClosedSlugStuck('/repo', dir, null, Date.now(), resolve), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isClosedSlugStuck: false whenever a run-state.json exists — not this predicate\'s shape', () => {
  const dir = mkConfigOnlyDir('record-1378-816', STRUCTURALLY_STUCK_TTL_MS * 2);
  const resolve = () => ({ state: 'CLOSED' });
  assert.equal(isClosedSlugStuck('/repo', dir, { status: 'active' }, Date.now(), resolve), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isClosedSlugStuck: false for a gh-absent/network-failure probe on any one record — never archives on unresolved evidence', () => {
  const dir = mkConfigOnlyDir('record-1378-816', STRUCTURALLY_STUCK_TTL_MS * 2);
  const resolve = (root, n) => (n === 816 ? 'network-failure' : { state: 'CLOSED' });
  assert.equal(isClosedSlugStuck('/repo', dir, null, Date.now(), resolve), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// AC (#1811): archiveMerged itself archives a config.yml-only, no-run-state
// dir once every record named in its slug resolves CLOSED via a real `gh
// issue view` call (intercepted at the process-spawn boundary, same
// installGhWrapper idiom this file already uses for `gh pr list`/`gh pr
// view`), and leaves it in place — still skipped, never escalated toward
// move-failed — while any one record is still open.
test('archiveMerged: archives a config.yml-only run dir with no run-state.json once every slug record is CLOSED', { skip: STUB_SKIP }, () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-27T105511-record-9001-9002';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  const backdated = new Date(Date.now() - (STRUCTURALLY_STUCK_TTL_MS * 2));
  fs.utimesSync(runDir, backdated, backdated);
  const ghWrapper = installGhIssueStateWrapper({ 9001: 'CLOSED', 9002: 'CLOSED' });
  try {
    const result = archiveMerged({ cwd: root });
    assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
    assert.equal(fs.existsSync(runDir), false);
  } finally {
    ghWrapper.restore();
  }
});

test('archiveMerged: leaves a config.yml-only run dir in place while any one slug record is still OPEN', { skip: STUB_SKIP }, () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-27T105511-record-9003-9004';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  const backdated = new Date(Date.now() - (STRUCTURALLY_STUCK_TTL_MS * 2));
  fs.utimesSync(runDir, backdated, backdated);
  const ghWrapper = installGhIssueStateWrapper({ 9003: 'CLOSED', 9004: 'OPEN' });
  try {
    const result = archiveMerged({ cwd: root });
    assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT in archived, got ${JSON.stringify(result)}`);
    assert.equal(fs.existsSync(runDir), true);
  } finally {
    ghWrapper.restore();
  }
});

test('classifyRunDir: kinds scoping restricts evaluation to exactly the requested kind, matching each standalone predicate', () => {
  // A dir shaped to match structurally-stuck (bare, old, no config.yml) would
  // ALSO satisfy orphaned-mint's own condition under the full precedence
  // order — but every wrapper predicate scopes its own `kinds` array to just
  // its one question, so isStructurallyStuck (and a `kinds: ['structurally-
  // stuck']` call here) must still answer true for it, unaffected by
  // orphaned-mint's higher precedence in the unscoped case.
  const dir = mkDirWithMtime(STRUCTURALLY_STUCK_TTL_MS * 2);
  assert.equal(classifyRunDir({ dir, kinds: ['orphaned-mint'] }).kind, 'orphaned-mint');
  assert.equal(classifyRunDir({ dir, skipReason: 'no-worktree', kinds: ['structurally-stuck'] }).kind, 'structurally-stuck');
  assert.equal(isStructurallyStuck(dir, 'no-worktree'), true);
});

// #3945: decideArchiveCore's fifth parameter — the tiebreak coverage refusal.
// It fires only where the function would otherwise return { action:'archive' },
// so every earlier guard keeps its word.
const TIEBREAK_MERGED_PR = { state: 'MERGED', closingIssuesReferences: [ref(5)] };
const TIEBREAK_HINT = "re-run the review step's findings writer for this run, or delete review-findings.json if the run predates the tiebreak";

test('decideArchiveCore refuses a listed finding with no verdict line (AC8.1)', () => {
  const coverage = { artifactPresent: true, artifactValid: true, missing: ['spec-a/F-1', 'F-2'] };
  const expected = { action: 'skip', reason: 'tiebreak-coverage-missing', missing: ['spec-a/F-1', 'F-2'], hint: TIEBREAK_HINT };
  // Both of today's archive returns: the no-recordCheck one and the all-closed one.
  assert.deepStrictEqual(decideArchiveCore(TIEBREAK_MERGED_PR, 'resolved', false, undefined, coverage), expected);
  assert.deepStrictEqual(
    decideArchiveCore(TIEBREAK_MERGED_PR, 'resolved', false, { records: [5], repoSlug: 'acme/w' }, coverage), expected,
  );
});

test('decideArchiveCore refuses an invalid artifact with its own reason (AC8.1)', () => {
  const coverage = { artifactPresent: true, artifactValid: false, missing: [] };
  const expected = { action: 'skip', reason: 'tiebreak-artifact-invalid', hint: TIEBREAK_HINT };
  assert.deepStrictEqual(decideArchiveCore(TIEBREAK_MERGED_PR, 'resolved', false, undefined, coverage), expected);
  assert.deepStrictEqual(
    decideArchiveCore(TIEBREAK_MERGED_PR, 'resolved', false, { records: [5], repoSlug: 'acme/w' }, coverage), expected,
  );
});

test('decideArchiveCore archives when every listed finding has a line (AC8.1)', () => {
  const coverage = { artifactPresent: true, artifactValid: true, missing: [] };
  assert.deepStrictEqual(decideArchiveCore(TIEBREAK_MERGED_PR, 'resolved', false, undefined, coverage), { action: 'archive' });
  assert.deepStrictEqual(
    decideArchiveCore(TIEBREAK_MERGED_PR, 'resolved', false, { records: [5], repoSlug: 'acme/w' }, coverage), { action: 'archive' },
  );
});

test('decideArchiveCore archives with no artifact exactly as before (AC8.1)', () => {
  const table = [
    ['gh-absent', 'resolved', false, undefined],
    ['network-failure', 'resolved', false, undefined],
    ['invalid-arguments', 'resolved', false, undefined],
    ['pr-not-found', 'resolved', false, undefined],
    [null, 'resolved', false, undefined],
    [{ state: 'OPEN' }, 'resolved', false, undefined],
    [{ state: 'CLOSED' }, 'resolved', false, undefined],
    [TIEBREAK_MERGED_PR, 'unresolved', false, undefined],
    [TIEBREAK_MERGED_PR, 'none', undefined, undefined],
    [TIEBREAK_MERGED_PR, 'none', true, undefined],
    [TIEBREAK_MERGED_PR, 'none', false, undefined],
    [TIEBREAK_MERGED_PR, 'resolved', false, undefined],
    [TIEBREAK_MERGED_PR, 'resolved', false, { records: [5], repoSlug: 'acme/w' }],
    [TIEBREAK_MERGED_PR, 'resolved', false, { records: [5, 6], repoSlug: 'acme/w' }],
    [TIEBREAK_MERGED_PR, 'resolved', false, { records: [5], repoSlug: null }],
    [{ state: 'MERGED' }, 'resolved', false, { records: [5], repoSlug: 'acme/w' }],
  ];
  const noArtifact = { artifactPresent: false, artifactValid: true, missing: [] };
  for (const [pr, consoleState, staged, check] of table) {
    const label = JSON.stringify([pr, consoleState, staged, check]);
    const before = decideArchiveCore(pr, consoleState, staged, check);
    assert.deepStrictEqual(decideArchiveCore(pr, consoleState, staged, check, undefined), before, label);
    assert.deepStrictEqual(decideArchiveCore(pr, consoleState, staged, check, noArtifact), before, label);
  }
});

test('decideArchiveCore coverage is evaluated after the #3668/#3370/#3503 guards (AC8.1)', () => {
  const missing = { artifactPresent: true, artifactValid: true, missing: ['F-1'] };
  const invalid = { artifactPresent: true, artifactValid: false, missing: [] };
  for (const coverage of [missing, invalid]) {
    assert.deepStrictEqual(decideArchiveCore(TIEBREAK_MERGED_PR, 'unresolved', false, undefined, coverage),
      { action: 'skip', reason: 'console-unresolved' });
    assert.deepStrictEqual(decideArchiveCore(TIEBREAK_MERGED_PR, 'none', true, undefined, coverage),
      { action: 'skip', reason: 'console-never-rendered-staged-pending' });
    assert.deepStrictEqual(decideArchiveCore({ state: 'OPEN' }, 'resolved', false, undefined, coverage),
      { action: 'skip', reason: 'pr-open' });
    assert.deepStrictEqual(
      decideArchiveCore(TIEBREAK_MERGED_PR, 'resolved', false, { records: [5, 6], repoSlug: 'acme/w' }, coverage),
      { action: 'skip', reason: 'merged-partial', unclosed: [6] });
    assert.deepStrictEqual(
      decideArchiveCore({ state: 'MERGED' }, 'resolved', false, { records: [5], repoSlug: 'acme/w' }, coverage),
      { action: 'skip', reason: 'closing-issues-unknown' });
    assert.deepStrictEqual(
      decideArchiveCore(TIEBREAK_MERGED_PR, 'resolved', false, { records: [5], repoSlug: null }, coverage),
      { action: 'skip', reason: 'no-repo-slug' });
  }
});

// #3945 F6: a tiebreak coverage refusal is structurally stuck (it never
// self-resolves: a human re-runs the findings writer or deletes the artifact),
// and its `missing` ids and `hint` reach the skipped entry the way #3503's
// `unclosed` does.
const TB_FINDINGS = [{ id: 'abc123def456', lens: 'correctness', path: 'src/a.js', line: 3, claim: 'x', reporterSeverity: 'medium', kind: 'unconfirmed' }];

test('STRUCTURALLY_STUCK_REASONS includes tiebreak-coverage-missing and tiebreak-artifact-invalid (#3945)', () => {
  assert.ok(STRUCTURALLY_STUCK_REASONS.has('tiebreak-coverage-missing'));
  assert.ok(STRUCTURALLY_STUCK_REASONS.has('tiebreak-artifact-invalid'));
});

test('branch-joined path: a tiebreak coverage skip carries missing and hint (#3945 F6)', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3945-tb-gap', '2026-10-22T090000-record-3945-tb-gap', [], {}, { findings: TB_FINDINGS },
  );
  assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), true, 'the run dir must stay in place');
  assert.deepStrictEqual(result.skipped.find((s) => s.runDir === runDir), {
    runDir, reason: 'tiebreak-coverage-missing', missing: ['abc123def456'], hint: TIEBREAK_HINT,
  });
});

test('clean-status sweep: a tiebreak coverage skip carries missing and hint (#3945 F6)', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-22T090000-clean-3945-tb-gap';
  const { root, runDir, featureSha } = fixtureCleanUnarchivedRun({ runId });
  fs.writeFileSync(path.join(runDir, 'review-findings.json'), JSON.stringify(TB_FINDINGS));
  const wrapper = installGhWrapper([{
    number: 99, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    mergeCommit: { oid: featureSha },
  }]);
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.equal(fs.existsSync(runDir), true, 'the run dir must stay in place');
  assert.deepStrictEqual(result.skipped.find((s) => s.runDir === runDir), {
    runDir, reason: 'tiebreak-coverage-missing', missing: ['abc123def456'], hint: TIEBREAK_HINT,
  });
});

// #3945 residual b: a closed run skipped for a tiebreak gap never converges on
// its own, so the clean sweep's onSkip must feed it into the same
// structurally-stuck escalation the main loop uses — for both tiebreak reasons.
for (const [reason, findings] of [
  ['tiebreak-coverage-missing', TB_FINDINGS],
  ['tiebreak-artifact-invalid', { not: 'an array' }],
]) {
  test(`clean-status sweep: a ${reason} skip enters the structurally-stuck residue counter (#3945)`, { skip: STUB_SKIP }, () => {
    const runId = `2026-10-22T090000-clean-3945-${reason}`;
    const { root, runDir, featureSha } = fixtureCleanUnarchivedRun({ runId });
    fs.writeFileSync(path.join(runDir, 'review-findings.json'), JSON.stringify(findings));
    const backdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
    fs.utimesSync(runDir, backdated, backdated);
    const wrapper = installGhWrapper([{
      number: 99, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
      mergeCommit: { oid: featureSha },
    }]);
    let result;
    try {
      result = archiveMerged({ cwd: root });
    } finally {
      wrapper.restore();
    }
    const skip = result.skipped.find((s) => s.runDir === runDir);
    assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
    assert.equal(skip.reason, reason);
    assert.ok(
      listResidueFailures(root).some((f) => f.reason === 'structurally-stuck' && f.path === runDir),
      `the clean sweep must start the structurally-stuck residue counter for a ${reason} skip`,
    );
  });
}

test('branch-joined path: an invalid findings artifact skip carries its hint (#3945 F6)', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-3945-tb-invalid', '2026-10-22T090000-record-3945-tb-invalid', [], {}, { findings: { not: 'an array' } },
  );
  assert.deepStrictEqual(result.skipped.find((s) => s.runDir === runDir), {
    runDir, reason: 'tiebreak-artifact-invalid', hint: TIEBREAK_HINT,
  });
});

// #3945 F7: settleMergedPartial's own coverage branch. The by-number run's PR
// closes 3503 but not 3504, so decideArchiveCore returns merged-partial and never
// reaches its coverage check; 3504's issue is CLOSED, so settling empties the
// unclosed set, and the coverage gap must still refuse rather than archive.
test('by-number path: a merged-partial settled to archive still refuses a tiebreak coverage gap (#3945 F7)', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-19T090000-record-3503-3504';
  const { runDir, result } = fixtureByNumberMergedRecordRun({
    runId, closes: [3503], issueStates: { 3504: 'CLOSED' }, findings: TB_FINDINGS,
  });
  assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), true, 'the run dir must stay in place');
  assert.deepStrictEqual(result.skipped.find((s) => s.runDir === runDir), {
    runDir, reason: 'tiebreak-coverage-missing', missing: ['abc123def456'], hint: TIEBREAK_HINT,
  });
});

// #4171: an auto-merge run with no Review Console holds can't-tell findings nobody filed.
const AUTO_MERGE_LINE = '- AUTO 09:59:00 — Fast-lane auto-merge: issue #12, assess-agent-autonomy verdict auto-merge. Reversibility: high.';
const cantTellFinding = { id: '0123456789ab', lens: '3a', path: 'src/a.js', line: 10, claim: 'The guard runs after the read', reporterSeverity: 'medium', kind: 'unconfirmed' };
const cantTellVerdict = (id) => `- STAGED 10:00:00 — Tiebreak tiebreak:${id}: lens "3a" finding src/a.js:10 console: verdict:cant-tell. Severity: medium. Recommendation: file.`;
const unfiledDeps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } };
// review-console.md's created filed line, built by the real producer (log-decision.js's formatEntry).
const cantTellFiledLine = (fingerprint) => `${formatEntry({
  status: 'AUTO', now: new Date(2026, 9, 25, 10, 1, 0), step: 'Queue write', reversibility: 'n/a',
  text: `tiebreak:${cantTellFinding.id} filed as #501 (work-fingerprint ${fingerprint})`,
})}\n`;

function seedCantTellRun({ autoMerge = true, extraLines = [], consoleJson = null, specDir = null } = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cant-tell-unfiled-'));
  const write = (dir, name, body) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), body); };
  const target = specDir ? path.join(runDir, specDir) : runDir;
  const lines = [...(autoMerge && !specDir ? [AUTO_MERGE_LINE] : []), cantTellVerdict(cantTellFinding.id), ...extraLines];
  if (specDir) write(runDir, 'decisions.md', autoMerge ? `${AUTO_MERGE_LINE}\n` : '');
  write(target, 'decisions.md', `${lines.join('\n')}\n`);
  write(target, 'review-findings.json', JSON.stringify([cantTellFinding]));
  if (consoleJson) write(runDir, 'console.json', consoleJson);
  return runDir;
}

test('AC1.1: decideArchiveCore skips cant-tell-unfiled when coverage names unfiled findings (#4171)', () => {
  const coverage = { artifactPresent: false, artifactValid: true, missing: [], unfiledCantTell: ['tiebreak:abc'] };
  assert.deepStrictEqual(decideArchiveCore(TIEBREAK_MERGED_PR, 'none', false, undefined, coverage),
    { action: 'skip', reason: 'cant-tell-unfiled', unfiled: ['tiebreak:abc'], hint: CANT_TELL_UNFILED_HINT });
  assert.deepStrictEqual(decideArchiveCore(TIEBREAK_MERGED_PR, 'none', false, undefined, { ...coverage, unfiledCantTell: [] }), { action: 'archive' });
  // The tiebreak artifact checks keep precedence when an artifact is present.
  assert.equal(decideArchiveCore(TIEBREAK_MERGED_PR, 'none', false, undefined,
    { artifactPresent: true, artifactValid: false, missing: [], unfiledCantTell: ['tiebreak:abc'] }).reason, 'tiebreak-artifact-invalid');
});

test('AC1.1: unfiledCantTellFindings names an auto-merge run\'s unfiled can\'t-tell finding, then clears once filed (#4171)', () => {
  const runDir = seedCantTellRun();
  try {
    assert.deepStrictEqual(unfiledCantTellFindings(runDir), [`tiebreak:${cantTellFinding.id}`]);
    const [{ fingerprint }] = unfiledCantTell({ runDir, deps: unfiledDeps });
    fs.appendFileSync(path.join(runDir, 'decisions.md'), cantTellFiledLine(fingerprint));
    assert.deepStrictEqual(unfiledCantTellFindings(runDir), []);
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('a rendered console turns the cant-tell-unfiled guard off (#4171)', () => {
  const resolved = seedCantTellRun({ consoleJson: '{"resolved":true}' });
  try { assert.deepStrictEqual(unfiledCantTellFindings(resolved), []); } finally { fs.rmSync(resolved, { recursive: true, force: true }); }
  const terminal = seedCantTellRun({ extraLines: ['- AUTO 10:02:00 — Review Console: terminal decision. Reversibility: n/a.'] });
  try { assert.deepStrictEqual(unfiledCantTellFindings(terminal), []); } finally { fs.rmSync(terminal, { recursive: true, force: true }); }
});

test('a non-auto-merge run is never guarded by cant-tell-unfiled (#4171)', () => {
  const runDir = seedCantTellRun({ autoMerge: false });
  try { assert.deepStrictEqual(unfiledCantTellFindings(runDir), []); } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('a spec dir\'s unfiled can\'t-tell finding is spec-prefixed (#4171)', () => {
  const runDir = seedCantTellRun({ specDir: 'spec-7' });
  try {
    assert.deepStrictEqual(unfiledCantTellFindings(runDir), [`spec-7/tiebreak:${cantTellFinding.id}`]);
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('a spec dir\'s finding clears only on a filed line in that spec dir\'s decisions.md (#4171)', () => {
  const runDir = seedCantTellRun({ specDir: 'spec-7' });
  try {
    const [{ fingerprint }] = unfiledCantTell({ runDir: path.join(runDir, 'spec-7'), deps: unfiledDeps });
    fs.appendFileSync(path.join(runDir, 'decisions.md'), cantTellFiledLine(fingerprint));
    assert.deepStrictEqual(unfiledCantTellFindings(runDir), [`spec-7/tiebreak:${cantTellFinding.id}`], 'a top-level filed line does not clear a spec-prefixed item');
    fs.appendFileSync(path.join(runDir, 'spec-7', 'decisions.md'), cantTellFiledLine(fingerprint));
    assert.deepStrictEqual(unfiledCantTellFindings(runDir), []);
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('an unreadable decisions.md fails the cant-tell-unfiled guard closed, per dir (#4171)', () => {
  const top = seedCantTellRun();
  const spec = seedCantTellRun({ specDir: 'spec-7' });
  try {
    // decisions.md as a directory: readFileSync throws EISDIR, not ENOENT.
    fs.rmSync(path.join(top, 'decisions.md'));
    fs.mkdirSync(path.join(top, 'decisions.md'));
    // The top-level file reads as "auto-merge" only when unreadable too (fail closed), so the guard is reached.
    const topResult = unfiledCantTellFindings(top);
    assert.equal(topResult.length, 1);
    assert.match(topResult[0], /^\(unreadable: decisions\.md: .*EISDIR/);

    fs.rmSync(path.join(spec, 'spec-7', 'decisions.md'));
    fs.mkdirSync(path.join(spec, 'spec-7', 'decisions.md'));
    const specResult = unfiledCantTellFindings(spec);
    assert.equal(specResult.length, 1);
    assert.match(specResult[0], /^\(unreadable: spec-7\/decisions\.md: .*EISDIR/);
  } finally { for (const d of [top, spec]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('cant-tell-unfiled is structurally stuck (#4171)', () => {
  assert.ok(STRUCTURALLY_STUCK_REASONS.has('cant-tell-unfiled'));
});

// #4171 end to end: the real archiveMerged sweep over a merged, console-less auto-merge run.
const CANT_TELL_DECISIONS = `${AUTO_MERGE_LINE}\n${cantTellVerdict(cantTellFinding.id)}\n`;

test('by-number path: archiveMerged skips an unfiled can\'t-tell finding, then archives once it is filed (#4171)', { skip: STUB_SKIP }, () => {
  const { runDir, result, rerun } = fixtureByNumberMergedRecordRun({
    runId: '2026-10-25T090000-record-4171', closes: [4171], findings: [cantTellFinding], decisions: CANT_TELL_DECISIONS,
  });
  assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT archived, got ${JSON.stringify(result)}`);
  assert.deepStrictEqual(result.skipped.find((s) => s.runDir === runDir), {
    runDir, reason: 'cant-tell-unfiled', unfiled: [`tiebreak:${cantTellFinding.id}`], hint: CANT_TELL_UNFILED_HINT,
  });

  const [{ fingerprint }] = unfiledCantTell({ runDir, deps: unfiledDeps });
  fs.appendFileSync(path.join(runDir, 'decisions.md'), cantTellFiledLine(fingerprint));
  const second = rerun();
  assert.ok(second.archived.includes(runDir), `expected ${runDir} archived once filed, got ${JSON.stringify(second)}`);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');
});

test('branch-joined path: archiveMergedRun skips an unfiled can\'t-tell finding with unfiled and hint (#4171)', { skip: STUB_SKIP }, () => {
  const { runDir, result } = fixtureOrdinaryMergedNoConsole(
    'feat-4171-cant-tell', '2026-10-25T090000-record-4171-cant-tell', [], {},
    { findings: [cantTellFinding], decisions: CANT_TELL_DECISIONS },
  );
  assert.equal(fs.existsSync(runDir), true, 'the run dir must stay in place');
  assert.deepStrictEqual(result.skipped.find((s) => s.runDir === runDir), {
    runDir, reason: 'cant-tell-unfiled', unfiled: [`tiebreak:${cantTellFinding.id}`], hint: CANT_TELL_UNFILED_HINT,
  });
});

// The clean-status sweep's onSkip tracks cant-tell-unfiled, as AC3.1 does for staged-pending (#3668).
test('the clean-status sweep tracks a cant-tell-unfiled skip toward structurally-stuck escalation (#4171)', { skip: STUB_SKIP }, () => {
  const runId = '2026-10-25T090000-record-4171-clean';
  const { root, runDir, featureSha } = fixtureCleanUnarchivedRun({ runId, consoleResolved: false });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), CANT_TELL_DECISIONS);
  fs.writeFileSync(path.join(runDir, 'review-findings.json'), JSON.stringify([cantTellFinding]));
  const backdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(runDir, backdated, backdated);

  const wrapper = installGhWrapper([{
    number: 99, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', mergeCommit: { oid: featureSha },
  }]);
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }

  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'cant-tell-unfiled');
  assert.ok(
    listResidueFailures(root).some((f) => f.reason === 'structurally-stuck' && f.path === runDir),
    'the clean sweep must start the structurally-stuck residue counter for a cant-tell-unfiled skip',
  );
});

// #4032: `prStates` (the pass-shared resolver) replaces archiveMerged's live PR
// lookups. The discriminator: a `gh` on PATH that FAILS and drops a marker on
// every call, so a lookup that bypasses the resolver surfaces as a marker file
// and a network-failure skip — while the resolver's injected deps answer MERGED.
function installFailingGhWithMarker() {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-failgh-'));
  const marker = path.join(wrapperDir, 'gh-was-called');
  fs.writeFileSync(path.join(wrapperDir, 'gh'), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
  fs.chmodSync(path.join(wrapperDir, 'gh'), 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return { marker, restore: () => { process.env.PATH = originalPath; } };
}

// A branch-resolvable, MERGED, console-less run (fixtureOrdinaryMergedNoConsole's
// shape) in its own repo, without running archiveMerged.
function ordinaryMergedRunFixture(branch, runId, { stampNumber = true } = {}) {
  const { root, featureSha } = mergedFeatureBranchRepo(branch);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', `gone-${runId}`),
    pr: stampNumber ? { number: 4032001, branch } : { branch },
  }));
  const pr = {
    number: 4032001, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    mergeCommit: { oid: featureSha },
  };
  return { root, runDir, pr };
}

test('archiveMerged: prStates answers replace live PR lookups (#4032)', { skip: STUB_SKIP }, () => {
  const runId = '2026-08-01T090000-record-4032-prstates';
  // Control: no prStates, the live (wrapped) gh answers MERGED.
  const control = ordinaryMergedRunFixture('feat-4032-prstates', runId);
  const wrapper = installGhWrapper([control.pr]);
  let controlResult;
  try { controlResult = archiveMerged({ cwd: control.root }); } finally { wrapper.restore(); }
  assert.deepStrictEqual(controlResult.archived, [control.runDir], `control must archive, got ${JSON.stringify(controlResult)}`);

  // Subject: identical shape; live gh fails and records any call, the resolver's deps answer MERGED.
  const subject = ordinaryMergedRunFixture('feat-4032-prstates', runId);
  const failing = installFailingGhWithMarker();
  let subjectResult;
  const asked = [];
  try {
    const prStates = createPrStateResolver({
      root: subject.root,
      deps: {
        byNumber: (n) => { asked.push(['number', n]); return subject.pr; },
        byBranch: (b) => { asked.push(['branch', b]); return subject.pr; },
      },
    });
    subjectResult = archiveMerged({ cwd: subject.root, prStates });
  } finally { failing.restore(); }

  const norm = (res, root) => JSON.parse(JSON.stringify(res).split(root).join('<root>'));
  assert.deepStrictEqual(norm(subjectResult, subject.root), norm(controlResult, control.root));
  assert.deepStrictEqual(asked, [['number', 4032001]], 'the resolver (not gh) must have answered the stamped-number lookup');
  assert.equal(fs.existsSync(failing.marker), false, 'a lookup that bypassed prStates would have called the failing gh');
});

test('prefetchArchivePrStates: numbers first, branches only for unanswered dirs, clean-sweep dirs included (#4032)', async () => {
  const root = fs.realpathSync(makeRepo());
  for (const b of ['aa', 'bb', 'cc', 'dd']) git(root, 'branch', b);
  const writeRun = (name, state) => {
    const d = path.join(root, '.claude-tweaks', 'pipelines', `2026-08-01T090000-${name}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'run-state.json'), JSON.stringify(state));
  };
  writeRun('a', { status: 'active', pr: { number: 11, branch: 'aa' } }); // number answers MERGED -> branch never asked
  writeRun('b', { status: 'active', pr: { branch: 'bb' } }); // unstamped -> branch
  writeRun('c', { status: 'clean', worktree: null, pr: { branch: 'cc' } }); // clean sweep, unstamped -> branch
  writeRun('d', { status: 'active', pr: { number: 12, branch: 'dd' } }); // number answers null -> branch

  const calls = { numbers: [], branches: [] };
  const prStates = createPrStateResolver({
    root,
    deps: {
      byNumberAsync: async (n) => { calls.numbers.push(n); return n === 11 ? { number: 11, state: 'MERGED' } : null; },
      byBranchAsync: async (b) => { calls.branches.push(b); return null; },
    },
  });
  await prefetchArchivePrStates(root, prStates);
  assert.deepStrictEqual(calls.numbers.sort(), [11, 12]);
  assert.deepStrictEqual(calls.branches.sort(), ['bb', 'cc', 'dd']);
});

test('prefetchArchivePrStates: a number with no answer queues no branch (#4032)', async () => {
  const root = fs.realpathSync(makeRepo());
  git(root, 'branch', 'ee');
  const d = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T090000-e');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'run-state.json'), JSON.stringify({ status: 'active', pr: { number: 13, branch: 'ee' } }));

  const calls = { numbers: [], branches: [], batch: [] };
  const prStates = createPrStateResolver({
    root,
    deps: {
      fetchBatch: async (r, keys) => { calls.batch.push(keys); return { byNumber: new Map(), byHead: new Map() }; },
      byNumberAsync: async (n) => { calls.numbers.push(n); return 'network-failure'; },
      byBranchAsync: async (b) => { calls.branches.push(b); return null; },
    },
  });
  await prefetchArchivePrStates(root, prStates);
  assert.deepStrictEqual(calls.numbers, [13], 'phase 2 must not go live again for the failed number');
  assert.deepStrictEqual(calls.branches, [], 'no answer for the number means no branch lookup');
  assert.deepStrictEqual(calls.batch, [{ numbers: [13], heads: [] }], 'the branch never reached the batch either');
});

// The branchless by-number fallback (archiveMerged's own `resolvePrStateByNumber`
// site, distinct from resolveRunPrState) routes through `prStates` too.
test('archiveMerged: prStates answers the branchless by-number fallback (#4032)', { skip: STUB_SKIP }, () => {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-4032-branchless');
  git(root, 'branch', '-D', 'feat-4032-branchless'); // branch ref gone — nothing for fallbackBranch to recover
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T090000-record-4032-branchless');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: path.join(root, '.claude', 'worktrees', 'gone-4032'), pr: { number: 4032002, branch: 'feat-4032-branchless' },
  }));
  const failing = installFailingGhWithMarker();
  const asked = [];
  let result;
  try {
    const prStates = createPrStateResolver({
      root,
      deps: {
        byNumber: (n) => {
          asked.push(n);
          return { number: n, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', mergeCommit: { oid: featureSha } };
        },
      },
    });
    result = archiveMerged({ cwd: root, prStates });
  } finally { failing.restore(); }
  assert.deepStrictEqual(result.archived, [runDir], `expected the by-number fallback to archive, got ${JSON.stringify(result)}`);
  assert.deepStrictEqual(asked, [4032002]);
  assert.equal(fs.existsSync(failing.marker), false, 'a lookup that bypassed prStates would have called the failing gh');
});

// resolveRunPrState's branch fallthrough: the path every unstamped run and most
// clean-sweep runs take (no pr.number to probe). Both shapes run under the
// failing-gh harness, so only the resolver's `byBranch` answer can archive them.
test('archiveMerged: prStates answers the branch lookup of an unstamped run (#4032)', { skip: STUB_SKIP }, () => {
  const { root, runDir, pr } = ordinaryMergedRunFixture('feat-4032-unstamped', '2026-08-01T090000-record-4032-unstamped', { stampNumber: false });
  const failing = installFailingGhWithMarker();
  const asked = [];
  let result;
  try {
    const prStates = createPrStateResolver({ root, deps: { byBranch: (b) => { asked.push(b); return pr; } } });
    result = archiveMerged({ cwd: root, prStates });
  } finally { failing.restore(); }
  assert.deepStrictEqual(result.archived, [runDir], `expected the branch lookup to archive, got ${JSON.stringify(result)}`);
  assert.deepStrictEqual(asked, ['feat-4032-unstamped']);
  assert.equal(fs.existsSync(failing.marker), false, 'a branch lookup that bypassed prStates would have called the failing gh');
});

test('archiveMerged: prStates answers the branch lookup of a status: clean sweep run (#4032)', { skip: STUB_SKIP }, () => {
  const { root, runDir, featureSha } = fixtureCleanUnarchivedRun({ runId: '2026-08-01T090000-record-4032-clean' });
  const failing = installFailingGhWithMarker();
  const asked = [];
  let result;
  try {
    const prStates = createPrStateResolver({
      root,
      deps: {
        byBranch: (b) => {
          asked.push(b);
          return { number: 4032003, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', mergeCommit: { oid: featureSha } };
        },
      },
    });
    result = archiveMerged({ cwd: root, prStates });
  } finally { failing.restore(); }
  assert.deepStrictEqual(result.archived, [runDir], `expected the clean sweep to archive, got ${JSON.stringify(result)}`);
  assert.deepStrictEqual(asked, ['feat-clean-branch']);
  assert.equal(fs.existsSync(failing.marker), false, 'a branch lookup that bypassed prStates would have called the failing gh');
});

// #4032: run-integrity.js's opt-in `{ worktreeList, integrationBranch }` cache,
// threaded through archiveMerged. The per-dir `checkRunIntegrity` of every
// abandoned-interrupted candidate used to re-spawn `git worktree list` (measured:
// 53 spawns in one archive pass); with a shared cache the whole phase reads it once.
function newPassCache() {
  return { worktreeList: new Map(), integrationBranch: new Map() };
}

// A repo with three torn-down, shipped, abandoned-interrupted runs plus two
// ordinary branch-joined runs (stamped worktree gone, branch recoverable).
function multiRunWorktreeFixture() {
  const base = fixtureAbandonedShippedRun({ runId: '2026-08-01T090000-cache-int1' });
  const pipelines = path.join(base.root, '.claude-tweaks', 'pipelines');
  const seedEvent = '{"skill":"claude-tweaks:build","ts":"2020-01-01T09:05:00.000Z","type":"skill_invoked"}\n';
  for (const name of ['cache-int2', 'cache-int3']) {
    const d = path.join(pipelines, `2026-08-01T090000-${name}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'run-state.json'), JSON.stringify({ status: 'interrupted', worktree: base.wt, pr: { branch: 'feat-branch' } }));
    fs.writeFileSync(path.join(d, 'events.jsonl'), seedEvent);
  }
  for (const name of ['cache-ord1', 'cache-ord2']) {
    const d = path.join(pipelines, `2026-08-01T090000-${name}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'config.yml'), 'x: 1\n');
    fs.writeFileSync(path.join(d, 'run-state.json'), JSON.stringify({
      status: 'active', worktree: path.join(base.root, '.claude', 'worktrees', `gone-${name}`), pr: { branch: 'feat-branch' },
    }));
  }
  return base;
}

function worktreeListSpawns(timings) {
  return Object.values(summarizeTimings(timings).phases)
    .reduce((n, p) => n + (p.subprocesses['git worktree'] || { count: 0 }).count, 0);
}

test('archiveMerged: a shared cache spawns git worktree list once per pass (#4032)', { skip: STUB_SKIP }, () => {
  const { root } = multiRunWorktreeFixture();
  const wrapper = installGhWrapper([]);
  try {
    const uncachedTimings = createTimings();
    const uncached = withTimings(uncachedTimings, () => archiveMerged({ cwd: root, dryRun: true, runVerdict: DEAD }));
    const cache = newPassCache();
    const cachedTimings = createTimings();
    const cached = withTimings(cachedTimings, () => archiveMerged({ cwd: root, dryRun: true, cache, runVerdict: DEAD }));
    assert.ok(uncached.archived.length >= 3, `control must reach checkRunIntegrity for each abandoned run, got ${JSON.stringify(uncached)}`);
    assert.ok(worktreeListSpawns(uncachedTimings) > 1, 'without a cache every per-dir checkRunIntegrity re-spawns the list');
    assert.equal(worktreeListSpawns(cachedTimings), 1, 'with a shared cache the whole archive phase lists worktrees once');
    assert.deepStrictEqual(cached, uncached, 'the cache must not change what is archived or skipped');
    assert.equal(cache.worktreeList.size, 1, 'the one list is cached under the main checkout root');
  } finally { wrapper.restore(); }
});

test('archiveMerged: a cache shared with prefetchArchivePrStates keeps the pass at one worktree list (#4032)', { skip: STUB_SKIP }, async () => {
  const { root } = multiRunWorktreeFixture();
  const wrapper = installGhWrapper([]);
  try {
    const cache = newPassCache();
    const prStates = createPrStateResolver({ root, deps: { byNumberAsync: async () => null, byBranchAsync: async () => null, byBranch: () => null } });
    const timings = createTimings();
    await withTimings(timings, async () => {
      await prefetchArchivePrStates(root, prStates, { cache });
      archiveMerged({ cwd: root, dryRun: true, cache, prStates, runVerdict: DEAD });
    });
    assert.equal(worktreeListSpawns(timings), 1);
  } finally { wrapper.restore(); }
});

// #4421: archiveMerged reports how many run dirs the pass left with no owner block to ask
// run-liveness about (spec AC6) — counted AFTER this pass's own archival.
const ownerlessFixture = (root) => {
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  // `config.yml` adopts the dir (keeps the orphaned-mint sweep off it); `config: false` omits it.
  const mk = (name, state, { config = true } = {}) => {
    const dir = path.join(pipelines, name);
    fs.mkdirSync(dir, { recursive: true });
    if (config) fs.writeFileSync(path.join(dir, 'config.yml'), 'x: 1\n');
    if (state !== undefined) fs.writeFileSync(path.join(dir, 'run-state.json'), typeof state === 'string' ? state : JSON.stringify(state));
    return dir;
  };
  return { pipelines, mk };
};

test('archiveMerged: ownerlessNonClean counts absent or owner-less non-clean run dirs after this pass\'s archival (#4421 AC6.1)', () => {
  const root = fs.realpathSync(makeRepo());
  const { pipelines, mk } = ownerlessFixture(root);
  mk('2026-08-01T090001-record-1', { status: 'active', worktree: path.join(root, 'gone-1') });
  mk('2026-08-01T090002-record-2', { status: 'active', worktree: path.join(root, 'gone-2') });
  mk('2026-08-01T090003-record-3', undefined); // config.yml, no run-state.json
  mk('2026-08-01T090004-record-4', { status: 'active', owner: { sessionId: 's', host: 'h', pid: 1 } });
  mk('2026-08-01T090005-record-5', { status: 'clean' });
  const mint = mk('2026-08-01T090006-record-6', { status: 'active' }, { config: false });
  const old = new Date(Date.now() - ORPHAN_MINT_TTL_MS * 2);
  fs.utimesSync(mint, old, old);
  fs.mkdirSync(path.join(pipelines, 'archive', '2026-08-01T090000-old'), { recursive: true });
  fs.writeFileSync(path.join(pipelines, 'archive', '2026-08-01T090000-old', 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveMerged({ cwd: root, runVerdict: DEAD });
  assert.ok(result.archived.includes(mint), `the orphaned mint must be archived this pass, got ${JSON.stringify(result)}`);
  assert.equal(result.ownerlessNonClean, 3);

  // Review Focus 4: an unparseable file, a non-object file and an archive twin are not counted.
  mk('2026-08-01T090007-record-7', '{not json');
  mk('2026-08-01T090008-record-8', '[]');
  mk('2026-08-01T090009-twin', { status: 'active', worktree: path.join(root, 'gone-9') });
  fs.mkdirSync(path.join(pipelines, 'archive', '2026-08-01T090009-twin'), { recursive: true });
  fs.writeFileSync(path.join(pipelines, 'archive', '2026-08-01T090009-twin', 'run-state.json'), JSON.stringify({ status: 'clean' }));
  assert.equal(archiveMerged({ cwd: root, runVerdict: DEAD }).ownerlessNonClean, 3);
});

test('archiveMerged: an owner-less run-state with no status key counts as non-clean (#4421 AC6.1)', () => {
  const root = fs.realpathSync(makeRepo());
  const { mk } = ownerlessFixture(root);
  mk('2026-08-01T090001-record-1', { createdBy: 'x' }); // no `status`, no owner
  assert.equal(countOwnerlessNonClean(root), 1);
  assert.equal(archiveMerged({ cwd: root, runVerdict: DEAD }).ownerlessNonClean, 1);
});

test('archiveMerged: only owner-block runs, or no pipelines dir, count 0 (#4421 AC6.2)', () => {
  const root = fs.realpathSync(makeRepo());
  assert.equal(archiveMerged({ cwd: root, runVerdict: DEAD }).ownerlessNonClean, 0, 'a missing pipelines dir counts 0');
  const { mk } = ownerlessFixture(root);
  mk('2026-08-01T090001-record-1', { status: 'active', owner: { sessionId: 's', host: 'h', pid: 1 } });
  mk('2026-08-01T090002-record-2', { status: 'active', owner: { sessionId: 't', host: 'h', pid: 2 } });
  assert.equal(archiveMerged({ cwd: root, runVerdict: DEAD }).ownerlessNonClean, 0);
});

test('archiveMerged: a dry run, a pass with no main checkout and an unreadable pipelines dir leave ownerlessNonClean absent (#4421 AC6.4)', () => {
  const root = fs.realpathSync(makeRepo());
  const { mk } = ownerlessFixture(root);
  mk('2026-08-01T090001-record-1', { status: 'active', worktree: path.join(root, 'gone-1') });
  assert.equal('ownerlessNonClean' in archiveMerged({ cwd: root, dryRun: true, runVerdict: DEAD }), false);
  assert.equal('ownerlessNonClean' in archiveMerged({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-norepo-')) }), false);

  const blocked = fs.realpathSync(makeRepo());
  fs.mkdirSync(path.join(blocked, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(blocked, '.claude-tweaks', 'pipelines'), 'not a directory\n'); // readdir -> ENOTDIR
  assert.equal(countOwnerlessNonClean(blocked), null);
  assert.equal('ownerlessNonClean' in archiveMerged({ cwd: blocked, runVerdict: DEAD }), false);
});

// --- #4599: postMergeDeferred — runs the post-merge check skipped for a retryable reason ---

// The guard sits at the top of both run-dir loops: a deferred dir is skipped `post-merge-pending`
// before any per-run work, and the skip is never fed to the stuck-skip tracker, because it is
// transient and must never escalate as residue.
test('archiveMerged: a run dir in postMergeDeferred is skipped post-merge-pending, untracked, and left in place (#4599)', () => {
  const root = fs.realpathSync(makeRepo());
  git(root, 'remote', 'add', 'origin', 'git@github.com:acme/w.git');
  const dir = seedStuckDir4180(root, '2026-01-01T000000-pending-4599');
  const runner = () => { throw new Error('no gh in this test'); };

  // Control: without the guard the same dir is a tracked structurally-stuck skip.
  const control = archiveMerged({ cwd: root, runner });
  assert.deepEqual(control.skipped, [{ runDir: dir, reason: 'no-branch' }]);
  assert.equal(listResidueFailures(root).filter((e) => e.path === dir).length, 1, 'the control pass tracks the stuck skip');
  fs.rmSync(cachePath(root), { force: true });

  // The deferred path is compared resolved, so an un-normalized spelling of it still matches.
  const unnormalized = `${path.dirname(dir)}${path.sep}.${path.sep}${path.basename(dir)}`;
  const result = archiveMerged({ cwd: root, runner, postMergeDeferred: [unnormalized] });
  assert.deepEqual(result.skipped, [{ runDir: dir, reason: 'post-merge-pending' }]);
  assert.deepEqual(result.archived, []);
  assert.equal(fs.existsSync(dir), true, 'the deferred run dir stays at its top-level path');
  assert.deepEqual(listResidueFailures(root), [], 'the stuck-skip cache gains no entry for a deferred dir');
});

test('archiveMerged: postMergeDeferred also guards the clean-status sweep, and only the listed dir (#4599)', () => {
  const root = fs.realpathSync(makeRepo());
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  const mkClean = (id) => {
    const d = path.join(pipelines, id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'run-state.json'), JSON.stringify({ status: 'clean', worktree: null }));
    return d;
  };
  const deferred = mkClean('2026-01-01T000001-clean-deferred-4599');
  const other = mkClean('2026-01-01T000002-clean-other-4599');
  const byDir = (a, b) => a.runDir.localeCompare(b.runDir);

  // Control: a clean run with no branch to resolve skips `no-branch` — the sweep reaches it.
  assert.deepEqual(
    archiveMerged({ cwd: root }).skipped.slice().sort(byDir),
    [{ runDir: deferred, reason: 'no-branch' }, { runDir: other, reason: 'no-branch' }],
  );
  const result = archiveMerged({ cwd: root, postMergeDeferred: [deferred] });
  assert.deepEqual(
    result.skipped.slice().sort(byDir),
    [{ runDir: deferred, reason: 'post-merge-pending' }, { runDir: other, reason: 'no-branch' }],
  );
});

test('archiveMerged: an empty or absent postMergeDeferred changes nothing (#4599)', () => {
  const root = fs.realpathSync(makeRepo());
  const dir = seedStuckDir4180(root, '2026-01-01T000000-pending-none-4599');
  for (const extra of [{}, { postMergeDeferred: [] }]) {
    assert.deepEqual(archiveMerged({ cwd: root, ...extra }).skipped, [{ runDir: dir, reason: 'no-branch' }]);
  }
});
