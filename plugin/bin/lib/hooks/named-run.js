// bin/lib/hooks/named-run.js — the run a PreToolUse gate's tool input names, read from the main
// checkout (#4589, #6143). Shared by dispatch-prompt-gate.js (rule A's marker run) and
// inflight-pr-gate.js (the run a PR body's first-line marker names). A named run id is untrusted
// input: it must pass RUN_ID_RE, and the run dir is returned only when it canonicalizes, is a
// directory, and is a direct child of the main checkout's canonical pipelines dir — so a symlink
// out, a nested entry (archive/) or a traversal yields null, which each gate reads as allow. Never
// the cwd's own, possibly worktree-local, pipelines dir. `d` is the caller's resolved deps:
// { fsImpl, mainCheckoutRoot }.
'use strict';
const path = require('path');
const ctxLib = require('./context');
const { canonicalRealpath, lstatType } = require('../path-guard');
const { isPathContained } = require('../shared-primitives');

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

// The main checkout's canonical pipelines dir, or null when it cannot be proven.
function pipelinesDir(cwd, d) {
  if (!isNonEmptyString(cwd) || !path.isAbsolute(cwd)) return null;
  let main;
  try { main = d.mainCheckoutRoot(cwd); } catch { return null; }
  if (!isNonEmptyString(main)) return null;
  return canonicalRealpath(path.join(main, '.claude-tweaks', 'pipelines'), { fsImpl: d.fsImpl });
}

// The canonical run dir {main}/.claude-tweaks/pipelines/{runId}, or null when it cannot be proven.
function namedRunDir(cwd, runId, d) {
  if (!isNonEmptyString(runId) || !ctxLib.RUN_ID_RE.test(runId)) return null;
  const pipes = pipelinesDir(cwd, d);
  if (!pipes) return null;
  const real = canonicalRealpath(path.join(pipes, runId), { fsImpl: d.fsImpl });
  if (!real) return null;
  if (lstatType(real, { fsImpl: d.fsImpl }).type !== 'directory') return null;
  if (!isPathContained(real, pipes) || path.dirname(real) !== pipes) return null;
  return real;
}

module.exports = { pipelinesDir, namedRunDir };
