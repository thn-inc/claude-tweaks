// plugin/bin/lib/plan-audit/checks.js — Checks A/B/C/D plus the headroom check
// for bin/plan-audit.js (#903). Mechanizes plan-audit.md's prose checks;
// policy handling (scope-creep, scope-keywords-required) stays at the skill
// layer — this module only reports facts.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  CEILING_BYTES, composedBytesReport, COMPOSED_STEP_EXCEPTIONS,
} = require('../skill-audit/context-cost');

const WALK_EXCLUDES = new Set(['.git', 'node_modules', '.claude', '.claude-tweaks']);

// ── Check A — Plan files exist ──────────────────────────────────────────────
// "Create" and "Test" bullets only require their parent directory to exist
// (both routinely name a file the plan itself is about to write for the
// first time — treating "Test" like "Modify" would false-positive on the
// standard write-the-test-first task shape). "Modify"/"Delete" bullets must
// name a path that already exists.
//
// #1999: a Create:/Test: bullet whose parent directory doesn't exist on disk
// yet still passes when ANOTHER Create:/Test: bullet in the same plan will
// bring that directory into existence (its path lives at or under that same
// directory) — the plan is internally self-sufficient, not missing anything.
// The set used for this cross-reference deliberately EXCLUDES the bullet
// being checked itself: a global, self-inclusive set would make every lone
// Create:/Test: bullet trivially pass (its own parent is always its own
// ancestor), which would silently stop catching a genuinely unsupported
// path — see this plan's own pinned regression test.
function ancestorDirs(absPath) {
  const dirs = [];
  let dir = path.dirname(absPath);
  while (true) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

function nearestExistingAncestor(dir) {
  let cur = dir;
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return cur;
}

function checkA(entries, repoRoot) {
  const missing = [];
  const missingDetail = [];
  for (let i = 0; i < entries.length; i++) {
    const { type, path: relPath } = entries[i];
    const abs = path.resolve(repoRoot, relPath);
    if (type === 'Create' || type === 'Test') {
      const parentAbs = path.dirname(abs);
      if (fs.existsSync(parentAbs)) continue;
      const createdDirs = new Set();
      for (let j = 0; j < entries.length; j++) {
        if (j === i) continue;
        const other = entries[j];
        if (other.type !== 'Create' && other.type !== 'Test') continue;
        for (const d of ancestorDirs(path.resolve(repoRoot, other.path))) createdDirs.add(d);
      }
      if (createdDirs.has(parentAbs)) continue;
      missing.push(relPath);
      missingDetail.push({
        path: relPath,
        nearestExistingAncestor: path.relative(repoRoot, nearestExistingAncestor(parentAbs)) || '.',
      });
    } else if (!fs.existsSync(abs)) {
      missing.push(relPath);
      missingDetail.push({
        path: relPath,
        nearestExistingAncestor: path.relative(repoRoot, nearestExistingAncestor(path.dirname(abs))) || '.',
      });
    }
  }
  return { ok: missing.length === 0, missing, missingDetail };
}

// ── Check B — Scope-keyword sweep ───────────────────────────────────────────
// fs-walk, never a gitignore-honoring grep (CLAUDE.md's Gotchas: a
// gitignore-honoring sweep would silently miss gitignored-but-plan-relevant
// files). Case-insensitive, content-anchored (a keyword matching anywhere in
// a file's content counts, matching plan-audit.md's existing grep example).
function walkFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — treat as empty, never throw the audit
  }
  for (const e of entries) {
    if (WALK_EXCLUDES.has(e.name)) continue;
    const p = path.join(dir, e.name);
    // "node_modules" is excluded at any depth (the WALK_EXCLUDES check
    // above), which already covers evals/node_modules — no depth-1 special
    // case needed.
    if (e.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
}

function checkB(scopeKeywords, plannedPaths, repoRoot) {
  if (scopeKeywords.length === 0) return { ok: true, unplanned: [] };
  const allFiles = [];
  walkFiles(repoRoot, allFiles);
  const plannedAbs = new Set(plannedPaths.map((p) => path.resolve(repoRoot, p)));
  const patterns = scopeKeywords.map((k) => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  const unplanned = new Set();
  for (const file of allFiles) {
    if (plannedAbs.has(file)) continue;
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // binary/unreadable — not a text match candidate
    }
    if (patterns.some((re) => re.test(content))) {
      unplanned.add(path.relative(repoRoot, file));
    }
  }
  const list = [...unplanned].sort();
  return { ok: list.length === 0, unplanned: list };
}

// ── Premise-refs — Upstream-schema premise citation check ──────────────────
// plan-authoring-checks.md's Upstream-schema premise check (#2575): a plan
// may declare `Premise-refs: {path or URL}` lines naming what it claims to
// have read to prove a claimed semantic about a schema this project does
// not own. This reports any *local path* that does not resolve to an
// existing file — a distinct finding from Check B's unplanned-file list (a
// scope mismatch vs. an unverifiable citation are different findings, never
// folded into the same category). A URL cannot be verified here (no network
// access) and is recorded but never treated as unresolved — the same
// documented limitation the prose check states. Kept as its own function
// (not folded into checkB) for the same backward-compatibility reason
// extractPremiseRefs above is kept separate from extractScopeKeywords: an
// empty/absent Premise-refs field must leave checkB's own return shape and
// every existing caller of it completely unchanged.
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function checkPremiseRefs(premiseRefs, repoRoot) {
  const unresolved = [];
  for (const ref of premiseRefs) {
    if (URL_RE.test(ref)) continue; // recorded, not fetch-verified
    if (!fs.existsSync(path.resolve(repoRoot, ref))) unresolved.push(ref);
  }
  return { ok: unresolved.length === 0, unresolved };
}

// ── Check C — Verification-command pre-check ────────────────────────────────
// Runs each extracted command once, read-only, against current repo state.
// The only finding: a command that already exhibits a passing/success
// signature despite the task declaring `Expected: FAIL`. A non-zero exit, an
// assertion failure, or a hard error are all non-findings — see
// plan-audit.md's "Finding" section for why (inter-task dependencies make a
// hard error on a later task's pre-run both common and expected).
function looksPassing(exitCode, output) {
  if (exitCode === 0) return true;
  const success = /(^|[\s(])(PASS|passed|0 failing|✓)([\s)]|$)/i;
  const failure = /(FAIL|failing|✗|Error:|AssertionError)/i;
  return success.test(output) && !failure.test(output);
}

// #1999: a task's Step 1 that *appends* new tests to an existing (already
// passing) file makes Step 2's pre-run pass today by construction — that is
// the discrimination the task relies on, not a non-discriminating command.
// Shaped either by an explicit `Expected: FAIL after Step 1` marker (no
// heuristic needed), or by a path named in Step 1's text that (a) is one of
// the task's own Modify:/Test: bullets, (b) exists on disk today, and (c) is
// also named in Step 2's Run: command (a plain substring/token match against
// the repo-relative path).
function isAppendShaped(check, repoRoot) {
  if (check.appendMarker) return { shaped: true, path: null };
  const step1Text = check.step1Text;
  if (!step1Text) return { shaped: false, path: null };
  const candidatePaths = new Set(
    (check.taskFileEntries || [])
      .filter((e) => e.type === 'Modify' || e.type === 'Test')
      .map((e) => e.path),
  );
  if (candidatePaths.size === 0) return { shaped: false, path: null };
  const backtickRe = /`([^`]+)`/g;
  let m;
  while ((m = backtickRe.exec(step1Text)) !== null) {
    const raw = m[1].replace(/:\d+(-\d+)?$/, '');
    if (!candidatePaths.has(raw)) continue;
    if (!fs.existsSync(path.resolve(repoRoot, raw))) continue;
    if (check.command.includes(raw)) return { shaped: true, path: raw };
  }
  return { shaped: false, path: null };
}

// ── Check C safety net — VCS-mutation refusal (#2593) ───────────────────────
// Check C is documented read-only (plan-audit.md): it pre-runs each task's
// declared Step 2 verification command against the live repo. Production
// incident (2026-09-18, plugin 6.126.0): a task's Step 2 prose merely
// MENTIONED a forbidden command ("Run: never run `git stash push -u -m tag`
// here; use a WIP commit instead") and extractStep2Verification's
// first-backtick-span extraction still pulled it out as "the" command,
// which checkC then executed — sweeping an untracked file off the
// repository-wide shared stash stack. Tightening extraction itself is not
// the fix: real plans routinely follow a genuine `Run: \`command\`` with a
// trailing parenthetical note (every real instance under
// docs/superpowers/plans/*.md has one), so a stricter "backtick must be the
// entire line" rule would break those. The actual fix is this refusal,
// applied identically regardless of how the command text was extracted:
// before ever calling run(), reject any command whose first token (or any
// token immediately after a top-level `&&`/`;`/`|` segment separator) is a
// VCS-mutation verb.
const GIT_MUTATION_VERBS = new Set([
  'stash', 'commit', 'push', 'reset', 'checkout', 'switch', 'clean', 'rebase', 'merge',
]);
// gh write VERBS — the third token in the standard `gh <noun> <verb>` shape
// (`gh issue close`, `gh pr merge`, `gh repo create`, `gh label create`, …).
// Read-only verbs (view, list, status, diff, ...) are deliberately absent;
// anything not in this set is treated as non-mutating for `gh`.
const GH_WRITE_VERBS = new Set([
  'create', 'edit', 'close', 'reopen', 'merge', 'delete', 'comment',
  'lock', 'unlock', 'ready', 'review', 'pin', 'unpin', 'transfer',
]);

