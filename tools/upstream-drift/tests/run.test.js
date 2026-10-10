'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseArgs,
  compareVersions,
  pickLatestTag,
  resolveLatest,
  evaluate,
  buildFindings,
  toIssuePayload,
  dedupeFindings,
  SEVERITY,
} = require('../run');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-drift-run-'));
}

// A fully-green evaluation, used as the base that individual tests break in
// exactly one way. Built as a factory rather than a shared constant so a test
// mutating one field cannot leak into its siblings.
function greenEvaluation(overrides = {}) {
  return {
    name: 'impeccable-plugin',
    pinned: '4.0.2',
    installed: ['4.0.2'],
    resolvedInstalled: '4.0.2',
    latest: '4.0.2',
    version: { check: 'version', name: 'impeccable-plugin', status: 'ok', installed: ['4.0.2'], pinned: '4.0.2', detail: 'ok' },
    assertions: { check: 'assertions', name: 'impeccable-plugin', status: 'ok', results: [] },
    fixtures: { check: 'fixtures', name: 'impeccable-plugin', status: 'ok', results: [] },
    ...overrides,
  };
}

// ─── parseArgs ───────────────────────────────────────────────────────────

test('parseArgs: --dry-run, --dep, --root, --issues, --offline', () => {
  const args = parseArgs(['findings', '--dep', 'impeccable-cli', '--dry-run', '--offline', '--root', '/tmp/x', '--issues', 'i.json']);
  assert.strictEqual(args._[0], 'findings');
  assert.strictEqual(args.dep, 'impeccable-cli');
  assert.strictEqual(args.dryRun, true);
  assert.strictEqual(args.offline, true);
  assert.strictEqual(args.root, '/tmp/x');
  assert.strictEqual(args.issues, 'i.json');
});

test('parseArgs: repeated --latest-tag builds a per-dependency override map', () => {
  const args = parseArgs(['due', '--latest-tag', 'impeccable-cli=cli-v3.6.0', '--latest-tag', 'impeccable-plugin=skill-v4.0.4']);
  assert.deepStrictEqual(args.latestTag, {
    'impeccable-cli': 'cli-v3.6.0',
    'impeccable-plugin': 'skill-v4.0.4',
  });
});

// ─── compareVersions ─────────────────────────────────────────────────────

test('compareVersions: orders numerically, not lexicographically', () => {
  // The bug this pins: string comparison puts "4.0.9" above "4.0.10", which
  // would report an older tag as latest for any project past its ninth patch.
  assert.ok(compareVersions('4.0.10', '4.0.9') > 0);
  assert.ok(compareVersions('4.0.9', '4.0.10') < 0);
  assert.strictEqual(compareVersions('4.0.2', '4.0.2'), 0);
  assert.ok(compareVersions('5.0.0', '4.99.99') > 0);
});

test('compareVersions: a shorter version is not treated as greater', () => {
  assert.ok(compareVersions('4.0', '4.0.1') < 0);
  assert.ok(compareVersions('4.1', '4.0.9') > 0);
});

// ─── pickLatestTag ───────────────────────────────────────────────────────

test('pickLatestTag: filters to the entry prefix and returns the highest', () => {
  const tags = ['cli-v3.5.0', 'skill-v4.0.2', 'skill-v4.0.10', 'skill-v4.0.9', 'ext-v1.0.0'];
  assert.deepStrictEqual(pickLatestTag(tags, 'skill-v'), { tag: 'skill-v4.0.10', version: '4.0.10' });
});

test('pickLatestTag: one upstream repo shipping several products never crosses product lines', () => {
  // pbakaus/impeccable ships skill-v*, cli-v* and ext-v* from one tree. A
  // prefix-blind "highest tag" would hand the CLI entry the plugin's version.
  const tags = ['cli-v3.5.0', 'skill-v4.0.4', 'ext-v9.9.9'];
  assert.deepStrictEqual(pickLatestTag(tags, 'cli-v'), { tag: 'cli-v3.5.0', version: '3.5.0' });
});

