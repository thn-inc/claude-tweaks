'use strict';
const fs = require('fs');
const path = require('path');
const { STALE_DAYS_LIGHT, STALE_DAYS_DEEP } = require('./score');
const { selectByStaleThenChurn } = require('../health-core/rotation');
const { parseFrontmatterListField } = require('../health-core/frontmatter-list');
const { domainChurn } = require('../health-core/churn');
const { toPosix } = require('../shared-primitives');

// ─── parseJourneyFiles ───────────────────────────────────────────────────────
// Extracts a journey file's `files:` frontmatter list, e.g.:
//   ---
//   files:
//     - src/checkout/Cart.tsx
//   ---
// Returns [] if there's no frontmatter, no `files:` key, or no list items —
// an unparseable header means "no declared domain," not an error. Thin
// wrapper over the shared parser (bin/lib/health-core/frontmatter-list.js),
// which also backs harness-health/scope.js's parseRulePaths and
// docs-health/freshness.js's parseFilesField — same bullet-list shape,
// different frontmatter key.
function parseJourneyFiles(content) {
  return parseFrontmatterListField(content, 'files');
}

// ─── caches ──────────────────────────────────────────────────────────────────
// selectTarget is called once per slot in a --budget > 1 loop (see
// journey-health.js's cmdNextTarget), and nothing on disk changes between
// slots of the same run. Without caching, every slot redid the full
// docs/journeys readdir+readFile scan (listJourneys) — purely wasted I/O that
// scaled with budget times journey count. Keyed on inputs that only change
// when the underlying data actually could, so a call repeated with the same
// inputs in the same process reuses the prior result instead of redoing the
// I/O; a call whose inputs genuinely changed (a journey file edited) still
// gets a fresh read. domainChurn (the git-log-based churn counter, also
// memoized) now lives in bin/lib/health-core/churn.js, shared with
// harness-health/scope.js and docs-health/scope.js — see the require at the
// top of this file.
const journeysCache = new Map(); // root -> { fingerprint, journeys }

