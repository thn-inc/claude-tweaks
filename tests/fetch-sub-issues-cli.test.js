'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { run } = require('../plugin/bin/fetch-sub-issues');

const probeOk = JSON.stringify({ data: { __type: { fields: [{ name: 'subIssues' }, { name: 'blockedBy' }] } } });
const probeNo = JSON.stringify({ data: { __type: { fields: [{ name: 'blockedBy' }] } } });

function deps(overrides = {}) {
  const calls = [];
  const d = {
    ghAvailable: () => true,
    remoteUrl: () => 'git@github.com:o/r.git',
    runner: (args) => {
      calls.push(args);
      const q = args.find((a) => a.startsWith('query='));
      if (q && q.includes('__type')) return probeOk;
      return JSON.stringify({ data: { repository: { i5: { number: 5, subIssues: { nodes: [{ number: 6 }], pageInfo: { hasNextPage: false } } } } } });
    },
    out: [], err: [],
    stdout(s) { this.out.push(s); }, stderr(s) { this.err.push(s); },
    ...overrides,
  };
  d.calls = calls;
  return d;
}

test('happy path prints byParent object and exits 0', () => {
  const d = deps();
  assert.strictEqual(run(['5'], d), 0);
  assert.deepStrictEqual(JSON.parse(d.out.join('')), { byParent: { 5: [6] }, retry: [] });
});

test('zero positionals is valid: empty envelope, exit 0, no GraphQL fetch', () => {
  const d = deps();
  assert.strictEqual(run([], d), 0);
  assert.deepStrictEqual(JSON.parse(d.out.join('')), { byParent: {}, retry: [] });
  assert.ok(!d.calls.some((args) => args.some((a) => a.includes('subIssues(first:100)'))));
});

// Review finding (whole-branch review, e90376a4..HEAD): the header comment guarantees zero
// positionals is "still a valid invocation" printing the empty envelope at exit 0, but run()
// used to call ghAvailable()/remoteUrl()/probeSchema() unconditionally before ever checking
// opts.numbers.length — so a zero-arg caller on a host where any of those fails got exit 2/4
// instead of the documented guarantee. The happy-path deps() fixture above wouldn't have caught
// this (ghAvailable/probeSchema both succeed there); these two force each dependency to fail and
// assert the guarantee holds anyway, proving the short-circuit runs before them.
test('zero positionals: guaranteed exit 0 even when gh is unavailable (finding regression)', () => {
  const d = deps({ ghAvailable: () => false });
  assert.strictEqual(run([], d), 0);
  assert.deepStrictEqual(JSON.parse(d.out.join('')), { byParent: {}, retry: [] });
});

test('zero positionals: guaranteed exit 0 even when the schema probe throws (finding regression)', () => {
  const d = deps({ runner: () => { throw new Error('gh api graphql: transient failure'); } });
  assert.strictEqual(run([], d), 0);
  assert.deepStrictEqual(JSON.parse(d.out.join('')), { byParent: {}, retry: [] });
});

test('probe reporting subIssues unavailable exits 4 before any fetch', () => {
  const d = deps({ runner: () => probeNo });
  assert.strictEqual(run(['5'], d), 4);
});

test('a throwing probe runner exits 3 with a network-failure message, not 4', () => {
  const d = deps({ runner: () => { throw new Error('gh api graphql: connection reset'); } });
  assert.strictEqual(run(['5'], d), 3);
  assert.match(d.err.join(''), /capability probe failed/);
  assert.match(d.err.join(''), /connection reset/);
});

test('a probe response that fails to JSON.parse also exits 3 (call/parse-layer failure), not 4', () => {
  const d = deps({ runner: () => 'not json at all' });
  assert.strictEqual(run(['5'], d), 3);
});

test('a GraphQL throw exits 3', () => {
  const d = deps({
    runner: (args) => {
      const q = args.find((a) => a.startsWith('query='));
      if (q && q.includes('__type')) return probeOk;
      return JSON.stringify({ data: { repository: null } });
    },
  });
  assert.strictEqual(run(['5'], d), 3);
});

test('trailing --repo with no value is malformed — exit 1, no network call', () => {
  const d = deps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  assert.strictEqual(run(['5', '--repo'], d), 1);
  assert.match(d.err.join(''), /missing value for --repo/);
  assert.deepStrictEqual(d.calls, []);
});

test('--repo followed by another flag is rejected as missing a value, not treated as the value', () => {
  const d = deps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  assert.strictEqual(run(['5', '--repo', '--help'], d), 1);
  assert.match(d.err.join(''), /missing value for --repo/);
});

test('--repo owner/name (well-formed) is unaffected', () => {
  const d = deps();
  assert.strictEqual(run(['5', '--repo', 'o/r'], d), 0);
});

test('non-integer positional exits 1; gh absent exits 2', () => {
  assert.strictEqual(run(['abc'], deps()), 1);
  assert.strictEqual(run(['5'], deps({ ghAvailable: () => false })), 2);
});

