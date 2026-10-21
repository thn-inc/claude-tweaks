'use strict';
const fs = require('fs');
const path = require('path');
const { STALE_DAYS } = require('./score');
const { parseFilesField } = require('./freshness');
const { selectByStaleThenChurn } = require('../health-core/rotation');
const { domainChurn } = require('../health-core/churn');
const { toPosix } = require('../shared-primitives');

// Directory names excluded when they sit directly under docs/. `superpowers`
// is ephemeral /specify + /superpowers:writing-plans build artifacts (specs,
// plans), not Diátaxis-portal content. `journeys` is /claude-tweaks:journey-
// health's exclusive territory (journey accuracy and agent-e2e coverage
// instead of Diátaxis genre-drift) — without this exclusion the same file
// could be independently audited and issue-filed by both by:docs-health and
// by:journey-health. Not a recursive-anywhere exclusion: only docs/superpowers
// and docs/journeys themselves are skipped, not any nested dir of the same
// name deeper in the tree (there shouldn't be one, but this keeps the rule
// narrow and explicit rather than accidentally over-broad).
const EXCLUDE_TOP_LEVEL_DIRS = new Set(['superpowers', 'journeys']);

// ─── listDocs ────────────────────────────────────────────────────────────
// Recursively walks docs/**, returning [{ kind: 'doc', id, path }] for
// every .md file, sorted by id. id is the path relative to docs/,
// forward-slashed, without the .md extension — e.g.
// docs/decisions/0007-foo.md -> "decisions/0007-foo". By default skips
// docs/superpowers/**, docs/journeys/**, and any dotfile directory. [] if
// docs/ doesn't exist — a project with no docs/ tree yet is a valid state,
// not an error.
//
// opts: { excludeTopLevelDirs?: boolean, skipDotDirs?: boolean } — both
// default true (this module's own scan-target callers). findability.js's
// inbound-reference scan calls with both false: it needs every candidate
// *referrer* file under docs/ (including docs/superpowers/** and
// docs/journeys/**, which may legitimately link to an audited doc even
// though they're never themselves audit targets), not just the
// Diátaxis-portal subset this function otherwise returns.
//
// Structurally never returns anything under .claude/skills/**,
// .claude/rules/**, or a project-root CLAUDE.md — this walker only ever
// descends into docs/, so harness-health's exclusive territory is excluded
// by construction, not by an explicit skip rule.
function walk(dir, docsRoot, out, opts) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    // Blanket dotfile/dotdir skip — covers any dot-prefixed directory this
    // walk might otherwise descend into (a nested .worktrees, .git, etc.)
    // by construction, unlike code-health/scope.js's explicit named
    // SKIP_DIRS list, since nothing under docs/ is expected to start with
    // a dot in the first place.
    if (opts.skipDotDirs && entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (opts.excludeTopLevelDirs && dir === docsRoot && EXCLUDE_TOP_LEVEL_DIRS.has(entry.name)) continue;
      walk(full, docsRoot, out, opts);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const rel = toPosix(path.relative(docsRoot, full)).replace(/\.md$/, '');
      out.push({ kind: 'doc', id: rel, path: full });
    }
  }
}

function listDocs(root, opts = {}) {
  const { excludeTopLevelDirs = true, skipDotDirs = true } = opts;
  const docsRoot = path.join(root, 'docs');
  const out = [];
  walk(docsRoot, docsRoot, out, { excludeTopLevelDirs, skipDotDirs });
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ─── extractDomainPaths ────────────────────────────────────────────────────
// Mechanical proxy for "what this doc references": backtick-quoted strings
// that look like a file path (no whitespace, a dot-extension, AND a
// slash). Deliberately NOT prose understanding — that's the LLM judge's
// job, not the engine's.
function extractDomainPaths(content) {
  const matches = content.match(/`([^`\s]+\.[a-zA-Z0-9]+)`/g) || [];
  const paths = matches.map((m) => m.slice(1, -1)).filter((p) => p.includes('/'));
  return [...new Set(paths)];
}

// domainChurn (git-log-based commit counter, memoized) now lives in
// bin/lib/health-core/churn.js, shared with harness-health/scope.js and
// journey-health/scope.js — see the require at the top of this file.

// ─── selectTarget ────────────────────────────────────────────────────────────
// opts: { now?: number, signals?: { [id]: number }, dir?: string }
// Returns { kind: 'doc', id, path, why: 'stale' | 'hotspot' } or null.
// Cursor key is namespaced "doc:<id>" throughout, matching harness-health's
// "${kind}:${id}" convention (docs-health has a single kind, so the prefix
// is a fixed literal rather than a variable).
//
// opts.dir (optional): restrict the candidate pool to docs whose id is, or
// starts with, this path relative to docs/ (e.g. "decisions" matches
// "decisions/0007-foo" but not "decisions-archive/0001-bar") — the normal
// stale/hotspot rotation logic below still applies within that subset. A
// dir with no matching docs behaves exactly like an empty candidate pool
// (selectByStaleThenChurn returns null), same as a project with no docs/
// tree at all.
function selectTarget(root, cursors, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const signals = opts.signals || null; // test injection hook — churn override by "doc:<id>" key

  let candidates = listDocs(root);
  if (opts.dir) {
    const dirPrefix = opts.dir.replace(/\/+$/, '');
    candidates = candidates.filter((c) => c.id === dirPrefix || c.id.startsWith(`${dirPrefix}/`));
  }

  return selectByStaleThenChurn(candidates, cursors, {
    now,
    staleDays: STALE_DAYS,
    getCursorKey: (candidate) => `doc:${candidate.id}`,
    getLastAuditedMs: (cursor) => (cursor && cursor.lastAuditedMs != null ? cursor.lastAuditedMs : null),
    // Score by churn since last audit — the doc's own declared files:
    // dependencies (preferred, parseFilesField) or, absent those, its
    // incidentally backtick-quoted paths (extractDomainPaths) — UNION the
    // doc file's own path, so editing the doc itself also counts (a doc
    // that changed a lot recently is itself a drift risk, independent of
    // what it references).
    computeScore: (candidate, cursor, sinceMs) => {
      const key = `doc:${candidate.id}`;
      let churn;
      if (signals) {
        churn = signals[key] || 0;
      } else {
        let content;
        try { content = fs.readFileSync(candidate.path, 'utf8'); } catch { content = ''; }
        const relDocPath = toPosix(path.relative(root, candidate.path));
        const declaredPaths = parseFilesField(content);
        const domainPaths = declaredPaths.length > 0 ? declaredPaths : extractDomainPaths(content);
        churn = domainChurn(root, [relDocPath, ...domainPaths], sinceMs);
      }
      return churn > 0 ? churn : null;
    },
    buildHotspotResult: (candidate, score) => ({ ...candidate, why: 'hotspot', churnCount: score }),
  });
}

module.exports = { listDocs, extractDomainPaths, domainChurn, selectTarget };
