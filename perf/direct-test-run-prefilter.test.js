// Direct-test-run guard prefilter budget (#5794) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// .claude/settings.json sources tools/direct-test-run-guard.sh into the PreToolUse hook's own
// shell on every Bash call; the prefilter reads the payload with a few field-split loops and
// starts node only when the command could be one the guard denies. What keeps that affordable is
// that its work stays linear in the payload and bounded by its 256-piece caps. This pins both,
// with ratios (load-independent: every payload is timed once per round, so a busy stretch of the
// machine falls on all of them) and one loose absolute ceiling. Lives outside tests/ for the
// same reason perf/hooks-prefilter.test.js does (wall-clock under sibling-suite load).
//
// A measurement is one sh process running the prefilter 200 times on one 8192-byte payload; each
// payload is timed in 7 rounds and the minimum kept. Measured on the authoring machine (macOS
// darwin, Node 26, /bin/sh and /bin/dash, load average 19.99 12.87 14.59 at the run). Per call
// (ratio to `word` in brackets; word / word1k is the linearity ratio, 8 would be exactly linear):
//   sh    word 0.898 ms, word1k 0.375 ms (2.39), blanks 0.843 (0.94), fragments 2.733 (3.04),
//         quotes 2.170 (2.42), newlines 2.763 (3.08), description 1.878 (2.09)
//   dash  word 0.490 ms, word1k 0.179 ms (2.73), blanks 0.478 (0.98), fragments 1.465 (2.99),
//         quotes 0.942 (1.92), newlines 1.389 (2.83), description 0.746 (1.52)
// Over the cap (65,536-byte line), registered command / old one-line registration, minimum of 5,
// load average 7.59: sh 58.0 ms / 34.6 ms (1.68), dash 51.2 ms / 31.6 ms (1.62).
// A node start measured about 50 ms on the same machine, so the 25 ms ceiling is half a node start.
// With one piece cap removed in a scratch copy of the prefilter, the matching payload measured
// 3.9 to 67 times `word` (cap 1 quotes 67x sh / 39x dash; cap 2 newlines 27x / 25x; cap 3
// fragments 20x / 33x), against the 12 times budget. The `description` row is a secondary row for
// the quote-piece cap (with that cap removed it measures about 7 times a plain payload under sh,
// inside the 12 times budget); the `quotes` row is the one that pins that cap.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findOnPath } = require('../tests/helpers/path-stub');
const { readText } = require('../tests/helpers/read-skill');

const ROOT = path.resolve(__dirname, '..');
const PREFILTER = path.join(ROOT, 'tools', 'direct-test-run-guard.sh');
const CALLS = 200;
const ROUNDS = 7;
const LINE_BYTES = 8192;
const DRIVER = 'DIRECT_TEST_RUN_GUARD_LIB=1; . "$1"; IFS= read -r l; i=0; while [ "$i" -lt "$2" ]; do direct_test_run_guard_needs_node "$l"; i=$((i + 1)); done';

// The hook payload's key set, as tests/direct-test-run-guard.test.js builds it.
const hookPayload = (command, description) => JSON.stringify({
  session_id: '1c62e9ba-c9f3-4896-a17e-e1f7fa768871',
  transcript_path: '/home/u/.claude/projects/-repo/1c62e9ba-c9f3-4896-a17e-e1f7fa768871.jsonl',
  cwd: ROOT,
  prompt_id: '6ee4cc1c-2e11-418f-960f-ba371fab8215',
  permission_mode: 'default',
  effort: { level: 'medium' },
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command, description },
  tool_use_id: 'toolu_014brzUtdmTepXVxeaXhFJAj',
});

// A payload line of exactly `bytes` bytes: the most `fill` characters that fit, then `a`
// characters at the end of the command (or of the description when `inDescription`) for the
// byte or two a two-byte fill character leaves over.
function buildLine({ prefix, fill, bytes, inDescription = false }) {
  const make = (n, pad) => {
    const filled = fill.repeat(n) + 'a'.repeat(pad);
    return inDescription ? hookPayload(prefix, filled) : hookPayload(prefix + filled, 'Run it');
  };
  const base = Buffer.byteLength(make(0, 0));
  const unit = Buffer.byteLength(make(1, 0)) - base; // bytes one fill character adds once JSON-escaped
  const n = Math.floor((bytes - base) / unit);
  const line = make(n, bytes - base - n * unit);
  assert.strictEqual(Buffer.byteLength(line), bytes, 'payload builder missed its byte length');
  return line;
}

const PAYLOADS = {
  word: buildLine({ prefix: 'ls ', fill: 'a', bytes: LINE_BYTES }),
  word1k: buildLine({ prefix: 'ls ', fill: 'a', bytes: 1024 }),
  blanks: buildLine({ prefix: 'ls ', fill: ' ', bytes: LINE_BYTES }),
  fragments: buildLine({ prefix: 'ls ', fill: ';', bytes: LINE_BYTES }),
  quotes: buildLine({ prefix: 'ls ', fill: '"', bytes: LINE_BYTES }),
  newlines: buildLine({ prefix: 'ls ', fill: '\n', bytes: LINE_BYTES }),
  description: buildLine({ prefix: 'ls', fill: '"', bytes: LINE_BYTES, inDescription: true }),
};
const WORST = ['blanks', 'fragments', 'quotes', 'newlines', 'description'];

