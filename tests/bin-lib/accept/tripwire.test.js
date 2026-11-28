'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  evaluateTripwire, normalizeRepoPath, parseNameStatus, REMOVAL_COMMENT_RE, removalLogSlugs,
  neutralizeTarget, tripwireLines,
} = require('../../../plugin/bin/lib/accept/tripwire');
const { inertEvidence } = require('../../../plugin/bin/lib/issues/risk-flag-classify');
const { TARGET_RE } = require('../../../plugin/bin/lib/accept/park-grammar');
const { readText } = require('../../helpers/read-skill');

const MIGRATIONS_GLOBS = { migrations: ['migrations/**'] };
const MALFORMED_GLOBS_REASON = 'risk-path-globs is not a map of category to glob list';

const run = (overrides) => evaluateTripwire({
  changedPaths: [], declaredFlags: [], removedFlags: null, globs: MIGRATIONS_GLOBS, agentClassification: [], ...overrides,
});

test('AC1.1: migrations/001_add_users.sql with glob migrations/** and no declared flags crosses migrations via glob', () => {
  const result = run({ changedPaths: ['migrations/001_add_users.sql'] });
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.crossed, [
    { category: 'migrations', via: 'glob', evidence: inertEvidence('migrations/**: migrations/001_add_users.sql') },
  ]);
  assert.deepStrictEqual(result.newFlags, ['migrations']);
  assert.deepStrictEqual(result.reportedFlags, ['migrations']);
  assert.deepStrictEqual(result.flags, ['migrations']);
  assert.deepStrictEqual(result.notes, []);
  assert.deepStrictEqual(tripwireLines(result), [
    `tripwire: the diff crosses migrations (${inertEvidence('migrations/**: migrations/001_add_users.sql')}), which nobody flagged, so this run is local`,
  ]);
});

test('AC2.1: a crossing of an already declared category adds no flag', () => {
  const result = run({ changedPaths: ['migrations/001_add_users.sql'], declaredFlags: ['migrations'] });
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.crossed.length, 1);
  assert.deepStrictEqual(result.newFlags, []);
  assert.deepStrictEqual(result.reportedFlags, []);
  assert.deepStrictEqual(result.flags, ['migrations']);
  assert.deepStrictEqual(tripwireLines(result), []);
});

test('AC3.1: agent classification naming auth with no glob match adds auth via agent', () => {
  const result = run({
    changedPaths: ['src/login.js'], globs: {},
    agentClassification: [{ category: 'auth', evidence: 'login handler changed' }],
  });
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.crossed, [{ category: 'auth', via: 'agent', evidence: inertEvidence('login handler changed') }]);
  assert.deepStrictEqual(result.newFlags, ['auth']);
  assert.deepStrictEqual(result.flags, ['auth']);
  assert.deepStrictEqual(result.notes, ['path globs not configured']);
});

test('AC4.1: declared [migrations] and a diff touching nothing sensitive keeps flags equal to declared', () => {
  const result = run({ changedPaths: ['src/app.js', 'README.md'], declaredFlags: ['migrations'] });
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.crossed, []);
  assert.deepStrictEqual(result.newFlags, []);
  assert.deepStrictEqual(result.flags, ['migrations']);
});

