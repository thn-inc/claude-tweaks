'use strict';
// Test helper: records every child process a node process starts, one JSON line
// per call, so a test or a trace script can count the git questions a CLI asks.
//
// Load with `node --require <this file>` (or NODE_OPTIONS) and set
// CT_TEST_GIT_CALL_LOG to a directory. Each process appends to <dir>/<pid>.jsonl:
//   { kind: 'argv', argv, cwd }                      first line
//   { kind: 'git', args, cwd, env }                  a git call
//   { kind: 'spawn', cmd }                           any other command
// Lines are written with appendFileSync so a process that calls process.exit
// loses nothing. The recorder never throws and never changes a call. Without the
// env var, requiring this file patches nothing (readGitCalls is still usable).
const fs = require('fs');
const path = require('path');

function readGitCalls(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
    const events = [];
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      if (!line) continue;
      try { events.push(JSON.parse(line)); } catch { /* a line cut short by a killed process */ }
    }
    const first = events[0] && events[0].kind === 'argv' ? events[0] : null;
    out.push({
      pid: Number(name.slice(0, -'.jsonl'.length)),
      argv: first ? first.argv : null,
      cwd: first ? first.cwd : null,
      events: first ? events.slice(1) : events,
    });
  }
  return out;
}

function install(dir) {
  const cp = require('child_process');
  const file = path.join(dir, `${process.pid}.jsonl`);
  let envFingerprint = null;
  try {
    ({ envFingerprint } = require('../../plugin/bin/lib/hooks/repo-info-cache'));
  } catch { /* fingerprint stays unavailable; calls are still recorded */ }

  const append = (obj) => {
    try { fs.appendFileSync(file, `${JSON.stringify(obj)}\n`); } catch { /* never break the call */ }
  };

  const record = (cmd, rest) => {
    try {
      if (typeof cmd !== 'string') return;
      const args = Array.isArray(rest[0]) ? rest[0] : [];
      const opts = rest.find((a) => a && typeof a === 'object' && !Array.isArray(a)) || {};
      const base = path.basename(cmd).replace(/\.exe$/i, '');
      if (base !== 'git') { append({ kind: 'spawn', cmd }); return; }
      append({
        kind: 'git',
        args,
        cwd: opts.cwd ? path.resolve(String(opts.cwd)) : process.cwd(),
        env: envFingerprint ? envFingerprint(opts.env || process.env) : null,
      });
    } catch { /* never break the call */ }
  };

  append({ kind: 'argv', argv: process.argv.slice(2), cwd: process.cwd() });
  for (const name of ['execFileSync', 'execFile', 'spawnSync', 'spawn']) {
    const real = cp[name];
    cp[name] = function (cmd, ...rest) {
      record(cmd, rest);
      return real.call(this, cmd, ...rest);
    };
  }
}

if (process.env.CT_TEST_GIT_CALL_LOG) {
  try {
    fs.mkdirSync(process.env.CT_TEST_GIT_CALL_LOG, { recursive: true });
    install(process.env.CT_TEST_GIT_CALL_LOG);
  } catch { /* a recorder error never breaks the host process */ }
}

module.exports = { readGitCalls };
