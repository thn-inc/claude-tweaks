// Pins #5162's workflow reader extension, readWorkflowShape (plugin/bin/lib/merge-verification.js):
// the trigger filters, push branches, jobs (job-level if: text, step-level if: count, job-level
// concurrency), workflow-level concurrency, and the exact unparsed reason strings the CI workflow
// review reports. Also pins AC6.2: the shape copies readPullRequestWorkflow's four fields unchanged.
// Every fixture runs LF and CRLF (windows-checkout-test-parity).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mv = require('../plugin/bin/lib/merge-verification');

function bothEndings(text, fn) { fn(text); fn(text.replace(/\n/g, '\r\n')); }
const MIN = 'on: push\njobs:\n  a:\n    runs-on: x\n';
const JOBS = 'jobs:\n  a:\n    runs-on: x\n';

// Every fixture string any test below reads, for the AC6.2 sweep at the end.
const ALL = [];
const shape = (t) => { ALL.push(t); return mv.readWorkflowShape(t); };

test('readWorkflowShape: every exported field is pinned by name — a rename fails here', () => {
  assert.equal(typeof mv.readWorkflowShape, 'function');
  assert.ok(mv.DRAFT_REF instanceof RegExp);
  assert.deepEqual([...mv.PR_FILTER_KEYS], ['branches', 'branches-ignore', 'paths', 'paths-ignore']);
  assert.ok(Object.isFrozen(mv.PR_FILTER_KEYS));
  const s = shape(MIN);
  assert.deepEqual(Object.keys(s).sort(), ['concurrency', 'draftReference', 'jobs', 'name', 'prFilters', 'prTrigger',
    'pushBranches', 'pushBranchesIgnore', 'pushTags', 'pushTrigger', 'types', 'typesDeclared', 'unparsed']);
  assert.deepEqual(Object.keys(s.jobs[0]).sort(), ['concurrency', 'id', 'if', 'stepIfCount']);
  bothEndings(MIN, (t) => assert.deepEqual(shape(t), {
    name: null, prTrigger: false, types: [], typesDeclared: false, draftReference: false, prFilters: [],
    pushTrigger: true, pushBranches: 'absent', pushBranchesIgnore: false, pushTags: false,
    jobs: [{ id: 'a', if: null, stepIfCount: 0, concurrency: false }], concurrency: 'absent', unparsed: [],
  }));
});

test('readWorkflowShape: non-string or empty input is the empty shape with no on: block, never throws', () => {
  for (const v of [undefined, null, 5, {}, [], '']) {
    assert.deepEqual(mv.readWorkflowShape(v), {
      name: null, prTrigger: false, types: [], typesDeclared: false, draftReference: false, prFilters: [],
      pushTrigger: false, pushBranches: 'absent', pushBranchesIgnore: false, pushTags: false,
      jobs: [], concurrency: 'absent', unparsed: ['no on: block'],
    });
  }
});

test('name: top-level name in bare, quoted and commented forms', () => {
  for (const c of ['name: CI\n', "name: 'CI' # x\n", '"name": "CI"\n']) {
    bothEndings(c + MIN, (t) => assert.equal(shape(t).name, 'CI', JSON.stringify(t)));
  }
  bothEndings(MIN, (t) => assert.equal(shape(t).name, null));
  bothEndings('on: push\njobs:\n  a:\n    name: CI\n    runs-on: x\n', (t) => assert.equal(shape(t).name, null));
  bothEndings(`name:\n${MIN}`, (t) => assert.equal(shape(t).name, null));
  // an alias or a tab-indented line in the name: region is never read as a literal name:
  // the name stays null and the region reason is reported, like on:/jobs:/concurrency:
  for (const [c, reason] of [['name: *n\n', 'anchor or alias in name:'], ['name: CI\n\tmore\n', 'tab indentation in name:']]) {
    bothEndings(c + MIN, (t) => {
      const s = shape(t);
      assert.equal(s.name, null, JSON.stringify(t));
      assert.deepEqual(s.unparsed, [reason], JSON.stringify(t));
    });
  }
});

