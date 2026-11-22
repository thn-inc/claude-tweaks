'use strict';
// plugin/bin/release-state.js (#5883): the frozen exit codes, the usage guards, the gh path
// over a fake `gh` world, the emit path over the agent's handoff files, and the host seam.
// The operations themselves are proven in marker.test.js; these cases pin what the CLI adds.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { cleanGitEnv } = require('../../helpers/git-fixtures');
const { pinnedGitEnv } = require('../../helpers/pinned-git');
const { captureGhTimeout } = require('../../helpers/gh-timeout-probe');
const { serializeMarker, OUTCOMES } = require('../../../plugin/bin/lib/release-state/marker');
const { makeLine, shallowClone } = require('./fixtures');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'release-state.js');
const {
  EXIT, OUTCOME_EXIT, USAGE, realDeps,
} = require(CLI);

const NOW = new Date('2026-11-18T12:00:00.000Z');
const THEN = '2026-11-18T10:00:00.000Z';
const BLOB = 'b'.repeat(40);
const hex = (n) => n.toString(16).padStart(40, '0');
const LINE = [1, 2, 3, 4, 5].map(hex);
const OFF = hex(99);
const markerText = (sha, run = 'r1') => serializeMarker({ sha, advancedAt: THEN, run });
const short12 = (sha) => sha.slice(0, 12);

// ---- a fake `gh` world: the contents, branch, repo, ref and compare routes the CLI reaches ----

const httpError = (text) => Object.assign(new Error(`Command failed: gh api\n${text}`), { stderr: text });
const field = (args, key) => {
  const i = args.findIndex((a, n) => a === '-f' && String(args[n + 1]).startsWith(`${key}=`));
  return i < 0 ? undefined : String(args[i + 1]).slice(key.length + 1);
};

function makeWorld(o = {}) {
  return {
    slug: 'o/r',
    marker: null, // the file's content, or null for no file
    blob: BLOB,
    branchExists: true,
    repoMissing: false,
    contentsError: null, // a stderr text every contents GET throws
    tipFails: false,
    putConflict: false,
    line: LINE,
    puts: [],
    ...o,
  };
}

