'use strict';

// Deterministic checks against the upstream-drift manifest
// (tools/upstream-drift/manifest.yml): is the artifact installed at the
// pinned version, do this repo's cited assertions about upstream source
// still hold, and do the recorded fixture replays still behave as recorded.
// A fourth check, checkContentPins, covers the content-hash-pinned entry
// class (`versioning: none` — tagless upstreams pinned by commit SHA plus
// per-file sha256 against committed fixture snapshots); it is the class's
// ONLY code path — the three probe-based checks never run for it.
//
// EVERY FUNCTION HERE RETURNS STRUCTURED DATA AND NEVER PRINTS. Rendering
// and issue-filing are a later, separate module's job — mixing them in here
// would make this module untestable without capturing stdout, and would
// couple a pure "what is true" question to a presentation decision.
//
// Version resolution always reads the artifact itself (a binary's own
// `--version` output, or a candidate's own plugin.json `version` field) —
// never install metadata, a catalog, or gitCommitSha ([IL-89]).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

// ─── default probe primitives (overridable via options) ────────────────────

// Runs a shell command string (as a human would type it — the manifest's
// `run`/`root` fields are full command lines, e.g. "npx --no-install
// impeccable --version") and returns trimmed stdout, or null for any of:
// the shell itself failing to spawn, a non-zero exit, or empty output. Never
// throws — an absent binary is an ordinary, expected outcome for this repo's
// dependencies (agent-browser, the Impeccable CLI, etc. are all optional).
function defaultRunCommand(cmd) {
  const result = spawnSync(cmd, { shell: true, encoding: 'utf8' });
  if (result.error) return null;
  if (result.status !== 0) return null;
  const out = (result.stdout || '').trim();
  return out || null;
}

function defaultReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Node 18 has no stable built-in glob, and this repo takes no new
// dependency to get one. The only shape ever needed here is a literal path
// with `*` standing in for exactly one path segment (see manifest.yml's
// `~/.claude/plugins/cache/*/impeccable/*/.claude-plugin/plugin.json`), so a
// small readdirSync recursion covers it without pulling in a glob library.
//
// `failures` accumulates directories that exist but could not be read
// (EACCES, EPERM, ...) — distinct from a directory that legitimately does
// not exist (ENOENT), which is an ordinary "nothing here" outcome, not a
// failure to inspect. An installed-but-unreadable artifact must not read
// identically to nothing installed, so callers get both the paths that DID
// expand and the paths that COULD NOT be inspected.
function expandGlobSegments(baseDir, segments, failures) {
  if (segments.length === 0) return [baseDir];
  const [seg, ...rest] = segments;
  if (seg === '*') {
    let entries;
    try {
      entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        failures.push({ path: baseDir, code: err.code, detail: `${baseDir}: could not be inspected (${err.code}): ${err.message}` });
      }
      return [];
    }
    return entries.flatMap((entry) => expandGlobSegments(path.join(baseDir, entry.name), rest, failures));
  }
  const candidate = path.join(baseDir, seg);
  if (!fs.existsSync(candidate)) return [];
  return rest.length === 0 ? [candidate] : expandGlobSegments(candidate, rest, failures);
}

// Returns {paths, failures} — paths that matched the glob, and directories
// along the way that existed but could not be read (see expandGlobSegments).
function expandGlob(globPattern) {
  const pattern = globPattern.startsWith('~') ? path.join(os.homedir(), globPattern.slice(1)) : globPattern;
  const baseDir = path.isAbsolute(pattern) ? path.parse(pattern).root : '.';
  const failures = [];
  const paths = expandGlobSegments(baseDir, pattern.split('/').filter(Boolean), failures);
  return { paths, failures };
}