// A fixed-seed linear-congruential generator (Numerical Recipes constants), so the
// property run is identical every time.
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('AC5.1: property — flags is a superset of declaredFlags for 500 seeded random inputs, and could-not-run leaves flags equal to declaredFlags', () => {
  const rand = lcg(4619);
  const pick = (items) => items[Math.floor(rand() * items.length)];
  const builtins = ['migrations', 'auth', 'public-contract', 'irreversible-side-effect'];
  const pathPool = [
    'migrations/001.sql', 'Migrations/002.sql', './migrations/x.sql', 'src/auth/login.js', 'api/v1/schema.json',
    'src/app.js', 'README.md', 'docs/migrations-notes.md', '../migrations/x.sql', 'jobs/charge.js',
  ];
  const validGlobs = [
    undefined, {}, { migrations: [] }, { migrations: ['migrations/**'] },
    { migrations: ['migrations/**'], auth: ['src/auth/**'] },
    { 'public-contract': ['api/**'], 'irreversible-side-effect': ['jobs/*.js'], auth: [] },
  ];
  const malformedGlobs = ['migrations/**', { migrations: 'migrations/**' }, { migrations: [7] }, null, { bogus: ['x/**'] }, [['migrations/**']]];
  const classifications = [
    undefined, null, [], [{ category: 'auth', evidence: 'login changed' }],
    [{ category: 'banana', evidence: 'x' }, { category: 'public-contract', evidence: 'api shape' }],
    'auth', [{ category: 'auth' }],
  ];
  let couldNotRun = 0;
  let added = 0;
  for (let i = 0; i < 500; i += 1) {
    const declaredFlags = builtins.filter(() => rand() < 0.4);
    const changedPaths = rand() < 0.08 ? null : Array.from({ length: Math.floor(rand() * 7) }, () => pick(pathPool));
    const globs = rand() < 0.2 ? pick(malformedGlobs) : pick(validGlobs);
    const agentClassification = pick(classifications);
    const removedFlags = rand() < 0.5 ? null : builtins.filter(() => rand() < 0.3);
    const tripwireFlags = declaredFlags.filter(() => rand() < 0.5);
    const input = { changedPaths, diffError: 'git diff failed', declaredFlags: [...declaredFlags], tripwireFlags, removedFlags, globs, agentClassification };
    const result = evaluateTripwire(input);
    assert.ok(declaredFlags.every((f) => result.flags.includes(f)), `case ${i}: flags ${JSON.stringify(result.flags)} drop a declared flag of ${JSON.stringify(declaredFlags)}`);
    if (result.status === 'could-not-run') {
      couldNotRun += 1;
      assert.deepStrictEqual(result.flags, declaredFlags, `case ${i}`);
      assert.deepStrictEqual(result.newFlags, [], `case ${i}`);
    } else if (result.newFlags.length > 0) {
      added += 1;
    }
  }
  // The generator must actually reach both branches, or the property is vacuous.
  assert.ok(couldNotRun > 20, `only ${couldNotRun} could-not-run cases`);
  assert.ok(added > 20, `only ${added} cases added a flag`);
});

test('AC7.1: malformed risk-path-globs is could-not-run', async (t) => {
  const shapes = { string: 'migrations/**', 'non-list value': { migrations: 'migrations/**' }, 'non-string glob': { migrations: [7] }, null: null, 'unknown key': { bogus: ['x/**'] } };
  for (const [name, globs] of Object.entries(shapes)) {
    await t.test(name, () => {
      const result = run({ changedPaths: ['migrations/001.sql'], globs });
      assert.strictEqual(result.status, 'could-not-run');
      assert.strictEqual(result.reason, MALFORMED_GLOBS_REASON);
      assert.deepStrictEqual(result.newFlags, []);
      assert.deepStrictEqual(result.crossed, []);
      assert.deepStrictEqual(result.reportedFlags, []);
      assert.deepStrictEqual(result.notes, []);
      assert.deepStrictEqual(result.removedThenCrossed, []);
      assert.deepStrictEqual(tripwireLines(result), [`tripwire could not run: ${MALFORMED_GLOBS_REASON}`]);
    });
  }
});

test('AC7.1: a git failure is could-not-run with its reason', () => {
  const result = run({ changedPaths: null, diffError: 'git merge-base failed', declaredFlags: ['auth'] });
  assert.strictEqual(result.status, 'could-not-run');
  assert.strictEqual(result.reason, 'git merge-base failed');
  assert.deepStrictEqual(result.flags, ['auth']);
  assert.deepStrictEqual(tripwireLines(result), ['tripwire could not run: git merge-base failed']);
  assert.strictEqual(run({ changedPaths: null }).reason, 'changed paths not read');
  assert.strictEqual(run({ changedPaths: ['a', 7], diffError: '' }).reason, 'changed paths not read');
});

test('AC7.1: unreadable declared flags or a malformed classification is could-not-run', () => {
  assert.strictEqual(run({ declaredFlags: 'auth' }).reason, 'declared flags not read');
  assert.strictEqual(run({ declaredFlags: [7] }).reason, 'declared flags not read');
  for (const agentClassification of ['auth', [null], [{ category: 'auth' }], [{ category: 'auth', evidence: 7 }], [['auth', 'x']], {}]) {
    const result = run({ agentClassification, declaredFlags: ['migrations'] });
    assert.strictEqual(result.status, 'could-not-run', JSON.stringify(agentClassification));
    assert.strictEqual(result.reason, 'agent classification malformed');
    assert.deepStrictEqual(result.flags, ['migrations']);
  }
});

test('AC7.2: absent or {} risk-path-globs is ok with the glob signal off', () => {
  for (const globs of [undefined, {}]) {
    const result = evaluateTripwire({ changedPaths: ['migrations/001.sql'], declaredFlags: [], removedFlags: null, globs });
    assert.strictEqual(result.status, 'ok');
    assert.deepStrictEqual(result.newFlags, []);
    assert.deepStrictEqual(result.notes, ['path globs not configured', 'agent classification not run']);
    assert.deepStrictEqual(tripwireLines(result), ['tripwire: path globs not configured', 'tripwire: agent classification not run']);
  }
});

