// tests/merge-watch-ready-run.test.js — #5153 AC7.1: the Step 2.5 bounded watch's 0) arm re-runs
// bin/ready-run.js and keeps watching while the read is `awaiting`. Extract-and-run: the fence is
// pulled out of the live pr-first-merge.md by a structural anchor (the **Bounded watch (** heading
// and the next bash fence), every {placeholder} is substituted literally, and exactly that string
// runs under bash and (when present) zsh against shell-function stubs for gh/sleep/date and a stub
// bin/ready-run.js reached through CLAUDE_PLUGIN_ROOT. Observable outcome = the RC the fence leaves
// plus how many times the stub CLI was called.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const GATE = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'pr-first-merge.md'));

const WATCH_RE = /\*\*Bounded watch \([^\n]*\n[\s\S]*?```bash\r?\n([\s\S]*?DEADLINE=[\s\S]*?)\r?\n```/;
const PARK_RE = /^[ ]*```bash\r?\n([ ]*printf 'Parked by merge-verification[\s\S]*?)\r?\n[ ]*```/m;
const watchFence = (text) => { const m = WATCH_RE.exec(text); assert.ok(m, 'bounded-watch fence not found'); return m[1]; };
const parkFence = (text) => { const m = PARK_RE.exec(text); assert.ok(m, 'park-comment fence not found'); return m[1]; };

const SHA = 'c'.repeat(40);
const fwd = (p) => p.split(path.sep).join('/');

const STUB_CLI = `'use strict';
const fs = require('fs'); const path = require('path');
const d = process.env.STUB_DIR; const f = path.join(d, 'ready-n');
let n = 0; try { n = Number(fs.readFileSync(f, 'utf8')); } catch (e) { /* first call */ }
fs.writeFileSync(f, String(n + 1));
fs.appendFileSync(path.join(d, 'ready-calls.log'), process.argv.slice(2).join(' ') + '\\n');
const seq = (process.env.READY_SEQ || '').split(',');
const v = seq[Math.min(n, seq.length - 1)];
if (v === '__fail') process.exit(3);
if (v === '__nostate') console.log('{}');
else if (v === '__garbage') console.log('not json');
else console.log(JSON.stringify({ state: v }));
`;

const DATE_STUB = 'date() { n=$(cat "$STUB_DIR/date-n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$STUB_DIR/date-n"; if [ "$n" -eq 1 ] || [ "$DATE_MODE" != jump ]; then echo 1000; else echo 5000; fi; }';
const STUBS = [
  'gh() { case "$1 $2" in "pr checks") return 0;; "run list") echo \'[]\';; esac; }',
  'sleep() { :; }',
  DATE_STUB,
].join('\n');

function hasShell(bin, probe) {
  const r = spawnSync(bin, probe, { encoding: 'utf8', windowsHide: true });
  return !r.error && r.status === 0;
}
const SHELLS = [
  { name: 'bash', bin: 'bash', args: ['--noprofile', '--norc', '-c'], present: hasShell('bash', ['--noprofile', '--norc', '-c', ':']) },
  { name: 'zsh', bin: 'zsh', args: ['-f', '-c'], present: hasShell('zsh', ['-f', '-c', ':']) },
];

// Substitute every placeholder literally against a fresh per-run scratch dir.
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-watch-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'ready-run.js'), STUB_CLI);
  const paths = {
    '{pr-checks-path}': fwd(path.join(dir, 'pr-checks.txt')),
    '{pr-runs-path}': fwd(path.join(dir, 'pr-runs.json')),
    '{pr-ready-path}': fwd(path.join(dir, 'pr-ready.json')),
    '{park-comment-path}': fwd(path.join(dir, 'park-comment.md')),
  };
  return { dir, paths };
}
function substitute(fence, paths) {
  let s = fence.split('{owner}/{repo}').join('o/r');
  s = s.split('{pr-number}').join('7').split('{headRefOid}').join(SHA);
  for (const [k, v] of Object.entries(paths)) s = s.split(k).join(v);
  assert.doesNotMatch(s, /\{[a-z-]+\}/, 'an unsubstituted placeholder survives in the fence');
  return s;
}
function run(shell, script, dir, env) {
  const r = spawnSync(shell.bin, [...shell.args, script], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, STUB_DIR: fwd(dir), CLAUDE_PLUGIN_ROOT: fwd(dir), DATE_MODE: 'flat', ...env },
  });
  assert.equal(r.error, undefined, `${shell.name} failed to spawn`);
  return r;
}
function runWatch(shell, fence, readySeq, extraEnv = {}) {
  const { dir, paths } = sandbox();
  const script = `${STUBS}\n${substitute(fence, paths)}\necho "RC=$RC"`;
  const r = run(shell, script, dir, { READY_SEQ: readySeq, ...extraEnv });
  const m = /^RC=(\d+)$/m.exec(r.stdout);
  assert.ok(m, `${shell.name}: no RC line.\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  let calls = [];
  try { calls = fs.readFileSync(path.join(dir, 'ready-calls.log'), 'utf8').trim().split('\n').filter(Boolean); } catch (e) { /* none */ }
  return { rc: Number(m[1]), calls, stderr: r.stderr };
}

const FENCE = watchFence(GATE);

for (const shell of SHELLS) {
  const t = (name, fn) => test(`${name} [${shell.name}]`, { skip: shell.present ? false : `${shell.name} not on PATH — loop not executed under it` }, fn);

  t('AC7.1: an awaiting ready-run read resumes the watch until met (RC=0 after two ready-run calls)', () => {
    const r = runWatch(shell, FENCE, 'awaiting,met');
    assert.equal(r.rc, 0);
    assert.equal(r.calls.length, 2);
    assert.equal(r.calls[0], `--pr 7 --sha ${SHA}`);
  });

  t('AC7.1: awaiting past the deadline ends RC=124 (checks-pending-timeout)', () => {
    const r = runWatch(shell, FENCE, 'awaiting,awaiting,awaiting', { DATE_MODE: 'jump' });
    assert.equal(r.rc, 124);
    assert.equal(r.calls.length, 1);
  });

  t('red and draft-skip-without-ready-trigger end RC=3', () => {
    for (const state of ['red', 'draft-skip-without-ready-trigger']) {
      const r = runWatch(shell, FENCE, state);
      assert.equal(r.rc, 3, state);
      assert.equal(r.calls.length, 1, state);
    }
  });

  t('read-failed, a failed CLI call, no state and unparseable output end RC=2', () => {
    for (const seq of ['read-failed', '__fail', '__nostate', '__garbage']) {
      const r = runWatch(shell, FENCE, seq);
      assert.equal(r.rc, 2, seq);
    }
  });

  t('met and not-applicable end RC=0 on the first pass', () => {
    for (const state of ['met', 'not-applicable']) {
      const r = runWatch(shell, FENCE, state);
      assert.equal(r.rc, 0, state);
      assert.equal(r.calls.length, 1, state);
    }
  });

  t('go-red controls: removing a loop line flips its observable outcome', () => {
    const awaitingLine = FENCE.split('\n').find((l) => l.includes('[ "$READY" = awaiting ] && PENDING_RUNS=1'));
    assert.ok(awaitingLine, 'the live fence carries the awaiting line');
    const noAwaiting = FENCE.replace(awaitingLine + '\n', '');
    assert.notEqual(noAwaiting, FENCE);
    const base = runWatch(shell, FENCE, 'awaiting,met');
    const mutated = runWatch(shell, noAwaiting, 'awaiting,met');
    assert.equal(base.calls.length, 2);
    assert.equal(mutated.calls.length, 1, 'without the awaiting line the 0) arm breaks green after one call');

    const redLine = FENCE.split('\n').find((l) => l.includes('= red ]'));
    assert.ok(redLine, 'the live fence carries the red line');
    const noRed = FENCE.replace(redLine + '\n', '');
    assert.notEqual(noRed, FENCE);
    assert.equal(runWatch(shell, FENCE, 'red').rc, 3);
    assert.equal(runWatch(shell, noRed, 'red').rc, 0, 'without the red line a red read breaks green');

    // A state-less read must be a failed read: the old extraction printed `undefined` with exit 0.
    const extractLine = FENCE.split('\n').find((l) => l.includes('READY=$(node -e'));
    assert.ok(extractLine && extractLine.includes('||process.exit(2)'), 'the extraction exits non-zero on a missing state');
    const lax = FENCE.replace(extractLine, extractLine.replace('||process.exit(2)', ''));
    assert.notEqual(lax, FENCE);
    assert.equal(runWatch(shell, FENCE, '__nostate').rc, 2);
    assert.notEqual(runWatch(shell, lax, '__nostate').rc, 2, 'a lax extraction reads `undefined` as a state');
  });

  t('AC7.2: the park-comment fence writes the {resume} sentence as a printf argument', () => {
    const park = parkFence(GATE);
    const RESUME = 'Resume once its workflow is fixed or a post-ready run lands.';
    const record = (fence) => {
      const { dir, paths } = sandbox();
      const gh = 'gh() { while [ $# -gt 0 ]; do if [ "$1" = --body-file ]; then cat "$2" > "$STUB_DIR/body.txt"; fi; shift; done; }';
      const script = `${gh}\nVALUE=wait REASON='check-failed:x' PR=7 ISSUE=9 RESUME='${RESUME}'\n${substitute(fence, paths)}`;
      const r = run(shell, script, dir, {});
      assert.equal(r.status, 0, r.stderr);
      return fs.readFileSync(path.join(dir, 'body.txt'), 'utf8');
    };
    const body = record(park);
    assert.ok(body.trimEnd().endsWith(RESUME), `body must end with the resume sentence: ${body}`);
    assert.doesNotMatch(body, /Resume once green/);
    assert.equal(body, `Parked by merge-verification (wait): check-failed:x on PR #7. ${RESUME}\n`);
    // Go-red: the pre-change fence hard-coded "Resume once green." and never took $RESUME.
    const old = park.replace(/printf '[^\n]*\n/, "printf 'Parked by merge-verification (%s): %s on PR #%s. Resume once green.\\n' \"$VALUE\" \"$REASON\" \"$PR\" > \"{park-comment-path}\"\n");
    assert.notEqual(old, park);
    assert.match(record(old), /Resume once green/);
  });
}

test('the fence extractors survive CRLF input and find nothing in a fence-less text', () => {
  assert.equal(watchFence(GATE.replace(/\n/g, '\r\n')).includes('DEADLINE='), true);
  assert.ok(parkFence(GATE.replace(/\n/g, '\r\n')).includes('Parked by merge-verification'));
  assert.equal(WATCH_RE.exec('no fence here'), null);
});
