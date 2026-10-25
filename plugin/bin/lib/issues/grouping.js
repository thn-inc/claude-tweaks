// bin/lib/issues/grouping.js
// Pure: partition claimed issues into groups whose target files overlap, and
// extract the file(s) an issue concerns straight from its body — used at
// dispatch time. Health-sweep records are read from their origin-specific
// header lines; every other record (a /specify-produced sub-issue, a /capture
// record) is read from the `### Key Files` subsection its body already carries.
'use strict';

const { normalizeLabelNames, extractSection } = require('./record');

// A path referenced by at least this many items, OR at least this fraction
// of the batch (whichever is larger — see the max() below), is treated as a
// hub and excluded from union-find bridging: it still counts as a file the
// item "has", but it can never be the shared file that merges two items into
// one group. Tuned against the reported incident (#1365): a 139-record
// eligible pool where tests/ appeared in 15 records, plugin/bin/hooks.js in
// 7, plugin/bin/lib/hooks/pre-tool-use.js in 5, and docs/donts.md in 5 —
// none of which represent real coupling between those records, just a common
// generic path each happens to touch. The min-count floor keeps small
// batches (the common case: 2-5 genuinely related records) from ever
// tripping the fraction half by accident; the tradeoff, accepted
// deliberately, is that a truly coincidental full-batch match (e.g. exactly
// 3 unrelated items in a 3-item batch that all happen to cite one path) also
// gets excluded — an "anomalously large fraction" is exactly what that is,
// regardless of how small the batch happens to be.
const HUB_PATH_MIN_COUNT = 3;
const HUB_PATH_FRACTION = 0.1;

// Shared by groupByFileOverlap and detectCrossPRFileOverlap: a path referenced
// by at least `minCount` items in `items`, OR at least `fraction` of `items`
// (whichever is larger), is a "hub" -- generic churn rather than a real
// coupling/overlap signal. `getFiles(item)` extracts each item's file list;
// counted once per item (a duplicate path within one item's own list must not
// inflate its count) so hub detection reflects how many *distinct items* cite
// it. Pure; returns a Set of hub paths.
function computeHubPaths(items, getFiles, minCount, fraction) {
  const fileCounts = new Map();
  for (const item of items) {
    for (const file of new Set(getFiles(item) || [])) {
      fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
    }
  }
  const threshold = Math.max(minCount, Math.ceil(items.length * fraction));
  const hubPaths = new Set();
  for (const [file, count] of fileCounts) {
    if (count >= threshold) hubPaths.add(file);
  }
  return hubPaths;
}

// Partitions items into groups whose keyFiles overlap, directly or
// transitively (union-find over shared file paths). Items with no overlap
// to anything else in the batch are singleton groups. A file path referenced
// by an anomalously large fraction of the batch (see HUB_PATH_MIN_COUNT/
// HUB_PATH_FRACTION above, overridable via options) is excluded from the
// union-find step entirely — as is any bare directory-level entry, regardless
// of count. Such a path can never bridge two items together, though each
// item's other files still can.
function groupByFileOverlap(items, options = {}) {
  const hubPathMinCount = options.hubPathMinCount ?? HUB_PATH_MIN_COUNT;
  const hubPathFraction = options.hubPathFraction ?? HUB_PATH_FRACTION;

  const parent = new Map();
  function find(x) {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const item of items) parent.set(item.id, item.id);

  const hubPaths = computeHubPaths(items, (item) => item.keyFiles, hubPathMinCount, hubPathFraction);

  // Two independent, additive exclusions from bridging. Neither removes a file
  // from an item's keyFiles — only its eligibility to bridge two items here:
  //   - a hub path (counted above, #1365);
  //   - a bare directory-level entry (trailing "/", no filename component —
  //     "tests/", "plugin/skills/"), which is syntactically generic no matter
  //     how few records cite it, so two records sharing only one would
  //     otherwise still union transitively below the hub threshold (#1420).
  const fileToId = new Map();
  for (const item of items) {
    for (const file of item.keyFiles || []) {
      if (hubPaths.has(file) || file.endsWith('/')) continue;
      if (fileToId.has(file)) union(item.id, fileToId.get(file));
      else fileToId.set(file, item.id);
    }
  }

  const groups = new Map();
  for (const item of items) {
    const root = find(item.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item.id);
  }
  return [...groups.values()];
}