test('prFilters: block, flow-mapping and pull_request_target forms', () => {
  const cases = [
    ["on:\n  pull_request:\n    paths: ['src/**']\n", ['paths']],
    ['on: { pull_request: { branches: [main], paths-ignore: [docs/**] } }\n', ['branches', 'paths-ignore']],
    ['on:\n  pull_request_target:\n    branches-ignore:\n      - x\n', ['branches-ignore']],
    ['on: [push, pull_request]\n', []],
    ["on:\n  push:\n    paths: ['src/**']\n  pull_request:\n", []],
    // both PR triggers contribute; the list is sorted and deduped
    ['on:\n  pull_request_target:\n    paths: [a]\n  pull_request:\n    paths: [b]\n    branches: [main]\n', ['branches', 'paths']],
  ];
  for (const [c, want] of cases) {
    bothEndings(c + JOBS, (t) => {
      const s = shape(t);
      assert.deepEqual(s.prFilters, want, JSON.stringify(t));
      assert.deepEqual(s.unparsed, [], JSON.stringify(t));
    });
  }
});

test('push: absent, all, some, ignore and tags', () => {
  const read = (on) => {
    let out;
    bothEndings(on + JOBS, (t) => {
      const s = shape(t);
      if (out) assert.deepEqual(s, out, JSON.stringify(t));
      out = s;
    });
    return out;
  };
  const plain = read('on: push\n');
  assert.equal(plain.pushTrigger, true);
  assert.equal(plain.pushBranches, 'absent');
  assert.equal(plain.pushBranchesIgnore, false);
  assert.equal(plain.pushTags, false);
  for (const on of ["on:\n  push:\n    branches: ['**']\n", "on:\n  push:\n    branches: '**'\n",
    "on:\n  push:\n    branches:\n      - '**'\n"]) {
    const s = read(on);
    assert.equal(s.pushBranches, 'all', on);
    assert.deepEqual(s.unparsed, [], on);
  }
  for (const on of ['on:\n  push:\n    branches: [main]\n', "on:\n  push:\n    branches:\n      - main\n      - 'release/*'\n",
    'on: { push: { branches: [main] } }\n', "on:\n  push:\n    branches: ['**', main]\n", 'on:\n  push:\n    branches: [release/v2.1]\n']) {
    const s = read(on);
    assert.equal(s.pushBranches, 'some', on);
    assert.deepEqual(s.unparsed, [], on);
  }
  assert.equal(read('on:\n  push:\n    branches-ignore: [x]\n').pushBranchesIgnore, true);
  assert.equal(read('on:\n  push:\n    branches-ignore: [x]\n').pushBranches, 'absent');
  assert.equal(read("on:\n  push:\n    tags: ['v*']\n").pushTags, true);
  assert.equal(read('on:\n  push:\n    tags-ignore: [x]\n').pushTags, true);
  assert.deepEqual(read('on:\n  push:\n    branches: ${{ x }}\n').unparsed, ['push branches not read']);
  // quotes around an item must balance; an unbalanced item is never read as '**'
  for (const on of ["on:\n  push:\n    branches: ['**]\n", "on:\n  push:\n    branches: ['**\"]\n",
    "on:\n  push:\n    branches: '**\"\n", "on:\n  push:\n    branches:\n      - \"**'\n"]) {
    assert.deepEqual(read(on).unparsed, ['push branches not read'], on);
    assert.equal(read(on).pushBranches, 'absent', on);
  }
  assert.deepEqual(read('on:\n  push:\n    branches:\n  pull_request:\n').unparsed, ['push branches not read']);
  // the indentless top-level sequence stays inside the on: region
  assert.equal(read('on:\n- workflow_dispatch\n- push\n').pushTrigger, true);
  const none = read('on: pull_request\n');
  assert.equal(none.pushTrigger, false);
  assert.equal(none.pushBranches, 'absent');
});

