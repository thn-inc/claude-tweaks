'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { run } = require('../plugin/bin/backlog-grant-gate');

// The only three gh fetches this CLI makes, keyed by args[3]: the
// ready-labeled candidate pool, the parent-issue pull, and the historical
// `--state all` record set. Anything else is an unexpected call and fails
// the test loudly rather than returning a plausible empty page.
function stubGh(args) {
  if (['ready', 'parent-issue', 'all'].includes(args[3])) return JSON.stringify([]);
  throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
}

function deps(overrides = {}) {
  const calls = [];
  const d = {
    ghAvailable: () => true,
    readPolicyRaw: () => 'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: body-text\nintegration-branch: main\n',
    runner: (args) => {
      calls.push(args);
      return stubGh(args);
    },
    gitRunner: () => '',
    out: [], err: [],
    stdout(s) { this.out.push(s); }, stderr(s) { this.err.push(s); },
    ...overrides,
  };
  d.calls = calls;
  return d;
}

test('--help prints usage and exits 0, no gh check', () => {
  const d = deps({ ghAvailable: () => { throw new Error('should not be called'); } });
  assert.strictEqual(run(['--help'], d), 0);
  assert.match(d.out.join(''), /usage: backlog-grant-gate\.js/);
});

test('unknown flag is malformed — exit 2, no gh check', () => {
  const d = deps({ ghAvailable: () => { throw new Error('should not be called'); } });
  assert.strictEqual(run(['--bogus'], d), 2);
  assert.match(d.err.join(''), /unknown argument/);
});

test('gh absent exits 2', () => {
  const d = deps({ ghAvailable: () => false });
  assert.strictEqual(run([], d), 2);
  assert.match(d.err.join(''), /`gh` is required/);
});

test('ceiling not unattended short-circuits before any gh call', () => {
  const d = deps({
    readPolicyRaw: () => 'autonomy: supervised\n',
    runner: () => { throw new Error('should not be called'); },
  });
  assert.strictEqual(run([], d), 0);
  const out = JSON.parse(d.out.join(''));
  assert.strictEqual(out.shortcut, 'ceiling-gate');
});

test('ceiling clears, opt-in unset, still short-circuits (both must hold)', () => {
  const d = deps({ readPolicyRaw: () => 'autonomy: unattended\n' });
  assert.strictEqual(run([], d), 0);
  const out = JSON.parse(d.out.join(''));
  assert.strictEqual(out.shortcut, 'ceiling-gate');
});

test('happy path (no candidates, no records) prints the zero-candidate envelope, exit 0', () => {
  const d = deps();
  assert.strictEqual(run([], d), 0);
  const out = JSON.parse(d.out.join(''));
  assert.strictEqual(out.shortcut, 'zero-eligible');
  assert.deepStrictEqual(out.candidates, []);
  assert.deepStrictEqual(out.eligible, []);
});

test('--limit overrides the resolved backlog-fetch-limit', () => {
  const d = deps({
    runner: (args) => {
      assert.ok(args.includes('7'), `expected --limit 7 in ${JSON.stringify(args)}`);
      return stubGh(args);
    },
  });
  assert.strictEqual(run(['--limit', '7'], d), 0);
});

test('malformed --limit is rejected — exit 2', () => {
  const d = deps({ ghAvailable: () => { throw new Error('should not be called'); } });
  assert.strictEqual(run(['--limit', 'abc'], d), 2);
});

test('--repo owner/.. under work-links: native is rejected before any REST call (#1443: parseRepo accepts ".." segments)', () => {
  const d = deps({
    readPolicyRaw: () => 'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: native\nintegration-branch: main\n',
    runner: () => { throw new Error('should not be called'); },
  });
  assert.strictEqual(run(['--repo', 'owner/..'], d), 2);
  assert.match(d.err.join(''), /invalid --repo value/);
  assert.deepStrictEqual(d.calls, []);
});