function ghFor(world, log) {
  const base = `repos/${world.slug}`;
  const file = `${base}/contents/reviewed-through.json`;
  return (args) => {
    log.push(args);
    if (args[0] !== 'api') throw new Error(`unexpected ${args.join(' ')}`);
    const target = args.find((a) => typeof a === 'string' && a.startsWith('repos/'));
    if (target === `${file}?ref=release-state`) {
      if (world.contentsError) throw httpError(world.contentsError);
      if (world.marker === null) throw httpError(world.branchExists ? 'Not Found (HTTP 404)' : 'No commit found for the ref release-state (HTTP 404)');
      return JSON.stringify({ content: world.marker, sha: world.blob });
    }
    if (target === file && args.includes('PUT')) {
      const sha = field(args, 'sha');
      const content = Buffer.from(field(args, 'content'), 'base64').toString('utf8');
      world.puts.push({ sha, content, message: field(args, 'message'), branch: field(args, 'branch') });
      if (world.putConflict) throw httpError('HTTP 409 Conflict');
      if (world.marker !== null && sha === undefined) throw httpError('HTTP 422 Validation failed: sha wasn\'t supplied');
      if (sha !== undefined && sha !== world.blob) throw httpError('HTTP 409 does not match');
      world.marker = content;
      world.blob = `${world.puts.length}`.padStart(40, 'c');
      return '{}';
    }
    if (target === `${base}/branches/release-state`) {
      if (!world.branchExists) throw httpError('Branch not found (HTTP 404)');
      return 'release-state';
    }
    if (target === base) {
      if (world.repoMissing) throw httpError('Not Found (HTTP 404)');
      return world.slug;
    }
    if (target.startsWith(`${base}/git/ref/heads/`)) {
      if (world.tipFails) throw httpError('connection reset by peer');
      return world.line[world.line.length - 1];
    }
    const compare = new RegExp(`^${base}/compare/([0-9a-f]{40})\\.\\.\\.([0-9a-f]{40})\\?per_page=100&page=1$`).exec(target);
    if (compare) {
      const at = world.line.indexOf(compare[1]);
      if (at < 0) throw httpError('Not Found (HTTP 404)');
      const commits = world.line.slice(at + 1).map((sha, i) => ({ sha, parents: [world.line[at + i]] }));
      return JSON.stringify({ status: commits.length ? 'ahead' : 'identical', total_commits: commits.length, commits });
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
}

// Deps for an in-process call: the fake gh, a git that is not there (so no local history), the
// gate's origin, and every call recorded.
function harness({ world = makeWorld(), origin = 'https://github.com/o/r.git', deps = {} } = {}) {
  const calls = {
    gh: [], git: [], pin: [], remote: 0, readFile: [],
  };
  return {
    world,
    calls,
    deps: {
      cwd: () => '/work',
      env: {},
      homeDir: () => '/home',
      remoteUrl: () => { calls.remote += 1; return origin; },
      pinGhHost: (spec) => { calls.pin.push(spec); },
      gh: ghFor(world, calls.gh),
      git: (args) => { calls.git.push(args); throw new Error(`no git here: ${args.join(' ')}`); },
      readFile: (p) => { calls.readFile.push(p); throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' }); },
      now: () => NOW,
      sleep: () => {},
      ...deps,
    },
  };
}

const call = (argv, h, opts = {}) => runCliSync(CLI, argv, { cwd: '/work', env: {}, deps: h.deps, ...opts });
const silent = (h) => {
  assert.deepEqual(h.calls.gh, []);
  assert.deepEqual(h.calls.git, []);
  assert.equal(h.calls.remote, 0);
  assert.deepEqual(h.calls.readFile, []);
};

// ---- the public contract ----

test('public contract: EXIT and OUTCOME_EXIT values', () => {
  assert.deepStrictEqual(EXIT, {
    OK: 0, REFUSED: 1, USAGE: 2, UNREADABLE: 3, CONTESTED: 4, INSUFFICIENT_HISTORY: 5, ORPHANED: 6,
  });
  assert.ok(Object.isFrozen(EXIT) && Object.isFrozen(OUTCOME_EXIT));
  assert.deepStrictEqual(OUTCOME_EXIT, {
    ok: 0, refused: 1, unreadable: 3, contested: 4, 'insufficient-history': 5, orphaned: 6,
  });
  assert.deepEqual(Object.keys(OUTCOME_EXIT).sort(), [...OUTCOMES].sort());
  for (const [name, code] of Object.entries(EXIT)) {
    assert.match(USAGE, new RegExp(`^  exit ${code} ${name.toLowerCase().replace('_', '-')}: `, 'm'), name);
  }
  assert.equal(USAGE.split('\n').filter((l) => l.startsWith('  exit ')).length, 7);
});

test('script entry: --help prints the usage and exits 0', () => {
  const r = spawnCli(CLI, ['--help']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, USAGE);
  assert.equal(r.stderr, '');
});

// ---- AC1.1 on a real clone ----

test('AC1.1: marker read prints the marker after an advance (real git, no gh, no --repo)', () => {
  const fx = makeLine();
  const gitCalls = [];
  const env = { ...cleanGitEnv(), ...pinnedGitEnv() };
  delete env.GH_HOST;
  const ghCalls = [];
  const deps = {
    remoteUrl: () => 'https://github.com/o/r.git',
    cwd: () => fx.cloneA,
    git: (args, o) => { gitCalls.push(args); return realDeps.git(args, o); },
    gh: (args) => { ghCalls.push(args); throw new Error(`unexpected ${args.join(' ')}`); },
    now: () => NOW,
    sleep: () => {},
  };
  const run = (argv) => runCliSync(CLI, argv, { cwd: fx.cloneA, env, deps });
  const init = run(['marker', 'init', '--to', fx.P1]);
  assert.deepEqual([init.code, init.stdout], [0, `{"initialized":true,"sha":"${fx.P1}"}\n`]);
  const adv = run(['marker', 'advance', '--to', fx.P3, '--run', 'r1']);
  assert.deepEqual([adv.code, adv.stdout], [0, `{"advanced":true,"from":"${fx.P1}","to":"${fx.P3}"}\n`]);
  const read = run(['marker', 'read']);
  assert.equal(read.code, 0);
  assert.equal(read.stdout, `{"version":1,"sha":"${fx.P3}","advancedAt":"${NOW.toISOString()}","run":"r1"}\n`);
  assert.deepEqual(ghCalls, []);
  assert.ok(gitCalls.some((a) => a[0] === 'fetch'), 'the local clone served the calls');
});

test('realDeps.git runs under the injected env, with extraEnv laid on top', () => {
  const fx = makeLine();
  const probe = (env, extraEnv) => realDeps.git(['config', '--get', 'release.state.probe'], { cwd: fx.cloneA, env, extraEnv }).trim();
  const keyed = (value) => ({
    ...cleanGitEnv(), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'release.state.probe', GIT_CONFIG_VALUE_0: value,
  });
  assert.equal(probe(keyed('from-env')), 'from-env');
  assert.equal(probe(keyed('from-env'), { GIT_CONFIG_VALUE_0: 'from-extra' }), 'from-extra');
});

// ---- each outcome maps to its exit code ----

const ON_LINE = () => makeWorld({ marker: markerText(LINE[1]) });
const REFUSE = [
  ['AC2.1: refused (a target off the first-parent line)', ON_LINE, ['advance', '--to', OFF, '--run', 'r2'], 1, /^release-state\.js: refused — /],
  ['AC2.1: refused (a target behind the marker)', () => makeWorld({ marker: markerText(LINE[3]) }), ['advance', '--to', LINE[1], '--run', 'r2'], 1, /^release-state\.js: refused — /],
  ['AC8.5: orphaned (the marker is not on the line)', () => makeWorld({ marker: markerText(OFF) }), ['advance', '--to', LINE[3], '--run', 'r2'], 6, /^release-state\.js: orphaned — /],
  ['AC8.1: insufficient-history (the tip cannot be read)', () => makeWorld({ marker: markerText(LINE[1]), tipFails: true }), ['advance', '--to', LINE[3], '--run', 'r2'], 5, /^release-state\.js: insufficient-history — /],
  ['AC6.1: init-exists (a marker is already there)', ON_LINE, ['init', '--to', LINE[2]], 1, /^release-state\.js: refused — a marker already exists/],
  ['AC5.1: unreadable (the contents read failed)', () => makeWorld({ contentsError: 'connection reset by peer' }), ['advance', '--to', LINE[3], '--run', 'r2'], 3, /^release-state\.js: unreadable — /],
  ['AC8.3: a malformed marker is unreadable', () => makeWorld({ marker: '{"version":2}' }), ['advance', '--to', LINE[3], '--run', 'r2'], 3, /^release-state\.js: unreadable — .*version/],
  ['an inaccessible repo is unreadable, never absent', () => makeWorld({ branchExists: false, repoMissing: true }), ['read'], 3, /^release-state\.js: unreadable — .*could not be confirmed/],
  ['contested (every write loses)', () => makeWorld({ marker: markerText(LINE[1]), putConflict: true }), ['advance', '--to', LINE[3], '--run', 'r2'], 4, /^release-state\.js: contested — /],
  ['reset of a marker still on the line is refused', ON_LINE, ['reset', '--to', LINE[3], '--run', 'r9'], 1, /^release-state\.js: refused — .*not orphaned/],
  ['reset of an unreadable marker without --force is unreadable', () => makeWorld({ marker: '{' }), ['reset', '--to', LINE[3], '--run', 'r9'], 3, /^release-state\.js: unreadable — .*--force --reason/],
];
for (const [label, world, args, exit, stderr] of REFUSE) {
  test(`${label}: exit ${exit}, empty stdout, one stderr line`, () => {
    const h = harness({ world: world() });
    const before = h.world.marker;
    const r = call(['marker', ...args], h);
    assert.equal(r.code, exit);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, stderr);
    assert.equal(r.stderr.trimEnd().split('\n').length, 1);
    assert.equal(h.world.marker, before, 'a failed operation left the marker file as it was');
  });
}

test('every non-ok outcome of marker.js has a row above (derived from OUTCOMES through OUTCOME_EXIT)', () => {
  const want = OUTCOMES.filter((o) => o !== 'ok').map((o) => OUTCOME_EXIT[o]);
  assert.deepEqual([...new Set(REFUSE.map((row) => row[3]))].sort(), [...new Set(want)].sort());
});

const OK_ROWS = [
  ['AC4.1: read on a branchless remote prints {"absent":true}', () => makeWorld({ branchExists: false }), ['read'], '{"absent":true}\n'],
  ['read prints the marker', ON_LINE, ['read'], `{"version":1,"sha":"${LINE[1]}","advancedAt":"${THEN}","run":"r1"}\n`],
  ['advance', ON_LINE, ['advance', '--to', LINE[3], '--run', 'r2'], `{"advanced":true,"from":"${LINE[1]}","to":"${LINE[3]}"}\n`],
  ['advance to the marker itself is same, exit 0', ON_LINE, ['advance', '--to', LINE[1], '--run', 'r2'], `{"advanced":false,"sha":"${LINE[1]}","reason":"same"}\n`],
  ['init', () => makeWorld(), ['init', '--to', LINE[2]], `{"initialized":true,"sha":"${LINE[2]}"}\n`],
  ['reset of an orphaned marker', () => makeWorld({ marker: markerText(OFF) }), ['reset', '--to', LINE[3], '--run', 'r9'], `{"reset":true,"from":"${OFF}","to":"${LINE[3]}","basis":"orphaned"}\n`],
  ['a forced reset logs basis forced even over a marker on the line', ON_LINE, ['reset', '--to', LINE[3], '--run', 'r9', '--force', '--reason', 'history rewritten by hand'], `{"reset":true,"from":"${LINE[1]}","to":"${LINE[3]}","basis":"forced"}\n`],
];
for (const [label, world, args, stdout] of OK_ROWS) {
  test(`exit 0 stdout, byte for byte: ${label}`, () => {
    const h = harness({ world: world() });
    const r = call(['marker', ...args], h);
    assert.deepEqual([r.code, r.stdout, r.stderr], [0, stdout, '']);
  });
}

test('an advance writes the marker file the contract names, on the release-state branch, over a PUT with the blob lease', () => {
  const h = harness({ world: ON_LINE() });
  call(['marker', 'advance', '--to', LINE[3], '--run', 'r2'], h);
  assert.deepEqual(h.world.puts, [{
    sha: BLOB,
    content: serializeMarker({ sha: LINE[3], advancedAt: NOW.toISOString(), run: 'r2' }),
    message: `Advance reviewed-through to ${short12(LINE[3])} from ${short12(LINE[1])} — run r2`,
    branch: 'release-state',
  }]);
});

test('a gh that is absent adds the MCP hint to the one failure line', () => {
  const h = harness({ deps: { gh: () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); } } });
  const r = call(['marker', 'read'], h);
  assert.equal(r.code, 3);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^release-state\.js: unreadable — /);
  assert.match(r.stderr, /\nrelease-state\.js: gh not found — read over MCP and pass --marker-json \(_shared\/release-state\.md\)\n$/);
});

