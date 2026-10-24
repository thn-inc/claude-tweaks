'use strict';

// run-header — the one resolver for where a spec header (`work/{N}-spec.md`)
// lives. A header sits in a run directory, either live
// (`.claude-tweaks/pipelines/{run-id}/…`) or archived
// (`.claude-tweaks/pipelines/archive/{run-id}/…`), and either flat
// (`work/{N}-spec.md`, a single-spec run) or nested
// (`spec-{N}/work/{N}-spec.md`, one spec of a multi-spec run). Readers that
// each hardcoded one of those four shapes went blind when a run archived
// (#3974); they route through here instead.
//
// Precedence everywhere: within one root, live before archived; flat before
// nested; roots in caller order. Repo-relative strings are POSIX (git
// pathspecs, `ls-tree`); filesystem paths returned are native.
//
// Never reads file content, and never throws: a stat or readdir error counts
// as absent. A symlink counts as what it points at (the followed reads the
// readers made before #3974 did the same): a link to a regular file is a
// header, a link to a directory a header dir, a dangling or unreadable link
// absent.

const fs = require('fs');
const path = require('path');
const { lstatType } = require('./path-guard');
const { RUN_ID_RE } = require('./hooks/context');

const PIPELINES_REL = '.claude-tweaks/pipelines';
const ARCHIVE_SEGMENT = 'archive';

// POSIX path tail of a header, in either location.
const HEADER_PATH_RE = /(^|\/)(spec-\d+\/)?work\/\d+-spec\.md$/;

const SPEC_DIR_RE = /^spec-(\d+)$/;

// A run dir's identity: a per-spec dir (`spec-{N}` under a run-id parent) is
// one spec of its parent run; any other dir is a run of its own.
function runIdentity(runDir) {
  if (typeof runDir !== 'string' || runDir === '') return null;
  const base = path.basename(runDir);
  if (base === '' || base === '.' || base === '..') return null;
  const m = SPEC_DIR_RE.exec(base);
  if (m) {
    const parent = path.basename(path.dirname(runDir));
    if (RUN_ID_RE.test(parent)) return { runId: parent, specN: Number(m[1]) };
  }
  return { runId: base, specN: null };
}

// The checkout root a run dir sits under: the native path before the last
// `.claude-tweaks` segment that is followed by `pipelines`. `pathFlavor`
// (`path.win32`/`path.posix`) defaults to the host's, so tests reach the
// win32 branch on any host.
function checkoutRootOf(runDir, pathFlavor = path) {
  if (typeof runDir !== 'string' || runDir === '') return null;
  const { sep } = pathFlavor;
  const segs = runDir.split(sep === '\\' ? /[\\/]/ : '/');
  for (let i = segs.length - 2; i >= 0; i--) {
    if (segs[i] === '.claude-tweaks' && segs[i + 1] === 'pipelines') {
      const root = segs.slice(0, i).join(sep);
      if (root === '') return segs[0] === '' ? sep : '.';
      // A bare drive (`C:`) is drive-relative on win32; its root is `C:\`.
      return sep === '\\' && /^[A-Za-z]:$/.test(root) ? `${root}${sep}` : root;
    }
  }
  return null;
}

function liveDir(runId) {
  return `${PIPELINES_REL}/${runId}`;
}

function archivedDir(runId) {
  return `${PIPELINES_REL}/${ARCHIVE_SEGMENT}/${runId}`;
}

// Repo-relative POSIX header candidates, in precedence order: live-flat,
// live-nested, archived-flat, archived-nested. `shape: 'nested'` drops the
// flat ones; `specN` means the run is one spec of a parent, so only that
// spec dir's header (live, then archived) is a candidate.
function headerRelPaths(runId, n, { specN = null, shape = 'any' } = {}) {
  const file = `${n}-spec.md`;
  const out = [];
  for (const dir of [liveDir(runId), archivedDir(runId)]) {
    if (specN !== null) {
      out.push(`${dir}/spec-${specN}/work/${file}`);
    } else {
      if (shape !== 'nested') out.push(`${dir}/work/${file}`);
      out.push(`${dir}/spec-${n}/work/${file}`);
    }
  }
  return out;
}

// `git log` pathspecs (no leading `--`). A wildcard directory component needs
// a trailing wildcard: `spec-*/work/*`, never `spec-*/work`.
function headerPathspecs(runId, { specN = null } = {}) {
  const live = liveDir(runId);
  const archived = archivedDir(runId);
  if (specN !== null) return [`${live}/spec-${specN}/work/*`, `${archived}/spec-${specN}/work/*`];
  return [`${live}/work`, `${live}/spec-*/work/*`, `${archived}/work`, `${archived}/spec-*/work/*`];
}

// Repo-relative POSIX directories to `ls-tree -r`: live run dir, archived run
// dir, each narrowed to `spec-{N}` for a per-spec run.
function headerTreeDirs(runId, { specN = null } = {}) {
  const suffix = specN !== null ? `/spec-${specN}` : '';
  return [`${liveDir(runId)}${suffix}`, `${archivedDir(runId)}${suffix}`];
}

function validRoots(roots) {
  return Array.isArray(roots) ? roots.filter((r) => typeof r === 'string' && r !== '') : [];
}