// ─── listJourneys ────────────────────────────────────────────────────────────
// Returns [{ kind: 'journey', id, path, filesFrontmatter }] for each
// docs/journeys/*.md file, sorted by id. Empty array if the directory doesn't
// exist — a project with no journeys yet is a valid state, not an error.
// Caches the parsed result per root, validated on each call against a cheap
// name+mtime+size fingerprint (stat only, no content read) — so repeated
// calls in the same process skip the expensive readFileSync+parse work
// unless a journey file was actually added, removed, or modified.
function listJourneys(root) {
  const dir = path.join(root, 'docs', 'journeys');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));

  const fingerprint = mdFiles
    .map((e) => {
      try {
        const st = fs.statSync(path.join(dir, e.name));
        return `${e.name}:${st.mtimeMs}:${st.size}`;
      } catch {
        return `${e.name}:?`;
      }
    })
    .sort()
    .join('|');

  const cached = journeysCache.get(root);
  if (cached && cached.fingerprint === fingerprint) return cached.journeys;

  const journeys = mdFiles
    .map((e) => {
      const filePath = path.join(dir, e.name);
      let content = '';
      try { content = fs.readFileSync(filePath, 'utf8'); } catch { /* unreadable -> no files */ }
      return { kind: 'journey', id: e.name.slice(0, -3), path: filePath, filesFrontmatter: parseJourneyFiles(content) };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  journeysCache.set(root, { fingerprint, journeys });
  return journeys;
}

// ─── glob-aware file existence check ────────────────────────────────────────
// Phase 0's "deleted file" signal (below) needs real existence for both
// literal `files:` entries (a plain relative path) and glob entries (e.g.
// "docs/research/competitors/*.md") — a naive fs.existsSync on the raw glob
// string always reports "missing" (no file is literally named "*.md"),
// permanently force-picking any journey that declares one (#73). Minimal
// glob support by design, matching this codebase's existing narrow
// conventions (bin/lib/issues/blast-radius.js, bin/lib/code-health/scope.js):
// only `*` is a wildcard, confined to the final path segment (no `**`, no
// wildcard in a directory segment). A pattern outside that shape is treated
// as always-present — skipping the heuristic for that entry rather than
// risking a false "missing", per #73's own suggested fallback.
function journeyFileExists(root, relPath) {
  if (!relPath.includes('*')) return fs.existsSync(path.join(root, relPath));

  const dir = path.dirname(relPath);
  const base = path.basename(relPath);
  if (dir.includes('*')) return true; // wildcard outside the final segment: unsupported, don't false-flag

  let entries;
  try { entries = fs.readdirSync(path.join(root, dir)); } catch { return false; }
  const pattern = base.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*');
  const re = new RegExp(`^${pattern}$`);
  return entries.some((name) => re.test(name));
}

// ─── deleted-file acknowledgement signature (#131) ──────────────────────────
// The set of declared `files:` entries that don't exist on disk right now,
// preserving the frontmatter's own order (the finding text reads better that
// way); deletedFileSignature is what gets compared, and it sorts.
function missingJourneyFiles(root, filesFrontmatter) {
  return (filesFrontmatter || []).filter((relPath) => !journeyFileExists(root, relPath));
}

// A stable, order-independent identity for one journey's missing-file state,
// recorded onto that journey's cursor by the audit that follows a Phase 0
// pick (see buildValidateFindingsUpdate in cache.js) and compared against the
// live tree by Phase 0 below. null means "nothing missing" — there is no
// acknowledgement to record, and any previously recorded one is cleared.
function deletedFileSignature(missingFiles) {
  if (!missingFiles || missingFiles.length === 0) return null;
  return [...missingFiles].sort().join('|');
}

// The signature for one journey id as of the tree right now — recomputed at
// audit-completion time rather than carried over from the next-target call,
// so a journey whose frontmatter was fixed (or whose file was restored)
// during the audit records the corrected state, not the state that selected
// it. A journey id with no matching file resolves to null, same as one with
// nothing missing.
function currentDeletedFileSignature(root, journeyId) {
  const journey = listJourneys(root).find((j) => j.id === journeyId);
  if (!journey) return null;
  return deletedFileSignature(missingJourneyFiles(root, journey.filesFrontmatter));
}

// ─── selectTarget ────────────────────────────────────────────────────────────
// opts: { now?: number, tier?: 'light'|'deep', signals?: { [id]: number } }
// Returns { kind: 'journey', id, path, filesFrontmatter, why: 'stale'|'hotspot', ... } or null.
// Light and deep tiers use independent staleness thresholds and independent
// cursor fields (lastLightAuditMs vs lastDeepAuditMs) — a journey force-picked
// as light-stale is not automatically deep-stale too, and vice versa.
function selectTarget(root, cursors, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const tier = opts.tier === 'deep' ? 'deep' : 'light';
  const signals = opts.signals || null; // test injection hook — churn override by id
  // Within-batch dedup for --budget > 1 callers, Phase 0 only. Phases 1/2
  // already self-exclude a just-picked journey via the cursor bump the
  // --budget loop applies after every pick (daysSince/churn-since-bump both
  // read as ~0); Phase 0 keys off the deletedFileSig cursor field instead,
  // which the --budget loop's in-memory patch does not simulate, so it needs
  // its own within-batch exclusion signal or it would return the same
  // deleted-file journey on every remaining slot in the batch. This is the
  // within-run analogue of the cross-run suppression below.
  const alreadyPicked = opts.alreadyPicked || null;
  const staleDays = tier === 'deep' ? STALE_DAYS_DEEP : STALE_DAYS_LIGHT;
  const auditField = tier === 'deep' ? 'lastDeepAuditMs' : 'lastLightAuditMs';

  const candidates = listJourneys(root);

  // Phase 0 (light tier only): force-pick any journey with a declared file
  // that no longer exists. This is a stronger, more certain signal than
  // staleness or churn, and requires no LLM judgment to detect — a plain
  // existence check. Deep tier does not get this phase: its own
  // post-selection "skip condition" (SKILL.md Step 3.5) already handles a
  // broken journey without permanently parking the deep-tier rotation on it.
  // Not part of the shared rotation core (health-core/rotation.js) — it has
  // no analogue in the other three engines' Phase 1/2 shape, so it stays
  // here and only calls into the shared core for its own Phase 1/2 once
  // Phase 0 has had its chance to return first.
  //
  // Once-per-missing-set, not once-per-run (#131): the force-pick is
  // suppressed for a journey whose cursor already records THIS EXACT missing
  // set (`deletedFileSig`, written by the audit that followed the last Phase
  // 0 pick — see cache.js's buildValidateFindingsUpdate). Without that,
  // Phase 0 re-picked the same journey on every firing forever, because a
  // genuinely deleted file stays deleted until a human fixes the frontmatter
  // — one broken journey starved the entire rotation (observed: 16 of 17
  // journeys never audited across ~9 days of daily runs), and the repeat pick
  // was invisible in the issue stream because dedup swallowed the duplicate
  // finding. Suppression is per missing-set, not per journey, so a NEW
  // deletion behind an already-reported one still force-picks immediately;
  // an unfixed one is left to Phase 1's staleness floor, which re-audits it
  // on the normal 30-day rotation. #73 fixed the adjacent glob false-positive
  // (journeyFileExists above); this is the real-missing-file case.
  if (tier === 'light') {
    for (const candidate of candidates) {
      if (alreadyPicked && alreadyPicked.has(candidate.id)) continue;
      const missing = missingJourneyFiles(root, candidate.filesFrontmatter);
      if (missing.length === 0) continue;
      const signature = deletedFileSignature(missing);
      const cursor = cursors ? cursors[candidate.id] : null;
      if (cursor && cursor.deletedFileSig === signature) continue; // already reported
      return { ...candidate, why: 'deleted-file', missingFiles: missing, deletedFileSig: signature };
    }
  }

  return selectByStaleThenChurn(candidates, cursors, {
    now,
    staleDays,
    getCursorKey: (candidate) => candidate.id,
    getLastAuditedMs: (cursor) => (cursor && cursor[auditField] != null ? cursor[auditField] : null),
    // Score by churn on filesFrontmatter since last audit on this tier,
    // UNION the journey file's own path — mirrors docs-health/scope.js's
    // [relDocPath, ...domainPaths] union, so a journey that's been heavily
    // hand-rewritten (its narrative changed substantially) still registers
    // churn even when its declared `files:` dependencies haven't themselves
    // seen matching commits.
    computeScore: (candidate, cursor, sinceMs) => {
      if (signals) {
        const churn = signals[candidate.id] || 0;
        return churn > 0 ? churn : null;
      }
      const relJourneyPath = toPosix(path.relative(root, candidate.path));
      const churn = domainChurn(root, [relJourneyPath, ...candidate.filesFrontmatter], sinceMs);
      return churn > 0 ? churn : null;
    },
    buildHotspotResult: (candidate, score) => ({ ...candidate, why: 'hotspot', churnCount: score }),
  });
}

module.exports = {
  parseJourneyFiles,
  listJourneys,
  domainChurn,
  selectTarget,
  journeyFileExists,
  missingJourneyFiles,
  deletedFileSignature,
  currentDeletedFileSignature,
};
