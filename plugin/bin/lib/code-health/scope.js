'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { MAX_STALE_DAYS } = require('./score');
const { selectByStaleThenChurn } = require('../health-core/rotation');
const { relativeDisplayId } = require('../shared-primitives');

const SKIP_DIRS = new Set([
  '.claude-tweaks', '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo',
  '.claude', '.worktrees',
]);
const SOURCE_EXTS = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs']);

// Byte ceiling for one emitted slice. A slice is the unit the code-health judge
// is told to read in full and hold in context (skills/code-health/SKILL.md
// Step 3), so an unbounded slice is an unbounded context read: before this cap
// existed, listSlices went exactly one level deep and this repo's own `bin`
// slice measured 1,181,325 B across 208 files. A directory over the cap is
// SPLIT into its subdirectories (never truncated — dropping files would make
// the judge silently blind to them). See splitOversized.
const MAX_SLICE_BYTES = 30 * 1024;

// ─── listSlices ──────────────────────────────────────────────────────────────
// Returns [{ id, path, recursive }] for . (root), each immediate non-SKIP subdir
// NOT covered by a workspace manifest, plus every workspace-expanded package
// slice. A top-level dir covered by a workspace pattern (e.g. "packages" when
// "packages/*" is declared) is replaced by its expanded children rather than
// also appearing as its own mega-slice.
//
// Any candidate whose recursive source-byte total exceeds MAX_SLICE_BYTES is
// then replaced by the finer-grained slices splitOversized derives from it, so
// no emitted slice is an unbounded whole-subtree read. Slice ids stay plain
// repo-relative paths at every depth (`bin`, `bin/lib`, `bin/lib/issues`), so
// cursor keys, `--area`, and `classify` keep exactly today's semantics.
function listSlices(root) {
  const slices = sourceFiles(root, { recursive: false }).length
    ? [{ id: '.', path: root, recursive: false }]
    : [];
  // Read the workspace manifest exactly once and hand the parsed patterns to
  // both consumers below — listWorkspaceSlices and fullyCoveredTopLevelDirs
  // each independently called readWorkspacePatterns(root) before, doubling
  // the package.json/pnpm-workspace.yaml read+parse on every listSlices call.
  const patterns = readWorkspacePatterns(root);
  const workspaceSlices = listWorkspaceSlices(root, patterns);
  const coveredTopLevel = fullyCoveredTopLevelDirs(root, patterns);
  const candidates = [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return slices; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (coveredTopLevel.has(entry.name)) continue;
    const absPath = path.join(root, entry.name);
    // A dot-directory (.github, .vscode, .devcontainer, .husky, ...) that
    // recursively contains zero SOURCE_EXTS files holds nothing for the
    // code-health judge to read — emitting it as a rotation candidate just
    // spends an audit slot on config/tooling files (YAML workflows, JSON
    // settings) with no judgeable source (#133). Scoped to dot-directories
    // specifically, not every directory with zero source files today: an
    // ordinary (non-dot) empty directory keeps its place in the rotation on
    // purpose (see splitOversized's "gains source files later" comment) —
    // this check must not silently defeat that guarantee for the common
    // case. A dot-directory that DOES hold real source (a hypothetical
    // `.config/`) still passes through untouched.
    if (entry.name.startsWith('.') && isEmptySourceDir(absPath)) continue;
    candidates.push({ id: entry.name, path: absPath });
  }
  candidates.push(...workspaceSlices);
  for (const candidate of candidates) splitOversized(candidate.id, candidate.path, slices);
  // fs.readdirSync order is not guaranteed by Node's API, so sort for a
  // stable emitted list across environments/checkouts of the identical repo
  // state. This is now presentation-order only, NOT the coverage mechanism:
  // selectByStaleThenChurn's Phase 1 used to be first-qualifying-wins, which
  // made this sort load-bearing (and starved everything past position
  // ≈ MAX_STALE_DAYS — #130). Phase 1 now picks the most overdue candidate
  // outright and tie-breaks equal staleness by slice id, so selection is
  // independent of the order this function returns. Sibling engines (e.g.
  // harness-health/scope.js's listSkills/listRules) sort likewise.
  slices.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return slices;
}