test('an unexpected throw from an operation is unreadable, never the exit code that means refused', () => {
  const h = harness({ world: ON_LINE(), deps: { now: () => { throw new Error('clock exploded'); } } });
  const r = call(['marker', 'advance', '--to', LINE[3], '--run', 'r2'], h);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /^release-state\.js: unreadable — clock exploded\n$/);
});

// ---- usage ----

const T = LINE[2];
const REASON = 'history rewritten by hand';
// Each row names the stderr text of the one check that must fire, so a row cannot pass on a later
// check catching what an earlier one stopped catching.
const USAGE_CASES = [
  ['no verb', [], /a subcommand is required/],
  ['marker alone', ['marker'], /marker needs read, advance, init or reset/],
  ['an unknown group', ['frobnicate', 'read'], /unknown subcommand: frobnicate/],
  ['an unknown marker verb', ['marker', 'frobnicate'], /unknown marker subcommand: frobnicate/],
  ['an unknown marker verb before --help is not help', ['marker', 'frobnicate', '--help'], /unknown marker subcommand: frobnicate/],
  ['an unknown flag before --help is not help', ['marker', 'read', '--bogus', '--help'], /unknown argument: --bogus/],
  ['advance without --to', ['marker', 'advance', '--run', 'r1'], /--to must be a 40-character/],
  ['--to given as 39 hex', ['marker', 'advance', '--to', 'a'.repeat(39), '--run', 'r1'], /--to must be a 40-character/],
  ['--to given as uppercase hex', ['marker', 'advance', '--to', 'A'.repeat(40), '--run', 'r1'], /--to must be a 40-character/],
  ['advance without --run', ['marker', 'advance', '--to', T], /--run is required/],
  ['a trailing --run', ['marker', 'advance', '--to', T, '--run'], /--run requires a value/],
  ['a leading-dash --run', ['marker', 'advance', '--to', T, '--run', '-x'], /--run requires a value/],
  ['--run init', ['marker', 'advance', '--to', T, '--run', 'init'], /--run must match .* never "init"/],
  ['a --run over 128 characters', ['marker', 'advance', '--to', T, '--run', 'r'.repeat(129)], /--run must match/],
  ['--run with a space', ['marker', 'advance', '--to', T, '--run', 'a b'], /--run must match/],
  ['--force without --reason', ['marker', 'reset', '--to', T, '--run', 'r1', '--force'], /--force requires --reason/],
  ['--reason without --force', ['marker', 'reset', '--to', T, '--run', 'r1', '--reason', REASON], /--reason is only valid with --force/],
  // The short reasons (#, newline) fit the commit-message budget, so only the reason rule refuses
  // them; the 201-character reason is refused by that rule first, ahead of the budget check.
  ['a --reason with #', ['marker', 'reset', '--to', T, '--run', 'r1', '--force', '--reason', 'fix #12'], /--reason must match/],
  ['a --reason with a newline', ['marker', 'reset', '--to', T, '--run', 'r1', '--force', '--reason', 'one\ntwo'], /--reason must match/],
  ['a --reason over 200 characters', ['marker', 'reset', '--to', T, '--run', 'r1', '--force', '--reason', 'x'.repeat(201)], /--reason must match/],
  ['a --reason that is another flag', ['marker', 'reset', '--to', T, '--run', 'r1', '--force', '--reason', '--force'], /--reason requires a value/],
  ['a --reason with a leading dash is refused like any flag value', ['marker', 'reset', '--to', T, '--run', 'r1', '--force', '--reason', '-x'], /--reason requires a value/],
  ['a --reason of -h is a refused value, not help', ['marker', 'reset', '--to', T, '--run', 'r1', '--force', '--reason', '-h'], /--reason requires a value/],
  ['a --run of -h is a refused value, not help', ['marker', 'advance', '--to', T, '--run', '-h'], /--run requires a value/],
  ['a --repo of --help is a refused value, not help', ['marker', 'read', '--repo', '--help'], /--repo requires a value/],
  ['a trailing --reason', ['marker', 'reset', '--to', T, '--run', 'r1', '--force', '--reason'], /--reason requires a value/],
  ['an invalid --branch', ['marker', 'advance', '--to', T, '--run', 'r1', '--branch', 'a..b'], /is not a valid branch name/],
  ['a leading-dash --branch', ['marker', 'advance', '--to', T, '--run', 'r1', '--branch', '-x'], /--branch requires a value/],
  ['--marker-json with --repo (advance)', ['marker', 'advance', '--to', T, '--run', 'r1', '--marker-json', 'x', '--repo', 'o/r'], /--marker-json and --repo are mutually exclusive/],
  ['--marker-json with --repo (read)', ['marker', 'read', '--marker-json', 'x', '--repo', 'o/r'], /--marker-json and --repo are mutually exclusive/],
  ['--emit with --repo', ['marker', 'init', '--to', T, '--emit', '--repo', 'o/r'], /--emit and --repo are mutually exclusive/],
  ['--emit on advance', ['marker', 'advance', '--to', T, '--run', 'r1', '--emit'], /--emit is not valid for marker advance/],
  ['--marker-json on init', ['marker', 'init', '--to', T, '--marker-json', 'x'], /--marker-json is not valid for marker init/],
  ['--run on init', ['marker', 'init', '--to', T, '--run', 'r1'], /--run is not valid for marker init/],
  ['--force on advance', ['marker', 'advance', '--to', T, '--run', 'r1', '--force'], /--force is not valid for marker advance/],
  ['--to on read', ['marker', 'read', '--to', T], /--to is not valid for marker read/],
  ['--after-conflict without --marker-json', ['marker', 'advance', '--to', T, '--run', 'r1', '--after-conflict'], /--after-conflict needs --marker-json/],
  ['--after-conflict with --repo', ['marker', 'advance', '--to', T, '--run', 'r1', '--after-conflict', '--repo', 'o/r'], /--after-conflict needs --marker-json/],
  ['--after-conflict on read', ['marker', 'read', '--after-conflict', '--marker-json', 'x'], /--after-conflict is not valid for marker read/],
  ['--after-conflict on init', ['marker', 'init', '--to', T, '--after-conflict'], /--after-conflict is not valid for marker init/],
  ['--after-conflict on reset', ['marker', 'reset', '--to', T, '--run', 'r1', '--after-conflict', '--marker-json', 'x'], /--after-conflict is not valid for marker reset/],
  ['an unknown flag', ['marker', 'read', '--frobnicate'], /unknown argument: --frobnicate/],
  ['a repeated flag', ['marker', 'advance', '--to', T, '--to', T, '--run', 'r1'], /--to given more than once/],
  ['a trailing --repo', ['marker', 'read', '--repo'], /--repo requires a value/],
  ['an empty --marker-json', ['marker', 'read', '--marker-json', ''], /--marker-json requires a value/],
  // The reset commit message must fit the store's 200-character rule: a valid run id
  // and a valid reason can still overflow it together.
  ['a reset whose --run and --reason overflow the commit-message budget', ['marker', 'reset', '--to', T, '--run', 'r'.repeat(128), '--force', '--reason', 'x'.repeat(200)], /200-character commit-message budget/],
  ['an unforced reset whose --run alone overflows the budget', ['marker', 'reset', '--to', T, '--run', 'r'.repeat(128)], /200-character commit-message budget/],
];
for (const [label, argv, expected] of USAGE_CASES) {
  test(`usage: ${label} -> exit 2, zero gh, git, origin and file calls`, () => {
    const h = harness();
    const r = call(argv, h);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^release-state\.js: /);
    assert.match(r.stderr.split('\n')[0], expected);
    assert.ok(r.stderr.endsWith(USAGE), 'the usage follows the reason');
    silent(h);
  });
}