// A group whose member count exceeds this threshold is oversized — a second,
// independent line of defense alongside the hub-path/bare-directory bridging
// exclusions above (#1228). Those two prevent most false unions at the
// source; this catches whatever still slips through (a batch of genuinely
// overlapping records that's just large, or a bridging rule this file
// doesn't yet anticipate) before a caller commits to running it as one
// build/test/review/wrap-up flow. Tuned the same way HUB_PATH_MIN_COUNT is
// tuned above: the reported incident was a 52-record group against a queue
// where a real bundle is size 2-3, so 10 comfortably separates "large but
// plausible" from "clearly a false union."
const GROUP_SIZE_GUARD_DEFAULT = 10;

// Splits groups into those at-or-under the size guard and those over it.
// Pure -- takes no action itself. `dispatch`'s queue-pull script (Step 2)
// uses this to exclude an oversized group from `next`'s headless
// auto-selection while still surfacing it, the same shape its existing
// blocked-exclusion report already uses (#1228's Acceptance Criteria: never
// auto-select a group above the guard without at least surfacing it).
function partitionGroupsBySizeGuard(groups, options = {}) {
  const threshold = options.groupSizeGuard ?? GROUP_SIZE_GUARD_DEFAULT;
  const withinGuard = [];
  const oversized = [];
  for (const group of groups) {
    (group.length > threshold ? oversized : withinGuard).push(group);
  }
  return { withinGuard, oversized, threshold };
}

// Fast-lane bundling (#1910): merges up to `bundleCap` singleton
// groups into one multi-spec group when every member carries
// `ceremony:fast-lane`, so a dispatch firing shares one preflight/wrap-up
// tail across several small records instead of paying it once per record
// (the #1535 evidence: ~24min preflight + ~27min wrap-up on a size:low
// single-module fix). Disjoint Key Files is NOT guaranteed by construction
// once every record is its own group (buildDispatchGroups, #3278): two
// singletons may share a specific, non-hub file. A caller that needs the
// bundle to stay disjoint passes `options.conflicts`, and no bundle then
// holds two records for which it returns true. What this function adds on top
// of "is a fast-lane singleton": never crossing a `priority:*` band, and only
// bundling records that agree on `auto:merge` presence — a merge-authorization
// grant a bundle must not silently mix across.
//
// `groups`: dispatch groups (single records, from buildDispatchGroups) as full issue objects
// (each carrying `.number`, `.labels`, `.createdAt` — the shape
// queue-pull-script.md already builds before calling this). A group that
// already has two or more members is never touched — only singletons are
// candidates for merging, so "never merge a group that already has two or
// more members" holds by construction, not by an extra check.
//
// `options.bundleCap` caps how many singletons merge into one bundle
// (default 3). A cap of 1 or less disables bundling entirely and returns the
// input unchanged, byte-for-byte (AC3's `dispatch-fastlane-bundle-cap: 0`
// case; 1 is equally a no-op since there is nothing to merge a lone record
// with).
//
// `options.conflicts` is an optional `(numberA, numberB) => boolean`
// (default: never conflicts). Chunking is first-fit over the open chunks in
// sorted order: each issue joins the earliest chunk that has fewer than
// `bundleCap` members and no member it conflicts with, else starts a new
// chunk. With no conflicts this is the same fixed-size slicing as before.
//
// Returns `{ groups, bundles }` — `groups` is the full output list, every
// input group appearing exactly once, either untouched or folded into a
// bundle; `bundles` lists only the groups this pass actually created,
// `{ records: number[] }[]`, oldest-first within each, for a caller
// (queue-pull-script.md) that wants to report which groups are fast-lane
// bundles versus ordinary unbundled groups.
const FASTLANE_BUNDLE_CAP_DEFAULT = 3;