const SPAWN = { timeout: 120000, killSignal: 'SIGKILL', windowsHide: true };

function timeOnce(shell, line) {
  const start = process.hrtime.bigint();
  const r = spawnSync(shell, ['-c', DRIVER, 'sh', PREFILTER, String(CALLS)], { ...SPAWN, input: line + '\n', encoding: 'utf8' });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.strictEqual(r.status, 0, `${shell} driver failed: ${r.stderr}`);
  return ms;
}

// Minimum wall time of the 200-call process per payload name; every round times every payload once.
function measure(shell) {
  const best = {};
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const name of Object.keys(PAYLOADS)) {
      best[name] = Math.min(best[name] ?? Infinity, timeOnce(shell, PAYLOADS[name]));
    }
  }
  return best;
}

const fmt = (best) => Object.entries(best).map(([k, v]) => `${k} ${(v / CALLS).toFixed(3)}ms/call`).join(', ');

const WIN32_DASH_SKIP = 'win32: dash cannot exec a Windows-form path (C:\\...\\node.exe), measured in windows-regression run 43647466952; Claude Code runs Windows hooks under Git Bash sh, covered by [sh]';

const SHELLS = [['sh', findOnPath('sh')], ['dash', findOnPath('dash')]];

function skipReason(name, shell) {
  if (name === 'dash' && process.platform === 'win32') return WIN32_DASH_SKIP;
  return shell ? false : `${name} not on PATH`;
}

for (const [name, shell] of SHELLS) {
  const skip = skipReason(name, shell);
  let cached;
  const best = () => { cached = cached || measure(shell); return cached; };

  test(`#5794 AC9.1 AC9.2: work is linear in the payload (${name})`, { skip }, () => {
    const b = best();
    assert.ok(b.word < 24 * b.word1k, `8192 bytes took ${b.word.toFixed(1)}ms, 1024 bytes ${b.word1k.toFixed(1)}ms per ${CALLS} calls: more than 24 times (${fmt(b)})`);
  });

  test(`#5794 AC9.1 AC9.2: a worst-case payload at the caps costs under 12 times a plain payload of the same size (${name})`, { skip }, () => {
    const b = best();
    for (const w of WORST) {
      assert.ok(b[w] < 12 * b.word, `${w} took ${b[w].toFixed(1)}ms, plain ${b.word.toFixed(1)}ms per ${CALLS} calls: more than 12 times (${fmt(b)})`);
    }
  });

  test(`#5794 AC9.1 AC9.2: a worst-case call stays under 25 ms (${name})`, { skip }, () => {
    const b = best();
    for (const w of ['word', ...WORST]) {
      assert.ok(b[w] < 5000, `${w} took ${b[w].toFixed(1)}ms for ${CALLS} calls (over 25 ms a call) (${fmt(b)})`);
    }
  });

  test(`#5794 AC9.2: a payload over the cap costs under 3 times the old registration (${name})`, { skip }, () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-perf-dtrg-'));
    try {
      fs.mkdirSync(path.join(project, 'tools'));
      fs.writeFileSync(path.join(project, 'tools', 'direct-test-run-guard.js'), 'process.stdin.resume();\n');
      fs.copyFileSync(PREFILTER, path.join(project, 'tools', 'direct-test-run-guard.sh'));
      const settings = JSON.parse(readText(path.join(ROOT, '.claude', 'settings.json')));
      const registered = settings.hooks.PreToolUse.find((e) => e.matcher === 'Bash').hooks[0].command;
      const old = 'node "$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard.js"';
      const line = buildLine({ prefix: 'ls ', fill: 'a', bytes: 65536 });
      assert.strictEqual(Buffer.byteLength(line), 65536);
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
      env.PATH = [path.dirname(process.execPath), process.env.PATH || process.env.Path || ''].filter(Boolean).join(path.delimiter);
      env.CLAUDE_PROJECT_DIR = project;
      const run = (command) => {
        const start = process.hrtime.bigint();
        const r = spawnSync(shell, ['-c', command], { ...SPAWN, input: line + '\n', env, encoding: 'utf8' });
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        assert.strictEqual(r.status, 0, `${name} -c failed: ${r.stderr}`);
        return ms;
      };
      let reg = Infinity;
      let base = Infinity;
      for (let i = 0; i < 5; i += 1) {
        reg = Math.min(reg, run(registered));
        base = Math.min(base, run(old));
      }
      assert.ok(reg < 3 * base, `over the cap the registered command took ${reg.toFixed(1)}ms, the old registration ${base.toFixed(1)}ms: more than 3 times`);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
}