test('pickLatestTag: returns null when no tag carries the prefix', () => {
  assert.strictEqual(pickLatestTag(['cli-v3.5.0'], 'skill-v'), null);
});

// ─── resolveLatest ───────────────────────────────────────────────────────

test('resolveLatest: reads tags through the injected command runner', () => {
  const entry = { name: 'p', upstream: { repo: 'pbakaus/impeccable', 'tag-prefix': 'skill-v' } };
  const calls = [];
  const result = resolveLatest(entry, {
    runCommand: (cmd) => {
      calls.push(cmd);
      return 'skill-v4.0.2\nskill-v4.0.4\ncli-v3.5.0\n';
    },
  });
  assert.deepStrictEqual(result, { tag: 'skill-v4.0.4', version: '4.0.4' });
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0], /pbakaus\/impeccable/);
});

test('resolveLatest: offline returns null and issues no command at all', () => {
  const entry = { name: 'p', upstream: { repo: 'r', 'tag-prefix': 'v' } };
  let called = false;
  const result = resolveLatest(entry, { offline: true, runCommand: () => { called = true; return ''; } });
  assert.strictEqual(result, null);
  assert.strictEqual(called, false, 'offline must make no network call');
});

test('resolveLatest: a failing command degrades to null rather than throwing', () => {
  const entry = { name: 'p', upstream: { repo: 'r', 'tag-prefix': 'v' } };
  const result = resolveLatest(entry, { runCommand: () => { throw new Error('gh: not found'); } });
  assert.strictEqual(result, null);
});

// ─── evaluate ────────────────────────────────────────────────────────────

test('evaluate: resolvedInstalled picks the copy matching pinned, not the first found', () => {
  // A plugin-cache-glob probe legitimately resolves several cached copies.
  // judge-procedure.md step 2: diff from the one matching `pinned`; the
  // others are stale cache directories, not the running artifact.
  const entry = { name: 'p', pinned: '4.0.2', upstream: { repo: 'r', 'tag-prefix': 'skill-v' } };
  const ev = evaluate(entry, {
    checkVersion: () => ({ check: 'version', status: 'breach', installed: ['3.9.0', '4.0.2'], pinned: '4.0.2', detail: 'd' }),
    checkAssertions: () => ({ check: 'assertions', status: 'ok', results: [] }),
    replayFixtures: () => ({ check: 'fixtures', status: 'ok', results: [] }),
    resolveLatest: () => ({ tag: 'skill-v4.0.4', version: '4.0.4' }),
  });
  assert.strictEqual(ev.resolvedInstalled, '4.0.2');
});

test('evaluate: with no copy matching pinned, resolvedInstalled falls back to the first installed', () => {
  const entry = { name: 'p', pinned: '4.0.2', upstream: { repo: 'r', 'tag-prefix': 'skill-v' } };
  const ev = evaluate(entry, {
    checkVersion: () => ({ check: 'version', status: 'breach', installed: ['3.9.0'], pinned: '4.0.2', detail: 'd' }),
    checkAssertions: () => ({ check: 'assertions', status: 'ok', results: [] }),
    replayFixtures: () => ({ check: 'fixtures', status: 'ok', results: [] }),
    resolveLatest: () => null,
  });
  assert.strictEqual(ev.resolvedInstalled, '3.9.0');
});

// ─── buildFindings: the trigger table (AC1) ──────────────────────────────

test('buildFindings: all green and no upgrade yields zero findings (AC2)', () => {
  assert.deepStrictEqual(buildFindings(greenEvaluation()), []);
});