function bundleFastLaneSingletons(groups, options = {}) {
  const bundleCap = options.bundleCap ?? FASTLANE_BUNDLE_CAP_DEFAULT;
  const conflicts = options.conflicts ?? (() => false);
  if (!(bundleCap > 1)) return { groups, bundles: [] };

  const passthrough = [];
  const eligible = [];
  for (const group of groups) {
    if (group.length !== 1) { passthrough.push(group); continue; }
    const issue = group[0];
    if (!normalizeLabelNames(issue.labels).includes('ceremony:fast-lane')) {
      passthrough.push(group);
      continue;
    }
    eligible.push(issue);
  }

  // Bucket by (auto:merge presence, priority band) — never merge across
  // either axis.
  const buckets = new Map();
  for (const issue of eligible) {
    const names = normalizeLabelNames(issue.labels);
    const autoMerge = names.includes('auto:merge');
    const priority = names.find((n) => n.startsWith('priority:')) || 'none';
    const key = `${autoMerge}|${priority}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(issue);
  }

  const bundles = [];
  for (const bucket of buckets.values()) {
    const sorted = bucket.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const chunks = [];
    for (const issue of sorted) {
      const open = chunks.find((chunk) => chunk.length < bundleCap
        && !chunk.some((member) => conflicts(member.number, issue.number) || conflicts(issue.number, member.number)));
      if (open) open.push(issue);
      else chunks.push([issue]);
    }
    for (const chunk of chunks) {
      if (chunk.length > 1) bundles.push(chunk);
      else passthrough.push(chunk);
    }
  }

  return {
    groups: [...passthrough, ...bundles],
    bundles: bundles.map((chunk) => ({ records: chunk.map((issue) => issue.number) })),
  };
}

// Pairwise (direct, non-transitive) file overlap (#3278). `items`:
// [{ id, keyFiles }]. Returns Map<id, [{ id, files }]> — every pair of items
// sharing at least one linking file appears under both ids, `files` sorted,
// neighbours in `items` order. A pair with no shared linking file is absent,
// and an id with no neighbour has no entry. A linking file is any keyFile that
// is neither a hub over `items` (same computeHubPaths rule and defaults as
// groupByFileOverlap, overridable via options) nor a bare directory entry.
function directOverlaps(items, options = {}) {
  const hubPathMinCount = options.hubPathMinCount ?? HUB_PATH_MIN_COUNT;
  const hubPathFraction = options.hubPathFraction ?? HUB_PATH_FRACTION;
  const hubPaths = computeHubPaths(items, (item) => item.keyFiles, hubPathMinCount, hubPathFraction);

  const filesToIds = new Map();
  for (const item of items) {
    for (const file of new Set(item.keyFiles || [])) {
      if (hubPaths.has(file) || file.endsWith('/')) continue;
      if (!filesToIds.has(file)) filesToIds.set(file, []);
      filesToIds.get(file).push(item.id);
    }
  }

  const shared = new Map();
  for (const [file, ids] of filesToIds) {
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        if (!shared.has(a)) shared.set(a, new Map());
        const forA = shared.get(a);
        if (!forA.has(b)) forA.set(b, []);
        forA.get(b).push(file);
      }
    }
  }

  const order = new Map(items.map((item, index) => [item.id, index]));
  const result = new Map();
  for (const [id, neighbours] of shared) {
    result.set(id, [...neighbours]
      .sort(([x], [y]) => order.get(x) - order.get(y))
      .map(([neighbourId, files]) => ({ id: neighbourId, files: files.sort() })));
  }
  return result;
}

// Which in-flight records share a specific file with each candidate (#3278).
// Both inputs are [{ id, keyFiles }]. Overlap is computed over the union
// (candidates first, so hubs are judged over the whole pool); an in-flight item
// whose id is also a candidate id is dropped, so a candidate is never its own
// neighbour. Returns Map<candidateId, [{ number, files }]> where `number` is the
// in-flight id; every candidate id has an entry, `[]` when none.
function findInFlightNeighbours(candidates, inFlight, options = {}) {
  const candidateIds = new Set(candidates.map((c) => c.id));
  const liveIds = new Set();
  const live = [];
  for (const item of inFlight || []) {
    if (candidateIds.has(item.id) || liveIds.has(item.id)) continue;
    liveIds.add(item.id);
    live.push(item);
  }
  const overlaps = directOverlaps([...candidates, ...live], options);
  const result = new Map();
  for (const candidate of candidates) {
    result.set(candidate.id, (overlaps.get(candidate.id) || [])
      .filter((edge) => liveIds.has(edge.id))
      .map((edge) => ({ number: edge.id, files: edge.files })));
  }
  return result;
}

// Per-record dispatch groups (#3278): every eligible issue is its own
// single-record group, instead of the transitive file-overlap chains
// groupByFileOverlap builds. Fast-lane bundling then folds only singletons that
// share no direct linking file. `issues`: [{ number, body, labels, createdAt }].
// Returns bundleFastLaneSingletons's `{ groups, bundles }`.
function buildDispatchGroups(issues, options = {}) {
  const items = issues.map((issue) => ({ id: issue.number, keyFiles: extractKeyFiles(issue) }));
  const overlaps = directOverlaps(items, options);
  const conflicts = (a, b) => (overlaps.get(a) || []).some((edge) => edge.id === b);
  return bundleFastLaneSingletons(issues.map((issue) => [issue]), { bundleCap: options.bundleCap, conflicts });
}

// A path touched by this large a fraction of the *open-PR pool* is generic
// churn (a re-edited SKILL.md, docs/donts.md, a shared test fixture) rather
// than evidence two records fix the same root cause — the same rationale as
// HUB_PATH_MIN_COUNT/HUB_PATH_FRACTION above (#1365), computed over open PRs
// instead of over the candidate batch, since the pools being compared here
// are different (an eligible dispatch candidate's keyFiles vs. an unrelated
// open PR's changed files, not candidate-to-candidate).
const CROSS_PR_HUB_MIN_COUNT = 3;
const CROSS_PR_HUB_FRACTION = 0.2;

// candidates: [{number, keyFiles}], openPRs: [{number, files, closingIssueNumbers}]
// -> [{candidate, pr, files}], one entry per (candidate, PR) pair whose file
// sets share at least one non-hub, non-directory path (#1579's AC1 signal).
//
// This is deliberately NOT the same check PR #1572 (fixing #1224) already
// shipped: that one excludes a candidate from eligibility when its OWN linked
// PR (a closing-keyword or "Development" reference to that same issue number)
// is still open — a re-dispatch guard, issue-scoped and self-referential. It
// says nothing about two DIFFERENT issues independently diagnosing the same
// root cause (the #1410/#1402 case this record documents), where the open PR
// in question belongs to the *other* issue, not the candidate. A PR that
// already closes/links the candidate itself is excluded here via
// `closingIssueNumbers` — that pair is #1224's exclusion to make, not a
// cross-issue duplicate for this function to also flag.
//
// Pure and read-only. Per #1579's AC2, this never removes a candidate from
// eligibility — it only reports a same-file overlap for a human (or a
// headless firing's decisions.md) to see and choose to serialize. False-
// positive sources evaluated: (1) generic/hub paths, excluded by the
// hub-path threshold above; (2) bare directory-level entries (no filename
// component), excluded the same way groupByFileOverlap excludes them (#1420);
// (3) a candidate's own linked PR, excluded via closingIssueNumbers so this
// never doubles up on #1224's own signal. What's left — two independent
// records whose declared/inferred key files hit the same specific,
// non-generic path while an unrelated PR referencing neither of them is
// still open — is a small, deliberately noisy-favoring residual: a real
// coincidence (two unrelated fixes to one busy-but-not-hub file) still
// surfaces, but only as an informational line, never a block, exactly what
// AC2 asks for ("a documented fallback for 'unclear'").
function detectCrossPRFileOverlap(candidates, openPRs, options = {}) {
  const hubMinCount = options.hubPathMinCount ?? CROSS_PR_HUB_MIN_COUNT;
  const hubFraction = options.hubPathFraction ?? CROSS_PR_HUB_FRACTION;
  const pool = openPRs || [];
  const hubPaths = computeHubPaths(pool, (pr) => pr.files, hubMinCount, hubFraction);

  // A path specific enough to carry the signal: a real filename (not a bare
  // directory entry, #1420) that isn't generic open-PR churn (a hub path).
  function isSignal(file) {
    if (typeof file !== 'string' || file === '' || file.endsWith('/')) return false;
    return !hubPaths.has(file);
  }

  const overlaps = [];
  for (const candidate of candidates || []) {
    // Every member is already a signal path, so the PR-side filter below needs
    // no second isSignal check.
    const keyFiles = new Set((candidate.keyFiles || []).filter(isSignal));
    if (keyFiles.size === 0) continue;
    for (const pr of pool) {
      if ((pr.closingIssueNumbers || []).includes(candidate.number)) continue;
      const shared = (pr.files || []).filter((file) => keyFiles.has(file));
      if (shared.length > 0) {
        const overlap = { candidate: candidate.number, pr: pr.number, files: shared };
        // Additive attribution (#1985): a caller that tags its pool entries
        // with `source` (e.g. 'drain' for a PR this same firing opened,
        // distinct from the pre-drain snapshot) gets that source carried
        // onto the matching overlap entry, so a re-check against a UNION of
        // pre-drain + in-flight-drain PRs can tell which pool a hit came
        // from without re-deriving it. Omitted entirely (not even `source:
        // undefined`) when the caller's pool entries carry no `source` at
        // all, so every existing caller's output stays byte-identical.
        if (pr.source !== undefined) overlap.source = pr.source;
        overlaps.push(overlap);
      }
    }
  }
  return overlaps;
}