// ─── splitOversized ──────────────────────────────────────────────────────────
// Appends to `out` the slices that cover absDir, keeping each under
// MAX_SLICE_BYTES where the directory tree allows it:
//
//   - under the cap  → one recursive slice for the whole subtree (today's shape)
//   - over the cap   → a NON-recursive slice for the directory's own direct
//                      files (when it has any), plus a recursive descent into
//                      each immediate subdirectory, each re-tested against the
//                      cap
//   - over the cap with no subdirectory to descend into → emitted whole, over
//     the cap, because the alternative is dropping files. An oversized slice
//     splits; it never truncates. SKILL.md Step 3's read budget is what bounds
//     this residual case at read time.
//
// One `find` per candidate: the whole subtree's file list is fetched once and
// every nested total is derived from that in-memory list, rather than
// re-spawning `find` per directory visited.
//
// The node keys below are `/` display IDs (#3315): on win32 `path.relative`
// yields `one\deeper`, which the `/`-based ancestor walk and the `${rel}/${kid}`
// descent would never agree on, silently dropping every nested slice. Keys are
// normalized once at relDir and walked with path.posix; slice paths are still
// built with the native pathImpl.join because they are opened later.
// pathImpl / listFiles / sizeOf are test seams; listSlices passes none of them.
function splitOversized(id, absDir, out, {
  pathImpl = path,
  listFiles = (dir) => sourceFiles(dir, { recursive: true }),
  sizeOf = (f) => fs.statSync(f).size,
} = {}) {
  const files = listFiles(absDir);
  // A candidate with no source files at all still emits exactly one slice, as
  // it did before splitting existed — a directory that is empty today but
  // gains source files later must keep its place in the rotation rather than
  // silently vanishing from the candidate list.
  if (files.length === 0) {
    out.push({ id, path: absDir, recursive: true });
    return;
  }

  // relative-dir -> { own: bytes of direct files, total: bytes of whole subtree,
  //                   ownCount, kids: Set<childDirName> }
  const nodes = new Map();
  const nodeFor = (rel) => {
    if (!nodes.has(rel)) nodes.set(rel, { own: 0, ownCount: 0, total: 0, kids: new Set() });
    return nodes.get(rel);
  };
  nodeFor('');
  for (const file of files) {
    let size = 0;
    try { size = sizeOf(file); } catch { size = 0; }
    const relDir = relativeDisplayId(absDir, pathImpl.dirname(file), pathImpl);
    const node = nodeFor(relDir);
    node.own += size;
    node.ownCount += 1;
    // Walk up, registering this dir with each ancestor and accumulating totals.
    let cur = relDir;
    for (;;) {
      nodeFor(cur).total += size;
      if (cur === '') break;
      const parentDir = path.posix.dirname(cur);
      const parent = parentDir === '.' ? '' : parentDir;
      nodeFor(parent).kids.add(path.posix.basename(cur));
      cur = parent;
    }
  }

  const walk = (rel, sliceId) => {
    const node = nodes.get(rel);
    if (!node || node.total === 0) return;
    const abs = rel === '' ? absDir : pathImpl.join(absDir, rel);
    if (node.total <= MAX_SLICE_BYTES) {
      out.push({ id: sliceId, path: abs, recursive: true });
      return;
    }
    const kids = [...node.kids].sort();
    if (kids.length === 0) {
      // Nothing left to split by — emit whole rather than drop files.
      out.push({ id: sliceId, path: abs, recursive: true });
      return;
    }
    if (node.ownCount > 0) out.push({ id: sliceId, path: abs, recursive: false });
    for (const kid of kids) {
      walk(rel === '' ? kid : `${rel}/${kid}`, `${sliceId}/${kid}`);
    }
  };
  walk('', id);
}

