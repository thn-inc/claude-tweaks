// tests/bin-lib/wrap-up/cli.test.js — the CLI's own composition: argument
// parsing, the --since resolution and its error path, and the reflog-to-ops
// rendering path. None of that is reachable from the three module suites,
// which each feed their unit hand-made inputs.
//
// NOT covered here: the local+remote reflog JOIN itself (the concat + sort in
// wrap-up-state.js, and the `upstreamRef ? … : ''` truthy branch). Every test
// below runs either outside a repository or against a worktree branch with no
// upstream, so `upstreamRef` is always falsy and only the `''` branch ever
// executes — there is never a second reflog to join against. Exercising the
// truthy branch would require a real remote-tracking branch, which this suite
// deliberately avoids depending on (live remote state is not reproducible
// here). Treat that branch as covered only by inspection.
//
// These assertions are deliberately STRUCTURAL — line presence, exit codes,
// JSON shape, and the echoed boundary. Asserting a history-derived value (a
// commit count, a specific op) would be a scheduled failure the next time the
// branch moves.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'wrap-up-state.js');

function run(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || process.cwd(), encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('exits 2 with a usage message when --since is missing', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-state\.js --since/);
});

test('--since followed by another flag does not swallow it as the value', () => {
  const r = run(['--since', '--json', 'HEAD~5']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-state\.js --since/);
});

test('the usage string advertises only the base-sha form', () => {
  const r = run([]);
  assert.match(r.stderr, /--since <base-sha>/);
  assert.doesNotMatch(r.stderr, /iso-datetime/);
});

test('exits 0 and renders all three State lines for a valid base', () => {
  const r = run(['--since', 'HEAD~1']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /^Branch\s+\S/m);
  assert.match(r.stdout, /^Worktree\s+\S/m);
  assert.match(r.stdout, /^Scope\s+since HEAD~1/m);
});

test('--json emits a parseable object carrying state, ops, since and sinceDate', () => {
  const r = run(['--since', 'HEAD~1', '--json']);
  assert.strictEqual(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.ok('pushed' in o.state, 'pushed must be present');
  assert.ok(
    typeof o.state.pushed === 'boolean' || o.state.pushed === null,
    'pushed must be a measured boolean or an explicit null for an unmeasured push state',
  );
  assert.ok(Array.isArray(o.ops));
  assert.strictEqual(o.since, 'HEAD~1');
  assert.ok(typeof o.sinceDate === 'string' && o.sinceDate.length > 0);
});

// #1930 review I7: --json used to carry only the block's raw ingredients, so a
// consumer reading it (the wrap-up fact pack) had no choice but to COMPOSE the
// State block from them — exactly what summary-template.md's "Render VERBATIM
// from the helper" rule forbids. `rendered` is that block, byte for byte.
test('--json carries a `rendered` field byte-identical to the non-JSON block', () => {
  const plain = run(['--since', 'HEAD~1']);
  const json = run(['--since', 'HEAD~1', '--json']);
  assert.strictEqual(plain.status, 0);
  assert.strictEqual(json.status, 0);
  const o = JSON.parse(json.stdout);
  assert.strictEqual(typeof o.rendered, 'string');
  assert.strictEqual(`${o.rendered}\n`, plain.stdout);
});

test('an unresolvable --since inside a repository exits 2 and names the bad value', () => {
  const r = run(['--since', 'not-a-real-ref']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /not-a-real-ref/);
  assert.strictEqual(r.stdout, '');
});

test('outside a git repository the fields render unknown and the exit stays 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-cli-'));
  try {
    const r = run(['--since', 'HEAD'], dir);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /Branch\s+unknown/);
    assert.match(r.stdout, /Worktree\s+unknown/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