test('buildFindings: installed != pinned is a high-severity contract breach', () => {
  const findings = buildFindings(greenEvaluation({
    version: { status: 'breach', installed: ['4.0.4'], pinned: '4.0.2', detail: 'd' },
    installed: ['4.0.4'],
    resolvedInstalled: '4.0.4',
  }));
  const breach = findings.find((f) => f.kind === 'pin-breach');
  assert.ok(breach, 'expected a pin-breach finding');
  assert.strictEqual(breach.severity, 'high');
  assert.strictEqual(breach.class, 'drift');
});

test('buildFindings: absent is low severity and is never described as a breach', () => {
  const findings = buildFindings(greenEvaluation({
    version: { status: 'absent', installed: [], pinned: '4.0.2', detail: 'not installed' },
    installed: [],
    resolvedInstalled: null,
  }));
  const absent = findings.find((f) => f.kind === 'absent');
  assert.ok(absent);
  assert.strictEqual(absent.severity, 'low');
  assert.ok(!findings.some((f) => f.kind === 'pin-breach'), 'absent must not also report a breach');
  assert.doesNotMatch(absent.detail, /breach/i, 'not-installed is not the same as wrong');
});

test('buildFindings: an unmatched assertion is medium and names its citing file and claim', () => {
  const findings = buildFindings(greenEvaluation({
    assertions: {
      status: 'drift',
      results: [{
        file: 'plugin/skills/design-wrapper/command-map.md',
        claims: 'the plugin exposes a polish command',
        upstreamPath: 'skills/impeccable/SKILL.md',
        status: 'unmatched',
        detail: 'no longer contains "polish [target]"',
      }],
    },
  }));
  const drift = findings.find((f) => f.kind === 'assertion-drift');
  assert.ok(drift);
  assert.strictEqual(drift.severity, 'medium');
  assert.match(drift.detail, /plugin\/skills\/design-wrapper\/command-map\.md/);
  assert.match(drift.detail, /the plugin exposes a polish command/);
});

test('buildFindings: a missing upstream file outranks a merely unmatched literal', () => {
  const findings = buildFindings(greenEvaluation({
    assertions: {
      status: 'drift',
      results: [{
        file: 'plugin/skills/design-wrapper/modes/live.md',
        claims: 'live mode boots a server',
        upstreamPath: 'skills/impeccable/scripts/impeccable',
        status: 'missing-file',
        detail: 'does not exist',
      }],
    },
  }));
  const f = findings.find((x) => x.kind === 'assertion-missing-file');
  assert.ok(f);
  assert.strictEqual(f.severity, 'high');
  assert.ok(SEVERITY.indexOf('high') < SEVERITY.indexOf('medium'), 'high must outrank medium');
});

test('buildFindings: a skipped assertion block emits no finding at all', () => {
  // judge-procedure.md step 1: an unresolvable root means absent, which
  // checkVersion already reported. A second finding here manufactures
  // evidence this repo does not have.
  const findings = buildFindings(greenEvaluation({
    version: { status: 'absent', installed: [], pinned: '4.0.2', detail: 'not installed' },
    installed: [],
    resolvedInstalled: null,
    assertions: { status: 'skipped', results: [], detail: 'could not resolve an installed root' },
  }));
  assert.ok(!findings.some((f) => f.kind.startsWith('assertion')), 'skipped assertions must produce no finding');
  assert.strictEqual(findings.filter((f) => f.kind === 'absent').length, 1);
});

test('buildFindings: a fixture mismatch is a high-severity runtime breach, one per fixture', () => {
  const findings = buildFindings(greenEvaluation({
    fixtures: {
      status: 'mismatch',
      results: [
        { run: 'impeccable detect a.html', status: 'mismatch', detail: 'expected exit 2, observed exit 0' },
        { run: 'impeccable detect b.html', status: 'ok', detail: 'matched' },
      ],
    },
  }));
  const fx = findings.filter((f) => f.kind === 'fixture-breach');
  assert.strictEqual(fx.length, 1, 'only the mismatching fixture yields a finding');
  assert.strictEqual(fx[0].severity, 'high');
  assert.match(fx[0].detail, /expected exit 2/);
});

