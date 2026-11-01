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
// `gh api graphql` calls. This exercises the remote-URL fallback path, which
// already preserves the real host; #2444 below covers the explicit --repo flag.
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

// #2444 review fix: a caller-supplied --repo can itself already be a
// host-qualified `host/owner/repo` slug (repoSlug()'s GHE output) — before
// this fix, --repo was always prefixed with `github.com/` regardless of
// shape, producing an unparseable 4-segment string for a slug like this.
test('#2444 fix: --resolve-retries with a host-qualified --repo slug threads --hostname into the REST retry call', () => {
  const d = deps({
    remoteUrl: () => { throw new Error('remoteUrl should not be called — --repo was given'); },
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
  assert.strictEqual(run(['5', '--repo', 'ghe.example.com/acme/widget', '--resolve-retries'], d), 0);
  assert.deepStrictEqual(JSON.parse(d.out.join('')), { byParent: { 5: [6, 9] }, retry: [] });
});

test('#2444 fix: a bare --repo owner/repo still resolves to github.com (unchanged, no --hostname)', () => {
  const d = deps({
    remoteUrl: () => { throw new Error('remoteUrl should not be called — --repo was given'); },
    runner(args) {
      d.calls.push(args);
      const q = args.find((a) => a.startsWith('query='));
      if (q && q.includes('__type')) return probeOk;
      if (q) {
        return JSON.stringify({ data: { repository: { i5: { number: 5, subIssues: { nodes: [{ number: 6 }], pageInfo: { hasNextPage: true } } } } } });
      }
      assert.deepStrictEqual(args, ['api', '--paginate', 'repos/o/r/issues/5/sub_issues', '--jq', '.[].number']);
      return '6\n9\n';
    },
  });
  assert.strictEqual(run(['5', '--repo', 'o/r', '--resolve-retries'], d), 0);
  assert.deepStrictEqual(JSON.parse(d.out.join('')), { byParent: { 5: [6, 9] }, retry: [] });
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

// #4806: the schema probe and every GraphQL page reach the --repo / origin host, not github.com.
// 51 numbers is one probe and two 50-alias pages.
test('#4806: the schema probe and every GraphQL page carry --hostname right after graphql off github.com, and none on github.com', () => {
  const nums = Array.from({ length: 51 }, (_, i) => String(i + 1));
  const probeArgv = ['api', 'graphql', '-f', 'query={ __type(name: "Issue") { fields { name } } }'];
  const assertHosted = (d) => {
    const gql = d.calls.filter((a) => a[1] === 'graphql');
    assert.strictEqual(gql.length, 3);
    for (const a of gql) {
      assert.deepStrictEqual(a.slice(0, 4), ['api', 'graphql', '--hostname', 'ghe.example.com']);
      assert.strictEqual(a.filter((x) => x === '--hostname').length, 1);
    }
  };

  // Parent 5 reports a next page, so --resolve-retries sends the REST retry in this same run.
  const viaRepo = deps({
    runner(args) {
      viaRepo.calls.push(args);
      const q = args.find((a) => a.startsWith('query='));
      if (q && q.includes('__type')) return probeOk;
      if (!q) return '6\n9\n';
      const repository = {};
      for (const [, n] of q.matchAll(/i(\d+): issue/g)) {
        repository[`i${n}`] = { number: Number(n), subIssues: { nodes: [], pageInfo: { hasNextPage: n === '5' } } };
      }
      return JSON.stringify({ data: { repository } });
    },
  });
  assert.strictEqual(run([...nums, '--repo', 'ghe.example.com/o/r', '--resolve-retries'], viaRepo), 0);
  assertHosted(viaRepo);
  const rest = viaRepo.calls.filter((a) => a[1] === '--paginate');
  assert.deepStrictEqual(rest, [['api', '--paginate', 'repos/o/r/issues/5/sub_issues', '--jq', '.[].number', '--hostname', 'ghe.example.com']]);

  const viaRemote = deps({ remoteUrl: () => 'git@ghe.example.com:acme/widget.git' });
  assert.strictEqual(run(nums, viaRemote), 0);
  assertHosted(viaRemote);

  const plain = deps();
  assert.strictEqual(run([...nums, '--repo', 'o/r'], plain), 0);
  assert.ok(plain.calls.every((a) => !a.includes('--hostname')));
  assert.deepStrictEqual(plain.calls[0], probeArgv);
});
