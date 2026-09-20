// bin/lib/stage-item/write.js — the staged/ half of #637's "no CLI writes
// decisions.md or staged/ items" gap (the decisions.md half shipped as
// bin/log-decision.js / bin/lib/log-decision/append.js under #686). Every
// site that used to compose a proposal file by hand via a scratch `node -e`
// calls bin/stage-item.js, which is a thin wrapper over this module.
//
// The run dir must resolve under the main checkout ($RUN_ROOT — see
// _shared/pipeline-run-dir.md's Anchoring section): a worktree-local shadow
// copy is refused, never silently written ([IL-127]) — same structural
// .git-walk anchoring bin/lib/log-decision/append.js already implements.
'use strict';

const fs = require('fs');
const path = require('path');
const { mainCheckoutRoot, safeReal } = require('../hooks/worktree-detect');

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// A staged item's id becomes a filename stem — reject anything that isn't a
// plain, single-segment token (no `/`, no leading `.`, no empty string).
function sanitizeId(id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return null;
  return id;
}

// Anchoring rationale (ADR-0004's two worktree domains, fail-closed-on-unknown,
// the deliberate `mainRoot: null` opt-out): see `bin/lib/log-decision/append.js`'s
// header comment — this predicate is deliberately duplicated for two small
// sibling files, not extracted.
// Walk up from `startDir` for the nearest ancestor containing a `.git` entry.
function findGitRoot(startDir) {
  let dir = startDir;
  for (;;) {
    let st;
    try { st = fs.statSync(path.join(dir, '.git')); } catch { st = null; }
    if (st) return { dir, isFile: st.isFile() };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// { runDir, cwd?, mainRoot? } -> { ok, dir } | { ok:false, reason:'missing'|'not-anchored' }
function resolveTarget({ runDir, cwd = process.cwd(), mainRoot }) {
  const real = safeReal(runDir);
  if (!real || !isDirectory(real)) return { ok: false, reason: 'missing' };

  const found = findGitRoot(real);
  if (!found || found.isFile) return { ok: false, reason: 'not-anchored' };
  const gitRoot = found.dir;

  let anchor = mainRoot;
  if (mainRoot === undefined) {
    anchor = mainCheckoutRoot(cwd);
    if (!anchor) return { ok: false, reason: 'not-anchored' };
  }
  if (anchor && (safeReal(anchor) || anchor) !== gitRoot) return { ok: false, reason: 'not-anchored' };
  return { ok: true, dir: real };
}

// { runDir, id, sourcePath, content } -> { file }. Overwrites; staged
// proposals are documents, not an append log.
function writeStagedItem({ runDir, id, sourcePath, content }) {
  const stagedDir = path.join(runDir, 'staged');
  fs.mkdirSync(stagedDir, { recursive: true });
  const ext = path.extname(sourcePath || '');
  const file = path.join(stagedDir, `${id}${ext}`);
  fs.writeFileSync(file, content);
  return { file };
}

// { runDir, id, content } -> { file }. Writes the machine-readable sidecar
// (#2612) alongside a staged item's own `.md`/`.patch` file — same
// mkdir-then-write, same overwrite semantics as writeStagedItem, always at
// `staged/{id}.json` regardless of the sibling file's own extension so
// render-tidy-report.js's glob (`staged/*.json`) finds it unambiguously.
function writeStagedSidecar({ runDir, id, content }) {
  const stagedDir = path.join(runDir, 'staged');
  fs.mkdirSync(stagedDir, { recursive: true });
  const file = path.join(stagedDir, `${id}.json`);
  fs.writeFileSync(file, content);
  return { file };
}

module.exports = { resolveTarget, sanitizeId, writeStagedItem, writeStagedSidecar };
