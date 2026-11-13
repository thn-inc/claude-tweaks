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
    // No concurrency key, so check 4 would flag this one if the gate let it through.
    ['jobs: not read', draftWf().replace(CONC, '').replace('    steps:\n      - run: npm test\n', '    steps: run-this\n')],
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
  // and a step if: added, so checks 1 and 2 have something to flag; its
  // generated `cancel-in-progress: false` is check 4's once a PR triggers it.
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
  assert.deepEqual(checksOf(r, T), ['draft-skip-no-ready-for-review', 'draft-skip-with-ci-source', 'no-cancel-in-progress-concurrency']);
  assert.ok(r.findings[0].detail.includes('label-fix-branch'), r.findings[0].detail);
  assert.equal(r.findings[2].detail, 'cancel-in-progress: false');
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

const JOBS = '  a:\n    runs-on: x\n    steps:\n      - run: t\n';
const prWf = ({ on = '  pull_request:\n', conc = CONC, jobs = JOBS } = {}) => `on:\n${on}${conc}jobs:\n${jobs}`;
const pushWf = (onBlock, jobs) => `${onBlock}jobs:\n${jobs}`;
const PATHS_ON = "  pull_request:\n    paths: ['src/**']\n";
const STEP_GATED = "  deploy:\n    runs-on: x\n    steps:\n      - if: github.ref == 'refs/heads/main'\n        run: d\n";
const EXPR_CONC = "concurrency:\n  group: x\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n";
const OTHER = '.github/workflows/other.yml';
const NO_ALWAYS = 'paths on pull_request; no always-reporting workflow';

test('AC3.1: a paths filter on pull_request with no other workflow yields exactly paths-filter-no-always-reporting-job', () => {
  const r = review({ 'ci.yml': prWf({ on: PATHS_ON }) });
  assert.deepEqual(checksOf(r, W), ['paths-filter-no-always-reporting-job']);
  assert.equal(r.findings[0].remedy, 'Path filters');
  assert.equal(r.findings[0].detail, NO_ALWAYS);
  assert.deepEqual(r.unparsed, []);
  const ignore = review({ 'ci.yml': prWf({ on: '  pull_request:\n    branches: [main]\n    paths-ignore: [docs/**]\n' }) });
  assert.deepEqual(checksOf(ignore, W), ['paths-filter-no-always-reporting-job']);
  assert.equal(ignore.findings[0].detail, 'paths-ignore on pull_request; no always-reporting workflow');
});

test('AC3.2: a second unfiltered pull_request workflow with an if:-free job clears it', () => {
  const r = review({ 'ci.yml': prWf({ on: PATHS_ON }), 'other.yml': prWf() });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.unparsed, []);
});

test('AC3.3: a second workflow whose every job skips drafts, or whose trigger has branches:, or that is push-only, does not count', () => {
  const draftJobs = '  a:\n    if: github.event.pull_request.draft == false\n    runs-on: x\n    steps:\n      - run: t\n'
    + '  b:\n    if: ${{ !github.event.pull_request.draft }}\n    runs-on: x\n    steps:\n      - run: t\n';
  const others = [
    prWf({ on: `  pull_request:\n    ${READY_TYPES}\n`, jobs: draftJobs }),
    prWf({ on: '  pull_request:\n    branches: [main]\n' }),
    pushWf('on: push\n', JOBS),
  ];
  for (const other of others) {
    const r = review({ 'ci.yml': prWf({ on: PATHS_ON }), 'other.yml': other });
    assert.deepEqual(checksOf(r, W), ['paths-filter-no-always-reporting-job'], other);
    assert.equal(r.findings[0].detail, NO_ALWAYS, other);
    assert.deepEqual(checksOf(r, OTHER), [], other);
    assert.deepEqual(r.unparsed, [], other);
  }
});