test('jobs: job-level if in inline, quoted, wrapped, block and folded forms', () => {
  const cases = [
    ['    if: github.event.pull_request.draft == false\n', 'github.event.pull_request.draft == false'],
    ['    if: "github.event.pull_request.draft == false"\n', 'github.event.pull_request.draft == false'],
    ["    if: 'github.event.pull_request.draft == false' # c\n", 'github.event.pull_request.draft == false'],
    ['    if: ${{ !github.event.pull_request.draft }}\n', '${{ !github.event.pull_request.draft }}'],
    ['    if: |\n      a &&\n      b\n', 'a && b'],
    ['    if: >-\n      a\n      && b\n', 'a && b'],
    ['    if: a\n      && b\n', 'a && b'],
    ['    if:\n      a && b\n', 'a && b'],
    // YAML quote escapes are undone: '' in single quotes, \" and \\ in double quotes
    ["    if: 'github.actor != ''bot'''\n", "github.actor != 'bot'"],
    ['    if: "a == \\"b\\" && c == \'\\\\\'"\n', 'a == "b" && c == \'\\\''],
  ];
  for (const [body, want] of cases) {
    bothEndings(`on: pull_request\njobs:\n  a:\n${body}    runs-on: x\n  b:\n    runs-on: y\n`, (t) => {
      const s = shape(t);
      assert.deepEqual(s.jobs, [
        { id: 'a', if: want, stepIfCount: 0, concurrency: false },
        { id: 'b', if: null, stepIfCount: 0, concurrency: false },
      ], JSON.stringify(t));
      assert.deepEqual(s.unparsed, [], JSON.stringify(t));
    });
  }
  bothEndings('on: push\njobs:\n  a:\n    if:\n    runs-on: x\n', (t) => {
    const s = shape(t);
    assert.ok(s.unparsed.includes('job a if: not read'), JSON.stringify(s.unparsed));
    assert.equal(s.jobs[0].if, null);
  });
});

test('jobs: stepIfCount counts step keys only', () => {
  const wf = [
    'on: push',
    'jobs:',
    '  a:',
    '    runs-on: x',
    '    steps:',
    '      - if: x',
    '        run: one',
    '      - name: n',
    '        if: github.ref == x',
    '        run: two',
    '      - run: |',
    '          if: y',
    '          if [ -f z ]; then echo; fi',
    '      - uses: some/action@v1',
    '        with:',
    '          if: w',
    '      # if: v',
    '      - run: echo',
    '        # if: v',
    '',
  ].join('\n');
  bothEndings(wf, (t) => {
    const s = shape(t);
    assert.deepEqual(s.jobs, [{ id: 'a', if: null, stepIfCount: 2, concurrency: false }]);
    assert.deepEqual(s.unparsed, []);
  });
  // an indentless step sequence and an item whose keys start on the next line
  bothEndings('on: push\njobs:\n  a:\n    steps:\n    - if: x\n      run: y\n    -\n      if: z\n    runs-on: x\n', (t) => {
    assert.deepEqual(shape(t).jobs, [{ id: 'a', if: null, stepIfCount: 2, concurrency: false }]);
  });
  bothEndings('on: push\njobs:\n  build-and-test:\n    uses: ./.github/workflows/r.yml\n', (t) => {
    assert.deepEqual(shape(t).jobs, [{ id: 'build-and-test', if: null, stepIfCount: 0, concurrency: false }]);
  });
  bothEndings('on: push\njobs:\n  a:\n    concurrency: x\n    runs-on: x\n', (t) => {
    const s = shape(t);
    assert.deepEqual(s.jobs, [{ id: 'a', if: null, stepIfCount: 0, concurrency: true }]);
    assert.equal(s.concurrency, 'absent');
  });
});

