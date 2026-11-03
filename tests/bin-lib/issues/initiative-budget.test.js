'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_BUDGET,
  permittedInitiative,
  isTestPath,
} = require('../../../plugin/bin/lib/issues/initiative-budget.js');

// A valid fix, reused as the base for every negative case so each test varies exactly one
// thing. Building the negatives by mutating a known-good input is what makes them
// discriminating: if the base ever stops being allowed, every negative passes vacuously and
// proves nothing, so the first test pins the base itself.
const base = () => ({
  ceiling: 'trusted',
  fix: {
    kind: 'pointer-repair',
    files: ['docs/guide.md'],
    changedLines: 3,
    brokenBy: 'skills/build/SKILL.md',
  },
  changedFiles: ['skills/build/SKILL.md', 'skills/build/other.md'],
  spent: 0,
  sensitivePaths: [],
});

test('the base case is allowed — pins the fixture every negative case mutates', () => {
  const r = permittedInitiative(base());
  assert.strictEqual(r.allowed, true, r.reason);
  assert.match(r.reason, /pointer repair/);
  assert.match(r.reason, /1\/3/);
});

test('unattended also permits initiative fixes', () => {
  const input = { ...base(), ceiling: 'unattended' };
  assert.strictEqual(permittedInitiative(input).allowed, true);
});

test('supervised denies — the default ceiling authorizes nothing', () => {
  const input = { ...base(), ceiling: 'supervised' };
  const r = permittedInitiative(input);
  assert.strictEqual(r.allowed, false);
  assert.match(r.reason, /requires trusted or unattended/);
});

test('an unknown or malformed ceiling denies rather than falling open', () => {
  for (const ceiling of ['Trusted', 'TRUSTED', '', 'god-mode', null, undefined, 1, {}]) {
    const r = permittedInitiative({ ...base(), ceiling });
    assert.strictEqual(r.allowed, false, `ceiling ${JSON.stringify(ceiling)} must deny`);
  }
});

test('kind is an allowlist — an untaught kind denies', () => {
  for (const kind of ['dead-code', 'typo', 'POINTER-REPAIR', '', 'refactor', null, 7]) {
    const r = permittedInitiative({ ...base(), fix: { ...base().fix, kind } });
    assert.strictEqual(r.allowed, false, `kind ${JSON.stringify(kind)} must deny`);
  }
});

test('budget exhaustion denies, and reports the budget rather than a cap', () => {
  const r = permittedInitiative({ ...base(), spent: DEFAULT_BUDGET.maxFixes });
  assert.strictEqual(r.allowed, false);
  assert.match(r.reason, /budget exhausted/);
});

test('the last fix inside the budget is still allowed', () => {
  const r = permittedInitiative({ ...base(), spent: DEFAULT_BUDGET.maxFixes - 1 });
  assert.strictEqual(r.allowed, true, r.reason);
  assert.match(r.reason, /3\/3/);
});

test('a negative or non-integer spent is treated as zero, never as credit', () => {
  for (const spent of [-5, 1.5, '2', null, undefined, NaN]) {
    const r = permittedInitiative({ ...base(), spent });
    assert.strictEqual(r.allowed, true, `spent ${JSON.stringify(spent)} should floor to 0`);
  }
});

test('file-count and line caps deny at the boundary+1 and allow at the boundary', () => {
  const atFileCap = {
    ...base(),
    fix: { ...base().fix, files: ['docs/a.md', 'docs/b.md'] },
  };
  assert.strictEqual(permittedInitiative(atFileCap).allowed, true);

  const overFileCap = {
    ...base(),
    fix: { ...base().fix, files: ['docs/a.md', 'docs/b.md', 'docs/c.md'] },
  };
  const rf = permittedInitiative(overFileCap);
  assert.strictEqual(rf.allowed, false);
  assert.match(rf.reason, /over the cap/);

  const atLineCap = {
    ...base(),
    fix: { ...base().fix, changedLines: DEFAULT_BUDGET.maxLinesPerFix },
  };
  assert.strictEqual(permittedInitiative(atLineCap).allowed, true);

  const overLineCap = {
    ...base(),
    fix: { ...base().fix, changedLines: DEFAULT_BUDGET.maxLinesPerFix + 1 },
  };
  const rl = permittedInitiative(overLineCap);
  assert.strictEqual(rl.allowed, false);
  assert.match(rl.reason, /over the cap/);
});

test('a missing or malformed changed-line count denies — it is never assumed small', () => {
  for (const changedLines of [undefined, null, -1, 'three', 2.5, {}]) {
    const r = permittedInitiative({ ...base(), fix: { ...base().fix, changedLines } });
    assert.strictEqual(r.allowed, false, `changedLines ${JSON.stringify(changedLines)} must deny`);
  }
});

test('empty, missing, or malformed file lists deny', () => {
  for (const files of [[], undefined, null, 'docs/a.md', [''], ['  '], [null], [1]]) {
    const r = permittedInitiative({ ...base(), fix: { ...base().fix, files } });
    assert.strictEqual(r.allowed, false, `files ${JSON.stringify(files)} must deny`);
  }
});

