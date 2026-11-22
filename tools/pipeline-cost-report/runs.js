'use strict';
// tools/pipeline-cost-report/runs.js — enumerates pipeline run directories for the cost report (#5914).
//
// listRuns reads the top level of the pipelines directory and of its archive/ subdirectory. A name found in both
// is kept from the top level (the run was archived mid-scan or copied back); `archive` itself is not a run. A name
// with no leading YYYY-MM-DD is counted `unparsed` (undated, not unreadable) and left out. A `spec-{N}` subdirectory
// of a run is a member. A run directory whose own readdir fails (it vanished or moved to archive/ mid-scan) is
// counted `unreadable` and skipped. A missing archive/ adds nothing; a missing pipelines directory returns
// `missing: true` with no runs. Read-only.

const fs = require('fs');
const path = require('path');
const { isDate } = require('../efficiency-report');

const ARCHIVE = 'archive';
const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?!\d)/;
const MEMBER_RE = /^spec-(\d+)$/;

// { runs: [{ name, date, dir, archived, members: [{ id, dir }] }], unparsed, unreadable, missing }
function listRuns(pipelinesDir, fsImpl = fs) {
  const out = { runs: [], unparsed: 0, unreadable: 0, missing: false };
  let top;
  try {
    top = fsImpl.readdirSync(pipelinesDir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') out.missing = true;
    else out.unreadable += 1;
    return out;
  }
  let archived = [];
  try {
    archived = fsImpl.readdirSync(path.join(pipelinesDir, ARCHIVE), { withFileTypes: true });
  } catch (e) {
    if (!(e && e.code === 'ENOENT')) out.unreadable += 1;
  }

  // A symlink to a directory is a directory; one that cannot be stat'ed is unreadable. null = not a directory.
  const isDir = (entry, full) => {
    if (entry.isDirectory()) return true;
    if (!entry.isSymbolicLink()) return false;
    try {
      return fsImpl.statSync(full).isDirectory();
    } catch {
      out.unreadable += 1;
      return null;
    }
  };

  // A name is marked seen only once it has been read, so a top-level copy that fails to read (it just moved to
  // archive/) does not hide the archived copy.
  const seen = new Set();
  const visit = (entries, base, isArchived) => {
    for (const entry of entries) {
      if (entry.name === ARCHIVE || seen.has(entry.name)) continue;
      const dir = path.join(base, entry.name);
      if (isDir(entry, dir) !== true) continue;
      const m = DATE_RE.exec(entry.name);
      if (!m || !isDate(m[1])) {
        seen.add(entry.name);
        out.unparsed += 1;
        continue;
      }
      let inside;
      try {
        inside = fsImpl.readdirSync(dir, { withFileTypes: true });
      } catch {
        out.unreadable += 1;
        continue;
      }
      seen.add(entry.name);
      const members = [];
      for (const sub of inside) {
        const subDir = path.join(dir, sub.name);
        const mm = MEMBER_RE.exec(sub.name);
        if (mm && isDir(sub, subDir) === true) members.push({ id: Number(mm[1]), dir: subDir });
      }
      out.runs.push({ name: entry.name, date: m[1], dir, archived: isArchived, members });
    }
  };
  visit(top, pipelinesDir, false);
  visit(archived, path.join(pipelinesDir, ARCHIVE), true);
  return out;
}

module.exports = { listRuns, isDate };