// ─── contentHash ─────────────────────────────────────────────────────────────
// Deterministic SHA-1 of all source-file contents under absDir, skipping SKIP_DIRS.
// Falls back to hashing the directory listing string if find/read fails.
// recursive:false scans only direct file children of absDir (maxdepth 1) —
// used for the '.' slice, which must NOT overlap every subdirectory/
// workspace slice that already covers everything beneath root. Was
// docs/superpowers/specs/2026-07-30-durable-state-git-native-write-design.md
// — deleted (70849915).
// Throws on a scan failure instead of swallowing it — sourceFiles below
// catches this for its own degrade-to-[] contract; isEmptySourceDir below
// instead needs to tell "genuinely zero files" apart from "the scan failed"
// (review finding), so it calls this directly.
function sourceFilesRaw(absDir, { recursive = true } = {}) {
  const excludeArgs = [];
  for (const dir of SKIP_DIRS) {
    // `*/dir/*` (not `${dir}/*`) so a skip-directory is excluded wherever it
    // appears in the subtree, not only as a direct child of absDir — find's
    // -path matches against the whole path string, so `*` spans '/' and
    // matches nested occurrences too (e.g. pkg/nested/dir/*).
    excludeArgs.push('-not', '-path', `*/${dir}/*`);
  }
  const depthArgs = recursive ? [] : ['-maxdepth', '1'];
  // Scan `.` with cwd set to absDir, NOT the absolute path. -path matches the
  // whole path string, so an absolute start point puts absDir's OWN ancestors
  // in front of every candidate — and a checkout living under any segment
  // named in SKIP_DIRS then excludes itself entirely. A linked worktree sits
  // at <repo>/.claude/worktrees/<name>, so every sweep run from one found
  // zero files while still emitting every slice: judged nothing, filed
  // nothing, reported success (#111). Relative paths cannot name an ancestor,
  // which is what makes the exclusions mean what the comment above says.
  const raw = execFileSync(
    'find',
    ['.', ...depthArgs, '-type', 'f', ...excludeArgs],
    { cwd: absDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, windowsHide: true },
  );
  return raw
    .split('\n')
    .filter(Boolean)
    .filter((f) => SOURCE_EXTS.has(path.extname(f)))
    .map((f) => path.resolve(absDir, f))
    .sort();
}

function sourceFiles(absDir, opts) {
  try {
    return sourceFilesRaw(absDir, opts);
  } catch {
    return [];
  }
}

// listSlices' dot-directory rotation-exclusion guard: true only when the
// scan genuinely succeeded and found zero source files. A scan failure
// (permission denial, spawn failure, timeout — sourceFiles' own catch
// collapses all of these into the same [] a real empty directory produces)
// must NOT be read as "empty" here, unlike sourceFiles' other callers: this
// is the one call site whose result decides whether a directory is silently
// dropped from rotation, so a transient failure would permanently exclude a
// dot-directory that actually holds real source, with no error surfaced
// anywhere (review finding). Fails safe — keep the directory in rotation —
// and reports the failure to stderr instead.
function isEmptySourceDir(absDir) {
  try {
    return sourceFilesRaw(absDir, { recursive: true }).length === 0;
  } catch (e) {
    process.stderr.write(
      `[code-health] scope: dot-directory scan failed for ${absDir} — keeping it in rotation rather than silently excluding it (${e && e.message ? e.message : e})\n`,
    );
    return false;
  }
}

// Reads every source file under absDir exactly once, as a Buffer (so both
// contentHash's byte-for-byte hashing and selectSlice's line count can be
// derived from the same in-memory read — see hashFromFileData/locFromFileData
// below and selectSlice's computeScore, which calls this once per slice
// instead of independently re-spawning `find` and re-reading every file for
// hash and LOC separately).
function readSourceFileData(absDir, opts) {
  const files = sourceFiles(absDir, opts);
  return files.map((file) => {
    try {
      return { file, buffer: fs.readFileSync(file) };
    } catch {
      return { file, buffer: null };
    }
  });
}