const ANCHOR_RE = /Anchor:\s*`([^`#]+)/;
const FILES_LINE_RE = /^Files:\s*(.+)$/m;
// Matches the first bold "**Label:** value" field of a spec-shaped issue
// header (e.g. "**Skill:** path | **Section:** ..." or "**Journey:** path |
// ...") — the shape harness-health and journey-health both use. The value
// itself is captured up to the next " | " field separator (or end of line)
// rather than stopping at the first whitespace character, so a target path
// containing a literal space (e.g. "docs/User Guide.md") extracts intact —
// matching code-health's ANCHOR_RE/FILES_LINE_RE above, which already
// preserve spaces for the identical extraction purpose.
const BOLD_HEADER_RE = /^\*\*[^:*]+:\*\*\s*([^|]+?)\s*(?:\||$)/m;

// A health skill's origin label appears either in the bare pre-migration form
// (code-health, harness-health — the only two that predate the by:* origin
// migration) or the post-6.0 `by:*` form (skills/_shared/work-record.md).
// Records filed before and after the migration must group identically.
function hasOrigin(names, origin) {
  return names.includes(origin) || names.includes(`by:${origin}`);
}

// Extracts the file path from a spec-shaped bold header line ("**Label:**
// value | ..."), or [] when the body has no such header. Shared core logic
// for harness-health, journey-health, and docs-health issue bodies — all
// three use the same header shape (BOLD_HEADER_RE above).
function extractBoldHeaderFile(body) {
  const targetHeader = BOLD_HEADER_RE.exec(body);
  return targetHeader ? [targetHeader[1]] : [];
}