test('usage: an overflowing reset names the 200-character commit-message budget', () => {
  const r = call(['marker', 'reset', '--to', T, '--run', 'r'.repeat(128), '--force', '--reason', 'x'.repeat(200)], harness());
  assert.match(r.stderr, /200-character commit-message budget/);
});

test('usage: the longest reset that fits is accepted and reaches the store', () => {
  // 128-char run, unforced: 202 > 200, so shorten the run until the composed message is exactly 200.
  const run = 'r'.repeat(126);
  const h = harness({ world: makeWorld({ marker: markerText(OFF) }) });
  const r = call(['marker', 'reset', '--to', LINE[3], '--run', run], h);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(h.world.puts.length, 1);
  assert.equal(h.world.puts[0].message.length, 200);
});

// ---- --reason-file: a forced reset's free-text reason, read from a file so no shell expands it ----

const REASON_PATH = `/work${path.sep}reason.txt`;
const FORCED_FILE = ['marker', 'reset', '--to', LINE[3], '--run', 'r9', '--force', '--reason-file', 'reason.txt'];
// A harness whose readFile serves `text` (or throws, for null) and records each path it was asked for.
function reasonFileHarness(text) {
  const h = harness({ world: ON_LINE() });
  h.deps.readFile = (p) => {
    h.calls.readFile.push(p);
    if (text === null) throw Object.assign(new Error(`EACCES: permission denied, open '${p}'`), { code: 'EACCES' });
    return text;
  };
  return h;
}