// Same as readSourceFileData, but reuses a caller-supplied Map (keyed by
// absDir) across repeated calls for the same directory instead of
// re-spawning `find` and re-reading every file each time. Used by
// selectSlice's computeScore AND the final cursor-patch hash lookup in a
// --budget > 1 next-slice invocation — cache is null/undefined for a normal
// single-pick call, which falls straight through to the uncached read.
function readSourceFileDataCached(absDir, cache, opts) {
  if (!cache) return readSourceFileData(absDir, opts);
  // Key on the recursive flag as well as the path. One directory can be read
  // both ways within a single invocation (splitOversized emits an oversized
  // directory as a non-recursive own-files slice while its children are
  // separate recursive slices), and a path-only key would hand the second
  // caller the first caller's file list — silently hashing/scoring the wrong
  // file set instead of failing.
  const key = `${absDir}\0${(opts && opts.recursive) !== false}`;
  if (cache.has(key)) return cache.get(key);
  const data = readSourceFileData(absDir, opts);
  cache.set(key, data);
  return data;
}

function hashFromFileData(absDir, fileData) {
  const hasher = crypto.createHash('sha1');
  if (fileData.length === 0) {
    hasher.update('empty:' + absDir);
    return hasher.digest('hex');
  }
  for (const { file, buffer } of fileData) {
    hasher.update(file + '\0');
    hasher.update(buffer != null ? buffer : 'unreadable');
  }
  return hasher.digest('hex');
}

function locFromFileData(fileData) {
  let total = 0;
  for (const { buffer } of fileData) {
    if (buffer == null) continue;
    total += buffer.toString('utf8').split('\n').length;
  }
  return total;
}

// cache: optional Map (see readSourceFileDataCached) — pass the same Map
// across repeated calls for the same absDir within one CLI invocation to
// avoid re-spawning `find` and re-reading every file.
function contentHash(absDir, cache, opts) {
  return hashFromFileData(absDir, readSourceFileDataCached(absDir, cache, opts));
}

// ─── Hotspot signals (impure; degrade gracefully) ────────────────────────────
function gitChurn(root, relDir, now, { recursive = true } = {}) {
  try {
    // Full ISO 8601 datetime (with time-of-day and Z/UTC suffix), not a bare
    // YYYY-MM-DD date string — a bare date string is parsed by git as local
    // midnight and then converted to UTC, silently skewing (or, near the
    // epoch, underflowing to pre-epoch and matching zero commits) the
    // boundary in positive-UTC-offset timezones. Identical bug and fix as
    // harness-health/scope.js's domainChurn, journey-health/scope.js, and
    // docs-health/scope.js.
    const since = new Date(now - 30 * 86400000).toISOString();
    let pathArgs;
    if (recursive) {
      pathArgs = [relDir === '.' ? '.' : relDir];
    } else {
      // Non-recursive slice: `git log -- <dir>` always means that dir's whole
      // subtree regardless of depth, so instead pass each of the directory's
      // DIRECT source files as its own pathspec, scoping churn to exactly what
      // the non-recursive content-hash also covers.
      //
      // Resolve from relDir, not from root: '.' used to be the only
      // non-recursive slice, so hardcoding root was safe. splitOversized now
      // emits a non-recursive slice for any oversized directory's own files
      // (e.g. 'bin/lib'), and scoping those to root-level files would report
      // the root's churn under that directory's id.
      const absDir = relDir === '.' ? root : path.resolve(root, relDir);
      const files = sourceFiles(absDir, { recursive: false }).map((f) => path.relative(root, f));
      if (files.length === 0) return 0;
      pathArgs = files;
    }
    const out = execFileSync(
      'git',
      ['-C', root, 'log', '--oneline', `--since=${since}`, '--', ...pathArgs],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, windowsHide: true },
    );
    return out.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

// Single source of truth for "is this slice's file/churn scan recursive?" —
// used by bin/code-health.js's cmdValidateFindings, which is handed only a
// `--slice <id>` string and so cannot read the flag off a slice object the way
// selectSlice's computeScore and cmdNextSlice's buildCursorPatch both do.
//
// Recursiveness stopped being derivable from the id alone once splitOversized
// began emitting a non-recursive own-files slice for any oversized directory:
// 'bin/lib' is non-recursive when bin/lib was split, recursive when it wasn't.
// Pass `root` to get the real answer; without it this falls back to the
// pre-split heuristic (only '.' is non-recursive), which is still correct for
// a manual `--area` path that listSlices never emitted.
function sliceRecursive(id, root) {
  if (root) {
    const match = listSlices(root).find((slice) => slice.id === id);
    if (match) return match.recursive;
  }
  return id !== '.';
}

// Hotspot score = churn × complexity (higher = more important to judge next).
function hotspotScore(churn, loc) {
  return churn * Math.min(loc / 100, 10); // cap loc contribution to keep scores finite
}

// ─── Workspace-aware slicing ─────────────────────────────────────────────────
// Reads package.json#workspaces (array or {packages:[...]} form) or, failing
// that, pnpm-workspace.yaml's `packages:` list, and expands each pattern to its
// member packages. Minimal glob support by design — no new dependency:
//   "<dir>/*"   → every immediate subdirectory of <dir> becomes its own slice
//   "<literal>" → that exact path becomes one slice (existence-checked)
//   anything else (**, negation, multiple wildcards) → skipped, logged to stderr
function readWorkspacePatterns(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
    if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) return pkg.workspaces.packages;
  } catch { /* no package.json, or no usable workspaces field — fall through to pnpm */ }

  try {
    const yaml = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    const patterns = [];
    let inPackages = false;
    for (const line of yaml.split('\n')) {
      if (/^packages:\s*$/.test(line.trim())) { inPackages = true; continue; }
      if (!inPackages) continue;
      const m = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?\s*$/);
      if (m) { patterns.push(m[1]); continue; }
      if (line.trim() !== '' && !/^[\s-]/.test(line)) inPackages = false;
    }
    return patterns;
  } catch {
    return [];
  }
}