// Every plugin-cache-glob candidate paired with the version its OWN
// plugin.json reports — never the directory name a candidate happens to sit
// under. Directory names are not a reliable source of the version; only the
// file's own `version` field is (a stale or mislabeled cache directory is
// exactly the kind of drift this tool exists to catch, not reproduce). A
// candidate whose plugin.json exists but carries no usable string `version`
// (missing, wrong type, empty) is never silently dropped: a faithful number
// is coerced to its string form, and anything else is surfaced as
// `malformed` rather than made to look like "nothing installed". Returns
// {candidates, failures} — failures are the unreadable directories from
// expandGlob, passed through unchanged.
function resolveGlobCandidates(entry, options) {
  const probe = entry['installed-probe'] || {};
  if (probe.type !== 'plugin-cache-glob' || !probe.glob) return { candidates: [], failures: [] };
  const readJson = options.readJson || defaultReadJson;
  const { paths, failures } = expandGlob(probe.glob);
  const candidates = [];
  for (const candidatePath of paths) {
    const parsed = readJson(candidatePath);
    if (!parsed) continue;
    if (typeof parsed.version === 'string' && parsed.version) {
      candidates.push({ path: candidatePath, version: parsed.version });
    } else if (typeof parsed.version === 'number' && Number.isFinite(parsed.version)) {
      candidates.push({ path: candidatePath, version: String(parsed.version) });
    } else {
      candidates.push({
        path: candidatePath,
        malformed: true,
        detail: `${candidatePath}: plugin.json has no usable string 'version' field (got ${JSON.stringify(parsed.version)})`,
      });
    }
  }
  return { candidates, failures };
}

// Where checkAssertions should look for contract-paths / upstream-path
// values — plural, because more than one installed copy can legitimately
// exist side by side. `options.root` always wins outright and means exactly
// one root (tests use this to bypass real probes entirely). Otherwise
// derived from the same probe the version check uses: a `command` probe
// joins `root`'s own output with `root-suffix` (always exactly one root); a
// `plugin-cache-glob` probe resolves to the directory that CONTAINS the
// `.claude-plugin` directory of EVERY candidate whose version equals
// `pinned` — i.e. the plugin's own source root, two path segments up from
// its plugin.json, for each matching candidate. A malformed candidate (see
// resolveGlobCandidates) never has a usable `version`, so it can never
// equal `pinned` and is never included here.
function resolveRoots(entry, options) {
  if (options.root) return [{ root: options.root }];
  const probe = entry['installed-probe'] || {};
  const runCommand = options.runCommand || defaultRunCommand;
  if (probe.type === 'command') {
    if (!probe.root) return [];
    const rootOut = runCommand(probe.root);
    if (!rootOut) return [];
    const suffix = probe['root-suffix'] || '';
    return [{ root: suffix ? path.join(rootOut, suffix) : rootOut }];
  }
  if (probe.type === 'plugin-cache-glob') {
    const { candidates } = resolveGlobCandidates(entry, options);
    return candidates
      .filter((c) => !c.malformed && c.version === entry.pinned)
      .map((c) => ({ root: path.dirname(path.dirname(c.path)) }));
  }
  return [];
}

// ─── checkVersion ───────────────────────────────────────────────────────────

// A single leading 'v'/'V' is stripped for COMPARISON purposes only (a
// probe reporting "v3.5.0" against a pinned "3.5.0" is the same version, not
// a breach) — the returned `installed` array and `detail` always carry the
// original, un-normalized strings the probe actually reported. No other
// semver normalization is attempted.
function normalizeVersionForCompare(v) {
  return typeof v === 'string' && (v[0] === 'v' || v[0] === 'V') ? v.slice(1) : v;
}