test('a test file denies — retargeting an assertion is not pointer repair', () => {
  for (const p of [
    'tests/foo.test.js',
    'test/foo.js',
    'src/__tests__/foo.js',
    'spec/foo.js',
    'bin/lib/issues/tests/trust.test.js',
    'src/a.spec.ts',
  ]) {
    const r = permittedInitiative({ ...base(), fix: { ...base().fix, files: [p] } });
    assert.strictEqual(r.allowed, false, `${p} must deny`);
    assert.match(r.reason, /test file/);
  }
});

test('isTestPath does not misclassify ordinary paths', () => {
  for (const p of ['docs/latest.md', 'src/contest.js', 'skills/test-runner/SKILL.md']) {
    assert.strictEqual(isTestPath(p), false, `${p} must not read as a test file`);
  }
});

test('the causal gate: brokenBy must be a file this run actually changed', () => {
  const notOurs = {
    ...base(),
    fix: { ...base().fix, brokenBy: 'skills/unrelated/SKILL.md' },
  };
  const r = permittedInitiative(notOurs);
  assert.strictEqual(r.allowed, false);
  assert.match(r.reason, /not among this run's changed files/);
});

test('a missing brokenBy denies — an unattributed repair is a scope expansion', () => {
  for (const brokenBy of [undefined, null, '', '   ', 42]) {
    const r = permittedInitiative({ ...base(), fix: { ...base().fix, brokenBy } });
    assert.strictEqual(r.allowed, false, `brokenBy ${JSON.stringify(brokenBy)} must deny`);
  }
});

test('a missing or malformed changedFiles set denies every fix', () => {
  for (const changedFiles of [undefined, null, [], 'skills/build/SKILL.md', [1, 2]]) {
    const r = permittedInitiative({ ...base(), changedFiles });
    assert.strictEqual(r.allowed, false, `changedFiles ${JSON.stringify(changedFiles)} must deny`);
  }
});

test('merge-sensitive paths deny, including via glob', () => {
  const exact = {
    ...base(),
    fix: { ...base().fix, files: ['db/schema.sql'] },
    sensitivePaths: ['db/schema.sql'],
  };
  assert.strictEqual(permittedInitiative(exact).allowed, false);

  const singleStar = {
    ...base(),
    fix: { ...base().fix, files: ['migrations/001.sql'] },
    sensitivePaths: ['migrations/*.sql'],
  };
  const rs = permittedInitiative(singleStar);
  assert.strictEqual(rs.allowed, false);
  assert.match(rs.reason, /merge-sensitive/);

  const doubleStar = {
    ...base(),
    fix: { ...base().fix, files: ['src/deep/nested/config.yml'] },
    sensitivePaths: ['src/**/config.yml'],
  };
  assert.strictEqual(permittedInitiative(doubleStar).allowed, false);
});

test('a single-star glob does not cross a path separator', () => {
  const input = {
    ...base(),
    fix: { ...base().fix, files: ['migrations/sub/001.sql'] },
    sensitivePaths: ['migrations/*.sql'],
  };
  assert.strictEqual(permittedInitiative(input).allowed, true, 'single * must not span "/"');
});

test('no input at all denies rather than throwing', () => {
  for (const input of [undefined, null, {}, { ceiling: 'trusted' }]) {
    const r = permittedInitiative(input);
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(typeof r.reason, 'string');
  }
});

test('a caller-supplied budget can tighten the caps', () => {
  const r = permittedInitiative({ ...base(), budget: { maxFixes: 0 } });
  assert.strictEqual(r.allowed, false);
  assert.match(r.reason, /budget exhausted/);
});

test('#4636: an allowed fix does not hold', () => {
  const r = permittedInitiative(base());
  assert.strictEqual(r.allowed, true, r.reason);
  assert.strictEqual(r.hold, false);
});

test('#4636: a clean fix denied only by the ceiling, budget or a cap is approvable (hold false)', () => {
  const cases = [
    { ...base(), ceiling: 'supervised' },
    { ...base(), spent: DEFAULT_BUDGET.maxFixes },
    { ...base(), fix: { ...base().fix, files: ['a.md', 'b.md', 'c.md'] } },
    { ...base(), fix: { ...base().fix, changedLines: DEFAULT_BUDGET.maxLinesPerFix + 1 } },
  ];
  for (const input of cases) {
    const r = permittedInitiative(input);
    assert.strictEqual(r.allowed, false, JSON.stringify(input));
    assert.strictEqual(r.hold, false, r.reason);
  }
});

const FLOOR_DENIALS = {
  'test file': (b) => ({ ...b, fix: { ...b.fix, files: ['tests/a.test.js'] } }),
  'merge-sensitive path': (b) => ({ ...b, sensitivePaths: ['docs/**'] }),
  'brokenBy outside the causal set': (b) => ({ ...b, fix: { ...b.fix, brokenBy: 'not/changed.md' } }),
  'no brokenBy': (b) => ({ ...b, fix: { ...b.fix, brokenBy: '' } }),
  'untaught kind': (b) => ({ ...b, fix: { ...b.fix, kind: 'typo' } }),
  'no files': (b) => ({ ...b, fix: { ...b.fix, files: [] } }),
  'malformed file path': (b) => ({ ...b, fix: { ...b.fix, files: [''] } }),
  'no changed-line count': (b) => ({ ...b, fix: { ...b.fix, changedLines: undefined } }),
  'no fix': (b) => ({ ...b, fix: null }),
};

test('AC1.1 (#4636): every floor denial holds', () => {
  for (const [label, make] of Object.entries(FLOOR_DENIALS)) {
    const r = permittedInitiative(make(base()));
    assert.strictEqual(r.allowed, false, label);
    assert.strictEqual(r.hold, true, label);
  }
  assert.strictEqual(permittedInitiative(undefined).hold, true, 'no input names no fix');
});

test('AC1.1 (#4636): a floor denial holds whichever check fails first', () => {
  const earlier = {
    'ceiling': (i) => ({ ...i, ceiling: 'supervised' }),
    'budget': (i) => ({ ...i, spent: DEFAULT_BUDGET.maxFixes }),
    'lines cap': (i) => (i.fix ? { ...i, fix: { ...i.fix, changedLines: DEFAULT_BUDGET.maxLinesPerFix + 1 } } : i),
    'files cap': (i) => (i.fix ? { ...i, fix: { ...i.fix, files: [...(i.fix.files || []), 'x1.md', 'x2.md', 'x3.md'] } } : i),
  };
  for (const [floor, make] of Object.entries(FLOOR_DENIALS)) {
    for (const [check, worsen] of Object.entries(earlier)) {
      if (floor === 'no changed-line count' && check === 'lines cap') continue; // lines cap replaces the missing count
      if (floor === 'no files' && check === 'files cap') continue; // files cap replaces the empty list
      const r = permittedInitiative(worsen(make(base())));
      assert.strictEqual(r.allowed, false, `${floor} + ${check}`);
      assert.strictEqual(r.hold, true, `${floor} + ${check}: ${r.reason}`);
    }
  }
});

test('#4636: an unknown or non-string ceiling holds; supervised does not', () => {
  for (const ceiling of ['bogus', 'Trusted', 'TRUSTED', 7, null, undefined, {}]) {
    const r = permittedInitiative({ ...base(), ceiling });
    assert.strictEqual(r.allowed, false, String(ceiling));
    assert.strictEqual(r.hold, true, String(ceiling));
  }
  assert.strictEqual(permittedInitiative({ ...base(), ceiling: 'supervised' }).hold, false);
});

test('#4636: a root-level file under a **/ pattern is merge-sensitive', () => {
  const r = permittedInitiative({ ...base(), fix: { ...base().fix, files: ['package-lock.json'] }, sensitivePaths: ['**/package-lock.json'] });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.hold, true);
});