// #4933: the origin-derived spec passes the host gate and then meets the same guard.
test('an origin whose owner is ".." under work-links: native is rejected after the host gate, before any REST call', () => {
  const d = deps({
    readPolicyRaw: () => 'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: native\nintegration-branch: main\n',
    remoteUrl: () => 'git@github.com:../r.git',
    runner: () => { throw new Error('should not be called'); },
  });
  assert.strictEqual(run([], d), 2);
  assert.match(d.err.join(''), /invalid --repo value/);
  assert.deepStrictEqual(d.calls, []);
});

test('--repo ../evil under work-links: native is rejected before any REST call', () => {
  const d = deps({
    readPolicyRaw: () => 'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: native\nintegration-branch: main\n',
    runner: () => { throw new Error('should not be called'); },
  });
  assert.strictEqual(run(['--repo', '../evil'], d), 2);
  assert.match(d.err.join(''), /invalid --repo value/);
  assert.deepStrictEqual(d.calls, []);
});

// #2444 review fix: a caller-supplied --repo can itself already be a
// host-qualified `host/owner/repo` slug (repoSlug()'s GHE output) — before
// this fix, --repo was always prefixed with `github.com/` regardless of
// shape, producing an unparseable 4-segment string (parseRepo's regex
// expects exactly host/owner/repo) that failed with "could not resolve
// owner/repo" even though a valid slug was supplied.
test('#2444 fix: a host-qualified --repo slug under work-links: native resolves cleanly (not rejected as unparseable)', () => {
  const d = deps({
    readPolicyRaw: () => 'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: native\nintegration-branch: main\n',
  });
  const code = run(['--repo', 'ghe.example.com/acme/widgets'], d);
  assert.strictEqual(code, 0);
  const out = JSON.parse(d.out.join(''));
  assert.strictEqual(out.shortcut, 'zero-eligible');
});

test('#2444 fix: a bare --repo owner/repo under work-links: native still resolves to github.com (unchanged)', () => {
  const d = deps({
    readPolicyRaw: () => 'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: native\nintegration-branch: main\n',
  });
  const code = run(['--repo', 'acme/widgets'], d);
  assert.strictEqual(code, 0);
  const out = JSON.parse(d.out.join(''));
  assert.strictEqual(out.shortcut, 'zero-eligible');
});

test('a required gh fetch failure exits 1 and names the error', () => {
  const d = deps({
    runner: () => { throw new Error('gh: connection reset'); },
  });
  assert.strictEqual(run([], d), 1);
  assert.match(d.err.join(''), /connection reset/);
});