// The entry type at `p` (path-guard's lstatType vocabulary), following a
// symlink to its target's file or directory type; a link that dangles, loops,
// is unreadable or points at anything else stays 'symlink'. Never throws.
function followedType(p) {
  const { type } = lstatType(p);
  if (type !== 'symlink') return type;
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return 'file';
    if (st.isDirectory()) return 'directory';
  } catch (_err) {
    // dangling, looping or unreadable link: absent
  }
  return type;
}

function nativeJoin(root, rel) {
  return path.join(root, ...rel.split('/'));
}

// A run dir that sits outside any `.claude-tweaks/pipelines` tree (a bare tmp
// fixture) has no checkout root, so the root-relative lookups cannot reach it.
// `options.runDir` names it: when `checkoutRootOf(runDir)` is null the run dir
// itself is read directly -- `{runDir}/work` flat, `{runDir}/spec-*/work`
// nested -- and when the run dir does resolve to a checkout root the option
// adds nothing (the live location under that root already is the run dir).
function bareRunDir(runDir) {
  return typeof runDir === 'string' && runDir !== '' && checkoutRootOf(runDir) === null ? runDir : null;
}

// Absolute native paths of every header location a lookup for `n` searches,
// whether or not a file sits there, in precedence order: root by root (each
// root is a checkout root), live before archived. `findHeaderFiles` filters
// this list, and a "not found" message names it, so the two cannot drift.
// `opts.runDir`: see bareRunDir -- a root-less run dir's own `work/{n}-spec.md`
// (and, unless `specN` is set, `spec-{n}/work/{n}-spec.md`) come first.
function headerCandidates(roots, runId, n, opts = {}) {
  const rels = headerRelPaths(runId, n, opts);
  const out = [];
  const bare = bareRunDir(opts.runDir);
  if (bare !== null) {
    const file = `${n}-spec.md`;
    if (opts.shape !== 'nested') out.push(path.join(bare, 'work', file));
    if (opts.specN == null) out.push(path.join(bare, `spec-${n}`, 'work', file));
  }
  for (const root of validRoots(roots)) {
    for (const rel of rels) out.push(nativeJoin(root, rel));
  }
  return out;
}

// The candidates of `headerCandidates` that exist as regular files (a symlink
// to one included).
function findHeaderFiles(roots, runId, n, opts = {}) {
  return headerCandidates(roots, runId, n, opts).filter((abs) => followedType(abs) === 'file');
}

function compareNames(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Every child of `dir` whose name starts with `spec-`, as [N, name] pairs — the
// same breadth the `spec-*/work/*` git pathspec and the pre-existing readers
// accept. N is a number only when the suffix is all digits, else null. Order:
// numeric `spec-N` ascending first, then non-numeric names in lexical order.
function specChildren(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_err) {
    return [];
  }
  const numeric = [];
  const other = [];
  for (const name of names) {
    if (!name.startsWith('spec-')) continue;
    const m = SPEC_DIR_RE.exec(name);
    if (m) numeric.push([Number(m[1]), name]);
    else other.push([null, name]);
  }
  numeric.sort((a, b) => a[0] - b[0]);
  other.sort((a, b) => compareNames(a[1], b[1]));
  return [...numeric, ...other];
}

// Existing header directories, root by root: live `work/`, live
// `spec-*/work/` (numeric N ascending, then non-numeric names lexically),
// archived `work/`, archived `spec-*/work/` in the same order. A per-spec run
// lists only its own `spec-{N}/work/` at both locations. Each entry carries
// `shape`: 'flat' for a run's own `work/`, 'nested' for a `spec-*/work/`.
// `options.runDir`: see bareRunDir -- a root-less run dir contributes its own
// `work/` (flat, or for a per-spec run its single `work/`) and `spec-*/work/`
// dirs as 'live' entries with `root: null`, ahead of the root-based ones.
function listHeaderDirs(roots, runId, { specN = null, runDir: bareDir } = {}) {
  const out = [];
  const add = (dir, location, root, n, shape) => {
    if (followedType(dir) === 'directory') out.push({ dir, location, specN: n, shape, root });
  };
  const bare = bareRunDir(bareDir);
  if (bare !== null) {
    add(path.join(bare, 'work'), 'live', null, specN, 'flat');
    if (specN === null) {
      for (const [n, name] of specChildren(bare)) add(path.join(bare, name, 'work'), 'live', null, n, 'nested');
    }
  }
  for (const root of validRoots(roots)) {
    for (const [location, rel] of [['live', liveDir(runId)], ['archived', archivedDir(runId)]]) {
      const runDir = nativeJoin(root, rel);
      if (specN !== null) {
        add(path.join(runDir, `spec-${specN}`, 'work'), location, root, specN, 'nested');
        continue;
      }
      add(path.join(runDir, 'work'), location, root, null, 'flat');
      for (const [n, name] of specChildren(runDir)) add(path.join(runDir, name, 'work'), location, root, n, 'nested');
    }
  }
  return out;
}

module.exports = {
  PIPELINES_REL,
  ARCHIVE_SEGMENT,
  HEADER_PATH_RE,
  runIdentity,
  checkoutRootOf,
  headerRelPaths,
  headerPathspecs,
  headerTreeDirs,
  headerCandidates,
  findHeaderFiles,
  listHeaderDirs,
};
