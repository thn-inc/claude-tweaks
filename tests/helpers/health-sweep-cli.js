'use strict';
// In-process runner for the health-sweep CLIs' tests (#5380).
//
// `sweepCli` runs a CLI through runCliSync with the ambient environment plus
// GIT_ALLOW_PROTOCOL=file. The CLIs' durable-state code runs real `git fetch`
// and `git push origin` against whatever root the call resolves; if a cwd or
// --root thread-through regresses, that root silently becomes the test process's
// own checkout, whose origin is the real GitHub remote. The guard makes any
// https/ssh fetch or push fail fast, so such a regression can never reach the
// real remote (and a fixture pointing at an unreachable https URL fails at once
// instead of retrying DNS). Local bare-repo `file` remotes, which the fixtures
// use, keep working. `env` is merged over that base, so a test can still override
// any key; `code` is mapped to `status` to match the spawnSync shape.

const { runCliSync } = require('./run-cli');

function sweepCli(cliPath, argv, opts = {}) {
  const res = runCliSync(cliPath, argv, {
    env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file', ...opts.env },
    cwd: opts.cwd,
    fresh: opts.fresh,
  });
  return { status: res.code, stdout: res.stdout, stderr: res.stderr };
}

module.exports = { sweepCli };