// G6: an unparsed workflow never counts as the always-reporting one. The last
// two would count if read as clean (pull_request, no filter, an if:-free job).
test('an unparsed second workflow is not counted, and the detail names it', () => {
  const cases = [
    ['no jobs: key', `on:\n  pull_request:\n${CONC}`],
    ['concurrency not read', prWf({ conc: 'concurrency: {group: x\n' })],
    ['cancel-in-progress expression not evaluated', prWf({ conc: EXPR_CONC })],
  ];
  for (const [reason, other] of cases) {
    const r = review({ 'ci.yml': prWf({ on: PATHS_ON }), 'other.yml': other });
    assert.deepEqual(checksOf(r, W), ['paths-filter-no-always-reporting-job'], reason);
    assert.equal(r.findings[0].detail, `${NO_ALWAYS} (unparsed, not counted: ${OTHER})`, reason);
    assert.deepEqual(r.unparsed, [{ workflow: OTHER, reason }], reason);
  }
});

test('an unreadable second workflow is a PR-candidate: not counted, and the detail names it; a read push-only unparsed file is not named', () => {
  const ci = wf('ci.yml', prWf({ on: PATHS_ON }));
  const r = M.reviewWorkflows({ workflows: [ci, { workflow: OTHER, unreadable: 'could not read: EACCES' }], ciSources: null });
  assert.deepEqual(checksOf(r, W), ['paths-filter-no-always-reporting-job']);
  assert.ok(r.findings[0].detail.endsWith(`(unparsed, not counted: ${OTHER})`), r.findings[0].detail);
  assert.ok(r.unparsed.some((u) => u.workflow === OTHER && u.reason === 'could not read: EACCES'), JSON.stringify(r.unparsed));

  const push = M.reviewWorkflows({ workflows: [ci, wf('push.yml', 'on: push\n')], ciSources: null });
  assert.deepEqual(checksOf(push, W), ['paths-filter-no-always-reporting-job']);
  assert.equal(push.findings[0].detail, NO_ALWAYS);
  assert.deepEqual(push.unparsed, [{ workflow: '.github/workflows/push.yml', reason: 'no jobs: key' }]);
});

// A read entry with no pull_request trigger read is still a candidate when its
// PR trigger itself was not read; each fixture carries only that one reason.
test('an entry whose PR trigger is unread is named, each reason on its own, and named files run in input order', () => {
  const cases = [
    ['on: block not read', pushWf('on: [push,\n  workflow_dispatch]\n', JOBS)],
    ['tab indentation in on:', pushWf('on:\n\tpush:\n', JOBS)],
    ['anchor or alias in on:', pushWf('on:\n  push: *x\n', JOBS)],
    ['pull_request trigger not read', pushWf('on: pull_request\r\r\n', JOBS)],
  ];
  for (const [reason, other] of cases) {
    const r = review({ 'ci.yml': prWf({ on: PATHS_ON }), 'other.yml': other });
    assert.deepEqual(r.unparsed, [{ workflow: OTHER, reason }], reason);
    assert.equal(r.findings[0].detail, `${NO_ALWAYS} (unparsed, not counted: ${OTHER})`, reason);
  }
  const r = review({ 'z.yml': cases[0][1], 'ci.yml': prWf({ on: PATHS_ON }), 'a.yml': cases[1][1] });
  assert.equal(r.findings[0].detail, `${NO_ALWAYS} (unparsed, not counted: .github/workflows/z.yml, .github/workflows/a.yml)`);
});

test('AC4.1: a pull_request workflow with no concurrency key yields exactly no-cancel-in-progress-concurrency', () => {
  const r = review({ 'ci.yml': prWf({ conc: '' }) });
  assert.deepEqual(checksOf(r, W), ['no-cancel-in-progress-concurrency']);
  assert.equal(r.findings[0].remedy, 'Concurrency');
  assert.equal(r.findings[0].detail, 'no workflow-level concurrency');
  assert.deepEqual(r.unparsed, []);
});

test('AC4.2: flow-form and block-form cancel-in-progress: true yield none', () => {
  for (const conc of ['concurrency: {group: x, cancel-in-progress: true}\n', CONC]) {
    const r = review({ 'ci.yml': prWf({ conc }) });
    assert.deepEqual(r.findings, [], conc);
    assert.deepEqual(r.unparsed, [], conc);
  }
});