// ─── the upgrade class is not a defect ───────────────────────────────────

test('buildFindings: latest != installed reports an upgrade, not a defect', () => {
  const findings = buildFindings(greenEvaluation({ latest: '4.0.4' }));
  const up = findings.find((f) => f.kind === 'upgrade-available');
  assert.ok(up, 'expected an upgrade-available finding');
  assert.strictEqual(up.class, 'upgrade', 'an upgrade is its own class, never drift');
  assert.strictEqual(up.severity, 'low');
});

test('buildFindings: an upgrade finding is titled and worded as an opportunity, not a failure', () => {
  const findings = buildFindings(greenEvaluation({ latest: '4.0.4' }));
  const payload = toIssuePayload(findings.find((f) => f.kind === 'upgrade-available'));
  assert.doesNotMatch(payload.title, /breach|broke|fail/i);
  assert.doesNotMatch(payload.body.split('\n')[0], /breach|broke|fail/i);
});

test('buildFindings: no upgrade finding when the latest tag equals the installed version', () => {
  assert.ok(!buildFindings(greenEvaluation({ latest: '4.0.2' })).some((f) => f.kind === 'upgrade-available'));
});

test('buildFindings: no upgrade finding when latest could not be resolved (offline)', () => {
  assert.ok(!buildFindings(greenEvaluation({ latest: null })).some((f) => f.kind === 'upgrade-available'));
});

test('buildFindings: an upgrade is not reported for an artifact that is not installed', () => {
  // "You could upgrade from nothing to 4.0.4" is noise, not a finding.
  const findings = buildFindings(greenEvaluation({
    version: { status: 'absent', installed: [], pinned: '4.0.2', detail: 'not installed' },
    installed: [],
    resolvedInstalled: null,
    latest: '4.0.4',
  }));
  assert.ok(!findings.some((f) => f.kind === 'upgrade-available'));
});

// ─── AC5: every finding names both versions ──────────────────────────────

test('every finding kind names both versions involved (AC5)', () => {
  const evaluations = [
    greenEvaluation({
      version: { status: 'breach', installed: ['4.0.4'], pinned: '4.0.2', detail: 'd' },
      installed: ['4.0.4'], resolvedInstalled: '4.0.4', latest: '4.0.6',
    }),
    greenEvaluation({
      assertions: { status: 'drift', results: [{ file: 'f.md', claims: 'c', upstreamPath: 'u', status: 'unmatched', detail: 'd' }] },
      latest: '4.0.6',
    }),
    greenEvaluation({
      fixtures: { status: 'mismatch', results: [{ run: 'cmd', status: 'mismatch', detail: 'd' }] },
      latest: '4.0.6',
    }),
  ];
  const findings = evaluations.flatMap(buildFindings);
  assert.ok(findings.length >= 4, 'expected findings across all three evaluations');
  for (const f of findings) {
    const payload = toIssuePayload(f);
    assert.ok(f.versions.from, `${f.kind} must carry a "from" version`);
    assert.ok(f.versions.to, `${f.kind} must carry a "to" version`);
    assert.ok(
      payload.body.includes(f.versions.from) && payload.body.includes(f.versions.to),
      `${f.kind} body must print both versions so a reader can date the finding without re-deriving it`,
    );
  }
});

// ─── AC4: fingerprint stability across version moves ─────────────────────

test('fingerprint is stable when only the versions move (AC4 beats AC5 in the basis)', () => {
  // The load-bearing decision: versions appear in the BODY (AC5) but never in
  // the fingerprint basis (AC4). Were they in the basis, every upstream
  // release would mint a brand-new issue for the same unresolved drift
  // instead of updating the standing one.
  const a = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  const b = buildFindings(greenEvaluation({ latest: '4.0.9' }))[0];
  assert.strictEqual(a.kind, 'upgrade-available');
  assert.strictEqual(a.id, b.id, 'same standing drift across two upstream releases must share one id');
  assert.notStrictEqual(a.versions.to, b.versions.to, 'the versions themselves must still differ');
});