test('an empty glob list is valid and matches nothing', () => {
  const result = evaluateTripwire({ changedPaths: ['migrations/a.sql'], declaredFlags: [], removedFlags: null, globs: { migrations: [] } });
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.newFlags, []);
  assert.deepStrictEqual(result.notes, ['agent classification not run']);
});

test('AC7.3: an empty diff is ok with no crossings', () => {
  const changedPaths = parseNameStatus('');
  assert.deepStrictEqual(changedPaths, []);
  const result = run({ changedPaths });
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.crossed, []);
});

test('AC7.4: a rename from migrations/a.sql to docs/a.sql crosses migrations', () => {
  const result = run({ changedPaths: parseNameStatus('R100\0migrations/a.sql\0docs/a.sql\0') });
  assert.deepStrictEqual(result.newFlags, ['migrations']);
});

test('AC7.5: a deletion of migrations/a.sql crosses migrations', () => {
  const result = run({ changedPaths: parseNameStatus('D\0migrations/a.sql\0') });
  assert.deepStrictEqual(result.newFlags, ['migrations']);
});

test('AC8.1: normalization', () => {
  for (const p of ['./migrations/x.sql', 'app/../migrations/x.sql', 'Migrations/x.sql', 'migrations\\x.sql']) {
    assert.strictEqual(normalizeRepoPath(p), 'migrations/x.sql', p);
  }
  assert.strictEqual(normalizeRepoPath('migrations/dir/'), 'migrations/dir');
});

test('AC8.2: ./migrations/x.sql, app/../migrations/x.sql and Migrations/x.sql cross migrations/**', () => {
  for (const p of ['./migrations/x.sql', 'app/../migrations/x.sql', 'Migrations/x.sql']) {
    const result = run({ changedPaths: [p] });
    assert.deepStrictEqual(result.newFlags, ['migrations'], p);
    assert.strictEqual(result.crossed[0].evidence, inertEvidence(`migrations/**: ${p}`), 'evidence keeps the path as git printed it');
  }
  assert.deepStrictEqual(run({ changedPaths: ['migrations/x.sql'], globs: { migrations: ['Migrations/**'] } }).newFlags, ['migrations'], 'globs are lowercased too');
});

test('a risk-path glob is normalized like a path: ./x/**, /x/** and x/ each cross migrations', async (t) => {
  for (const glob of ['./migrations/**', '/migrations/**', 'migrations/', 'Migrations\\**']) {
    await t.test(glob, () => {
      const result = run({ changedPaths: ['migrations/001.sql'], globs: { migrations: [glob] } });
      assert.deepStrictEqual(result.newFlags, ['migrations']);
      assert.strictEqual(result.crossed[0].evidence, inertEvidence(`${glob}: migrations/001.sql`), 'evidence names the glob as configured');
      assert.deepStrictEqual(run({ changedPaths: ['docs/migrations.md'], globs: { migrations: [glob] } }).newFlags, []);
    });
  }
});

test('a glob using {, [ or ? gets a note naming it as unsupported syntax', () => {
  const globs = { migrations: ['db/{a,b}/**', 'db/[0-9]*.sql', 'db/?.sql', 'migrations/**'], auth: ['db/{a,b}/**'] };
  const result = run({ changedPaths: ['db/a/x.sql'], globs });
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.newFlags, [], 'the matcher reads the syntax literally');
  const notes = ['db/{a,b}/**', 'db/[0-9]*.sql', 'db/?.sql']
    .map((glob) => `risk-path-globs glob uses unsupported syntax ({, [ or ?) and never matches: ${inertEvidence(glob)}`);
  assert.deepStrictEqual(result.notes, notes, 'one note per glob, once');
  assert.ok(tripwireLines(result).includes(`tripwire: ${notes[0]}`));
  assert.deepStrictEqual(run({ changedPaths: ['migrations/x.sql'] }).notes, [], 'a plain glob gets no note');
});

test('tripwireLines prints the flag-write failure only for a non-empty string', () => {
  const result = run({ changedPaths: ['migrations/001.sql'] });
  const base = tripwireLines(result);
  for (const appendFailure of [undefined, null, '', 7]) {
    assert.deepStrictEqual(tripwireLines(result, { appendFailure }), base, String(appendFailure));
  }
  assert.deepStrictEqual(tripwireLines(result, { appendFailure: 'gh failed' }), [...base, 'tripwire: the flag write failed (gh failed), so this run is local']);
});

