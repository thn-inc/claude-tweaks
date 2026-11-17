'use strict';
// tests/bin-lib/ci-audit/workflow-facts.test.js — #5757: the facts /claude-tweaks:ci-health reads
// from a workflow file's text — each job's needs, declared timeout, matrix use and step kinds, and
// whether the workflow declares concurrency — and the unparsed reasons that stand in for a guess.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readWorkflowFacts } = require('../../../plugin/bin/lib/ci-audit/workflow-facts');

const lines = (...l) => `${l.join('\n')}\n`;

const WORKFLOW = lines(
  'name: CI',
  'on: [push]',
  'concurrency:',
  '  group: ci-${{ x }}',
  '  cancel-in-progress: true',
  'jobs:',
  '  build:',
  '    runs-on: x',
  '    steps:',
  '      - name: Checkout',
  '        uses: some/checkout@v4',
  '      - name: Install',
  '        run: npm ci',
  '      - name: Build',
  '        run: |',
  '          npm run build',
  '          echo done # not a comment',
  '  test:',
  '    name: Unit tests',
  '    needs: build',
  '    timeout-minutes: 20',
  '    strategy:',
  '      fail-fast: false',
  '      matrix:',
  '        os: [a, b]',
  '    steps:',
  '      - uses: some/setup@v1 # trailing comment',
  '        with:',
  '          version: 20',
  "      - name: 'Run tests'",
  '        run: npm test',
);

const EXPECTED_JOBS = [
  {
    id: 'build', name: 'build', needs: [], timeoutDeclared: false, matrix: false,
    steps: [
      { name: 'Checkout', kind: 'action', named: true, value: 'some/checkout@v4' },
      { name: 'Install', kind: 'command', named: true, value: 'npm ci' },
      { name: 'Build', kind: 'command', named: true, value: 'npm run build' },
    ],
  },
  {
    id: 'test', name: 'Unit tests', needs: ['build'], timeoutDeclared: true, matrix: true,
    steps: [
      { name: 'some/setup@v1', kind: 'action', named: false, value: 'some/setup@v1' },
      { name: 'Run tests', kind: 'command', named: true, value: 'npm test' },
    ],
  },
];

test('reads jobs, needs, timeout, matrix, step kinds and workflow concurrency', () => {
  const facts = readWorkflowFacts(WORKFLOW);
  assert.deepEqual(facts, { jobs: EXPECTED_JOBS, concurrencyDeclared: true, unparsed: [] });
});

test('CRLF line endings and a leading BOM read identically to LF text', () => {
  const lf = readWorkflowFacts(WORKFLOW);
  assert.deepEqual(readWorkflowFacts(WORKFLOW.replace(/\n/g, '\r\n')), lf);
  assert.deepEqual(readWorkflowFacts(`﻿${WORKFLOW}`), lf);
  assert.deepEqual(readWorkflowFacts(`﻿${WORKFLOW.replace(/\n/g, '\r\n')}`), lf);
});

test('no top-level concurrency reads as not declared', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    runs-on: x', '    concurrency: g'));
  assert.equal(facts.concurrencyDeclared, false);
  assert.deepEqual(facts.unparsed, []);
  assert.equal(facts.jobs.length, 1);
});

// --- needs forms ---

const needsOf = (needsLines) => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    runs-on: x', '  b:', ...needsLines, '    runs-on: x'));
  assert.deepEqual(facts.unparsed, []);
  return facts.jobs.find((j) => j.id === 'b').needs;
};

test('flow-style and block-style needs both read as a list', () => {
  assert.deepEqual(needsOf(['    needs: [a, b]']), ['a', 'b']);
  assert.deepEqual(needsOf(['    needs:', '      - a', '      - b']), ['a', 'b']);
  assert.deepEqual(needsOf(['    needs:', '    - a', '    - b']), ['a', 'b'], 'an indentless sequence');
  assert.deepEqual(needsOf(["    needs: ['a', \"b\"] # both"]), ['a', 'b'], 'quoted flow items and a comment');
});

test('a scalar needs reads as a one-item list', () => {
  assert.deepEqual(needsOf(['    needs: build']), ['build']);
  assert.deepEqual(needsOf(["    needs: 'build'"]), ['build']);
});

test('a needs value the scanner cannot follow is unparsed with no jobs', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs:', '  b:', '    needs: ${{ x }}', '    runs-on: x'));
  assert.deepEqual(facts, { jobs: [], concurrencyDeclared: false, unparsed: ['job b needs not read'] });
});

// --- one guard per unparsed cause: each fixture trips only that guard ---

const BASE = ['on: [push]', 'jobs:', '  a:', '    runs-on: x', '    steps:'];