test('fingerprint distinguishes dependencies, kinds, and subjects', () => {
  const base = greenEvaluation({
    assertions: {
      status: 'drift',
      results: [
        { file: 'a.md', claims: 'claim one', upstreamPath: 'u', status: 'unmatched', detail: 'd' },
        { file: 'b.md', claims: 'claim two', upstreamPath: 'u', status: 'unmatched', detail: 'd' },
      ],
    },
  });
  const [f1, f2] = buildFindings(base);
  assert.notStrictEqual(f1.id, f2.id, 'two different citing files are two different findings');

  const otherDep = buildFindings(greenEvaluation({
    name: 'impeccable-cli',
    assertions: { status: 'drift', results: [{ file: 'a.md', claims: 'claim one', upstreamPath: 'u', status: 'unmatched', detail: 'd' }] },
  }))[0];
  assert.notStrictEqual(f1.id, otherDep.id, 'the same claim under a different dependency is a different finding');
});

test('fingerprint ignores cosmetic rewording of the detail text', () => {
  const mk = (detail) => buildFindings(greenEvaluation({
    fixtures: { status: 'mismatch', results: [{ run: 'same cmd', status: 'mismatch', detail }] },
  }))[0];
  assert.strictEqual(mk('expected exit 2, observed 0').id, mk('EXPECTED  exit 2,   observed 0').id);
});

test('every finding id carries the upstream-drift prefix', () => {
  const f = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  assert.match(f.id, /^upstreamdrift-[0-9a-f]{8}$/);
});

// ─── AC4: dedup against existing by:upstream-drift issues ────────────────

test('dedupeFindings: an open issue with the same fingerprint is skipped, not re-filed', () => {
  const f = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  const { payloads, decisions } = dedupeFindings([f], { [f.id]: { number: 7, state: 'OPEN', labels: ['by:upstream-drift'] } }, {});
  assert.deepStrictEqual(payloads, []);
  assert.strictEqual(decisions[0].action, 'skip');
  assert.strictEqual(decisions[0].issue, 7);
});

test('dedupeFindings: a closed issue with the same fingerprint reopens as a regression', () => {
  const f = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  const { payloads, decisions } = dedupeFindings([f], { [f.id]: { number: 9, state: 'CLOSED', labels: [] } }, {});
  assert.strictEqual(decisions[0].action, 'reopen');
  assert.strictEqual(payloads.length, 1);
  assert.strictEqual(payloads[0].fingerprint, f.id);
});

test('dedupeFindings: a wontfix issue is a standing decision and is never re-proposed', () => {
  const f = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  const { payloads, decisions } = dedupeFindings([f], { [f.id]: { number: 11, state: 'OPEN', labels: ['by:upstream-drift', 'wontfix'] } }, {});
  assert.deepStrictEqual(payloads, []);
  assert.strictEqual(decisions[0].action, 'suppress');
});

test('dedupeFindings: an unseen finding is filed', () => {
  const f = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  const { payloads } = dedupeFindings([f], {}, {});
  assert.strictEqual(payloads.length, 1);
  assert.strictEqual(payloads[0].fingerprint, f.id);
});

test('dedupeFindings: the same finding twice in one run files once', () => {
  const f = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  const { payloads } = dedupeFindings([f, { ...f }], {}, {});
  assert.strictEqual(payloads.length, 1);
});

// ─── issue payloads ──────────────────────────────────────────────────────

test('toIssuePayload: carries the by:upstream-drift label', () => {
  const f = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  assert.ok(toIssuePayload(f).labels.includes('by:upstream-drift'));
});

test('toIssuePayload: embeds the fingerprint in the body so a later run can re-read it', () => {
  // dedup's issue index is built by grepping filed issues for their
  // fingerprint; a payload that only carries it out-of-band cannot be
  // reconstructed from GitHub on a fresh machine.
  const f = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  assert.match(toIssuePayload(f).body, new RegExp(f.id));
});