test('AC4.3: cancel-in-progress: false, a scalar concurrency and job-level concurrency only each yield one', () => {
  const cases = [
    ['cancel-in-progress: false', prWf({ conc: 'concurrency:\n  group: x\n  cancel-in-progress: false\n' })],
    ['concurrency has no cancel-in-progress', prWf({ conc: 'concurrency: x\n' })],
    ['job-level concurrency only', prWf({ conc: '', jobs: JOBS.replace('    runs-on: x\n', '    runs-on: x\n    concurrency: y\n') })],
  ];
  for (const [detail, text] of cases) {
    const r = review({ 'ci.yml': text });
    assert.deepEqual(checksOf(r, W), ['no-cancel-in-progress-concurrency'], detail);
    assert.equal(r.findings[0].detail, detail);
    assert.deepEqual(r.unparsed, [], detail);
  }
});

test('AC4.4: a cancel-in-progress expression is unparsed', () => {
  const r = review({ 'ci.yml': prWf({ conc: EXPR_CONC }) });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.unparsed, [{ workflow: W, reason: 'cancel-in-progress expression not evaluated' }]);
  // Check 4 applies to PR workflows only, so a push-only one is not unparsed.
  const push = review({ 'ci.yml': pushWf(`on:\n  push:\n    branches: [main]\n${EXPR_CONC}`, JOBS) });
  assert.deepEqual(push.findings, []);
  assert.deepEqual(push.unparsed, []);
});

test('AC5.1: on: push with only a step-level if: yields exactly push-all-step-gated', () => {
  for (const onBlock of ['on: push\n', "on:\n  push:\n    branches: ['**']\n"]) {
    const r = review({ 'ci.yml': pushWf(onBlock, STEP_GATED) });
    assert.deepEqual(checksOf(r, W), ['push-all-step-gated'], onBlock);
    assert.equal(r.findings[0].remedy, 'see #5152');
    assert.equal(r.findings[0].detail, 'push on every branch; no job-level if:, 1 step-level if:');
    assert.deepEqual(r.unparsed, [], onBlock);
  }
  const two = review({ 'ci.yml': pushWf('on: push\n', STEP_GATED + STEP_GATED.replace('deploy', 'notify')) });
  assert.equal(two.findings[0].detail, 'push on every branch; no job-level if:, 2 step-level if:');
});

test('AC5.2: branches: [main], branches-ignore, tags only, a job-level if:, or no if: anywhere yield none', () => {
  const jobIf = STEP_GATED.replace('    runs-on: x\n', "    if: github.ref == 'refs/heads/main'\n    runs-on: x\n");
  const cases = [
    pushWf('on:\n  push:\n    branches: [main]\n', STEP_GATED),
    pushWf('on:\n  push:\n    branches-ignore: [wip]\n', STEP_GATED),
    pushWf('on:\n  push:\n    tags: [v*]\n', STEP_GATED),
    pushWf('on: push\n', jobIf),
    pushWf('on: push\n', JOBS),
    // No push trigger at all: the step-gated jobs run on pull_request only.
    prWf({ jobs: STEP_GATED }),
  ];
  for (const text of cases) {
    const r = review({ 'ci.yml': text });
    assert.deepEqual(r.findings, [], text);
    assert.deepEqual(r.unparsed, [], text);
  }
  const tagsAll = review({ 'ci.yml': pushWf("on:\n  push:\n    tags: [v*]\n    branches: ['**']\n", STEP_GATED) });
  assert.deepEqual(checksOf(tagsAll, W), ['push-all-step-gated']);
});

test('AC6.1: a workflow set valid on every check yields an empty findings list', () => {
  const r = review({
    'ci.yml': draftWf({ types: READY_TYPES }),
    'docs.yml': prWf({ on: PATHS_ON }),
    'always.yml': prWf(),
    'deploy.yml': pushWf('on:\n  push:\n    branches: [main]\n', STEP_GATED),
  }, []);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.unparsed, []);
  assert.equal(r.reviewed, 4);
});

test('AC7.1: a malformed on: yields an unparsed entry naming the file, never an empty list', () => {
  const r = review({ 'bad.yml': 'on: [push,\n  pull_request]\njobs:\n  a:\n    runs-on: x\n' });
  assert.equal(r.unparsed.length, 1);
  assert.equal(r.unparsed[0].workflow, '.github/workflows/bad.yml');
  assert.deepEqual(r.findings, []);
});
