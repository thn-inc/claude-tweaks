'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { run } = require('../../../plugin/bin/resolved-refusal');

const RESOLVED_KEEP_BODY = '**Resolved:** keep — 2026-10-19\n\n<!-- needs-decision: backlog-refine -->\n## Decision needed\n...';

// The #3214 canned GraphQL response: a trusted MEMBER decision comment resolved `keep`,
// the body last edited before the resolution, and only the resolver's own needs:decision
// removal after it.
const CANNED_RESPONSE = JSON.stringify({
  data: {
    repository: {
      issue: {
        lastEditedAt: '2026-10-17T17:34:56Z',
        comments: {
          nodes: [{
            body: RESOLVED_KEEP_BODY,
            authorAssociation: 'MEMBER',
            createdAt: '2026-10-17T19:25:48Z',
            lastEditedAt: '2026-10-19T03:38:54Z',
            url: 'https://github.com/thn-inc/claude-tweaks/issues/3214#issuecomment-1',
            author: { login: 'thn' },
          }],
        },
        timelineItems: {
          nodes: [
            { __typename: 'UnlabeledEvent', createdAt: '2026-10-19T03:38:58Z', label: { name: 'needs:decision' } },
          ],
        },
      },
    },
  },
});

function fakeDeps(overrides = {}) {
  const out = { stdout: [], stderr: [], runner: [], ghAvailable: 0 };
  const deps = {
    runner: (args) => { out.runner.push(args); return CANNED_RESPONSE; },
    ghAvailable: () => { out.ghAvailable++; return true; },
    remoteUrl: () => 'https://github.com/thn-inc/claude-tweaks.git',
    stdout: (s) => out.stdout.push(s),
    stderr: (s) => out.stderr.push(s),
    ...overrides,
  };
  return { deps, out };
}

test('exit 0 prints suppress:true verdict for the #3214 canned response', () => {
  const { deps, out } = fakeDeps();
  assert.strictEqual(run(['3214'], deps), 0);
  assert.strictEqual(out.stdout.length, 1);
  const verdict = JSON.parse(out.stdout[0]);
  assert.strictEqual(verdict.number, 3214);
  assert.strictEqual(verdict.suppress, true);
  assert.strictEqual(verdict.reason, 'unchanged');
  assert.strictEqual(verdict.choice, 'keep');
  assert.strictEqual(verdict.date, '2026-10-19');
  assert.strictEqual(verdict.resolvedAt, '2026-10-19T00:00:00Z');
  assert.deepStrictEqual(verdict.changes, []);
  assert.strictEqual(verdict.annotation, '#3214 — refusal resolved keep on 2026-10-19; not re-asked');
  assert.deepStrictEqual(out.stderr, []);
});

test('exit 0 with a non-suppressing verdict when the decision comment is absent', () => {
  const { deps, out } = fakeDeps({
    runner: () => JSON.stringify({ data: { repository: { issue: {
      lastEditedAt: null, comments: { nodes: [] }, timelineItems: { nodes: [] },
    } } } }),
  });
  assert.strictEqual(run(['3597'], deps), 0);
  const verdict = JSON.parse(out.stdout[0]);
  assert.strictEqual(verdict.number, 3597);
  assert.strictEqual(verdict.suppress, false);
  assert.strictEqual(verdict.reason, 'no-decision-comment');
});

test('exit 1 when the runner throws', () => {
  const { deps, out } = fakeDeps({
    runner: () => { throw new Error('gh: HTTP 502'); },
  });
  assert.strictEqual(run(['3214'], deps), 1);
  assert.match(out.stderr.join(''), /gh: HTTP 502/);
  assert.deepStrictEqual(out.stdout, []);
});