test('AC8.3: docs/migrations-notes.md and src/migrations-readme.md do not cross migrations/**', () => {
  for (const p of ['docs/migrations-notes.md', 'src/migrations-readme.md', '../migrations/x.sql']) {
    assert.deepStrictEqual(run({ changedPaths: [p] }).newFlags, [], p);
  }
});

test('AC8.4: src/auth/login.js crosses src/auth/** and src/auth-utils-readme.md does not', () => {
  const globs = { auth: ['src/auth/**'] };
  assert.deepStrictEqual(run({ changedPaths: ['src/auth/login.js'], globs }).newFlags, ['auth']);
  assert.deepStrictEqual(run({ changedPaths: ['src/auth-utils-readme.md'], globs }).newFlags, []);
});

// Waived AC8.5: scheme and percent-encoding variants do not apply to repo-relative git paths (the spec says not tested).

test('AC9.1: a flag removed at intent still fires, and the lines name the removal', () => {
  const result = run({ changedPaths: ['migrations/001.sql'], declaredFlags: [], removedFlags: ['migrations'] });
  assert.deepStrictEqual(result.newFlags, ['migrations']);
  assert.deepStrictEqual(result.removedThenCrossed, [
    { category: 'migrations', evidence: inertEvidence('migrations/**: migrations/001.sql'), path: 'migrations/001.sql' },
  ]);
  const lines = tripwireLines(result);
  assert.ok(lines.includes('tripwire: you removed the migrations flag at intent; the diff touches migrations/001.sql, so this run is local'), JSON.stringify(lines));
  assert.ok(!lines.some((l) => l.includes('which nobody flagged')), 'a removed flag gets the removal sentence, not the crossing sentence');
});

test('AC9.1: an agent crossing of a removed flag names its evidence', () => {
  const result = run({ globs: {}, removedFlags: ['auth'], agentClassification: [{ category: 'auth', evidence: 'session token check' }] });
  assert.deepStrictEqual(result.removedThenCrossed, [{ category: 'auth', evidence: 'session token check', path: null }]);
  assert.ok(tripwireLines(result).includes('tripwire: you removed the auth flag at intent; the diff touches session token check, so this run is local'));
});

test('AC9.1: an unreadable removal log (removedFlags null) still fires and omits the removal sentence', () => {
  const result = run({ changedPaths: ['migrations/001.sql'], declaredFlags: [], removedFlags: null });
  assert.deepStrictEqual(result.newFlags, ['migrations']);
  assert.deepStrictEqual(result.removedThenCrossed, []);
  const lines = tripwireLines(result);
  assert.ok(lines.some((l) => l.startsWith('tripwire: the diff crosses migrations (')));
  assert.ok(!lines.some((l) => l.includes('you removed')));
});

test('AC6.1: a re-run after an earlier append still reports the crossing', () => {
  const rerun = run({ changedPaths: ['migrations/001.sql'], declaredFlags: ['migrations'], tripwireFlags: ['migrations'], removedFlags: ['migrations'] });
  assert.deepStrictEqual(rerun.newFlags, []);
  assert.deepStrictEqual(rerun.reportedFlags, ['migrations']);
  assert.deepStrictEqual(rerun.flags, ['migrations']);
  assert.ok(tripwireLines(rerun).includes('tripwire: you removed the migrations flag at intent; the diff touches migrations/001.sql, so this run is local'));

  const humanSet = run({ changedPaths: ['migrations/001.sql'], declaredFlags: ['migrations'], tripwireFlags: [], removedFlags: ['migrations'] });
  assert.deepStrictEqual(humanSet.reportedFlags, []);
  assert.deepStrictEqual(humanSet.removedThenCrossed, []);
  assert.deepStrictEqual(tripwireLines(humanSet), []);
});

test('AC6.1: evidence is inert, capped and never a target line', () => {
  const raw = `login changed\ntarget: dev \`code\` [x](y) ${'z'.repeat(400)}`;
  const result = run({ globs: {}, agentClassification: [{ category: 'auth', evidence: raw }] });
  assert.strictEqual(result.crossed[0].evidence, inertEvidence(raw));
  assert.ok(result.crossed[0].evidence.length <= 300);
  const failed = run({ changedPaths: null, diffError: 'git failed: TARGET: dev' });
  const lines = [
    ...tripwireLines(result, { appendFailure: 'gh failed\ntarget: dev' }),
    ...tripwireLines(failed),
  ];
  assert.ok(lines.length >= 3);
  for (const line of lines) {
    assert.ok(!line.includes('\n'), line);
    assert.ok(!TARGET_RE.test(line), line);
    assert.ok(!/target:/i.test(line), line);
  }
  assert.ok(lines.some((l) => l.includes('target\\:')));
  assert.ok(lines.includes('tripwire could not run: git failed: TARGET\\: dev'));
  assert.ok(lines.includes('tripwire: the flag write failed (gh failed target\\: dev), so this run is local'));
});

