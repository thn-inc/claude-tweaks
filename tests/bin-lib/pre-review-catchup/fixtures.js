'use strict';
// Template-copy fixture for pre-review-catchup/cli.test.js (#5769): the build checkout, the
// upstream checkout and the setup several tests share are built once per test process and
// copied per call, so a further call starts no git process (tests/helpers/git-template.js).
// No test runner import here.

const fs = require('node:fs');
const path = require('node:path');
const { originWithTwoClones } = require('../../helpers/git-fixtures');

const FIVE_LINES = ['l1', 'l2', 'l3', 'l4', 'l5'];

// Pre-call setups that two or more tests run identically before their first invoke(), with no
// assertion in between. Each is a list of steps in the original order; `in` names the checkout,
// `push` is pushUpstream(). A setup only one test uses, and every pushUpstream() after the first
// call under test, stays in the test.
const CATCHUP_SHAPE_STEPS = {
  // work edits a.txt line 1; nothing upstream.
  'feat-edit-only': [
    { in: 'work', file: 'a.txt', n: 1, value: 'F1', msg: 'feat edit' },
  ],
  // work edits a.txt line 1; upstream edits a.txt line 5 and pushes: a clean overlap on a.txt.
  'feat-edit-overlapping-upstream': [
    { in: 'work', file: 'a.txt', n: 1, value: 'F1', msg: 'feat edit' },
    { in: 'other', file: 'a.txt', n: 5, value: 'O5', msg: 'upstream edit' },
    { push: true },
  ],
  // work and upstream both edit a.txt line 3 and upstream pushes: the merge conflicts.
  'conflicting-edit': [
    { in: 'work', file: 'a.txt', n: 3, value: 'FEAT', msg: 'feat edit' },
    { in: 'other', file: 'a.txt', n: 3, value: 'UPSTREAM', msg: 'upstream edit' },
    { push: true },
  ],
};
const CATCHUP_SHAPES = Object.keys(CATCHUP_SHAPE_STEPS);

function writeFile(run, dir, name, lines, msg) {
  fs.writeFileSync(path.join(dir, name), `${lines.join('\n')}\n`);
  run(dir, ['add', name]);
  run(dir, ['commit', '-q', '-m', msg]);
}

// Replace line `n` (1-based) of a file with `value`, commit it.
function editLineWith(run, dir, name, n, value, msg) {
  const lines = [...FIVE_LINES];
  lines[n - 1] = value;
  writeFile(run, dir, name, lines, msg);
}

function seedBase({ work, other, run }) {
  writeFile(run, work, 'a.txt', FIVE_LINES, 'a');
  writeFile(run, work, 'b.txt', FIVE_LINES, 'b');
  run(work, ['push', '-q', 'origin', 'main']);
  run(other, ['pull', '-q', 'origin', 'main']);
  run(work, ['checkout', '-q', '-b', 'feat']);
}

function catchupFixture(shape) {
  const steps = shape === undefined ? [] : Object.hasOwn(CATCHUP_SHAPE_STEPS, shape) && CATCHUP_SHAPE_STEPS[shape];
  if (!steps) throw new Error(`catchupFixture: unknown shape "${shape}"`);
  const f = originWithTwoClones('ct-precatchup-', {
    key: shape === undefined ? 'pre-review-catchup' : `pre-review-catchup:${shape}`,
    seed: (ops) => {
      seedBase(ops);
      for (const s of steps) {
        if (s.push) ops.run(ops.other, ['push', '-q', 'origin', 'main']);
        else editLineWith(ops.run, ops[s.in], s.file, s.n, s.value, s.msg);
      }
    },
  });
  const editLine = (dir, name, n, value, msg) => editLineWith(f.run, dir, name, n, value, msg);
  const pushUpstream = () => f.run(f.other, ['push', '-q', 'origin', 'main']);
  return { ...f, editLine, pushUpstream, head: () => f.run(f.work, ['rev-parse', 'HEAD']).trim() };
}

module.exports = { CATCHUP_SHAPES, catchupFixture };