test('exit 1 when the issue is null (never a suppress verdict)', () => {
  const { deps, out } = fakeDeps({
    runner: () => '{"data":{"repository":{"issue":null}}}',
  });
  assert.strictEqual(run(['3214'], deps), 1);
  assert.match(out.stderr.join(''), /issue #3214 not found in thn-inc\/claude-tweaks/);
  assert.deepStrictEqual(out.stdout, []);
});

test('exit 2 on a missing <n>', () => {
  const { deps, out } = fakeDeps();
  assert.strictEqual(run([], deps), 2);
  assert.match(out.stderr.join(''), /usage: resolved-refusal\.js/);
  assert.deepStrictEqual(out.runner, []);
});

test("exit 2 on a non-positive-integer <n> ('-5')", () => {
  const { deps, out } = fakeDeps();
  assert.strictEqual(run(['-5'], deps), 2);
  assert.deepStrictEqual(out.runner, []);
});

test('exit 2 on a non-integer <n> (1.5, abc, 0)', () => {
  for (const bad of ['1.5', 'abc', '0', '3e2']) {
    const { deps, out } = fakeDeps();
    assert.strictEqual(run([bad], deps), 2, bad);
    assert.deepStrictEqual(out.runner, [], bad);
  }
});

test('exit 2 on an unknown flag', () => {
  const { deps, out } = fakeDeps();
  assert.strictEqual(run(['3214', '--bogus'], deps), 2);
  assert.match(out.stderr.join(''), /unknown argument: --bogus/);
  assert.deepStrictEqual(out.runner, []);
});

test('exit 2 on a trailing bare --repo with no value', () => {
  const { deps, out } = fakeDeps();
  assert.strictEqual(run(['3214', '--repo'], deps), 2);
  assert.match(out.stderr.join(''), /missing value for --repo/);
  assert.deepStrictEqual(out.runner, []);
});

test("exit 2 on --repo '' (empty-string value)", () => {
  const { deps, out } = fakeDeps();
  assert.strictEqual(run(['3214', '--repo', ''], deps), 2);
  assert.match(out.stderr.join(''), /missing value for --repo/);
  assert.deepStrictEqual(out.runner, []);
});

test('exit 2 when gh is absent', () => {
  const { deps, out } = fakeDeps({ ghAvailable: () => false });
  assert.strictEqual(run(['3214'], deps), 2);
  assert.match(out.stderr.join(''), /`gh` is required/);
  assert.deepStrictEqual(out.runner, []);
});

test('exit 2 when no --repo is given and the origin remote is unreadable', () => {
  const { deps, out } = fakeDeps({
    remoteUrl: () => { throw new Error('not a git repository'); },
  });
  assert.strictEqual(run(['3214'], deps), 2);
  assert.match(out.stderr.join(''), /could not resolve owner\/repo/);
  assert.deepStrictEqual(out.runner, []);
});

test('--help exits 0 before ghAvailable is called', () => {
  const { deps, out } = fakeDeps();
  assert.strictEqual(run(['--help'], deps), 0);
  assert.match(out.stdout.join(''), /usage: resolved-refusal\.js <n> \[--repo owner\/name\] \[--help\]/);
  assert.strictEqual(out.ghAvailable, 0);
  assert.deepStrictEqual(out.runner, []);
});

test('--repo owner/name and host/owner/repo both resolve to -f owner= / -f repo=', () => {
  const bare = fakeDeps();
  assert.strictEqual(run(['3214', '--repo', 'acme/widgets'], bare.deps), 0);
  assert.ok(bare.out.runner[0].includes('owner=acme'));
  assert.ok(bare.out.runner[0].includes('repo=widgets'));

  const qualified = fakeDeps();
  assert.strictEqual(run(['3214', '--repo', 'github.com/acme/widgets'], qualified.deps), 0);
  assert.ok(qualified.out.runner[0].includes('owner=acme'));
  assert.ok(qualified.out.runner[0].includes('repo=widgets'));
});

test('--repo host/owner/repo on a GHE host passes --hostname and the owner/repo variables', () => {
  const { deps, out } = fakeDeps();
  assert.strictEqual(run(['3214', '--repo', 'ghe.example.com/acme/widgets'], deps), 0);
  assert.deepStrictEqual(out.runner[0].slice(0, 4), ['api', 'graphql', '--hostname', 'ghe.example.com']);
  assert.ok(out.runner[0].includes('owner=acme'));
  assert.ok(out.runner[0].includes('repo=widgets'));
});