test('--reason-file: $(…), a backtick and " in the reason reach the commit message verbatim', () => {
  const reason = 'rewound by `id` and $(touch x) — "quoted" $HOME';
  const h = reasonFileHarness(`${reason}\n`);
  const r = call(FORCED_FILE, h);
  assert.deepEqual([r.code, r.stderr], [0, '']);
  assert.equal(r.stdout, `{"reset":true,"from":"${LINE[1]}","to":"${LINE[3]}","basis":"forced"}\n`);
  assert.deepEqual(h.calls.readFile, [REASON_PATH], 'read relative to the cwd');
  assert.equal(h.world.puts.length, 1);
  assert.equal(h.world.puts[0].message, `Reset reviewed-through from ${short12(LINE[1])} to ${short12(LINE[3])} — run r9 — forced: ${reason}`);
});

test('--reason-file: exactly one trailing CRLF is stripped', () => {
  const h = reasonFileHarness('history rewritten by hand\r\n');
  assert.equal(call(FORCED_FILE, h).code, 0);
  assert.ok(h.world.puts[0].message.endsWith('— forced: history rewritten by hand'), h.world.puts[0].message);
});

const REASON_FILE_REFUSALS = [
  ['an unreadable file', null, FORCED_FILE, /could not read --reason-file reason\.txt \(EACCES/],
  ['a reason with #', 'fix #12\n', FORCED_FILE, /--reason-file reason\.txt must match/],
  ['an interior newline', 'one\ntwo\n', FORCED_FILE, /--reason-file reason\.txt must match/],
  ['two trailing newlines (only one is the file\'s)', 'one\n\n', FORCED_FILE, /--reason-file reason\.txt must match/],
  ['a reason over 200 characters', `${'x'.repeat(201)}\n`, FORCED_FILE, /--reason-file reason\.txt must match/],
  ['a reason that overflows the commit-message budget', `${'x'.repeat(200)}\n`, ['marker', 'reset', '--to', LINE[3], '--run', 'r'.repeat(128), '--force', '--reason-file', 'reason.txt'], /200-character commit-message budget — shorten --run or --reason-file reason\.txt/],
  ['a blank file', '\n', FORCED_FILE, /--reason-file reason\.txt must hold a reason that is not blank/],
  ['a reason with a leading dash', '-x\n', FORCED_FILE, /--reason-file reason\.txt must hold a reason .* does not start with "-"/],
];
for (const [label, text, argv, expected] of REASON_FILE_REFUSALS) {
  test(`--reason-file: ${label} -> exit 2, the usage, no write and zero gh, git or origin calls`, () => {
    const h = reasonFileHarness(text);
    const r = call(argv, h);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr.split('\n')[0], expected);
    assert.ok(r.stderr.endsWith(USAGE), 'the usage follows the reason');
    assert.deepEqual(h.calls.readFile, [REASON_PATH]);
    assert.deepEqual([h.calls.gh, h.calls.git, h.calls.remote, h.world.puts], [[], [], 0, []]);
  });
}

const REASON_FILE_ARGV_REFUSALS = [
  ['--reason with --reason-file', [...FORCED_FILE, '--reason', REASON], /--reason and --reason-file are mutually exclusive/],
  ['--reason-file without --force', ['marker', 'reset', '--to', LINE[3], '--run', 'r9', '--reason-file', 'reason.txt'], /--reason-file is only valid with --force/],
  ['--reason-file on advance', ['marker', 'advance', '--to', LINE[3], '--run', 'r9', '--reason-file', 'reason.txt'], /--reason-file is not valid for marker advance/],
];
for (const [label, argv, expected] of REASON_FILE_ARGV_REFUSALS) {
  test(`usage: ${label} -> exit 2 before the file is read`, () => {
    const h = reasonFileHarness('history rewritten by hand\n');
    const r = call(argv, h);
    assert.equal(r.code, 2);
    assert.match(r.stderr.split('\n')[0], expected);
    assert.ok(r.stderr.endsWith(USAGE), 'the usage follows the reason');
    silent(h);
  });
}

test('--help anywhere prints the usage on stdout and exits 0 with no call', () => {
  const h = harness();
  const r = call(['marker', 'advance', '--help'], h);
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, USAGE, '']);
  silent(h);
});

test('a repo that cannot be resolved is a usage failure before any gh call', () => {
  const h = harness({ origin: null });
  const r = call(['marker', 'read'], h);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /could not resolve owner\/repo/);
  assert.deepEqual(h.calls.gh, []);
  for (const bad of ['o/r?x', 'o/..', 'x', 'o/r/extra/more', 'o/r~1', 'o/r:x', 'o/a b']) {
    const again = harness();
    assert.equal(call(['marker', 'read', '--repo', bad], again).code, 2, bad);
    assert.deepEqual(again.calls.gh, [], bad);
  }
});

test('a slug the store refuses is exit 2 at the CLI: one rule, the store\'s own predicate', () => {
  const { isBareSlug } = require('../../../plugin/bin/lib/release-state/store');
  for (const slug of ['o/..', 'o/r~1', 'o/r:x', 'o/a b', 'o/r?x']) {
    assert.equal(isBareSlug(slug), false, slug);
    const h = harness();
    assert.equal(call(['marker', 'read', '--repo', slug], h).code, 2, slug);
    assert.deepEqual(h.calls.gh, [], slug);
  }
  assert.equal(isBareSlug('o/r'), true);
});

// ---- the repo, the host and the branch: a typed repo other than the origin gets no local git ----

test('repo: --repo other/x with origin acme/widgets uses no local git', () => {
  const h = harness({ world: makeWorld({ slug: 'other/x', marker: markerText(LINE[1]) }), origin: 'https://github.com/acme/widgets.git' });
  const r = call(['marker', 'advance', '--to', LINE[3], '--run', 'r2', '--repo', 'other/x'], h);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(h.calls.git.filter((a) => a[0] === 'fetch' || a[0] === 'push'), []);
  assert.deepEqual(h.calls.git, [], 'no git call of any kind');
  assert.ok(h.calls.gh.some((a) => a.includes('repos/other/x/git/ref/heads/main')), 'the compare tip read ran');
  assert.ok(h.calls.gh.every((a) => a.find((x) => String(x).startsWith('repos/')).startsWith('repos/other/x')), 'every call targets the typed repo');
  assert.equal(h.world.puts.length, 1);
  assert.equal(h.world.puts[0].branch, 'release-state');
});

