'use strict';

// #1752: one module owning dispatch's session-scoped exclusion-list shape and
// file, replacing four (now six, live at build time -- #1983/#1984 shipped
// after this record was filed) ad hoc per-reason JSON files each with their
// own shape/producer/reader/report. One array of {reason, records, detail}
// entries in one file: a new exclusion reason is one appendExclusion call
// site plus one report line, never a new file or filter derivation.

const fs = require('fs');

// path -> entries, or [] on absent/unreadable (malformed JSON, not an array,
// permission error) -- a read failure here must never throw and block a
// dispatch firing; an empty exclusion set is always a safe degrade. A
// genuinely-absent file (ENOENT -- the normal case on a firing's first pull)
// degrades silently; anything else (corrupt JSON, non-array content, a
// permission error) is a diagnosable state, not a routine one -- it also
// silently drops any preserved 'firing'-reason entries at
// queue-pull-script.md's truncate step, re-enabling the infinite-reselect
// bug firing-exclusion.md exists to prevent, so it degrades loud (stderr),
// never loud enough to throw and block the firing itself.
function readExclusions(path) {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error(`readExclusions: ${path} did not contain a JSON array -- treating as empty`);
      return [];
    }
    return parsed;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error(`readExclusions: ${path} unreadable (${err.code || err.message}) -- treating as empty`);
    }
    return [];
  }
}

// Appends one {reason, records, detail} entry, creating the file (as
// [entry]) if absent. Callers loop for multiple entries of the same reason
// (e.g. one per excluded candidate) -- there is no bulk variant, matching
// the record's "one appendExclusion call site" extensibility claim (AC5).
function appendExclusion(path, entry) {
  const entries = readExclusions(path);
  entries.push(entry);
  fs.writeFileSync(path, JSON.stringify(entries));
}

// entries whose reason is in `reasons`, flattened to the set of every
// excluded record number across all of them.
function excludedNumbers(entries, reasons) {
  const reasonSet = new Set(reasons);
  const numbers = new Set();
  for (const e of entries) {
    if (!e || !reasonSet.has(e.reason) || !Array.isArray(e.records)) continue;
    for (const n of e.records) numbers.add(n);
  }
  return numbers;
}

// True when ANY member of `group` (a file-overlap group -- {number}[]) is
// excluded under one of `reasons` -- a group is claimed/released as a unit,
// so one excluded member excludes the whole group (next-ranking.md's and
// firing-exclusion.md's existing semantics, preserved here, not changed).
function groupIsExcluded(group, entries, reasons) {
  const numbers = excludedNumbers(entries, reasons);
  return group.some((r) => numbers.has(r.number));
}

module.exports = {
  readExclusions, appendExclusion, excludedNumbers, groupIsExcluded,
};
