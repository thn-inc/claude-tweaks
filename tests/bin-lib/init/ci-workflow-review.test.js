'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const M = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'init', 'ci-workflow-review.js'));
const { generateWorkflowYaml, classifyExistingWorkflow } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'issue-branch-tracking.js'));
const { readText } = require(path.join(__dirname, '..', '..', 'helpers', 'read-skill.js'));

const wf = (name, text) => ({ workflow: `.github/workflows/${name}`, text });
const checksOf = (r, w) => r.findings.filter((f) => f.workflow === w).map((f) => f.check);
const CONC = 'concurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\n';
const draftWf = ({ types = 'types: [opened, synchronize]', cond = 'github.event.pull_request.draft == false', name = 'CI' } = {}) =>
  `name: ${name}\non:\n  pull_request:\n${types ? `    ${types}\n` : ''}${CONC}jobs:\n  test:\n    if: ${cond}\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n`;
const W = '.github/workflows/ci.yml';
const review = (texts, ciSources = null) => M.reviewWorkflows({ workflows: Object.entries(texts).map(([n, t]) => wf(n, t)), ciSources });

const READY_TYPES = 'types: [opened, synchronize, reopened, ready_for_review]';
const SPEC_CONDS = [
  'github.event.pull_request.draft == false',
  '!github.event.pull_request.draft',
  "github.event.pull_request.draft != true && github.actor != 'bot'",
];

test('CHECKS: the five checks in order, frozen, each naming its remedy', () => {
  assert.deepEqual(Object.entries(M.CHECKS), [
    ['draft-skip-no-ready-for-review', 'Workflow shape'],
    ['draft-skip-with-ci-source', 'Coexistence with the `ci` verification source'],
    ['paths-filter-no-always-reporting-job', 'Path filters'],
    ['no-cancel-in-progress-concurrency', 'Concurrency'],
    ['push-all-step-gated', 'see #5152'],
  ]);
  assert.ok(Object.isFrozen(M.CHECKS));
  assert.equal(M.GENERATED_TRACKING_WORKFLOW, 'track-issue-fixes.yml');
});

test('classifyDraftCondition: skip, draft-only, none and unparsed forms', () => {
  const cases = {
    skip: [
      'github.event.pull_request.draft == false',
      '!github.event.pull_request.draft',
      '${{ !github.event.pull_request.draft }}',
      "github.event.pull_request['draft'] != true",
      "github.event.pull_request.draft != true && github.actor != 'bot'",
    ],
    'draft-only': [
      'github.event.pull_request.draft == true',
      'github.event.pull_request.draft != false',
    ],
    none: [
      "github.actor != 'bot'",
      'always()',
    ],
    unparsed: [
      'github.event.pull_request.draft == false || always()',
      "!contains(toJSON(github.event.pull_request.draft), 'true')",
      '(!github.event.pull_request.draft)',
      'false == github.event.pull_request.draft',
      'github.event.pull_request.draft',
      '!github.event.pull_request.draft && github.event.pull_request.draft == true',
      'github.event.pull_request.draft ==',
    ],
  };
  for (const [want, exprs] of Object.entries(cases)) {
    for (const expr of exprs) assert.equal(M.classifyDraftCondition(expr), want, expr);
  }
});

test('classifyDraftCondition: && inside quotes or parens never splits, and an unbalanced expression is unparsed', () => {
  assert.equal(M.classifyDraftCondition("!github.event.pull_request.draft && github.actor != 'a && b'"), 'skip');
  assert.equal(M.classifyDraftCondition("!github.event.pull_request.draft && contains(github.head_ref, 'x') && (github.actor != 'a' && true)"), 'skip');
  assert.equal(M.classifyDraftCondition("github.actor == 'x && !github.event.pull_request.draft'"), 'unparsed');
  assert.equal(M.classifyDraftCondition("!github.event.pull_request.draft && github.actor != 'bot"), 'unparsed');
  assert.equal(M.classifyDraftCondition('!github.event.pull_request.draft && (always()'), 'unparsed');
  assert.equal(M.classifyDraftCondition('${{ a }} && ${{ !github.event.pull_request.draft }}'), 'unparsed');
  // `||` anywhere is refused, even in a clause without the draft reference.
  assert.equal(M.classifyDraftCondition("!github.event.pull_request.draft && (github.actor == 'a' || always())"), 'unparsed');
  // Whole-clause match: a double negation (draft-only) never reads as the `!` skip.
  assert.equal(M.classifyDraftCondition('!!github.event.pull_request.draft'), 'unparsed');
});