// The `### Key Files` subsection lives under `## Technical Approach` in every
// record /claude-tweaks:specify shapes (skills/specify/spec-template.md), one
// backticked path per list item followed by an optional annotation:
//   - `path/to/file.md` (create)
//   - `path/to/other.md` (modify — why, with commas, **and bold**)
const LIST_ITEM_RE = /^[ \t]*[-*][ \t]+(.+)$/;
const BACKTICKED_RE = /`([^`]+)`/;
// spec-template.md ships the literal "- `{path}` — {what changes}". A record
// still carrying the unfilled template must not union with every other one.
const TEMPLATE_PLACEHOLDER_RE = /^\{.*\}$/;

// Extracts the paths listed under a body's `### Key Files` subsection, or []
// when the body has no such subsection — the documented absence case, not an
// error (skills/specify/decomposition-mode.md: records without one "contribute
// nothing to the map — skip silently"). Boundary-finding (tolerates `##`..`####`
// so a re-nested body still parses; the section always ends at the next heading
// of any level — Gotchas routinely names files in backticks, and scraping those
// would union records on an incidental mention) comes from record.js's shared
// extractSection, at its own default options — the same h2-h4/any-heading-stop
// shape this function always used.
function extractKeyFilesSection(body) {
  const section = extractSection(body, 'Key Files');
  if (!section) return [];

  const files = [];
  for (const line of section.split('\n')) {
    const item = LIST_ITEM_RE.exec(line);
    if (!item) continue;
    // First backticked span wins: it drops the trailing annotation, and an item
    // naming an alternative (``- `a/tests/` or `tests/` ``) yields the primary
    // path rather than both. Matching the annotation would also re-introduce
    // code-health's comma-splitting bug on "(modify — Step 1, Step 2)".
    const backticked = BACKTICKED_RE.exec(item[1]);
    if (!backticked) continue;
    const file = backticked[1].trim();
    if (!file || TEMPLATE_PLACEHOLDER_RE.test(file)) continue;
    files.push(file);
  }
  return files;
}