test('repo: a clone whose origin is the target is used (a fetch of the history)', () => {
  const calls = [];
  const h = harness({
    world: makeWorld({ marker: markerText(LINE[1]) }),
    deps: { git: (args) => { calls.push(args); if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true\n'; throw new Error('stop'); } },
  });
  call(['marker', 'read'], h);
  assert.deepEqual(calls[0], ['rev-parse', '--is-inside-work-tree']);
  assert.ok(calls.some((a) => a[0] === 'fetch' && a.includes('origin')), 'the store tried the local fetch first');
});

test('repo: a typed --repo naming the origin repo keeps the local clone', () => {
  const calls = [];
  const h = harness({
    world: makeWorld({ slug: 'O/R', marker: markerText(LINE[1]) }),
    deps: { git: (args) => { calls.push(args); if (args[1] === '--is-inside-work-tree') return 'true\n'; throw new Error('stop'); } },
  });
  assert.equal(call(['marker', 'read', '--repo', 'O/R'], h).code, 0);
  assert.ok(calls.some((a) => a[0] === 'fetch'), 'the local clone was tried first');
});

test('repo: outside a work tree there is no local history either', () => {
  const h = harness({ world: ON_LINE() });
  const r = call(['marker', 'read'], h);
  assert.equal(r.code, 0);
  assert.deepEqual(h.calls.git, [['rev-parse', '--is-inside-work-tree']]);
});

test('repo: --hostname rides every gh api call off github.com, never on github.com', () => {
  const ghe = harness({ world: ON_LINE() });
  assert.equal(call(['marker', 'advance', '--to', LINE[3], '--run', 'r2', '--repo', 'ghe.example.com/o/r'], ghe).code, 0);
  assert.ok(ghe.calls.gh.length >= 3);
  for (const args of ghe.calls.gh) {
    assert.deepEqual(args.slice(-2), ['--hostname', 'ghe.example.com'], args.join(' '));
    assert.ok(args.some((a) => String(a).startsWith('repos/o/r')), 'the REST path keeps the bare slug');
  }
  assert.equal(ghe.calls.pin.length, 1);
  assert.deepEqual([ghe.calls.pin[0].host, ghe.calls.pin[0].owner, ghe.calls.pin[0].repo], ['ghe.example.com', 'o', 'r']);

  const dotcom = harness({ world: ON_LINE() });
  assert.equal(call(['marker', 'advance', '--to', LINE[3], '--run', 'r2', '--repo', 'o/r'], dotcom).code, 0);
  assert.ok(dotcom.calls.gh.length >= 3);
  for (const args of dotcom.calls.gh) assert.ok(!args.includes('--hostname'), args.join(' '));
  assert.equal(dotcom.calls.pin.length, 1);

  const origin = harness({ world: ON_LINE(), origin: 'https://github.com/o/r.git' });
  call(['marker', 'read'], origin);
  assert.equal(origin.calls.pin.length, 0, 'pinGhHost is for an explicit --repo only');
});

test('repo: a host-qualified origin that is known routes its calls by --hostname', () => {
  const h = harness({ world: ON_LINE(), origin: 'https://acme.ghe.com/o/r.git' });
  assert.equal(call(['marker', 'read'], h).code, 0);
  for (const args of h.calls.gh) assert.deepEqual(args.slice(-2), ['--hostname', 'acme.ghe.com'], args.join(' '));
});

test('repo: an unknown origin host is refused before any gh call', () => {
  const h = harness({ origin: 'https://git.corp.invalid/o/r.git' });
  const r = call(['marker', 'read'], h);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /git\.corp\.invalid/);
  assert.deepEqual(h.calls.gh, []);
  assert.deepEqual(h.calls.git, []);
});

test('--branch trunk reaches the history fetch and the compare tip read', () => {
  const fx = makeLine({ branch: 'trunk' });
  const gitCalls = [];
  const env = { ...cleanGitEnv(), ...pinnedGitEnv() };
  delete env.GH_HOST;
  const local = runCliSync(CLI, ['marker', 'init', '--to', fx.P2, '--branch', 'trunk'], {
    cwd: fx.cloneA,
    env,
    deps: {
      remoteUrl: () => 'https://github.com/o/r.git',
      cwd: () => fx.cloneA,
      git: (args, o) => { gitCalls.push(args); return realDeps.git(args, o); },
      gh: (args) => { throw new Error(`unexpected ${args.join(' ')}`); },
      now: () => NOW,
      sleep: () => {},
    },
  });
  assert.equal(local.code, 0, local.stderr);
  assert.ok(gitCalls.some((a) => a[0] === 'fetch' && a.some((x) => String(x).startsWith('+refs/heads/trunk:refs/release-state-history/'))), 'the history fetch names trunk');

  const h = harness({ world: ON_LINE() });
  assert.equal(call(['marker', 'advance', '--to', LINE[3], '--run', 'r2', '--branch', 'trunk'], h).code, 0);
  assert.ok(h.calls.gh.some((a) => a.includes('repos/o/r/git/ref/heads/trunk')), 'the compare tip read names trunk');
  assert.ok(!h.calls.gh.some((a) => a.some((x) => String(x).endsWith('/heads/main'))));
});

test('realDeps.gh carries the GH_TIMEOUT_MS bound', () => {
  const modulePath = require.resolve('../../../plugin/bin/release-state');
  const seen = captureGhTimeout({
    envValue: '45000',
    modulePaths: [modulePath],
    exercise: (setEnv) => {
      setEnv();
      const fresh = require('../../../plugin/bin/release-state');
      fresh.realDeps.gh(['api', 'repos/o/r']);
    },
  });
  assert.equal(seen, 45000);
});

// ---- emit mode: no gh, no repo resolution, local history only ----

function emitHarness(fx, files = {}, clone = fx.cloneA) {
  const calls = {
    gh: [], git: [], pin: [], remote: 0, read: [],
  };
  const env = { ...cleanGitEnv(), ...pinnedGitEnv() };
  delete env.GH_HOST;
  const table = new Map(Object.entries(files).map(([name, text]) => [path.join(clone, name), text]));
  const deps = {
    cwd: () => clone,
    git: (args, o) => { calls.git.push(args); return realDeps.git(args, o); },
    gh: (args) => { calls.gh.push(args); throw new Error(`unexpected ${args.join(' ')}`); },
    remoteUrl: () => { calls.remote += 1; throw new Error('unexpected remoteUrl'); },
    pinGhHost: (spec) => { calls.pin.push(spec); },
    readFile: (p) => {
      calls.read.push(p);
      if (table.has(p)) return table.get(p);
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' });
    },
    now: () => NOW,
    sleep: () => {},
  };
  // The tests below reach the file through a relative path under the injected cwd, which is not
  // the process's own.
  const run = (argv) => {
    const r = runCliSync(CLI, argv, { cwd: clone, env, deps });
    assert.deepEqual(calls.gh, [], 'no gh call');
    assert.equal(calls.remote, 0, 'no repo resolution');
    assert.deepEqual(calls.pin, []);
    return r;
  };
  return { run, calls };
}

const readFileOf = (sha, blob = BLOB, run = 'r1') => JSON.stringify({ content: markerText(sha, run), sha: blob });

test('emit mode: an advance prints a write descriptor leased on the file\'s blob sha', () => {
  const fx = makeLine();
  const { run, calls } = emitHarness(fx, { 'm.json': readFileOf(fx.P1) });
  const r = run(['marker', 'advance', '--to', fx.P3, '--run', 'r1', '--marker-json', 'm.json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, `${JSON.stringify({
    write: {
      branch: 'release-state',
      path: 'reviewed-through.json',
      content: serializeMarker({ sha: fx.P3, advancedAt: NOW.toISOString(), run: 'r1' }),
      sha: BLOB,
      message: `Advance reviewed-through to ${short12(fx.P3)} from ${short12(fx.P1)} — run r1`,
    },
  })}\n`);
  assert.deepEqual(calls.read, [path.join(fx.cloneA, 'm.json')], 'the relative path resolved against the injected cwd');
});

test('emit mode: an advance that is already satisfied prints its normal line and no write', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': readFileOf(fx.P3) });
  const same = run(['marker', 'advance', '--to', fx.P3, '--run', 'r1', '--marker-json', 'm.json']);
  assert.deepEqual([same.code, same.stdout], [0, `{"advanced":false,"sha":"${fx.P3}","reason":"same"}\n`]);
  const back = run(['marker', 'advance', '--to', fx.P2, '--run', 'r1', '--marker-json', 'm.json']);
  assert.equal(back.code, 1);
  assert.equal(back.stdout, '');
});

// ---- --after-conflict: the MCP path's at-or-past check after a lost PUT ----

const AFTER = (fx, extra = []) => ['marker', 'advance', '--to', fx.P3, '--run', 'r1', '--marker-json', 'm.json', '--after-conflict', ...extra];

test('after-conflict: a fresh marker at the target is at-or-past, exit 0, no write', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': readFileOf(fx.P3) });
  const r = run(AFTER(fx));
  assert.deepEqual([r.code, r.stdout], [0, `{"advanced":false,"sha":"${fx.P3}","reason":"at-or-past"}\n`]);
});

test('after-conflict: a fresh marker past the target is at-or-past, exit 0, no write', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': readFileOf(fx.P5) });
  const r = run(AFTER(fx));
  assert.deepEqual([r.code, r.stdout], [0, `{"advanced":false,"sha":"${fx.P5}","reason":"at-or-past"}\n`]);
  // Without the flag the same file is a backward move: refused.
  const plain = run(['marker', 'advance', '--to', fx.P3, '--run', 'r1', '--marker-json', 'm.json']);
  assert.equal(plain.code, 1);
});

test('after-conflict: a fresh marker behind the target gets a write descriptor leased on the fresh blob', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': readFileOf(fx.P1, 'e'.repeat(40)) });
  const r = run(AFTER(fx));
  assert.equal(r.code, 0, r.stderr);
  const { write } = JSON.parse(r.stdout);
  assert.equal(write.sha, 'e'.repeat(40));
  assert.equal(write.message, `Advance reviewed-through to ${short12(fx.P3)} from ${short12(fx.P1)} — run r1`);
});

test('after-conflict: the recheck and the advance each load a history of their own, never a shared one', () => {
  const fx = makeLine();
  const { run, calls } = emitHarness(fx, { 'm.json': readFileOf(fx.P1, 'e'.repeat(40)) });
  const r = run(AFTER(fx));
  assert.equal(r.code, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).write, 'the recheck fell through to an advance');
  // One branch fetch per history. A shared history would hand the advance the recheck's
  // snapshot (one fetch in all), and with it any refresh the recheck had spent.
  const historyFetches = (c) => c.git.filter((a) => a[0] === 'fetch' && a.some((x) => String(x).includes(':refs/release-state-history/'))).length;
  assert.equal(historyFetches(calls), 2);
  const plain = emitHarness(fx, { 'm.json': readFileOf(fx.P1, 'e'.repeat(40)) });
  assert.equal(plain.run(['marker', 'advance', '--to', fx.P3, '--run', 'r1', '--marker-json', 'm.json']).code, 0);
  assert.equal(historyFetches(plain.calls), 1, 'a lone advance loads one history');
});

test('after-conflict: a vanished marker (null file) is contested, exit 4', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': 'null' });
  const r = run(AFTER(fx));
  assert.equal(r.code, 4);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^release-state\.js: contested — the marker disappeared/);
});

test('after-conflict: a fresh marker that is unreadable stays unreadable, exit 3', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': JSON.stringify({ content: '{', sha: 'c'.repeat(40) }) });
  const r = run(AFTER(fx));
  assert.equal(r.code, 3);
  assert.equal(r.stdout, '');
});

test('emit mode: a null file is no marker (read: absent; advance: refused)', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': 'null' });
  assert.deepEqual(run(['marker', 'read', '--marker-json', 'm.json']).stdout, '{"absent":true}\n');
  const adv = run(['marker', 'advance', '--to', fx.P3, '--run', 'r1', '--marker-json', 'm.json']);
  assert.equal(adv.code, 1);
  assert.match(adv.stderr, /^release-state\.js: refused — no marker/);
});

test('emit mode: a recorded read prints the marker', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': readFileOf(fx.P2) });
  const r = run(['marker', 'read', '--marker-json', 'm.json']);
  assert.deepEqual([r.code, r.stdout], [0, `{"version":1,"sha":"${fx.P2}","advancedAt":"${THEN}","run":"r1"}\n`]);
});

const BAD_HANDOFFS = [
  ['an error object', JSON.stringify({ failure: 'x' })],
  ['{content} without sha', JSON.stringify({ content: markerText(LINE[1]) })],
  ['{sha} without content', JSON.stringify({ sha: BLOB })],
  ['a non-string content', JSON.stringify({ content: 5, sha: BLOB })],
  ['a short sha', JSON.stringify({ content: markerText(LINE[1]), sha: 'b'.repeat(39) })],
  ['a failure beside a read', JSON.stringify({ content: markerText(LINE[1]), sha: BLOB, failure: 'x' })],
  ['an MCP error wrapper', JSON.stringify({ message: 'Not Found', status: '404' })],
  ['an empty object', '{}'],
  ['a bare string', JSON.stringify('str')],
  ['an array', '[]'],
  ['a number', '0'],
  ['unparseable text', 'not json'],
  ['an empty file', ''],
];
for (const verb of [['read'], ['advance', '--to', LINE[3], '--run', 'r1']]) {
  for (const [label, text] of BAD_HANDOFFS) {
    test(`emit mode (${verb[0]}): ${label} is exit 3, never absent and never a marker`, () => {
      const fx = makeLine();
      const { run } = emitHarness(fx, { 'm.json': text });
      const r = run(['marker', ...verb, '--marker-json', 'm.json']);
      assert.equal(r.code, 3);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /^release-state\.js: unreadable — /);
    });
  }
  test(`emit mode (${verb[0]}): a missing file is exit 3`, () => {
    const fx = makeLine();
    const { run } = emitHarness(fx);
    const r = run(['marker', ...verb, '--marker-json', 'absent.json']);
    assert.equal(r.code, 3);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /could not read absent\.json \(ENOENT: no such file or directory, open 'absent\.json'\)/, 'the path is spelled as typed');
  });
}

test('emit mode: init --emit prints a create descriptor with sha null', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx);
  const r = run(['marker', 'init', '--to', fx.P1, '--emit']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `${JSON.stringify({
    write: {
      branch: 'release-state',
      path: 'reviewed-through.json',
      content: serializeMarker({ sha: fx.P1, advancedAt: NOW.toISOString(), run: 'init' }),
      sha: null,
      message: `Initialize reviewed-through at ${short12(fx.P1)}`,
    },
  })}\n`);
});

test('emit mode: an init target off the first-parent line is refused, with no descriptor', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx);
  const r = run(['marker', 'init', '--to', fx.S, '--emit']);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
});

test('emit mode: a shallow clone that misses the marker is insufficient-history (5), never a gh call', () => {
  const fx = makeLine();
  const shallow = shallowClone(fx, 1);
  const { run } = emitHarness(fx, { 'm.json': readFileOf(fx.P1) }, shallow);
  const r = run(['marker', 'advance', '--to', fx.P5, '--run', 'r1', '--marker-json', 'm.json']);
  assert.equal(r.code, 5);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^release-state\.js: insufficient-history — /);
});

test('AC8.6: a malformed marker is recoverable on the MCP path', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': JSON.stringify({ content: '{', sha: 'c'.repeat(40) }) });
  const forced = run(['marker', 'reset', '--to', fx.P3, '--run', 'r1', '--force', '--reason', 'history rewritten by hand', '--marker-json', 'm.json']);
  assert.equal(forced.code, 0, forced.stderr);
  const { write } = JSON.parse(forced.stdout);
  assert.equal(write.sha, 'c'.repeat(40));
  assert.equal(write.content, serializeMarker({ sha: fx.P3, advancedAt: NOW.toISOString(), run: 'r1' }));
  assert.ok(write.message.endsWith('forced: history rewritten by hand'), write.message);
  assert.equal(write.message, `Reset reviewed-through from unreadable to ${short12(fx.P3)} — run r1 — forced: history rewritten by hand`);

  const plain = run(['marker', 'reset', '--to', fx.P3, '--run', 'r1', '--marker-json', 'm.json']);
  assert.equal(plain.code, 3);
  assert.equal(plain.stdout, '');
  assert.match(plain.stderr, /--force --reason/);
  assert.equal(run(['marker', 'read', '--marker-json', 'm.json']).code, 3);
});

test('emit mode: a reset over a readable marker prints the descriptor leased on its blob', () => {
  const fx = makeLine();
  const { run } = emitHarness(fx, { 'm.json': readFileOf(fx.P1, 'd'.repeat(40)) });
  const r = run(['marker', 'reset', '--to', fx.P3, '--run', 'r1', '--force', '--reason', 'history rewritten by hand', '--marker-json', 'm.json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).write.sha, 'd'.repeat(40));
});

test('emit mode: --branch trunk reaches the local history', () => {
  const fx = makeLine({ branch: 'trunk' });
  const { run } = emitHarness(fx, { 'm.json': readFileOf(fx.P1) });
  const on = run(['marker', 'advance', '--to', fx.P3, '--run', 'r1', '--branch', 'trunk', '--marker-json', 'm.json']);
  assert.equal(on.code, 0, on.stderr);
  // The default branch `main` does not exist in this fixture: the same call is undetermined.
  const off = run(['marker', 'advance', '--to', fx.P3, '--run', 'r1', '--marker-json', 'm.json']);
  assert.equal(off.code, 5);
});
