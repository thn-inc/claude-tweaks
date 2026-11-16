'use strict';
// The one resolver for where a pipeline run's materialized spec header lives (#3974).
//
// A header is written live, at `.claude-tweaks/pipelines/{run-id}/work/{N}-spec.md`
// (or `.../{run-id}/spec-{N}/work/{N}-spec.md` for a multi-spec run), by /flow's
// materialize step. After wrap-up it moves to
// `.claude-tweaks/pipelines/archive/{run-id}/...` with the same layout beneath it —
// by wrap-up's pre-merge move (#3976, run-header-archive.js `archiveRunHeader`) or by
// `archiveRunDir` in reconcile/archive-merged.js, the post-merge fallback.
// Those are the two writers. The dual-path rule is permanent, not a compatibility
// shim: a run is read live during its phases and archived afterwards, and both are
// normal states. Precedence is root by root: within a root, live before archived and
// flat `work/` before `spec-{N}/work/`. The caller supplies the roots; nothing here
// discovers a mirror.
//
// Of the spec-header readers only this file spells the archive segment (the archive
// writers and other run-dir code spell their own run-dir paths). The eight readers go through it:
// - plugin/bin/verify-run-bookends.js `isSpecCommitted`
// - plugin/bin/lib/flow/preflight.js `specOnBranch`
// - plugin/bin/lib/hooks/pre-tool-use.js `hasMaterializeCommit` and `getMaterializedRecordNumbers`
// - plugin/bin/lib/pr-bookkeeping/precondition.js, which reads through `hasMaterializeCommit`
// - plugin/bin/lib/wrap-up/pack.js `resolveRecords` and `closingRecords`
// - plugin/bin/lib/dispatch/first-call-artifact-check.js `hasMaterializedHeader`
// - the `spec` probe in plugin/bin/lib/flow/preflight.js
// - `resolveTargetRecords` in plugin/bin/lib/timing/context-gauge.js
//
// Git-facing functions return POSIX repo-relative literals (`/` on every OS); the
// filesystem-facing ones return native paths built with `pathImpl.join`. Nothing here
// touches the filesystem except through the injected `readdir`.

const fs = require('node:fs');
const path = require('node:path');
const { RUN_ID_RE } = require('./hooks/run-dir-resolve');

const PIPELINES_REL = '.claude-tweaks/pipelines';
const SPEC_DIR_RE = /^spec-([1-9]\d*)$/;

function defaultReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

// [live, archived] repo-relative run dirs, each suffixed with `/{specDir}` when given.
function runRelDirs(runId, { specDir = null } = {}) {
  const suffix = specDir ? `/${specDir}` : '';
  return [`${PIPELINES_REL}/${runId}${suffix}`, `${PIPELINES_REL}/archive/${runId}${suffix}`];
}

// Concrete candidate paths for one record's header, in precedence order. For
// `git cat-file -e` and the like, which cannot glob. `layout` narrows the shapes:
// 'any' (default) is flat `work/` then `spec-{N}/work/`, 'nested' only the latter (a
// multi-spec parent never holds a flat header), 'flat' only the former. `layout` is
// ignored when `specDir` names the per-spec run dir, whose only shape is `work/`.
function headerRelPaths(runId, recordNumber, { specDir = null, layout = 'any' } = {}) {
  const [live, archived] = runRelDirs(runId);
  if (specDir) {
    return runRelDirs(runId, { specDir }).map((d) => `${d}/work/${recordNumber}-spec.md`);
  }
  const flat = (d) => `${d}/work/${recordNumber}-spec.md`;
  const nested = (d) => `${d}/spec-${recordNumber}/work/${recordNumber}-spec.md`;
  const out = [];
  for (const d of [live, archived]) {
    if (layout !== 'nested') out.push(flat(d));
    if (layout !== 'flat') out.push(nested(d));
  }
  return out;
}

// Pathspecs for `git log -- <spec>`. The trailing `/*` on the spec-* forms is
// required: `spec-*/work` does not match, `spec-*/work/*` does.
function headerPathspecs(runId, { specDir = null } = {}) {
  const [live, archived] = runRelDirs(runId);
  if (specDir) return runRelDirs(runId, { specDir }).map((d) => `${d}/work/*`);
  return [`${live}/work`, `${live}/spec-*/work/*`, `${archived}/work`, `${archived}/spec-*/work/*`];
}

// The archived sibling of a live run dir (native path), or null when the dir's shape
// gives no archived location: not under a `pipelines` parent, or already archived.
function archivedRunDir(runDir, pathImpl = path) {
  const base = pathImpl.basename(runDir);
  const parent = pathImpl.dirname(runDir);
  if (pathImpl.basename(parent) === 'pipelines') {
    return base === 'archive' ? null : pathImpl.join(parent, 'archive', base);
  }
  if (/^spec-/.test(base) && RUN_ID_RE.test(pathImpl.basename(parent))) {
    const grandparent = pathImpl.dirname(parent);
    if (pathImpl.basename(grandparent) === 'pipelines') {
      return pathImpl.join(grandparent, 'archive', pathImpl.basename(parent), base);
    }
  }
  return null;
}

// Native header-file candidates for one record, run dir by run dir: live flat, live
// nested, then the same two under the archived sibling. No existence check.
function headerFileCandidates(runDirs, recordNumber, pathImpl = path) {
  const out = [];
  for (const d of runDirs) {
    if (!d) continue;
    const bases = [d];
    const archived = archivedRunDir(d, pathImpl);
    if (archived) bases.push(archived);
    for (const b of bases) {
      out.push(pathImpl.join(b, 'work', `${recordNumber}-spec.md`));
      out.push(pathImpl.join(b, `spec-${recordNumber}`, 'work', `${recordNumber}-spec.md`));
    }
  }
  return out;
}

// The directories that may hold header files, per run dir: live then archived, each
// as flat `work/` then every `spec-*` child's `work/` (plain string sort). The
// returned dirs are not checked for existence; the caller's own listing decides.
// `nested: false` returns the flat `work/` dirs only and never lists the `spec-*` children.
function listHeaderDirs(runDirs, { readdir = defaultReaddir, pathImpl = path, nested = true } = {}) {
  const out = [];
  for (const d of runDirs) {
    if (!d) continue;
    const places = [['live', d]];
    const archived = archivedRunDir(d, pathImpl);
    if (archived) places.push(['archived', archived]);
    for (const [location, base] of places) {
      out.push({ dir: pathImpl.join(base, 'work'), location, specDir: null, specN: null });
      if (!nested) continue;
      const names =readdir(base).filter((n) => n.startsWith('spec-')).sort();
      for (const name of names) {
        const m = SPEC_DIR_RE.exec(name);
        out.push({
          dir: pathImpl.join(base, name, 'work'),
          location,
          specDir: name,
          specN: m ? Number(m[1]) : null,
        });
      }
    }
  }
  return out;
}

module.exports = {
  PIPELINES_REL, SPEC_DIR_RE, runRelDirs, headerRelPaths, headerPathspecs,
  archivedRunDir, headerFileCandidates, listHeaderDirs,
};