test('a YAML anchor is one unparsed reason and no jobs', () => {
  const facts = readWorkflowFacts(lines(...BASE, '      - name: s', '        uses: &x some/thing@v1'));
  assert.deepEqual(facts, { jobs: [], concurrencyDeclared: false, unparsed: ['anchor or alias in jobs:'] });
});

test('a YAML alias is one unparsed reason and no jobs', () => {
  const facts = readWorkflowFacts(lines(...BASE, '      - name: s', '        uses: *x'));
  assert.deepEqual(facts, { jobs: [], concurrencyDeclared: false, unparsed: ['anchor or alias in jobs:'] });
});

test('a tab indent is one unparsed reason and no jobs', () => {
  const facts = readWorkflowFacts(lines(...BASE, '      - name: s', '\t      run: x'));
  assert.deepEqual(facts, { jobs: [], concurrencyDeclared: false, unparsed: ['tab indentation in jobs:'] });
});

test('a flow-style jobs map is one unparsed reason and no jobs', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs: {a: {runs-on: x}}'));
  assert.deepEqual(facts, { jobs: [], concurrencyDeclared: false, unparsed: ['jobs: flow-style map not read'] });
});

test('a flow-style job map is one unparsed reason and no jobs', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    runs-on: x', '  b: {runs-on: x}'));
  assert.deepEqual(facts, { jobs: [], concurrencyDeclared: false, unparsed: ['job b flow-style map not read'] });
});

test('a flow-style step is one unparsed reason and no jobs', () => {
  const facts = readWorkflowFacts(lines(...BASE, '      - {name: s, run: x}'));
  assert.deepEqual(facts, { jobs: [], concurrencyDeclared: false, unparsed: ['job a steps not read'] });
});

test('a workflow with no jobs key says so', () => {
  assert.deepEqual(readWorkflowFacts(lines('on: [push]')).unparsed, ['no jobs: key']);
  assert.deepEqual(readWorkflowFacts('').unparsed, ['no jobs: key']);
});

test('never throws on a non-string', () => {
  for (const v of [null, undefined, 42, {}]) {
    assert.deepEqual(readWorkflowFacts(v), { jobs: [], concurrencyDeclared: false, unparsed: ['workflow file not read'] });
  }
});

// --- steps ---

const stepsOf = (stepLines) => {
  const facts = readWorkflowFacts(lines(...BASE, ...stepLines));
  assert.deepEqual(facts.unparsed, []);
  return facts.jobs[0].steps;
};

const cmd = (name, value, named) => ({ name, kind: 'command', named, value });
const act = (name, value, named = false) => ({ name, kind: 'action', named, value });

test('a step with a name and neither run nor uses is skipped', () => {
  assert.deepEqual(stepsOf(['      - name: Wait', '        if: always()', '      - name: Go', '        run: x']), [
    cmd('Go', 'x', true),
  ]);
});

test('an unnamed step carries a derived name: its one-line uses or run value', () => {
  assert.deepEqual(stepsOf(['      - uses: some/setup@v1', '      - run: npm ci # install', "      - run: 'npm test'"]), [
    act('some/setup@v1', 'some/setup@v1'),
    cmd('npm ci', 'npm ci', false),
    cmd('npm test', 'npm test', false),
  ]);
});

test('an unnamed literal-block step is kept with no name and its first content line as value', () => {
  // The first content line is read even when it starts with `#`, which inside a block is content.
  assert.deepEqual(stepsOf(['      - run: |', '          npm ci', '          npm test', '      - name: Go', '        run: x']), [
    cmd(null, 'npm ci', false), cmd('Go', 'x', true),
  ]);
  assert.deepEqual(stepsOf(['      - run: |-', '', '          # build', '          make', '      - uses: y']), [
    cmd(null, '# build', false), act('y', 'y'),
  ]);
  // The block ends at the next key: a later deeper line (under `with:`) is not its first line.
  assert.deepEqual(stepsOf(['      - shell: bash', '        run: |', '        env:', '          A: 1']), [cmd(null, null, false)]);
});

test('an unnamed folded block, continued plain value or escaped quoted value has no name and no value', () => {
  assert.deepEqual(stepsOf(['      - run: >', '          npm ci', '          --silent', '      - uses: y']), [cmd(null, null, false), act('y', 'y')]);
  assert.deepEqual(stepsOf(['      - run: npm ci', '          && npm test', '      - uses: y']), [cmd(null, null, false), act('y', 'y')]);
  // A backslash escape in a double-quoted value is not decoded: unknown, never a guessed name, and
  // the step is still listed (not dropped, not unparsed).
  assert.deepEqual(stepsOf(['      - run: "echo a\\tb"', '      - name: Go', '        run: x']), [cmd(null, null, false), cmd('Go', 'x', true)]);
});