// Quote-aware split on top-level &&/;/| — a separator character inside a
// single- or double-quoted argument is never treated as a segment boundary.
// This is a pre-execution safety refusal, not a full shell parser: it is
// deliberately conservative (a false "looks safe" for a sufficiently
// obfuscated command is possible) rather than exhaustive.
function commandSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '&' && command[i + 1] === '&') { segments.push(current); current = ''; i += 1; continue; }
    if (ch === ';' || ch === '|') { segments.push(current); current = ''; continue; }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

// Returns the matched "git {verb}"/"gh {noun} {verb}" string when `segment`
// starts with a refused verb, or null when it's clear to run. `git` is a
// two-token shape (`git stash`); `gh` is three-token (`gh issue close`,
// `gh pr merge`, `gh repo create`) — the write verb is the noun's own
// sub-action, not `gh`'s own second token.
function mutationVerb(segment) {
  const tokens = segment.split(/\s+/);
  if (tokens[0] === 'git' && GIT_MUTATION_VERBS.has(tokens[1])) return `git ${tokens[1]}`;
  if (tokens[0] === 'gh' && GH_WRITE_VERBS.has(tokens[2])) return `gh ${tokens[1]} ${tokens[2]}`;
  return null;
}

// Returns the matched verb string for the first refused segment found in
// `command`, or null when every segment is clear to run.
function refusedVcsMutation(command) {
  for (const segment of commandSegments(command)) {
    const verb = mutationVerb(segment);
    if (verb) return verb;
  }
  return null;
}