test('AC1.1: a draft skip without ready_for_review yields exactly draft-skip-no-ready-for-review', () => {
  for (const types of ['types: [opened, synchronize]', '']) {
    for (const cond of SPEC_CONDS) {
      const r = review({ 'ci.yml': draftWf({ types, cond }) });
      assert.deepEqual(checksOf(r, W), ['draft-skip-no-ready-for-review'], `${types} / ${cond}`);
      assert.equal(r.findings[0].remedy, 'Workflow shape');
      assert.ok(r.findings[0].detail.includes('test'), r.findings[0].detail);
      assert.deepEqual(r.unparsed, []);
    }
  }
  assert.equal(review({ 'ci.yml': draftWf() }).findings[0].detail, 'job(s) test skip drafts; types: opened, synchronize');
  assert.equal(review({ 'ci.yml': draftWf({ types: '' }) }).findings[0].detail, 'job(s) test skip drafts; types: opened, synchronize, reopened (default)');
});

test('AC1.2: a draft-only condition (== true) yields no finding', () => {
  const r = review({ 'ci.yml': draftWf({ cond: 'github.event.pull_request.draft == true' }) });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.unparsed, []);
});

test('AC1.3: || or contains() around the draft reference is unparsed and nothing else', () => {
  for (const cond of ['github.event.pull_request.draft == false || always()', "!contains(toJSON(github.event.pull_request.draft), 'true')"]) {
    const r = review({ 'ci.yml': draftWf({ cond }) });
    assert.deepEqual(checksOf(r, W), [], cond);
    assert.deepEqual(r.unparsed, [{ workflow: W, reason: 'draft condition not understood' }], cond);
  }
});

test('AC2.1: ready_for_review in the types clears draft-skip-no-ready-for-review', () => {
  const r = review({ 'ci.yml': draftWf({ types: READY_TYPES }) });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.unparsed, []);
});

test('AC2.2: a ci source naming the ready_for_review workflow by basename, path or name: yields exactly draft-skip-with-ci-source', () => {
  for (const workflow of ['ci.yml', '.github/workflows/ci.yml', 'CI']) {
    const r = review({ 'ci.yml': draftWf({ types: READY_TYPES }) }, [{ suite: 'tests', workflow }]);
    assert.deepEqual(checksOf(r, W), ['draft-skip-with-ci-source'], workflow);
    assert.equal(r.findings[0].remedy, 'Coexistence with the `ci` verification source');
    assert.equal(r.findings[0].detail, 'ci source tests names this workflow; job(s) test skip drafts');
  }
});

test('AC2.3: without ready_for_review plus the ci source both checks stack', () => {
  const r = review({ 'ci.yml': draftWf() }, [{ suite: 'tests', workflow: 'ci.yml' }]);
  assert.deepEqual(checksOf(r, W), ['draft-skip-no-ready-for-review', 'draft-skip-with-ci-source']);
});

test('AC2.4: a ci source naming a workflow file that does not exist yields no finding', () => {
  const r = review({ 'ci.yml': draftWf({ types: READY_TYPES }) }, [{ suite: 'tests', workflow: 'missing.yml' }]);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.unparsed, []);
});