// Only used under `version-mode: floor` — compares two dot-separated
// numeric version strings component-wise (3.6.0 vs 3.10.0: 10 > 6, not the
// lexical '1' < '6'). Returns -1/0/1. A component that isn't a plain
// non-negative integer (a pre-release suffix, a malformed string) falls
// back to a lexical whole-string compare — a conservative degrade, never a
// thrown error, since `pinned`/the probed version are manifest- and
// environment-supplied strings this check must not crash on.
function compareVersions(a, b) {
  const partsA = String(a).split('.');
  const partsB = String(b).split('.');
  const isPlainInt = (s) => /^\d+$/.test(s);
  if (partsA.every(isPlainInt) && partsB.every(isPlainInt)) {
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
      const na = Number(partsA[i] || 0);
      const nb = Number(partsB[i] || 0);
      if (na !== nb) return na < nb ? -1 : 1;
    }
    return 0;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// `installed` is always an array: a plugin-cache-glob probe can legitimately
// resolve several installed versions side by side (two cached copies on one
// machine is a real, observed state), so this never collapses to a single
// value. `absent` (no artifact found at all) and `breach` (an artifact IS
// present, but none of its version(s) equal `pinned`) are kept distinct on
// purpose — absent is not this repo's problem, a wrong-version install is a
// contract breach, and collapsing the two would misreport which is which.
// `status` stays one of exactly these three values; a malformed
// plugin.json (present but no usable version) or a directory that could not
// be inspected (EACCES) are surfaced via the separate `malformed` /
// `inspectionFailures` arrays and an enriched `detail`, never via a fourth
// status value.
function checkVersion(entry, options = {}) {
  const { name, pinned } = entry;
  const probe = entry['installed-probe'] || {};
  const runCommand = options.runCommand || defaultRunCommand;

  let installed = [];
  let malformed = [];
  let inspectionFailures = [];
  if (probe.type === 'command' && probe.run) {
    const version = runCommand(probe.run);
    if (version) installed = [version];
  } else if (probe.type === 'plugin-cache-glob') {
    const { candidates, failures } = resolveGlobCandidates(entry, options);
    installed = candidates.filter((c) => !c.malformed).map((c) => c.version);
    malformed = candidates.filter((c) => c.malformed).map((c) => ({ path: c.path, detail: c.detail }));
    inspectionFailures = failures.map((f) => ({ path: f.path, detail: f.detail }));
  }

  const base = { check: 'version', name, installed, pinned, malformed, inspectionFailures };
  const normalizedPinned = normalizeVersionForCompare(pinned);
  const floor = entry['version-mode'] === 'floor';
  const satisfies = floor
    ? (v) => compareVersions(v, normalizedPinned) >= 0
    : (v) => v === normalizedPinned;
  const matched = installed.some((v) => satisfies(normalizeVersionForCompare(v)));

  if (installed.length === 0) {
    const notes = [];
    if (malformed.length > 0) notes.push(`${malformed.length} candidate(s) had an unusable version field`);
    if (inspectionFailures.length > 0) notes.push(`${inspectionFailures.length} path(s) could not be inspected`);
    const suffix = notes.length > 0 ? ` (${notes.join('; ')})` : '';
    return { ...base, status: 'absent', detail: `${name}: not installed — probe found no artifact${suffix}` };
  }
  const found = `installed version(s) [${installed.join(', ')}]`;
  const expectation = floor ? `meet the minimum ${pinned}` : `include pinned ${pinned}`;
  if (matched) {
    return { ...base, status: 'ok', detail: `${name}: ${found} ${expectation}` };
  }
  return { ...base, status: 'breach', detail: `${name}: ${found} do not ${expectation}` };
}

// ─── checkAssertions ────────────────────────────────────────────────────────

// One result per manifest assertion, matched by LITERAL substring
// (String.prototype.includes) — never a regex. A cited literal such as
// Impeccable's own `polish [target]` help text contains regex metacharacters;
// treating it as a pattern would either match the wrong thing or throw.
//
// Evaluated against EVERY root resolveRoots() returns, not just the first:
// a plugin-cache-glob probe can legitimately resolve more than one
// installed copy at the pinned version, and a second copy whose upstream
// content has drifted is a real finding, not one this function may skip
// because an earlier copy looked fine. An assertion's top-level `status` is
// the worst outcome across all its roots ('missing-file' beats 'unmatched'
// beats 'ok'); the per-root detail is never collapsed away — it survives in
// `roots` so a caller can report exactly which root failed and how.
function checkAssertions(entry, options = {}) {
  const { name } = entry;
  const assertions = entry.assertions || [];
  const roots = resolveRoots(entry, options);

  if (roots.length === 0) {
    // An unresolvable root means the artifact is absent, not that its
    // assertions failed. Reporting these as failures would manufacture a
    // finding this repo has no evidence for — checkVersion already owns
    // reporting "absent".
    return {
      check: 'assertions',
      name,
      status: 'skipped',
      results: [],
      detail: `${name}: could not resolve an installed root — skipping assertion checks`,
    };
  }

  const results = assertions.map((assertion) => {
    const upstreamPath = assertion['upstream-path'];
    const mustMatch = assertion['must-match'];
    const base = { file: assertion.file, claims: assertion.claims, upstreamPath };

    const perRoot = roots.map(({ root }) => {
      const fullPath = path.join(root, upstreamPath);
      let content;
      try {
        content = fs.readFileSync(fullPath, 'utf8');
      } catch (err) {
        const reason = err.code === 'ENOENT' ? 'does not exist' : `could not be read: ${err.message}`;
        return { root, fullPath, status: 'missing-file', detail: `${fullPath} ${reason}` };
      }
      if (!content.includes(mustMatch)) {
        return { root, fullPath, status: 'unmatched', detail: `${fullPath} no longer contains "${mustMatch}"` };
      }
      return { root, fullPath, status: 'ok', detail: `${fullPath} still contains "${mustMatch}"` };
    });

    const failing = perRoot.filter((r) => r.status !== 'ok');
    if (failing.length === 0) {
      return { ...base, status: 'ok', detail: perRoot[0].detail, roots: perRoot };
    }
    const status = failing.some((r) => r.status === 'missing-file') ? 'missing-file' : 'unmatched';
    const detail = failing.map((r) => r.detail).join('; ');
    return { ...base, status, detail, roots: perRoot };
  });

  const status = results.every((r) => r.status === 'ok') ? 'ok' : 'drift';
  return { check: 'assertions', name, status, results };
}

// ─── replayFixtures ─────────────────────────────────────────────────────────

function defaultRunFixture(cmd, cwd) {
  return spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function checkOneFixture(fixture, cwd, runFixture) {
  const expect = fixture.expect || {};
  const result = runFixture(fixture.run, cwd);
  // The two streams are kept as separate keys and are never concatenated —
  // a payload that moved between them is the drift this replay exists to
  // catch, and merging them would reproduce exactly that blindness.
  const streams = { stdout: result.stdout || '', stderr: result.stderr || '' };
  const observed = { exit: result.status, stdoutLen: streams.stdout.length, stderrLen: streams.stderr.length };

  function mismatch(detail) {
    return { run: fixture.run, status: 'mismatch', detail, observed };
  }

  // expect.stream must be EXACTLY 'stdout' or 'stderr'. Falling back to
  // stdout for any other value (a typo'd case, stray whitespace, an absent
  // field) would silently validate the wrong stream — precisely the
  // stdout/stderr blindness this function exists to catch. This check does
  // not depend on the manifest having already been validated.
  if (expect.stream !== 'stdout' && expect.stream !== 'stderr') {
    return mismatch(`expect.stream must be exactly 'stdout' or 'stderr', got ${JSON.stringify(expect.stream)}`);
  }

  if (result.status !== expect.exit) {
    return mismatch(`expected exit ${expect.exit}, observed exit ${result.status}`);
  }

  const wanted = expect.stream;
  const other = wanted === 'stderr' ? 'stdout' : 'stderr';

  const parsed = tryParseJson(streams[wanted].trim());
  if (!parsed.ok) {
    // The single most important case this function exists to catch: the
    // payload silently moved to the other stream (stdout <-> stderr). A
    // plain "didn't parse" detail would hide that — name where it actually
    // landed instead.
    if (tryParseJson(streams[other].trim()).ok) {
      return mismatch(`expected the JSON payload on ${wanted}, but it appeared on ${other} instead`);
    }
    return mismatch(`${wanted} did not parse as JSON`);
  }

  const keys = expect.keys || [];
  if (keys.length > 0) {
    const first = Array.isArray(parsed.value) ? parsed.value[0] : parsed.value;
    if (!first || typeof first !== 'object') {
      return mismatch(`expected an object with key(s) [${keys.join(', ')}], but ${wanted}'s payload had no first element`);
    }
    const missing = keys.filter((k) => !(k in first));
    if (missing.length > 0) {
      return mismatch(`missing expected key(s) [${missing.join(', ')}] in ${wanted}'s first payload object`);
    }
  }

  return { run: fixture.run, status: 'ok', detail: 'observed output matched expect', observed };
}

// Replays every manifest fixture command and compares observed exit code /
// output stream / payload shape against `expect`. Captures stdout and
// stderr SEPARATELY (spawnSync does this natively) — never merged via
// `2>&1` or a shell pipe, and never merged in code afterward. A merge is
// exactly what let a stdout->stderr regression pass unnoticed through two
// prior verification passes on the real dependency this tool audits; a
// check that re-merges the streams would reproduce that same blindness.
function replayFixtures(entry, options = {}) {
  const { name } = entry;
  const fixtures = entry.fixtures || [];
  const cwd = options.cwd || path.resolve(__dirname, '..', '..');
  const runFixture = options.runFixture || defaultRunFixture;

  const results = fixtures.map((fixture) => checkOneFixture(fixture, cwd, runFixture));
  const status = results.every((r) => r.status === 'ok') ? 'ok' : 'mismatch';
  return { check: 'fixtures', name, status, results };
}

// ─── checkContentPins ───────────────────────────────────────────────────────

// The `versioning: none` entry class's marker — pin.versioning === 'none'.
// Shared with run.js's evaluate() so the two never disagree about which
// entries take the content-pin path instead of the probe machinery.
function isContentPinned(entry) {
  return Boolean(entry && entry.pin && typeof entry.pin === 'object' && entry.pin.versioning === 'none');
}

// Recomputes each committed fixture's sha256 and compares it to the
// manifest's pinned digest. Fully offline and deliberately fixture-based:
// the fixtures are snapshots of the upstream files at the entry's pinned
// commit, so a corrupted pin or a tampered fixture fails loudly here, while
// live upstream comparison (new skills appearing, a rewritten history making
// the pinned SHA unreachable) belongs to the auditor's own run, never to
// `node --test`. `options.fixtureRoot` is injectable for tests; the default
// mirrors the manifest convention: fixtures/{entry.name}/{consumed.path}.
function checkContentPins(entry, options = {}) {
  const { name } = entry;
  const pin = entry.pin || {};
  const consumed = entry.consumed || [];
  const fixtureRoot = options.fixtureRoot || path.join(__dirname, 'fixtures', name);

  const results = consumed.map((c) => {
    const fullPath = path.join(fixtureRoot, c.path);
    let content;
    try {
      content = fs.readFileSync(fullPath);
    } catch (err) {
      const reason = err.code === 'ENOENT' ? 'does not exist' : `could not be read: ${err.message}`;
      return { path: c.path, status: 'missing-fixture', observed: null, detail: `${fullPath} ${reason}` };
    }
    const observed = crypto.createHash('sha256').update(content).digest('hex');
    if (observed !== c.sha256) {
      return {
        path: c.path,
        status: 'mismatch',
        observed,
        detail: `${fullPath}: observed sha256 ${observed} does not equal the pinned ${c.sha256}`,
      };
    }
    return { path: c.path, status: 'ok', observed, detail: `${fullPath} matches its pinned sha256` };
  });

  const status = results.every((r) => r.status === 'ok') ? 'ok' : 'mismatch';
  return { check: 'content-pins', name, commit: pin.commit || null, status, results };
}

module.exports = { checkVersion, checkAssertions, replayFixtures, checkContentPins, isContentPinned };
