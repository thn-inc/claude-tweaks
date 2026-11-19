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

const ARCHIVE = 'archive';
const DATE_RE = /^(\d{4}-\d{2}-\d{2})/;
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

  const seen = new Set();
  const visit = (entries, base, isArchived) => {
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ARCHIVE || seen.has(entry.name)) continue;
      seen.add(entry.name);
      const m = DATE_RE.exec(entry.name);
      if (!m) {
        out.unparsed += 1;
        continue;
      }
      const dir = path.join(base, entry.name);
      let inside;
      try {
        inside = fsImpl.readdirSync(dir, { withFileTypes: true });
      } catch {
        out.unreadable += 1;
        continue;
      }
      const members = [];
      for (const sub of inside) {
        const mm = sub.isDirectory() ? MEMBER_RE.exec(sub.name) : null;
        if (mm) members.push({ id: Number(mm[1]), dir: path.join(dir, sub.name) });
      }
      out.runs.push({ name: entry.name, date: m[1], dir, archived: isArchived, members });
    }
  };
  visit(top, pipelinesDir, false);
  visit(archived, path.join(pipelinesDir, ARCHIVE), true);
  return out;
}

module.exports = { listRuns };
