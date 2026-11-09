'use strict';
// Counting fake `gh` for tests of the forge-detection probe (#4578).
//
// fakeGh({ first, rest = first }) installs a `gh` stub on PATH (installStub, so
// it is skipped on win32 like every script stub). Each invocation appends one
// line to a counter file in the stub's own temp dir, then picks its mode by the
// number of earlier invocations: none -> `first`, otherwise `rest`.
//
// Modes:
//   'ok'       prints the `gh repo view --json owner,name` payload, exit 0
//   'fail'     exit 1
//   'hang'     `exec sleep 30` -- the shell becomes the sleep, so the SIGTERM an
//              execFileSync timeout sends kills the sleep itself instead of
//              leaving an orphaned `sleep` process behind
//   { slow: N } sleeps N seconds, then prints the payload; a TERM trap kills its
//              sleep first, for the same reason
//
// count() is the number of invocations so far; restore() puts PATH back and
// removes the counter dir.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installStub } = require('./path-stub');

const PAYLOAD = `echo '{"owner":{"login":"o"},"name":"n"}'`;

function modeBody(mode) {
  if (mode === 'ok') return PAYLOAD;
  if (mode === 'fail') return 'exit 1';
  if (mode === 'hang') return 'exec sleep 30';
  if (mode && typeof mode === 'object' && Number.isInteger(mode.slow) && mode.slow > 0) {
    return `sleep ${mode.slow} & p=$!; trap 'kill $p; exit 143' TERM; wait $p; ${PAYLOAD}`;
  }
  throw new Error(`fakeGh: unknown mode ${JSON.stringify(mode)}`);
}

function fakeGh({ first, rest = first }) {
  const counterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fakegh-'));
  const counter = path.join(counterDir, 'calls');
  fs.writeFileSync(counter, '');
  let restoreStub;
  try {
    const script = [
      '#!/bin/sh',
      `echo x >> '${counter}'`,
      `n=$(wc -l < '${counter}' | tr -d ' ')`,
      'if [ "$n" -le 1 ]; then',
      `  ${modeBody(first)}`,
      'else',
      `  ${modeBody(rest)}`,
      'fi',
      '',
    ].join('\n');
    restoreStub = installStub('gh', script);
  } catch (err) {
    fs.rmSync(counterDir, { recursive: true, force: true });
    throw err;
  }
  return {
    count() {
      return fs.readFileSync(counter, 'utf8').split('\n').filter(Boolean).length;
    },
    restore() {
      restoreStub();
      fs.rmSync(counterDir, { recursive: true, force: true });
    },
  };
}

module.exports = { fakeGh };