test('toIssuePayload: a drift payload and an upgrade payload are not titled identically', () => {
  const drift = buildFindings(greenEvaluation({
    version: { status: 'breach', installed: ['4.0.4'], pinned: '4.0.2', detail: 'd' },
    installed: ['4.0.4'], resolvedInstalled: '4.0.4',
  })).find((f) => f.kind === 'pin-breach');
  const upgrade = buildFindings(greenEvaluation({ latest: '4.0.4' })).find((f) => f.kind === 'upgrade-available');
  assert.notStrictEqual(toIssuePayload(drift).title, toIssuePayload(upgrade).title);
});

// ─── AC3 + AC6: --dry-run gates every write ──────────────────────────────

test('validate-findings: --dry-run writes no cache file (AC3)', () => {
  const root = tmpDir();
  const { cmdValidateFindings } = require('../run');
  const findingsPath = path.join(root, 'findings.json');
  fs.writeFileSync(findingsPath, JSON.stringify(buildFindings(greenEvaluation({ latest: '4.0.4' }))));

  cmdValidateFindings({ _: ['validate-findings', findingsPath], root, dryRun: true }, { write: () => {} });
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'upstream-drift', 'cache.json')),
    false,
    'a dry run that still writes fingerprint state is not a dry run',
  );
});

test('validate-findings: a real run does write the cache, proving the dry-run test discriminates', () => {
  const root = tmpDir();
  const { cmdValidateFindings } = require('../run');
  const findingsPath = path.join(root, 'findings.json');
  fs.writeFileSync(findingsPath, JSON.stringify(buildFindings(greenEvaluation({ latest: '4.0.4' }))));

  cmdValidateFindings({ _: ['validate-findings', findingsPath], root, dryRun: false }, { write: () => {} });
  assert.strictEqual(fs.existsSync(path.join(root, '.claude-tweaks', 'upstream-drift', 'cache.json')), true);
});

test('validate-findings: a dry run still prints the full payload set (AC3)', () => {
  const root = tmpDir();
  const { cmdValidateFindings } = require('../run');
  const findingsPath = path.join(root, 'findings.json');
  fs.writeFileSync(findingsPath, JSON.stringify(buildFindings(greenEvaluation({ latest: '4.0.4' }))));

  let out = '';
  cmdValidateFindings({ _: ['validate-findings', findingsPath], root, dryRun: true }, { write: (s) => { out += s; } });
  assert.strictEqual(JSON.parse(out).length, 1, 'dry-run must still perform every check and report');
});

test('the runner never reads or writes health-state (AC6)', () => {
  // AC6 is "dry-run writes nothing to health-state and stamps no cursor".
  // This runner satisfies it structurally: it has no rotation cursor and
  // calls no durable-state accessor, so there is no code path to gate.
  //
  // Asserting on the module GRAPH would be wrong here and was tried first:
  // health-core's own cache.js does `require('./durable-state')` to borrow
  // its `defaultSleep`, so durable-state is transitively loaded by anything
  // using createCache. Loading it is not writing to it — the invariant that
  // actually matches the AC is that run.js never calls the accessors.
  const src = fs.readFileSync(path.join(__dirname, '..', 'run.js'), 'utf8');
  assert.doesNotMatch(src, /writeDurableState/, 'run.js must never write the health-state branch');
  assert.doesNotMatch(src, /readDurableState/, 'run.js must not depend on health-state either');
});

test('the runner defines no rotation cursor (AC1: version-driven triggers only)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'run.js'), 'utf8');
  // The four shipped sweeps rotate on `lastAuditedMs`; a cursor here would
  // sit on a real breaking bump for up to a rotation period.
  assert.doesNotMatch(src, /lastAuditedMs/, 'no rotation cursor — triggers are version-driven');
  assert.doesNotMatch(src, /selectTarget|selectBudget/, 'no rotation selection');
});