function expandWorkspacePattern(root, rawPattern) {
  const pattern = rawPattern.replace(/^\.\//, '').replace(/\/$/, '');
  const wildcardCount = (pattern.match(/\*/g) || []).length;
  const hasOtherSpecial = /[!{}?]/.test(pattern);

  if (wildcardCount === 0 && !hasOtherSpecial) {
    const abs = path.join(root, pattern);
    try {
      if (fs.statSync(abs).isDirectory()) return [{ id: pattern, path: abs }];
    } catch { /* pattern names a path that doesn't exist */ }
    return [];
  }

  if (wildcardCount === 1 && !hasOtherSpecial && pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2); // strip trailing "/*"
    const absPrefix = path.join(root, prefix);
    let entries;
    try { entries = fs.readdirSync(absPrefix, { withFileTypes: true }); } catch { return []; }
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ id: `${prefix}/${e.name}`, path: path.join(absPrefix, e.name) }));
  }

  process.stderr.write(
    `[code-health] scope: skipping unsupported workspace pattern "${pattern}" ` +
    '(only "<dir>/*" and literal paths are supported)\n',
  );
  return [];
}

// Top-level dirs genuinely enumerated in full by a "<dir>/*" workspace pattern —
// i.e. every immediate child of <dir> is covered, so <dir> itself should not
// also appear as its own top-level slice. A literal single-package pattern
// (e.g. "tools/cli") does NOT cover "tools" — unlisted siblings like
// "tools/scripts" must still reach a top-level slice, so they aren't silently
// dropped from scope. A literal pattern with NO path separator at all (e.g.
// "packages", naming a top-level dir directly) DOES cover that dir — it
// becomes one whole-directory package slice via expandWorkspacePattern's
// literal branch, so it must not also appear as its own top-level mega-slice
// from the plain readdir loop (they'd otherwise be listed — and scored —
// twice, as the same id and path).
// patterns: optional pre-read result of readWorkspacePatterns(root), so
// callers that already have it (listSlices) don't re-read the manifest.
function fullyCoveredTopLevelDirs(root, patterns) {
  const pats = patterns || readWorkspacePatterns(root);
  const covered = new Set();
  for (const rawPattern of pats) {
    const pattern = rawPattern.replace(/^\.\//, '').replace(/\/$/, '');
    const globMatch = pattern.match(/^([^*!{}?]+)\/\*$/);
    if (globMatch) { covered.add(globMatch[1]); continue; }
    if (!/[*!{}?]/.test(pattern) && !pattern.includes('/')) covered.add(pattern);
  }
  return covered;
}

// Returns [] when no workspace manifest exists or none of its patterns resolve.
// patterns: optional pre-read result of readWorkspacePatterns(root), so
// callers that already have it (listSlices) don't re-read the manifest.
function listWorkspaceSlices(root, patterns) {
  const pats = patterns || readWorkspacePatterns(root);
  const slices = [];
  const seen = new Set();
  for (const pattern of pats) {
    for (const slice of expandWorkspacePattern(root, pattern)) {
      if (seen.has(slice.id)) continue;
      seen.add(slice.id);
      slices.push(slice);
    }
  }
  return slices;
}

// ─── selectSlice ─────────────────────────────────────────────────────────────
// opts: { budget?: number, now?: number, signals?: { [id]: { churn, loc } },
//         fileDataCache?: Map }
// Returns Slice & { why: 'stale' | 'hotspot' } or null. Phase mechanics
// (force-pick past MAX_STALE_DAYS, else score-and-pick-highest) delegate to
// health-core/rotation's shared selectByStaleThenChurn; this module keeps
// ownership of the slice listing, content-hash skip, and hotspot scoring.
//
// fileDataCache (optional): a Map the caller can create once and pass into
// every selectSlice call across a --budget > 1 loop (see cmdNextSlice in
// bin/code-health.js) and into a subsequent contentHash() call for the
// winning slice — on-disk content doesn't change during one CLI invocation,
// so this avoids re-spawning `find` and re-reading every source file once
// per budget iteration per candidate, plus once more for the final picked
// slice's cursor-patch hash.
function selectSlice(root, cursors, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const signals = opts.signals || null; // test injection hook
  const fileDataCache = opts.fileDataCache || null;

  const candidates = listSlices(root);

  return selectByStaleThenChurn(candidates, cursors, {
    now,
    staleDays: MAX_STALE_DAYS,
    getCursorKey: (slice) => slice.id,
    getLastAuditedMs: (cursor) => (cursor && cursor.lastSweptMs != null ? cursor.lastSweptMs : null),
    // Skip if content-hash is unchanged (the real change-aware skip) —
    // returning null excludes the slice from Phase 2 entirely. Reads the
    // slice's source files exactly once per candidate per fileDataCache
    // lifetime (readSourceFileDataCached) and derives both the hash and the
    // LOC count from that single pass, instead of independently
    // re-spawning `find` and re-reading every file for each.
    computeScore: (slice, cursor) => {
      // listSlices already resolved this per slice — reading it back off the
      // slice avoids re-deriving (and re-listing the whole repo) per candidate.
      const recursive = slice.recursive;
      const fileData = readSourceFileDataCached(slice.path, fileDataCache, { recursive });
      const currentHash = hashFromFileData(slice.path, fileData);
      if (cursor.lastHash && cursor.lastHash === currentHash) return null;
      const sig = signals ? signals[slice.id] || { churn: 0, loc: 0 } : null;
      const churn = sig ? sig.churn : gitChurn(root, slice.id, now, { recursive });
      const loc = sig ? sig.loc : locFromFileData(fileData);
      return hotspotScore(churn, loc);
    },
    buildStaleResult: (slice) => ({ ...slice, why: 'stale' }),
    buildHotspotResult: (slice) => ({ ...slice, why: 'hotspot' }),
  });
}

// sourceFiles is exported for tests only — it is the function whose exclusion
// anchoring caused #111, and asserting on slice ids alone cannot distinguish
// "found the files" from "emitted an empty slice".
//
// SKIP_DIRS is exported so focus-mode candidate generators (candidates-
// abstraction-police.js, candidates-test-hygiene.js) import the same
// exclusion source next-slice uses instead of hand-copying the list — a
// copied list drifts from this one (IL-40's cardinality-restatement lesson
// applies equally to a restated set). SOURCE_EXTS is exported for the same
// reason — the JS/TS extension set source-scan.js already
// hand-declares its own copy of, but new verticals should not add a third.
module.exports = {
  listSlices,
  contentHash,
  selectSlice,
  listWorkspaceSlices,
  gitChurn,
  sliceRecursive,
  sourceFiles,
  splitOversized,
  SKIP_DIRS,
  SOURCE_EXTS,
};