// issue: { labels } shaped like `gh api .../issues/{n}` output. True when
// extractKeyFiles reads this issue via the `### Key Files` fallthrough branch
// below (a /specify-produced sub-issue, a /capture record, or a hand-filed
// one) rather than one of the four health-sweep origin headers — i.e. when an
// empty extractKeyFiles([]) result for this issue is actually meaningful (the
// record was supposed to carry a `### Key Files` subsection and doesn't) as
// opposed to expected-and-correct (a health-sweep record's own header shape
// legitimately has no such section, or a harness-health new-skill candidate
// that explicitly returns [] regardless). Callers that want to warn on an
// empty extraction — multi-spec.md's Cross-spec conflict detection,
// dispatch's queue-pull-script.md, help/status-scan.md's Conflict detection —
// gate the warning on this, so the four health-sweep origins never trip it.
function expectsKeyFilesSection(issue) {
  const names = normalizeLabelNames(issue && issue.labels);
  return !hasOrigin(names, 'code-health')
    && !hasOrigin(names, 'harness-health')
    && !hasOrigin(names, 'journey-health')
    && !hasOrigin(names, 'docs-health');
}

// issue: { body, labels } shaped like `gh api .../issues/{n}` output.
// Returns string[] of file paths, [] when nothing is extractable.
function extractKeyFiles(issue) {
  const body = (issue && issue.body) || '';
  const names = normalizeLabelNames(issue && issue.labels);

  if (hasOrigin(names, 'code-health')) {
    const anchor = ANCHOR_RE.exec(body);
    if (anchor) return [anchor[1]];
    const filesLine = FILES_LINE_RE.exec(body);
    if (filesLine && filesLine[1].trim() !== '(no specific file)') {
      return filesLine[1].split(',').map((f) => f.trim()).filter(Boolean);
    }
    return [];
  }

  if (hasOrigin(names, 'harness-health')) {
    // A new-skill candidate proposes content, it doesn't concern an existing
    // file — its header line ("**New skill candidate** | ...") has no colon
    // inside the bold run, so BOLD_HEADER_RE fails to match it and would
    // otherwise scan forward into the embedded proposedBody markdown (which
    // commonly contains its own bold, colon-terminated, line-starting labels)
    // and return a wrong, unrelated file path. Short-circuit instead.
    if (names.includes('harness-health:new-skill')) return [];
    return extractBoldHeaderFile(body);
  }

  if (hasOrigin(names, 'journey-health') || hasOrigin(names, 'docs-health')) {
    // journey-health and docs-health were both born after the by:* origin
    // migration, so neither ever had a bare pre-migration label (label-
    // bootstrap.md only ever registers by:journey-health / by:docs-health) —
    // hasOrigin's bare-form check is a no-op for every real record today,
    // kept only for symmetry with code-health/harness-health above. Both
    // issue headers ("**Journey:** {path} | **Section:** ...", bin/lib/
    // journey-health/issue-payload.js; "**Doc:** {path} | **Section:** ...",
    // bin/lib/docs-health/issue-payload.js) are the same bold-field shape as
    // harness-health's, so the same extraction applies to both.
    return extractBoldHeaderFile(body);
  }

  // Fallthrough — every record that is not one of the four health sweeps: a
  // /claude-tweaks:specify-produced sub-issue, a /claude-tweaks:capture record, a
  // hand-filed one. These carry no by:* origin header to key off, but a shaped
  // body already lists its targets under `### Key Files`.
  //
  // This must stay BELOW the four branches above, which all return early. An
  // origin-labelled record whose body happens to contain a `### Key Files`
  // heading is still read from its own header line, not from here ([IL-83]).
  return extractKeyFilesSection(body);
}