// ─── malformed input to validate-findings ────────────────────────────────

test('validateFinding: rejects a finding that cannot name both versions (AC5)', () => {
  const { validateFinding } = require('../run');
  const good = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  assert.strictEqual(validateFinding(good).ok, true);

  const noVersions = { ...good, versions: { from: '4.0.2' } };
  const result = validateFinding(noVersions);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /versions/.test(e)));
});

test('validateFinding: rejects an unknown kind rather than crashing on the title template', () => {
  const { validateFinding } = require('../run');
  const good = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  const result = validateFinding({ ...good, kind: 'invented-kind' });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /unknown kind/.test(e)));
});

test('validateFinding: rejects a finding with no fingerprint', () => {
  const { validateFinding } = require('../run');
  const good = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  // Without an id, decide() sees no match and files it as brand new on every
  // single run — the exact duplicate-spam AC4 exists to prevent.
  const { id, ...noId } = good;
  assert.strictEqual(validateFinding(noId).ok, false);
});

test('validate-findings: a malformed entry is dropped, and the valid ones still file', () => {
  const root = tmpDir();
  const { cmdValidateFindings } = require('../run');
  const good = buildFindings(greenEvaluation({ latest: '4.0.4' }))[0];
  const findingsPath = path.join(root, 'findings.json');
  fs.writeFileSync(findingsPath, JSON.stringify([{ kind: 'nonsense' }, good]));

  let out = '';
  cmdValidateFindings({ _: ['validate-findings', findingsPath], root, dryRun: true }, { write: (s) => { out += s; } });
  const payloads = JSON.parse(out);
  assert.strictEqual(payloads.length, 1, 'one bad entry must not fail the whole run');
  assert.strictEqual(payloads[0].fingerprint, good.id);
});

// ─── the upgrade predicate has exactly one definition ────────────────────

test('hasUpgrade: due, findings, and the due-report all agree on the same predicate', () => {
  const { hasUpgrade } = require('../run');
  const behind = greenEvaluation({ latest: '4.0.4' });
  const level = greenEvaluation({ latest: '4.0.2' });
  const absent = greenEvaluation({ latest: '4.0.4', resolvedInstalled: null, installed: [] });

  assert.strictEqual(hasUpgrade(behind), true);
  assert.strictEqual(hasUpgrade(level), false);
  assert.strictEqual(hasUpgrade(absent), false, 'no upgrade path from a missing artifact');

  // The agreement itself is the point: a `due` report that disagrees with the
  // findings it precedes is worse than either being wrong alone.
  for (const ev of [behind, level, absent]) {
    const hasUpgradeFinding = buildFindings(ev).some((f) => f.kind === 'upgrade-available');
    assert.strictEqual(hasUpgradeFinding, hasUpgrade(ev), 'buildFindings must match hasUpgrade');
  }
});

// ─── AC7: the one-way import boundary ────────────────────────────────────

test('nothing under plugin/bin/ imports from tools/ (AC7)', () => {
  const binRoot = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin');
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      // Matches require('../tools/x'), require('../../tools/x'), and
      // require('tools/x') — anchored on the path segment so a require of a
      // module merely *named* like a tool does not false-positive.
      if (/require\(\s*['"][^'"]*(?:^|\/)tools\//m.test(src)) offenders.push(path.relative(binRoot, full));
    }
  })(binRoot);
  assert.deepStrictEqual(offenders, [], 'plugin/bin/ -> tools/ imports break the one-way boundary');
});

test('the runner imports health-core rather than reimplementing dedup', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'run.js'), 'utf8');
  assert.match(src, /bin\/lib\/health-core\/dedup/);
  assert.match(src, /bin\/lib\/health-core\/fingerprint/);
});

// ─── the manifest this repo actually ships still evaluates ───────────────