test('two ci suites naming one workflow give one finding listing both', () => {
  const r = review({ 'ci.yml': draftWf({ types: READY_TYPES }) }, [{ suite: 'tests', workflow: 'ci.yml' }, { suite: 'e2e', workflow: 'CI' }]);
  assert.deepEqual(checksOf(r, W), ['draft-skip-with-ci-source']);
  assert.ok(r.findings[0].detail.includes('tests'), r.findings[0].detail);
  assert.ok(r.findings[0].detail.includes('e2e'), r.findings[0].detail);
  const same = review({ 'ci.yml': draftWf({ types: READY_TYPES }) }, [{ suite: 'tests', workflow: 'ci.yml' }, { suite: 'tests', workflow: 'CI' }]);
  assert.equal(same.findings[0].detail, 'ci source tests names this workflow; job(s) test skip drafts');
});

test('a draft skip without a pull_request trigger counts for neither check', () => {
  const text = draftWf().replace('  pull_request:\n    types: [opened, synchronize]\n', '  push:\n    branches: [main]\n');
  const r = review({ 'ci.yml': text }, [{ suite: 'tests', workflow: 'ci.yml' }]);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.unparsed, []);
});

test('a push-only workflow whose draft if: is not understood is not unparsed', () => {
  const text = draftWf({ cond: 'github.event.pull_request.draft == false || always()' })
    .replace('  pull_request:\n    types: [opened, synchronize]\n', '  push:\n    branches: [main]\n');
  const r = review({ 'ci.yml': text });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.unparsed, []);
});

test('ciSources null skips check 2; [] declares none', () => {
  for (const ciSources of [null, []]) {
    const r = review({ 'ci.yml': draftWf({ types: READY_TYPES }) }, ciSources);
    assert.equal(r.reviewed, 1);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.unparsed, []);
  }
});

test('an unreadable entry and a reader unparsed reason are unparsed entries, never findings', () => {
  const u = M.reviewWorkflows({ workflows: [{ workflow: W, unreadable: 'dangling symlink — not read' }], ciSources: null });
  assert.equal(u.reviewed, 1);
  assert.deepEqual(u.findings, []);
  assert.deepEqual(u.unparsed, [{ workflow: W, reason: 'dangling symlink — not read' }]);

  const noJobs = review({ 'ci.yml': `name: CI\non:\n  pull_request:\n${CONC}` });
  assert.deepEqual(noJobs.findings, []);
  assert.deepEqual(noJobs.unparsed, [{ workflow: W, reason: 'no jobs: key' }]);

  const several = review({ 'ci.yml': 'name: CI\n' });
  assert.deepEqual(several.unparsed, [{ workflow: W, reason: 'no on: block; no jobs: key' }]);
});

// Controller ruling: concurrency, push branches and jobs read the same unparsed
// as absent, so any reader reason suppresses every check on that workflow. One
// fixture per unreadable field; the first two would yield check 1 if read.
test('any reader unparsed reason suppresses that workflow\'s findings: concurrency, push branches, jobs', () => {
  const cases = [
    ['concurrency not read', draftWf().replace(CONC, 'concurrency: {group: x\n')],
    ['push branches not read', draftWf().replace('    types: [opened, synchronize]\n', "    types: [opened, synchronize]\n  push:\n    branches: [main, 'x y']\n")],
    ['jobs: not read', draftWf().replace('    steps:\n      - run: npm test\n', '    steps: run-this\n')],
    // A per-job reason keeps the other jobs, so job test's draft skip is still read.
    ['job b if: not read', `${draftWf()}  b:\n    if:\n    runs-on: ubuntu-latest\n`],
  ];
  for (const [reason, text] of cases) {
    const r = review({ 'ci.yml': text, 'other.yml': draftWf() }, [{ suite: 'tests', workflow: 'ci.yml' }]);
    assert.deepEqual(checksOf(r, W), [], reason);
    assert.deepEqual(r.unparsed, [{ workflow: W, reason }], reason);
    assert.deepEqual(checksOf(r, '.github/workflows/other.yml'), ['draft-skip-no-ready-for-review'], reason);
  }
});