test('101 numbers fan out as three chunked fetch calls (50/50/1)', () => {
  const nums = Array.from({ length: 101 }, (_, i) => i + 1);
  const d = deps({
    runner(args) {
      d.calls.push(args);
      const q = args.find((a) => a.startsWith('query='));
      if (q && q.includes('__type')) return probeOk;
      const aliased = [...q.matchAll(/i(\d+): issue/g)].map((m) => Number(m[1]));
      assert.ok(aliased.length <= 50, `chunk exceeded 50: ${aliased.length}`);
      const repository = Object.fromEntries(aliased.map((n) => [`i${n}`, { number: n, subIssues: { nodes: [], pageInfo: { hasNextPage: false } } }]));
      return JSON.stringify({ data: { repository } });
    },
  });
  d.calls.length = 0;
  assert.strictEqual(run(nums.map(String), d), 0);
  const fetches = d.calls.filter((args) => args.some((a) => typeof a === 'string' && a.includes('subIssues(first:100)')));
  assert.strictEqual(fetches.length, 3);
});

test('--resolve-retries resolves a retry parent via REST and merges it into byParent', () => {
  const d = deps({
    runner(args) {
      d.calls.push(args);
      const q = args.find((a) => a.startsWith('query='));
      if (q && q.includes('__type')) return probeOk;
      if (q) {
        // batch GraphQL call: parent 5 comes back with hasNextPage true, so it lands in retry
        return JSON.stringify({ data: { repository: { i5: { number: 5, subIssues: { nodes: [{ number: 6 }], pageInfo: { hasNextPage: true } } } } } });
      }
      // REST retry call: gh api --paginate repos/{owner}/{repo}/issues/5/sub_issues --jq '.[].number'
      assert.deepStrictEqual(args, ['api', '--paginate', 'repos/o/r/issues/5/sub_issues', '--jq', '.[].number']);
      return '6\n9\n';
    },
  });
  assert.strictEqual(run(['5', '--repo', 'o/r', '--resolve-retries'], d), 0);
  assert.deepStrictEqual(JSON.parse(d.out.join('')), { byParent: { 5: [6, 9] }, retry: [] });
});

test('--resolve-retries: a failing REST retry call exits 3, names the parent, and prints nothing to stdout', () => {
  const d = deps({
    runner(args) {
      d.calls.push(args);
      const q = args.find((a) => a.startsWith('query='));
      if (q && q.includes('__type')) return probeOk;
      if (q) return JSON.stringify({ data: { repository: { i5: { number: 5, subIssues: { nodes: [], pageInfo: { hasNextPage: true } } } } } });
      throw new Error('gh api: sub_issues 404');
    },
  });
  assert.strictEqual(run(['5', '--repo', 'o/r', '--resolve-retries'], d), 3);
  assert.match(d.err.join(''), /sub-issue REST retry failed for parent #5/);
  assert.match(d.err.join(''), /sub_issues 404/);
  assert.deepStrictEqual(d.out, []);
});

// #2240: parseRepo now returns { host, owner, repo } for a GitHub Enterprise Server
// remote (not just github.com), and the REST retry call threads --hostname when
// host !== 'github.com' -- mirroring #2021's fix for _shared/pr-run-comments.md's
// `gh api graphql` calls. `--repo` still hard-wraps as `github.com/${opts.repo}` (a
// separate, pre-existing gap outside this record's scope), so this exercises the
// remote-URL fallback path, which already preserves the real host.
test('#2240: --resolve-retries on a GitHub Enterprise Server remote threads --hostname into the REST retry call', () => {
  const d = deps({
    remoteUrl: () => 'git@ghe.example.com:acme/widget.git',
    runner(args) {
      d.calls.push(args);
      const q = args.find((a) => a.startsWith('query='));
      if (q && q.includes('__type')) return probeOk;
      if (q) {
        return JSON.stringify({ data: { repository: { i5: { number: 5, subIssues: { nodes: [{ number: 6 }], pageInfo: { hasNextPage: true } } } } } });
      }
      assert.deepStrictEqual(args, ['api', '--paginate', 'repos/acme/widget/issues/5/sub_issues', '--jq', '.[].number', '--hostname', 'ghe.example.com']);
      return '6\n9\n';
    },
  });
  assert.strictEqual(run(['5', '--resolve-retries'], d), 0);
  assert.deepStrictEqual(JSON.parse(d.out.join('')), { byParent: { 5: [6, 9] }, retry: [] });
});

test('--resolve-retries with an empty retry array is a no-op (unaffected output)', () => {
  const d = deps();
  assert.strictEqual(run(['5', '--repo', 'o/r', '--resolve-retries'], d), 0);
  assert.deepStrictEqual(JSON.parse(d.out.join('')), { byParent: { 5: [6] }, retry: [] });
});

test('--resolve-retries does not change exit-4 (probe unavailable) behavior', () => {
  const d = deps({ runner: () => probeNo });
  assert.strictEqual(run(['5', '--repo', 'o/r', '--resolve-retries'], d), 4);
});

test('--help output documents --resolve-retries', () => {
  const d = deps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  assert.strictEqual(run(['--help'], d), 0);
  assert.match(d.out.join(''), /--resolve-retries/);
});

test('--repo owner/.. is rejected before any gh call (review finding: parseRepo accepts ".." segments)', () => {
  const d = deps({ runner: () => { throw new Error('should not be called'); } });
  assert.strictEqual(run(['5', '--repo', 'owner/..'], d), 2);
  assert.match(d.err.join(''), /invalid --repo value/);
  assert.deepStrictEqual(d.calls, []);
});

test('--repo ../evil is rejected before any gh call', () => {
  const d = deps({ runner: () => { throw new Error('should not be called'); } });
  assert.strictEqual(run(['5', '--repo', '../evil'], d), 2);
  assert.match(d.err.join(''), /invalid --repo value/);
  assert.deepStrictEqual(d.calls, []);
});