test('a job name continued on a deeper line is unparsed', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    name: Unit', '      tests', '    runs-on: x'));
  assert.deepEqual(facts, { jobs: [], concurrencyDeclared: false, unparsed: ['job a name not read'] });
});

test('a step with both run and uses is unparsed', () => {
  const facts = readWorkflowFacts(lines(...BASE, '      - name: s', '        run: x', '        uses: y'));
  assert.deepEqual(facts.unparsed, ['job a steps not read']);
  assert.deepEqual(facts.jobs, []);
});

test('an indentless step list is read', () => {
  assert.deepEqual(stepsOf(['    - name: A', '      run: x', '    - uses: y']), [cmd('A', 'x', true), act('y', 'y')]);
});

test('steps: [] reads as no steps; any other inline steps value is unparsed', () => {
  const ok = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    runs-on: x', '    steps: []'));
  assert.deepEqual(ok.unparsed, []);
  assert.deepEqual(ok.jobs[0].steps, []);
  const bad = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    runs-on: x', '    steps: x'));
  assert.deepEqual(bad, { jobs: [], concurrencyDeclared: false, unparsed: ['job a steps not read'] });
});

test('each remaining jobs-region reason is pinned by an input where only it decides', () => {
  const reason = (...l) => readWorkflowFacts(lines('on: [push]', ...l)).unparsed;
  assert.deepEqual(reason('jobs: x'), ['jobs: not read']);
  assert.deepEqual(reason('jobs:', '  a: x'), ['job a not read']);
  assert.deepEqual(reason('jobs:', '  a:', '    timeout-minutes:', '    runs-on: x'), ['job a timeout-minutes not read']);
  assert.deepEqual(reason('jobs:', '  a:', '    runs-on: x', '  b:', '    needs:', '    runs-on: x'), ['job b needs not read']);
  // an empty flow list is no needs, not a reason
  const empty = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    needs: []', '    runs-on: x'));
  assert.deepEqual([empty.unparsed, empty.jobs[0].needs], [[], []]);
});

test('a quoted "jobs" key is the jobs region', () => {
  const facts = readWorkflowFacts(lines('on: [push]', '"jobs":', '  a:', '    runs-on: x'));
  assert.deepEqual(facts.unparsed, []);
  assert.deepEqual(facts.jobs.map((j) => j.id), ['a']);
});

// --- timeout and matrix are job-level only ---

test('a step-level timeout does not set timeoutDeclared', () => {
  const facts = readWorkflowFacts(lines(...BASE, '      - name: s', '        run: x', '        timeout-minutes: 5'));
  assert.deepEqual(facts.unparsed, []);
  assert.equal(facts.jobs[0].timeoutDeclared, false);
});

test('a job-level timeout sets timeoutDeclared', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    timeout-minutes: 5', '    runs-on: x'));
  assert.equal(facts.jobs[0].timeoutDeclared, true);
});

test('a matrix key inside a step with: block does not set matrix', () => {
  const facts = readWorkflowFacts(lines(...BASE, '      - uses: y', '        with:', '          matrix: z'));
  assert.deepEqual(facts.unparsed, []);
  assert.equal(facts.jobs[0].matrix, false);
});

test('a matrix outside strategy does not set matrix', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    runs-on: x', '    env:', '      matrix: z'));
  assert.deepEqual(facts.unparsed, []);
  assert.equal(facts.jobs[0].matrix, false);
});

test('a matrix key nested below a strategy child does not set matrix', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    strategy:', '      fail-fast: false', '      other:', '        matrix: z'));
  assert.deepEqual(facts.unparsed, []);
  assert.equal(facts.jobs[0].matrix, false);
});

test('a strategy value the scanner cannot follow is unparsed', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'jobs:', '  a:', '    strategy: ${{ fromJSON(x) }}'));
  assert.deepEqual(facts, { jobs: [], concurrencyDeclared: false, unparsed: ['job a strategy not read'] });
});

// --- region reasons outside jobs: and concurrency: are not this reader's ---

test('an anchor outside jobs: and concurrency: does not stop the jobs read', () => {
  // readWorkflowShape reports `anchor or alias in name:` here; only SHAPE_REASONS drops it.
  const facts = readWorkflowFacts(lines('name: &n CI', 'on: [push]', 'jobs:', '  a:', '    runs-on: x'));
  assert.deepEqual(facts.unparsed, []);
  assert.equal(facts.jobs.length, 1);
});

test('an unreadable concurrency region is unparsed and not declared', () => {
  const facts = readWorkflowFacts(lines('on: [push]', 'concurrency:', '  group: &g x', 'jobs:', '  a:', '    runs-on: x'));
  assert.equal(facts.concurrencyDeclared, false);
  assert.deepEqual(facts.unparsed, ['anchor or alias in concurrency:']);
  assert.equal(facts.jobs.length, 1);
});