test('concurrency: scalar, block and flow forms', () => {
  const cases = [
    ['', 'absent'],
    ['concurrency: ci-${{ github.ref }}\n', 'no-cancel'],
    ['concurrency:\n  group: x\n', 'no-cancel'],
    ['concurrency:\n  group: x\n  cancel-in-progress: true\n', 'cancel-true'],
    ['concurrency:\n  group: x\n  cancel-in-progress: false # keep\n', 'cancel-false'],
    ["concurrency:\n  group: x\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n", 'cancel-expression'],
    ['concurrency: {group: x, cancel-in-progress: true}\n', 'cancel-true'],
    ['concurrency: { group: x }\n', 'no-cancel'],
  ];
  for (const [c, want] of cases) {
    bothEndings(`${MIN}${c}`, (t) => {
      const s = shape(t);
      assert.equal(s.concurrency, want, JSON.stringify(t));
      assert.deepEqual(s.unparsed, [], JSON.stringify(t));
    });
  }
  bothEndings(`${MIN}concurrency: {group: x,\n  cancel-in-progress: true}\n`, (t) => {
    assert.ok(shape(t).unparsed.includes('concurrency not read'));
  });
  bothEndings(`${MIN}concurrency:\n  group: x\n  cancel-in-progress: 'true'\n`, (t) => {
    assert.deepEqual(shape(t).unparsed, ['cancel-in-progress value not read']);
  });
});

test('unparsed: each reason fires on its own fixture', () => {
  const cases = [
    ['jobs:\n  a:\n    runs-on: x\n', 'no on: block'],
    ['on: push\n', 'no jobs: key'],
    [`on:\n\tpush:\n${JOBS}`, 'tab indentation in on:'],
    ['on: push\njobs:\n\ta:\n\t\truns-on: x\n', 'tab indentation in jobs:'],
    [`${MIN}concurrency:\n\tgroup: x\n`, 'tab indentation in concurrency:'],
    [`on: *t\n${JOBS}`, 'anchor or alias in on:'],
    [`on: &t\n  push:\n${JOBS}`, 'anchor or alias in on:'],
    [`on:\n  push:\n    branches: [main, *b]\n${JOBS}`, 'anchor or alias in on:'],
    ['on: push\njobs:\n  a: *j\n', 'anchor or alias in jobs:'],
    ['on: push\njobs:\n  <<: *base\n  a:\n    runs-on: x\n', 'anchor or alias in jobs:'],
    ['on: push\njobs:\n  <<: {a: {runs-on: x}}\n', 'anchor or alias in jobs:'],
    ['on: push\njobs:\n  a:\n    steps:\n      - *s\n', 'anchor or alias in jobs:'],
    [`${MIN}concurrency: *c\n`, 'anchor or alias in concurrency:'],
    [`${MIN}concurrency: &c\n  group: x\n`, 'anchor or alias in concurrency:'],
    [`name: &n CI\n${MIN}`, 'anchor or alias in name:'],
    [`name:\n\tCI\n${MIN}`, 'tab indentation in name:'],
    [`on: [push,\n  workflow_dispatch]\n${JOBS}`, 'on: block not read'],
    [`on: \${{ x }}\n${JOBS}`, 'on: block not read'],
    [`on:\n  push: nonsense\n${JOBS}`, 'on: block not read'],
    // text after a flow map's closing brace is unread, at the on: line and at a trigger value
    [`on: { push: {} } junk\n${JOBS}`, 'on: block not read'],
    [`on: { push: {} junk }\n${JOBS}`, 'on: block not read'],
    [`on:\n  push: {branches: [main]} junk\n${JOBS}`, 'on: block not read'],
    [`on:\n  pull_request:\n    types: "ready_for_review"\n${JOBS}`, 'pull_request trigger not read'],
    [`on:\n  push:\n    branches: \${{ x }}\n${JOBS}`, 'push branches not read'],
    // an empty value inside a one-line flow mapping has no block list beneath it
    [`on: { push: { branches: } }\n- main\n${JOBS}`, 'push branches not read'],
    ['on: push\njobs: {}\n', 'jobs: not read'],
    ['on: push\njobs:\n', 'jobs: not read'],
    ['on: push\njobs:\n  a: {}\n', 'jobs: not read'],
    ['on: push\njobs:\n  a:\n    steps: [x]\n', 'jobs: not read'],
    // a step whose content is no `key:` entry is unreadable, never "a step with no if:"
    ['on: push\njobs:\n  a:\n    steps:\n      - {if: x, run: y}\n', 'jobs: not read'],
    ['on: push\njobs:\n  a:\n    steps:\n      - { name: n, if: "x" }\n', 'jobs: not read'],
    ['on: push\njobs:\n  a:\n    steps:\n      - run: x\n        not a key\n', 'jobs: not read'],
    ['on: push\njobs:\n  a:\n    steps:\n      -\n        {if: x}\n', 'jobs: not read'],
    ['on: push\njobs:\n  a:\n    if:\n    runs-on: x\n', 'job a if: not read'],
    [`${MIN}concurrency: {group: x,\n`, 'concurrency not read'],
    [`${MIN}concurrency:\n`, 'concurrency not read'],
    // text after a flow map's closing brace, and a sub-key shallower than the first one
    [`${MIN}concurrency: {group: x} cancel-in-progress: true\n`, 'concurrency not read'],
    [`${MIN}concurrency:\n    group: x\n  cancel-in-progress: true\n`, 'concurrency not read'],
    [`${MIN}concurrency:\n  group: x\n  cancel-in-progress: 'true'\n`, 'cancel-in-progress value not read'],
  ];
  for (const [c, reason] of cases) {
    bothEndings(c, (t) => assert.deepEqual(shape(t).unparsed, [reason], JSON.stringify(t)));
  }
  // negative controls: none of these is an anchor or alias
  const controls = [
    'on: push\njobs:\n  a:\n    steps:\n      - run: ls *.md\n      - run: echo a *b\n',
    'on: push\njobs:\n  a:\n    if: a && b\n',
    "on:\n  push:\n    paths: ['**/*.md']\njobs:\n  a:\n    runs-on: x\n",
    'on: push\njobs:\n  a:\n    steps:\n      - run: |\n          - *not an alias in a script\n          key: *nor this\n',
    "on: push\njobs:\n  a:\n    if: \"x == '*y'\"\n",
  ];
  for (const c of controls) bothEndings(c, (t) => assert.deepEqual(shape(t).unparsed, [], JSON.stringify(t)));
});

