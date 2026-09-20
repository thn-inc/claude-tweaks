'use strict';
const { parseChangelogVersions } = require('../changelog.js');
const { iterBumpCommits, recordsNamedIn, CHANGELOG } = require('./status.js');

// Prevention companion to `status.js`'s post-merge detection (#678/#768). `status.js`
// answers "which release (if any) already carries this merge" after the fact; this
// module answers "is every merge since the last bump named" before a new bump lands,
// so a release-time gate can refuse to cut a release that would ship the gap.

// The canonical "diff against nothing" boundary (`git hash-object -t tree /dev/null`) —
// used when no prior bump exists, so every materialized spec ever committed counts.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const PIPELINES_PATH = '.claude-tweaks/pipelines/';

// Matches both run-dir shapes materialize.md documents: the single-record
// `{run-id}/work/{n}-spec.md` and the multi-record `{run-id}/spec-{n}/work/{n}-spec.md`.
const SPEC_FILE_RE = /\/work\/(\d+)-spec\.md$/;

// Record numbers whose materialized spec file was newly ADDED between `sinceSha`
// (exclusive — the last bump, or nothing when there has never been one) and `HEAD`.
// Added-only: an edit to an already-tracked spec file, or a rename/delete, is not a
// new arrival and must not re-trigger the gate for a record already accounted for.
function materializedRecordsSince(deps, sinceSha) {
  const range = `${sinceSha || EMPTY_TREE}..HEAD`;
  const out = deps.git(['diff', '--name-status', range, '--', PIPELINES_PATH]);
  const records = new Set();
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split('\t');
    if (cols[0] !== 'A') continue; // added-only — see above
    const m = SPEC_FILE_RE.exec(cols[cols.length - 1]);
    if (m) records.add(Number(m[1]));
  }
  return [...records].sort((a, b) => a - b);
}

// Given the newest bump commit reachable from `main`, lists which records
// materialized since then are named neither in `summary` (the text about to become
// this release's CHANGELOG entry) nor in CHANGELOG.md's current newest entry (a
// record already backfilled ahead of time, per `docs/releasing.md`'s backfill
// procedure). `allow` is the explicit `--allow-unnamed` override — those records are
// reported separately in `allowed`, never counted toward `unnamed`.
function unnamedRecordsGate(deps, { summary = '', allow = [] } = {}) {
  // Only the newest bump is ever used below — draining the whole generator (the
  // previous `[...iterBumpCommits(...)]`) walked every commit that ever touched the
  // manifest, all the way to the repo root, paying the expected-to-fail
  // new-path-then-legacy-path probe (`manifest-path.js`) on every pre-#418 commit
  // along the way — ~490 lines of `fatal: ... exists on disk, but not in ...` git
  // stderr noise on a single `release.js --dry-run` (#2363). `.next()` stops the
  // walk the instant the first (newest) bump is found.
  const lastBump = iterBumpCommits(deps, 'main').next().value || null;
  const records = materializedRecordsSince(deps, lastBump ? lastBump.sha : null);

  const allowSet = new Set(allow);
  const allowed = records.filter((n) => allowSet.has(n));
  const candidates = records.filter((n) => !allowSet.has(n));

  if (candidates.length === 0) return { records, unnamed: [], allowed, lastBump };

  const { missing: afterSummary } = recordsNamedIn(summary || '', candidates);
  let unnamed = afterSummary;
  if (unnamed.length > 0) {
    // Scan every past CHANGELOG entry, not just the newest — a record can
    // re-enter materializedRecordsSince's added set many releases after it
    // actually shipped (e.g. a reconcile archive-move commit that re-adds
    // its spec file at a new path), and is invisible to a single-entry
    // check unless it happens to be re-mentioned in the immediately
    // preceding release.
    const entries = parseChangelogVersions(deps.readFile(CHANGELOG));
    const haystack = entries.map((e) => `${e.title}\n${e.body}`).join('\n');
    unnamed = recordsNamedIn(haystack, unnamed).missing;
  }
  return { records, unnamed, allowed, lastBump };
}

module.exports = { materializedRecordsSince, unnamedRecordsGate, PIPELINES_PATH, SPEC_FILE_RE, EMPTY_TREE };