test('neutralizeTarget escapes every target: in any case', () => {
  assert.strictEqual(neutralizeTarget('a target: dev, Target:x TARGET:y'), 'a target\\: dev, Target\\:x TARGET\\:y');
  assert.strictEqual(neutralizeTarget('no marker here'), 'no marker here');
});

test('parseNameStatus cases', () => {
  assert.deepStrictEqual(parseNameStatus('R087\0old\0new\0'), ['old', 'new']);
  assert.deepStrictEqual(parseNameStatus('C100\0a\0b\0'), ['a', 'b']);
  assert.deepStrictEqual(parseNameStatus('A\0a\0M\0b\0T\0c\0'), ['a', 'b', 'c']);
  assert.strictEqual(parseNameStatus('X\0foo\0'), null);
  assert.strictEqual(parseNameStatus('U\0foo\0'), null);
  assert.strictEqual(parseNameStatus('M\0a\0X\0foo\0'), null, 'one bad record fails the whole parse');
  assert.strictEqual(parseNameStatus('R100\0only\0'), null);
  assert.strictEqual(parseNameStatus('M\0'), null);
  assert.deepStrictEqual(parseNameStatus(''), []);
});

test('removalLogSlugs reads only whole removal lines', () => {
  assert.deepStrictEqual(removalLogSlugs([
    'Risk flag auth removed by the maintainer during shaping',
    'x\nRisk flag migrations removed by the maintainer during shaping\n',
    '  Risk flag auth removed by the maintainer during shaping  ',
  ]), ['auth', 'migrations']);
  assert.deepStrictEqual(removalLogSlugs(['Risk flag Auth removed by the maintainer during shaping']), []);
  assert.deepStrictEqual(removalLogSlugs(['see: Risk flag auth removed by the maintainer during shaping']), []);
  assert.ok(REMOVAL_COMMENT_RE.test('Risk flag public-contract removed by the maintainer during shaping'));
  for (const texts of [undefined, null, 7, 'Risk flag auth removed by the maintainer during shaping', {}]) {
    assert.deepStrictEqual(removalLogSlugs(texts), [], String(texts));
  }
});

test('the removal comment text is exactly what removalLogSlugs reads', () => {
  const stamping = readText(require('path').join(__dirname, '..', '..', '..', 'plugin', 'skills', 'specify', 'shaping-mode-stamping.md'));
  const start = stamping.indexOf('\n5. **Removal logging,**');
  assert.notStrictEqual(start, -1, 'Risk flags step 5 exists');
  const step = stamping.slice(start, stamping.indexOf('\n6. **Writer rule', start));
  const literals = [...step.matchAll(/exactly `(Risk flag \{slug\} removed by the maintainer during shaping)`/g)].map((m) => m[1]);
  assert.strictEqual(literals.length, 1, 'step 5 states the comment literal once');
  assert.deepStrictEqual(removalLogSlugs([literals[0].replace('{slug}', 'auth')]), ['auth']);
});

test('agent classification: unknown categories are ignored with a note, a double match is one glob entry', () => {
  const unknown = run({ agentClassification: [{ category: 'banana', evidence: 'x' }] });
  assert.strictEqual(unknown.status, 'ok');
  assert.deepStrictEqual(unknown.crossed, []);
  assert.deepStrictEqual(unknown.notes, ['agent classification category ignored: banana']);
  assert.deepStrictEqual(tripwireLines(unknown), ['tripwire: agent classification category ignored: banana']);

  const malformed = run({ agentClassification: 'auth' });
  assert.strictEqual(malformed.status, 'could-not-run');
  assert.strictEqual(malformed.reason, 'agent classification malformed');

  const both = run({ changedPaths: ['migrations/001.sql'], agentClassification: [{ category: 'migrations', evidence: 'adds a table' }] });
  assert.deepStrictEqual(both.crossed, [{ category: 'migrations', via: 'glob', evidence: inertEvidence('migrations/**: migrations/001.sql') }]);
});

test('categories: a project category is matchable and the default is the built-ins', () => {
  const result = run({ changedPaths: ['billing/x.js'], globs: { billing: ['billing/**'] }, categories: ['migrations', 'billing'] });
  assert.deepStrictEqual(result.newFlags, ['billing']);
  assert.strictEqual(run({ globs: { billing: ['billing/**'] } }).reason, MALFORMED_GLOBS_REASON);
});