test('buildFindings runs end-to-end against the real manifest with stubbed checks', () => {
  const { loadManifest } = require('../manifest');
  const manifest = loadManifest(path.join(__dirname, '..', 'manifest.yml'));
  assert.ok(manifest.dependencies.length >= 2);
  for (const dep of manifest.dependencies) {
    const ev = evaluate(dep, {
      checkVersion: () => ({ check: 'version', status: 'ok', installed: [dep.pinned], pinned: dep.pinned, detail: 'ok' }),
      checkAssertions: () => ({ check: 'assertions', status: 'ok', results: [] }),
      replayFixtures: () => ({ check: 'fixtures', status: 'ok', results: [] }),
      resolveLatest: () => null,
    });
    assert.deepStrictEqual(buildFindings(ev), [], `${dep.name}: an all-green run must file nothing (AC2)`);
    assert.strictEqual(ev.due, false, `${dep.name}: nothing moved, so nothing is due`);
  }
});

// ─── content-pinned entries (`versioning: none`) ─────────────────────────

function contentPinnedEntry() {
  return {
    name: 'sample-skills',
    kind: 'skill-repo',
    pin: { commit: 'a'.repeat(40), versioning: 'none' },
    upstream: { repo: 'example/skills' },
    consumed: [{ path: 'skills/one/SKILL.md', sha256: 'b'.repeat(64) }],
  };
}

test('evaluate takes the content-pin path for a versioning: none entry — no probe checks, no latest-tag resolution', () => {
  let probeCalled = false;
  const ev = evaluate(contentPinnedEntry(), {
    checkVersion: () => { probeCalled = true; },
    checkAssertions: () => { probeCalled = true; },
    replayFixtures: () => { probeCalled = true; },
    resolveLatest: () => { probeCalled = true; },
    checkContentPins: () => ({ check: 'content-pins', name: 'sample-skills', commit: 'a'.repeat(40), status: 'ok', results: [] }),
  });
  assert.strictEqual(probeCalled, false, 'no probe-class check may run for the class');
  assert.strictEqual(ev.pinned, 'a'.repeat(40));
  assert.strictEqual(ev.latest, null);
  assert.strictEqual(ev.due, false);
  assert.deepStrictEqual(buildFindings(ev), []);
});

test('a content-pin mismatch makes the entry due and builds one valid content-pin-breach finding', () => {
  const { validateFinding } = require('../run');
  const ev = evaluate(contentPinnedEntry(), {
    checkContentPins: () => ({
      check: 'content-pins',
      name: 'sample-skills',
      commit: 'a'.repeat(40),
      status: 'mismatch',
      results: [
        { path: 'skills/one/SKILL.md', status: 'mismatch', observed: 'c'.repeat(64), detail: 'observed differs' },
      ],
    }),
  });
  assert.strictEqual(ev.due, true);

  const findings = buildFindings(ev);
  assert.strictEqual(findings.length, 1);
  const f = findings[0];
  assert.strictEqual(f.kind, 'content-pin-breach');
  assert.strictEqual(f.class, 'drift');
  assert.strictEqual(f.severity, 'high');
  assert.strictEqual(f.subject, 'skills/one/SKILL.md');

  const v = validateFinding(f);
  assert.strictEqual(v.ok, true, JSON.stringify(v.errors));
  const payload = toIssuePayload(f);
  assert.ok(payload.title.includes('sample-skills'));
  assert.ok(payload.title.includes('skills/one/SKILL.md'));
});

test('a missing fixture also builds a content-pin-breach finding with a non-empty versions.from', () => {
  const ev = evaluate(contentPinnedEntry(), {
    checkContentPins: () => ({
      check: 'content-pins',
      name: 'sample-skills',
      commit: 'a'.repeat(40),
      status: 'mismatch',
      results: [
        { path: 'skills/one/SKILL.md', status: 'missing-fixture', observed: null, detail: 'does not exist' },
      ],
    }),
  });
  const findings = buildFindings(ev);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].versions.from, '(missing fixture)');
});
