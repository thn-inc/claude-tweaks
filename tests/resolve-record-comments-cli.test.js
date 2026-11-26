// tests/resolve-record-comments-cli.test.js — in-process tests for
// bin/resolve-record-comments.js's run(argv, deps), in
// tests/resolve-linked-prs-cli.test.js's deps-injection style. Argument parsing
// and repo resolution live in tests/bin-lib/number-list-cli.test.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../plugin/bin/resolve-record-comments');

const comment = { body: '<!-- driver-escalation -->', authorAssociation: 'MEMBER', url: 'https://github.com/acme/widgets/issues/7#c1', author: { login: 'tom' } };

function fakeDeps(overrides = {}) {
  const calls = { runner: [], stdout: [], stderr: [] };
  return {
    calls,
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    runner: (args) => {
      calls.runner.push(args);
      return JSON.stringify({
        data: { repository: {
          i7: { comments: { totalCount: 1, nodes: [comment] } },
          i8: { comments: { totalCount: 120, nodes: [comment] } },
        } },
      });
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

test('missing <n> is exit 1 with this CLI usage name', () => {
  const deps = fakeDeps();
  assert.equal(run([], deps), 1);
  assert.match(deps.calls.stderr.join(''), /usage: resolve-record-comments\.js/);
});

test('a comma list prints one number-keyed object from ONE runner call, comments verbatim', () => {
  const deps = fakeDeps();
  assert.equal(run(['7,8'], deps), 0);
  assert.equal(deps.calls.runner.length, 1);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), {
    7: { comments: [comment], complete: true },
    8: { comments: [comment], complete: false },
  });
});

test('an unread record (alias i8 null) is absent from the printed object, end to end', () => {
  const deps = fakeDeps({
    runner: () => JSON.stringify({ data: { repository: { i7: { comments: { totalCount: 1, nodes: [comment] } }, i8: null } } }),
  });
  assert.equal(run(['7,8'], deps), 0);
  const printed = JSON.parse(deps.calls.stdout[0]);
  assert.deepEqual(Object.keys(printed), ['7']);
  assert.equal('8' in printed, false);
});

test('a thrown fetch (null repository) is exit 3 with nothing on stdout', () => {
  const deps = fakeDeps({ runner: () => JSON.stringify({ data: { repository: null } }) });
  assert.equal(run(['7'], deps), 3);
  assert.equal(deps.calls.stdout.length, 0);
});