test('the generated track-issue-fixes.yml is skipped (current or prior-generated); a hand-modified copy is reviewed', () => {
  const T = '.github/workflows/track-issue-fixes.yml';
  const current = generateWorkflowYaml();
  assert.equal(classifyExistingWorkflow(current), 'current');
  const prior = readText(path.join(__dirname, '..', '..', 'fixtures', 'track-issue-fixes-pre-5152.yml'));
  assert.equal(classifyExistingWorkflow(prior), 'prior-generated');
  for (const text of [current, prior]) {
    const r = review({ 'track-issue-fixes.yml': text });
    assert.equal(r.reviewed, 0);
    assert.deepEqual(r.skipped, [T]);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.unparsed, []);
  }

  // The hand edit: a pull_request trigger, a job's if: replaced by a draft skip,
  // and a step if: added, so checks 1 and 2 have something to flag.
  const modified = current
    .replace('on:\n  push:\n', 'on:\n  pull_request:\n    types: [opened, synchronize]\n  push:\n')
    .replace(/^ {4}if: github\.ref != .*\n/m, '    if: github.event.pull_request.draft == false\n')
    .replace('        id: extract\n', '        id: extract\n        if: always()\n');
  assert.notEqual(modified, current);
  assert.equal(classifyExistingWorkflow(modified), 'modified');
  const ciSources = [{ suite: 'tests', workflow: 'Track issue fixes across branches' }];
  const r = M.reviewWorkflows({ workflows: [wf('track-issue-fixes.yml', modified)], ciSources });
  assert.equal(r.reviewed, 1);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(checksOf(r, T), ['draft-skip-no-ready-for-review', 'draft-skip-with-ci-source']);
  assert.ok(r.findings[0].detail.includes('label-fix-branch'), r.findings[0].detail);
  assert.deepEqual(r.unparsed, []);
  const other = M.reviewWorkflows({ workflows: [wf('other.yml', modified)], ciSources });
  const asOther = (xs) => xs.map((x) => ({ ...x, workflow: '.github/workflows/other.yml' }));
  assert.deepEqual(asOther(r.findings), other.findings);
  assert.deepEqual(asOther(r.unparsed), other.unparsed);
});

test('a modified copy of the generated track-issue-fixes.yml reads its quoted !-negated push branches', () => {
  const modified = generateWorkflowYaml().replace('        id: extract\n', '        id: extract\n        if: always()\n');
  assert.equal(classifyExistingWorkflow(modified), 'modified');
  assert.ok(/^ {6}- '!/m.test(modified), 'the fixture carries a quoted negated push branch');
  const r = review({ 'track-issue-fixes.yml': modified });
  assert.equal(r.reviewed, 1);
  assert.deepEqual(r.unparsed, []);
});

test('a CRLF checkout reads the same: check 1 still fires and the generated workflow is still skipped', () => {
  const crlf = (t) => t.replace(/\n/g, '\r\n');
  assert.deepEqual(review({ 'ci.yml': crlf(draftWf()) }), review({ 'ci.yml': draftWf() }));
  const r = review({ 'track-issue-fixes.yml': crlf(generateWorkflowYaml()) });
  assert.equal(r.reviewed, 0);
  assert.deepEqual(r.skipped, ['.github/workflows/track-issue-fixes.yml']);
});

test('findings run in workflow input order, then CHECKS order', () => {
  const r = review({ 'b.yml': draftWf({ name: 'B' }), 'a.yml': draftWf({ name: 'A' }) }, [{ suite: 'tests', workflow: 'a.yml' }, { suite: 'tests', workflow: 'b.yml' }]);
  assert.deepEqual(r.findings.map((f) => `${f.workflow} ${f.check}`), [
    '.github/workflows/b.yml draft-skip-no-ready-for-review',
    '.github/workflows/b.yml draft-skip-with-ci-source',
    '.github/workflows/a.yml draft-skip-no-ready-for-review',
    '.github/workflows/a.yml draft-skip-with-ci-source',
  ]);
});

test('formatRemedy renders a section citation and passes the #5152 pointer through', () => {
  assert.equal(M.formatRemedy('Path filters'), '`_shared/ci-skips-drafts.md` § Path filters');
  assert.equal(M.formatRemedy('see #5152'), 'see #5152');
});