function checkC(verificationChecks, repoRoot, deps = {}, unparseableStep2s = []) {
  const run = deps.run || ((command, cwd) => {
    try {
      const output = execFileSync(command, { cwd, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { exitCode: 0, output };
    } catch (err) {
      const output = `${err.stdout || ''}${err.stderr || ''}`;
      return { exitCode: typeof err.status === 'number' ? err.status : 1, output };
    }
  });
  const findings = [];
  const appendShaped = [];
  const executed = [];
  const refused = [];
  for (const check of verificationChecks) {
    const {
      taskNumber, title, command, expected,
    } = check;
    const verb = refusedVcsMutation(command);
    if (verb) {
      refused.push({
        task: taskNumber, title, command, reason: 'vcs-mutation-refusal', verb,
      });
      continue;
    }
    executed.push({ task: taskNumber, command });
    const { exitCode, output } = run(command, repoRoot);
    if (looksPassing(exitCode, output)) {
      const { shaped, path: shapedPath } = isAppendShaped(check, repoRoot);
      if (shaped) {
        appendShaped.push({
          task: taskNumber, title, command, path: shapedPath,
        });
        continue;
      }
      findings.push({
        task: taskNumber, title, command, expected,
        actualExitCode: exitCode,
        actualSummary: output.trim().split('\n').slice(0, 5).join('\n'),
      });
    }
  }
  // #1594: tasks whose Step 2 is present but unparseable (a wording/
  // formatting drift the parser couldn't extract a Run:/Expected: pair
  // from) — informational only, never a finding, never affects `ok`.
  const warnings = unparseableStep2s.map(({ taskNumber, title, raw }) => ({ task: taskNumber, title, raw }))
    .concat(refused);
  return {
    ok: findings.length === 0, findings, warnings, appendShaped, executed,
  };
}

// ── Headroom — near-ceiling / breaching files the plan adds prose to ───────
// Scope: existing files under the governed skill-corpus set
// (plugin/skills/**/*.md, per context-cost.js — the same ceiling every
// SKILL.md and sub-file is already measured against) that this plan
// *modifies*. "Create" bullets never apply — a file that doesn't exist yet
// has no current bytes to measure. v1 reports current bytes + headroom only;
// it never estimates a planned insertion's size (Non-Goals).
function isGovernedMdPath(relPath) {
  const norm = relPath.split(path.sep).join('/');
  return /^plugin\/skills\/.+\.md$/.test(norm);
}

// Composed rows — the multi-spec pre-flight [IL-140] lacked: a per-file
// ceiling never caught two specs each adding a *little* prose to two
// different sources of the same compose call site, where the composed bundle
// (not either file alone) is what crosses the ceiling. For every compose
// call site under `<repoRoot>/plugin` whose `sources` intersect this plan's
// touched governed entries, report the composed max across every combination
// the sources branch on, alongside `ceiling` (honoring
// `COMPOSED_STEP_EXCEPTIONS`) and `over` — regardless of which spec in a
// multi-spec run happens to touch which source first, since the intersection
// test is against the call site's full source list, not just the one entry
// that triggered it. A missing `plugin/` dir (the documented no-corpus case
// — a repo with governed paths but no payload subtree) or an unparsed
// call-site row (no `sources` to intersect against — parsing never reached a
// source list) never throws and contributes no composed row.
//
// A row that DOES have `sources` but also carries `error` (missing source,
// unreadable source, malformed marker — #1997) is a call site this plan
// touches that the tool simply could not measure. That is never the same
// signal as "does not apply": silently `continue`-ing past it (the pre-#1997
// behavior, indistinguishable from the unparsed case) would let a plan land
// against a call site nobody actually checked. Such rows go into
// `composedErrors` instead — reported, never blocking (`ok` stays keyed off
// `composed`/`breaches` only; see `headroomCheck` below). The same rule
// covers the report itself crashing (an unreadable corpus, a thrown bug):
// that is one `composedErrors` row with `step: null`, never an empty result
// that reads as "nothing to report" — the silent-fallback shape `[IL-146]`
// names. `deps.report` is the injectable seam a test uses to make it throw.
function composedHeadroom(governedPaths, repoRoot, { report = composedBytesReport } = {}) {
  const composed = [];
  const composedNearCeiling = [];
  const composedErrors = [];
  if (governedPaths.size === 0) return { composed, composedNearCeiling, composedErrors };
  const pluginRoot = path.join(repoRoot, 'plugin');
  if (!fs.existsSync(pluginRoot)) return { composed, composedNearCeiling, composedErrors };
  let rows;
  try {
    rows = report(pluginRoot);
  } catch (err) {
    composedErrors.push({
      step: null, file: null, line: null, error: `composed-bytes report failed: ${err.code || err.message}`,
    });
    return { composed, composedNearCeiling, composedErrors };
  }
  for (const row of rows) {
    if (!row.sources) continue; // unparsed call site — nothing to intersect
    const relSources = row.sources.map((s) => path.relative(repoRoot, s).split(path.sep).join('/'));
    if (!relSources.some((s) => governedPaths.has(s))) continue;
    if (row.error) {
      composedErrors.push({
        step: row.step, file: row.file, line: row.line, error: row.error,
      });
      continue;
    }
    const ceiling = Object.prototype.hasOwnProperty.call(COMPOSED_STEP_EXCEPTIONS, row.step)
      ? COMPOSED_STEP_EXCEPTIONS[row.step]
      : CEILING_BYTES;
    const over = Math.max(0, row.max - ceiling);
    const entry = {
      step: row.step, file: row.file, line: row.line, max: row.max, ceiling, over,
    };
    composed.push(entry);
    if (over === 0 && row.max >= ceiling * 0.9) composedNearCeiling.push(entry);
  }
  return { composed, composedNearCeiling, composedErrors };
}

function headroomCheck(entries, repoRoot, deps = {}) {
  const nearCeiling = [];
  const breaches = [];
  const seen = new Set();
  const governedPaths = new Set();
  for (const { type, path: relPath } of entries) {
    if (type === 'Create') continue;
    if (!isGovernedMdPath(relPath)) continue;
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    governedPaths.add(relPath.split(path.sep).join('/'));
    const abs = path.resolve(repoRoot, relPath);
    let bytes;
    try {
      bytes = fs.statSync(abs).size;
    } catch {
      continue; // Check A already reports this path as missing
    }
    if (bytes > CEILING_BYTES) {
      breaches.push({ file: relPath, bytes });
    } else if (bytes >= CEILING_BYTES * 0.9) {
      nearCeiling.push({ file: relPath, bytes, headroom: CEILING_BYTES - bytes });
    }
  }
  const { composed, composedNearCeiling, composedErrors } = composedHeadroom(governedPaths, repoRoot, deps);
  // composedErrors never gates `ok` — it's "could not measure", not "over
  // ceiling" (#1997); still reported so it stays visible rather than
  // silently dropped.
  const ok = breaches.length === 0 && composed.every((c) => c.over === 0);
  return {
    ok, nearCeiling, breaches, composed, composedNearCeiling, composedErrors,
  };
}

// ── Check D — Control-byte scan ─────────────────────────────────────────────
// #2000: the plan is read via readFileSync(..., 'utf8') — already decoded —
// so a code-point walk (never a byte-level scan, which would misfire on
// UTF-8 continuation bytes) finds every raw control character while leaving
// multi-byte text untouched. Flags any code point in U+0000-U+001F or
// U+007F other than tab/LF/CR. Findings are capped at 20 (with `truncated:
// true` beyond that) — a `line`/`column` pair (both 1-based) is what makes
// the fix a single edit; `offset` is the 0-based UTF-16 code-unit offset.
const CONTROL_FINDINGS_CAP = 20;
const ALLOWED_CONTROL_CODEPOINTS = new Set([0x09, 0x0A, 0x0D]); // tab, LF, CR

function checkD(text) {
  const findings = [];
  let totalFindings = 0;
  let line = 1;
  let column = 0;
  let offset = 0;
  for (const ch of text) {
    if (ch === '\n') {
      line += 1;
      column = 0;
      offset += ch.length;
      continue;
    }
    column += 1;
    const codePoint = ch.codePointAt(0);
    const isControl = (codePoint <= 0x1F || codePoint === 0x7F) && !ALLOWED_CONTROL_CODEPOINTS.has(codePoint);
    if (isControl) {
      totalFindings += 1;
      if (findings.length < CONTROL_FINDINGS_CAP) {
        findings.push({
          line,
          column,
          codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
          offset,
        });
      }
    }
    offset += ch.length;
  }
  const result = { ok: findings.length === 0, findings };
  if (totalFindings > CONTROL_FINDINGS_CAP) result.truncated = true;
  return result;
}

module.exports = {
  checkA, checkB, checkC, checkD, headroomCheck, looksPassing, isGovernedMdPath,
  refusedVcsMutation, commandSegments, checkPremiseRefs,
};
