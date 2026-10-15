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

// An allocate-mode id is `{kind}-{n}` (`build-deviation-1`) — the caller is
// requesting a slot, not addressing a fixed one, and `{n}` may already be
// stale by the time this write lands. This is deliberately NOT inferred from
// the id's own shape: `premise-satisfied-{issueNumber}` and
// `sibling-premise-disproof-{issueNumber}` (materialize.js) also end in
// digits, but there `{n}` is a stable identity key (the issue number) whose
// re-stage on a materialize re-run is an intentional idempotent overwrite,
// not a counter collision — treating it as allocatable would silently
// rename a legitimate update into a bogus duplicate under the next issue
// number. Only a caller that opts in with `allocate: true` gets collision
// protection; every other id keeps the original plain-overwrite contract.
function parseNumberedKind(id) {
  const m = /^(.*)-(\d+)$/.exec(id);
  return m ? { kind: m[1], n: parseInt(m[2], 10) } : null;
}

// Scan an existing staged/ dir for files already claiming `{kind}-{digits}`
// (with or without an extension) and return their numeric suffixes.
function listExistingNumbers(stagedDir, kind) {
  let entries;
  try { entries = fs.readdirSync(stagedDir); } catch { return []; }
  const escaped = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}-(\\d+)(?:\\.|$)`);
  const nums = [];
  for (const entry of entries) {
    const m = re.exec(entry);
    if (m) nums.push(parseInt(m[1], 10));
  }
  return nums;
}

// { runDir, id, sourcePath, content, allocate? } -> { file, id, renamed?, requestedId? }.
//
// #2770: the filename counter that picks `n` in `{kind}-{n}` used to live in
// each caller's own per-invocation state, not in the run directory's actual
// contents — two independent writers in the same run could each compute the
// same `{kind}-{n}` and the second would silently clobber the first's staged
// proposal. Default behavior (`allocate` unset/false) is unchanged: plain
// overwrite, same as before this fix — every existing caller (materialize.js,
// leftover/ledger-record slug staging, …) keeps its exact prior contract.
// `allocate: true` opts a numbered-kind id into collision-safe allocation: it
// tries the caller's requested slot first via an exclusive (O_EXCL) create —
// the common, uncontended case costs nothing extra — and only on a real
// collision reallocates against this run dir's own existing `{kind}-*`
// contents, retrying through any further race with a concurrent writer.
// Never a blind clobber in this mode; the returned `id`/`renamed` says what
// actually landed.
function writeStagedItem({
  runDir, id, sourcePath, content, allocate = false,
}) {
  const stagedDir = path.join(runDir, 'staged');
  fs.mkdirSync(stagedDir, { recursive: true });
  const ext = path.extname(sourcePath || '');

  if (!allocate) {
    const file = path.join(stagedDir, `${id}${ext}`);
    fs.writeFileSync(file, content);
    return { file, id };
  }

  const numbered = parseNumberedKind(id);
  if (!numbered) {
    throw new Error(`writeStagedItem: allocate:true requires a "{kind}-{n}" id, got ${JSON.stringify(id)}`);
  }

  let file = path.join(stagedDir, `${id}${ext}`);
  try {
    fs.writeFileSync(file, content, { flag: 'wx' });
    return { file, id };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  const existing = listExistingNumbers(stagedDir, numbered.kind);
  let n = Math.max(numbered.n, ...existing) + 1;
  for (;;) {
    const candidateId = `${numbered.kind}-${n}`;
    file = path.join(stagedDir, `${candidateId}${ext}`);
    try {
      fs.writeFileSync(file, content, { flag: 'wx' });
      return {
        file, id: candidateId, renamed: true, requestedId: id,
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      n += 1;
    }
  }
}

// { runDir, id, content } -> { file }. Writes the machine-readable sidecar
// (#2612) alongside a staged item's own `.md`/`.patch` file — same
// mkdir-then-write, plain-overwrite semantics (the caller passes the `id`
// `writeStagedItem` actually resolved to, not necessarily the one it
// requested, so the two files stay paired under whatever id won), always at
// `staged/{id}.json` regardless of the sibling file's own extension so
// render-tidy-report.js's glob (`staged/*.json`) finds it unambiguously.
function writeStagedSidecar({ runDir, id, content }) {
  const stagedDir = path.join(runDir, 'staged');
  fs.mkdirSync(stagedDir, { recursive: true });
  const file = path.join(stagedDir, `${id}.json`);
  fs.writeFileSync(file, content);
  return { file };
}

module.exports = {
  resolveTarget, sanitizeId, writeStagedItem, writeStagedSidecar, parseNumberedKind, listExistingNumbers,
};