test('integration-branch unresolved from policy falls back to git rev-parse origin/HEAD', () => {
  const gitCalls = [];
  const d = deps({
    readPolicyRaw: () => 'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: body-text\n',
    gitRunner: (args) => {
      gitCalls.push(args);
      if (args[0] === 'rev-parse') return 'origin/main\n';
      return ''; // the subsequent `git log {branch} ...` call inside fetchGitLog
    },
  });
  assert.strictEqual(run([], d), 0);
  const out = JSON.parse(d.out.join(''));
  assert.strictEqual(out.shortcut, 'zero-eligible');
  assert.deepStrictEqual(gitCalls[0], ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  assert.deepStrictEqual(gitCalls[1], ['log', 'main', '--format=%H%x1f%B%x1e']);
});

test('native work-links with no --repo and no resolvable remote exits 2', () => {
  const d = deps({
    readPolicyRaw: () => 'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: native\nintegration-branch: main\n',
    remoteUrl: () => { throw new Error('no remote'); },
  });
  assert.strictEqual(run([], d), 2);
  assert.match(d.err.join(''), /could not resolve owner\/repo/);
});

// --- Trust policy plumbing: policy.yml -> resolvePolicyKeys -> computeOutlook -> trustRows (#5291) ---
// The CLI reads every trust key from the project policy and hands them to trustRows.
// Each case runs on the same closed records and flips one policy line.

const DAY_MS = 24 * 60 * 60 * 1000;
const CLASS_KEY = 'producer:code-health|low';
const UNATTENDED = 'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: body-text\nintegration-branch: main\n';

function closedRecord(number, { daysAgo, labels = ['by:code-health', 'risk:low'] }) {
  return {
    number, title: 't', body: '', labels: labels.map((name) => ({ name })), state: 'CLOSED',
    closedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
  };
}

// The record snapshot is keyed on CLAUDE_CODE_SESSION_ID; a fresh one on this
// machine would answer the `--state all` fetch before the stub does.
function trustRowOf(policyLines, records, gitLog = '') {
  const saved = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  try {
    const d = deps({
      readPolicyRaw: () => UNATTENDED + policyLines,
      runner: (args) => {
        if (args[3] === 'ready') return JSON.stringify([{ number: 1, title: 'c', body: '', labels: [{ name: 'by:code-health' }, { name: 'ready' }, { name: 'risk:low' }], createdAt: '2026-01-01T00:00:00Z' }]);
        if (args[3] === 'all') return JSON.stringify(records);
        return JSON.stringify([]);
      },
      gitRunner: () => gitLog,
    });
    assert.strictEqual(run([], d), 0, d.err.join(''));
    return JSON.parse(d.out.join('')).trustRows.find((r) => r.key === CLASS_KEY) || null;
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = saved;
  }
}

const UNDISPOSITIONED = Array.from({ length: 8 }, (_, i) => closedRecord(100 + i, { daysAgo: 20 }));
const CLOSING_LOG = UNDISPOSITIONED.map((r, i) => `sha${i}\x1fShip it\n\nrefs #${r.number}\x1e`).join('\n');

test('trust-revert-window-days from policy.yml reaches trustRows: a closing commit ages into operational evidence only past the window', () => {
  assert.strictEqual(trustRowOf('', UNDISPOSITIONED, CLOSING_LOG).verdict, 'clean');
  assert.strictEqual(trustRowOf('trust-revert-window-days: 14\n', UNDISPOSITIONED, CLOSING_LOG).verdict, 'clean');
  const longer = trustRowOf('trust-revert-window-days: 30\n', UNDISPOSITIONED, CLOSING_LOG);
  assert.strictEqual(longer.verdict, 'insufficient-evidence');
  assert.strictEqual(longer.operationalGood, 0);
});

test('trust-evaluation-window-days from policy.yml reaches trustRows: records older than the window form no cell', () => {
  assert.strictEqual(trustRowOf('', UNDISPOSITIONED, CLOSING_LOG).total, 8);
  assert.strictEqual(trustRowOf('trust-evaluation-window-days: 25\n', UNDISPOSITIONED, CLOSING_LOG).total, 8);
  assert.strictEqual(trustRowOf('trust-evaluation-window-days: 10\n', UNDISPOSITIONED, CLOSING_LOG), null);
});

test('trust-follow-up-rate-max-percent from policy.yml reaches trustRows: 2 of 8 records drew a follow-up', () => {
  const approved = Array.from({ length: 8 }, (_, i) => closedRecord(200 + i, { daysAgo: 5, labels: ['by:code-health', 'risk:low', 'demo:approved'] }));
  const followUps = [200, 201].map((n, i) => ({
    number: 300 + i, title: 'f', body: `Origin: demo changes-requested from #${n}`, labels: [], state: 'OPEN', closedAt: null,
  }));
  const records = [...approved, ...followUps];
  const atDefault = trustRowOf('', records);
  assert.strictEqual(atDefault.verdict, 'clean');
  assert.strictEqual(atDefault.followUpRateMaxPercent, 30);
  assert.strictEqual(trustRowOf('trust-follow-up-rate-max-percent: 25\n', records).verdict, 'clean');
  const strict = trustRowOf('trust-follow-up-rate-max-percent: 24\n', records);
  assert.strictEqual(strict.verdict, 'mixed');
  assert.deepStrictEqual(strict.mixedReasons, ['follow-up-rate']);
  assert.strictEqual(strict.followUpRateMaxPercent, 24);
});