test('#4636: the reported reason stays the first failing check', () => {
  const r = permittedInitiative({ ...base(), spent: DEFAULT_BUDGET.maxFixes, fix: { ...base().fix, files: ['tests/a.test.js'] } });
  assert.match(r.reason, /budget exhausted/);
  assert.strictEqual(r.hold, true);
});

test('#4636: a case variant of a merge-sensitive path holds (a case-insensitive filesystem lands it on the sensitive file)', () => {
  const r = permittedInitiative({ ...base(), fix: { ...base().fix, files: ['Docs/A.md'] }, sensitivePaths: ['docs/**'] });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.hold, true);
  assert.match(r.reason, /merge-sensitive path "Docs\/A\.md"/);
  assert.strictEqual(permittedInitiative({ ...base(), fix: { ...base().fix, files: ['docs/a.md'] }, sensitivePaths: ['DOCS/**'] }).hold, true, 'an upper-case glob');
  assert.strictEqual(permittedInitiative({ ...base(), fix: { ...base().fix, files: ['Other/A.md'] }, sensitivePaths: ['docs/**'] }).allowed, true);
});

test('#4636: an unreadable sensitivePaths holds, an empty list does not', () => {
  for (const sensitivePaths of [undefined, 'docs/**', [7], null, {}]) {
    const r = permittedInitiative({ ...base(), sensitivePaths });
    assert.strictEqual(r.allowed, false, String(sensitivePaths));
    assert.strictEqual(r.hold, true, String(sensitivePaths));
    assert.match(r.reason, /merge-sensitive-paths unreadable/, String(sensitivePaths));
  }
  const { sensitivePaths: _omitted, ...withoutKey } = base();
  assert.strictEqual(permittedInitiative(withoutKey).hold, true, 'an omitted key');
  assert.strictEqual(permittedInitiative({ ...base(), sensitivePaths: [] }).allowed, true);
});