// Parses a comma-joined, optionally "#"-prefixed issue-number argument (the
// explicit-list dispatch form, e.g. "#123, #124,#130") into an array of
// issue numbers. Non-numeric entries are dropped, not thrown — a malformed
// entry in an otherwise-valid list shouldn't abort the whole parse.
// Parses a dispatch `#N[,#M...]` explicit-list argument per
// `_shared/record-batch-input.md`'s grammar: split on comma, trim each
// element, classify. Returns `{ numbers, invalid }` — `numbers` is every
// element that classified as a record reference (parsed to a positive
// integer; the `#` sigil is optional), in list order; `invalid` is every
// element that did not, also in list order, each `{ token, reason }` —
// `token` the trimmed (possibly empty) element as typed, `reason` the
// contract's canonical naming ("'{element}' is not a record reference" /
// "empty element after #{prev}"). This function performs classification
// only — whether dispatch reports `invalid` and proceeds with `numbers`
// anyway, or aborts entirely, is dispatch's own execution semantics
// (`_shared/record-batch-input.md`'s Out-of-scope section), decided by the
// caller, never by this function.
function parseExplicitIssueList(argString) {
  const trimmedArg = (argString || '').trim();
  if (trimmedArg === '') return { numbers: [], invalid: [] };
  const numbers = [];
  const invalid = [];
  let prev = null;
  for (const raw of trimmedArg.split(',')) {
    const el = raw.trim();
    if (el === '') {
      invalid.push({ token: el, reason: prev !== null ? `empty element after #${prev}` : 'empty element' });
      continue;
    }
    const n = Number(el.replace(/^#/, ''));
    if (Number.isInteger(n) && n > 0) {
      numbers.push(n);
      prev = n;
    } else {
      invalid.push({ token: el, reason: `'${el}' is not a record reference` });
    }
  }
  return { numbers, invalid };
}

// Given a set of requested issue numbers and dispatch Step 2's already-
// computed groups (arrays of full issue objects), returns the deduplicated
// groups containing at least one requested number, plus any requested
// numbers found in none of them (not currently eligible — already claimed,
// grant stripped, or never existed). selectedGroups are in named order: each
// group sits at the earliest position any of its members holds in
// requestedNumbers, ties keeping pool order (#4219). With batchSize (dispatch-
// batch-size), only the first batchSize ordered groups are selected and the
// requested numbers in the rest come back as deferredByCap, in requested order.
function selectGroupsForExplicitList(requestedNumbers, groups, batchSize) {
  if (batchSize !== undefined && !(Number.isInteger(batchSize) && batchSize > 0)) {
    throw new TypeError(`batchSize must be a positive integer, got ${batchSize}`);
  }
  const position = new Map();
  requestedNumbers.forEach((n, i) => { if (!position.has(n)) position.set(n, i); });
  const matched = [];
  const foundNumbers = new Set();
  for (const group of groups) {
    const groupNumbers = group.map((issue) => issue.number);
    const ranks = groupNumbers.filter((n) => position.has(n)).map((n) => position.get(n));
    if (ranks.length > 0) {
      matched.push({ group, rank: Math.min(...ranks) });
      groupNumbers.forEach((n) => foundNumbers.add(n));
    }
  }
  matched.sort((a, b) => a.rank - b.rank); // Array#sort is stable: ties keep pool order
  const ordered = matched.map((m) => m.group);
  const selectedGroups = batchSize === undefined ? ordered : ordered.slice(0, batchSize);
  const deferred = new Set(ordered.slice(selectedGroups.length).flatMap((group) => group.map((issue) => issue.number)));
  const deferredByCap = [...position.keys()].filter((n) => deferred.has(n));
  const notFound = requestedNumbers.filter((n) => !foundNumbers.has(n));
  return { selectedGroups, deferredByCap, notFound };
}

module.exports = { groupByFileOverlap, GROUP_SIZE_GUARD_DEFAULT, partitionGroupsBySizeGuard, bundleFastLaneSingletons, FASTLANE_BUNDLE_CAP_DEFAULT, extractKeyFiles, extractKeyFilesSection, expectsKeyFilesSection, parseExplicitIssueList, selectGroupsForExplicitList, hasOrigin, detectCrossPRFileOverlap, CROSS_PR_HUB_MIN_COUNT, CROSS_PR_HUB_FRACTION, directOverlaps, findInFlightNeighbours, buildDispatchGroups };