test('unparsed: reasons arrive in detection order, deduped', () => {
  bothEndings('on: push\njobs:\n  a:\n    if:\n  a:\n    if:\n', (t) => assert.deepEqual(shape(t).unparsed, ['job a if: not read']));
  bothEndings('concurrency: *c\n', (t) => assert.deepEqual(shape(t).unparsed, ['no on: block', 'no jobs: key', 'anchor or alias in concurrency:']));
});

test('BOM: a leading BOM reads as its BOM-less twin', () => {
  const pr = "name: CI\non:\n  pull_request:\n    types: [opened]\n    paths: ['src/**']\njobs:\n  a:\n    if: github.event.pull_request.draft == false\n    steps:\n      - if: x\n        run: y\nconcurrency:\n  cancel-in-progress: true\n";
  const push = "on:\n  push:\n    branches: ['**']\njobs:\n  a:\n    runs-on: x\n";
  for (const f of [pr, push]) {
    bothEndings(f, (t) => assert.deepEqual(shape(`\uFEFF${t}`), shape(t)));
  }
  assert.deepEqual(shape(pr).prFilters, ['paths']);
  assert.equal(shape(`\uFEFF${push}`).pushBranches, 'all');
});

// tests/merge-verification.test.js's AC5.1 and I1 reader strings, inlined.
const DRAFT = 'jobs:\n  a:\n    if: github.event.pull_request.draft == false\n';
const READER_CASES = [
  ...['pull_request', 'pull_request_target'].map((trig) => `name: a\non:\n  push:\n  ${trig}:\n    types: [opened, ready_for_review]\n`),
  'on:\n  pull_request:\n    types:\n      - opened\n      - ready_for_review\n',
  'on:\n  pull_request:\n    types:\n    - opened\n    - ready_for_review\n',
  "on:\n  pull_request:\n    types:\n      - opened\n      - 'ready_for_review'  # trailing\n",
  'on:\n  pull_request:\n',
  'on: [push, pull_request]\n',
  'on: pull_request\n',
  'on:\n  - push\n  - pull_request\n',
  'on:\n- push\n- pull_request\n',
  'on:\n  pull_request:\n    branches: [main]\n',
  'on:\n  pull_request: {}\n',
  'on:\n  pull_request: null\n',
  'on: { pull_request: {} }\n',
  `on: {\n  pull_request: { types: [ready_for_review] } }\n${DRAFT}`,
  `on: { push: {}, pull_request: {\n  types: [ready_for_review] } }\n${DRAFT}`,
  `on: [push,\n  pull_request]\n${DRAFT}`,
  `on: *triggers\n${DRAFT}`,
  `on: \${{ fromJSON(x) }}\n${DRAFT}`,
  `on:\n  <<: *base\n${DRAFT}`,
  `on:\n  push:\n  <<: *base\n${DRAFT}`,
  `on:\n  - push\n  - *pr\n${DRAFT}`,
  `on: [push, *pr]\n${DRAFT}`,
  `on:\n  - push\n  - \${{ x }}\n${DRAFT}`,
  `on:\n- push\n- *pr\n${DRAFT}`,
  'on: push\n', 'on: [push, workflow_dispatch]\n', 'on: { push: {} }\n', 'on:\n  push:\n',
  'on:\n  - push\n  - workflow_dispatch\n',
  'on:\n- push\njobs:\n  a: {}\n',
  'on:\n  push:\njobs:\n  pull_request:\n    runs-on: x\n',
  'on:\n- push\nx:\n- pull_request\n',
  "on: { push: { branches: ['rel #1'] } }\n",
  'on: &t\n  push:\n',
];

test('AC6.2: readWorkflowShape copies readPullRequestWorkflow\'s four fields unchanged', () => {
  const pick = (r) => ({ prTrigger: r.prTrigger, types: r.types, typesDeclared: r.typesDeclared, draftReference: r.draftReference });
  // ALL already holds each fixture's LF and CRLF forms (every test above reads both).
  const every = [...new Set([...ALL, ...READER_CASES, ...READER_CASES.map((c) => c.replace(/\n/g, '\r\n'))])];
  assert.ok(ALL.length > 100, 'the fixtures above were collected');
  for (const t of every) {
    const pr = mv.readPullRequestWorkflow(t);
    const s = mv.readWorkflowShape(t);
    assert.deepEqual(pick(s), pick(pr), JSON.stringify(t));
    if (pr.unparsed) assert.ok(s.unparsed.includes('pull_request trigger not read'), JSON.stringify(t));
    else assert.ok(!s.unparsed.includes('pull_request trigger not read'), JSON.stringify(t));
  }
});

test('never throws: a stray CR or U+2028 left in a line reads as unparsed, not a throw', () => {
  // readPullRequestWorkflow itself throws on these (its `on:` line regex stops at the stray
  // terminator); the shape reports that read as `pull_request trigger not read`.
  for (const t of ['on: pull_request\r\r\njobs:\r\r\n  a:\r\r\n    if: x\r\r\n', 'on:\u2028 pull_request\njobs:\n  a:\u2028\n',
    'on:\r\n  pull_request:\r\r\njobs:\r\n  a:\r\n    runs-on: x\r\r\nconcurrency:\r\r\n  group: x\r\nname: n\r\r\n']) {
    let s;
    assert.doesNotThrow(() => { s = mv.readWorkflowShape(t); }, JSON.stringify(t));
    assert.ok(s.unparsed.length > 0, JSON.stringify(t));
  }
});
