'use strict';
const fs = require('fs');
const path = require('path');
const { STALE_DAYS } = require('./score');
const { selectByStaleThenChurn } = require('../health-core/rotation');
const { parseFrontmatterListField } = require('../health-core/frontmatter-list');
const { domainChurn } = require('../health-core/churn');

// ─── listSkills ──────────────────────────────────────────────────────────────
// Returns [{ kind: 'skill', id, path }], sorted by id, for both skill shapes
// this project's own /init scaffolds: a flat .claude/skills/<name>.md file,
// or a directory-per-skill .claude/skills/<name>/SKILL.md (the current
// canonical convention — see skills/init/SKILL.md's own bootstrap scan).
// Empty array if the directory doesn't exist — a project with no generated
// skills yet is a valid state, not an error. README.md is excluded from the
// flat-file branch: a catalog index at the skills-directory root isn't a
// skill, regardless of which convention the real skills use.
function listSkills(root) {
  const dir = path.join(root, '.claude', 'skills');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const results = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      const skillPath = path.join(dir, e.name, 'SKILL.md');
      if (fs.existsSync(skillPath)) results.push({ kind: 'skill', id: e.name, path: skillPath });
    } else if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md') {
      results.push({ kind: 'skill', id: e.name.slice(0, -3), path: path.join(dir, e.name) });
    }
  }
  return results.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ─── parseRulePaths ────────────────────────────────────────────────────────────
// Extracts a rule file's `paths:` frontmatter list, e.g.:
//   ---
//   paths:
//     - src/api/**
//   ---
// Returns [] if there's no frontmatter, no `paths:` key, or no list items —
// an unparseable header means "no declared domain," not an error. Thin
// wrapper over the shared parser (bin/lib/health-core/frontmatter-list.js),
// which also backs docs-health/freshness.js's parseFilesField and
// journey-health/scope.js's parseJourneyFiles — same bullet-list shape,
// different frontmatter key.
function parseRulePaths(content) {
  return parseFrontmatterListField(content, 'paths');
}

// ─── listRules ───────────────────────────────────────────────────────────────
// Returns [{ kind: 'rule', id, path, pathGlobs }] for each .claude/rules/*.md
// file, sorted by id. pathGlobs is the parsed `paths:` frontmatter list (may
// be [] for an unparseable or absent header).
function listRules(root) {
  const dir = path.join(root, '.claude', 'rules');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const filePath = path.join(dir, e.name);
      let content = '';
      try { content = fs.readFileSync(filePath, 'utf8'); } catch { /* unreadable -> no globs */ }
      return { kind: 'rule', id: e.name.slice(0, -3), path: filePath, pathGlobs: parseRulePaths(content) };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ─── listClaudeMd ──────────────────────────────────────────────────────────────
// Returns a single-item list, [{ kind: 'claude-md', id: 'CLAUDE', path }], if
// <root>/CLAUDE.md exists — [] otherwise. Not a rotation candidate among
// siblings of its own kind (there's only ever one project CLAUDE.md), but
// competes in the same unified pool as skills/rules for churn/staleness
// selection.
function listClaudeMd(root) {
  const filePath = path.join(root, 'CLAUDE.md');
  if (!fs.existsSync(filePath)) return [];
  return [{ kind: 'claude-md', id: 'CLAUDE', path: filePath }];
}

// ─── listMemory ──────────────────────────────────────────────────────────────
// Returns [{ kind: 'memory', id, path }] for each `- [Title](file.md) — hook`
// bullet in <memoryDir>/MEMORY.md, sorted by id. [] if MEMORY.md is missing or
// unreadable — a project with no memory yet is a valid state, not an error.
// memoryDir is always an explicit, caller-supplied path (see selectMemoryTarget
// below) — never derived from a repo root.
function listMemory(memoryDir) {
  let content;
  try { content = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf8'); } catch { return []; }
  const results = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^-\s*\[.*?\]\(([^)]+)\)/);
    if (!m) continue;
    const href = m[1];
    const id = href.endsWith('.md') ? href.slice(0, -3) : href;
    results.push({ kind: 'memory', id, path: path.join(memoryDir, href) });
  }
  return results.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ─── selectMemoryTarget ──────────────────────────────────────────────────────
// Mirrors selectTarget's Phase 1 (force-pick the entry most overdue past
// STALE_DAYS) only — no Phase 2 hotspot/churn scoring, since memory has no git
// churn signal. Returns null (not an error) when nothing is due, same as
// selectTarget. Cursor key is namespaced "memory:<id>", same convention every
// other kind uses.
function selectMemoryTarget(memoryDir, cursors, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const candidates = listMemory(memoryDir);
  return selectByStaleThenChurn(candidates, cursors, {
    now,
    staleDays: STALE_DAYS,
    getCursorKey: (candidate) => `${candidate.kind}:${candidate.id}`,
    getLastAuditedMs: (cursor) => (cursor && cursor.lastAuditedMs != null ? cursor.lastAuditedMs : null),
    computeScore: () => null, // no Phase 2 signal for memory — always falls through to null
  });
}

// ─── readDesignIntegrationFlag ─────────────────────────────────────────────
// Parses CLAUDE.md's `design-integration:` value. Returns 'disabled' when
// CLAUDE.md is missing/unreadable or the flag is absent — mirrors the design
// wrapper's own "missing flag = disabled" rule (skills/design/SKILL.md Layer 1).
function readDesignIntegrationFlag(root) {
  let content;
  try { content = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'); } catch { return 'disabled'; }
  const m = content.match(/^design-integration:\s*(\S+)/m);
  return m ? m[1] : 'disabled';
}

// ─── DESIGN_DOMAIN_PATHS ────────────────────────────────────────────────────
// Frontend-signal git pathspecs, matching the file/directory signals /init's
// bootstrap uses for frontend detection. DESIGN.md documents the visual
// system, so churn here since its last regeneration is a meaningful
// staleness proxy.
const DESIGN_DOMAIN_PATHS = [
  '*.tsx', '*.jsx', '*.vue', '*.svelte', '*.html', '*.css', '*.scss', '*.sass', '*.less', '*.astro', '*.mdx',
  'components/', 'pages/', 'app/', 'routes/', 'views/', 'ui/',
];

// ─── listDesignArtifacts ────────────────────────────────────────────────────
// Returns [{ kind: 'design-artifact', id: 'PRODUCT'|'DESIGN', path, pathGlobs }]
// for PRODUCT.md/DESIGN.md, gated on design-integration being exactly
// 'enabled' ('plugin-only' and 'disabled' both skip — matches the design
// wrapper's Layer 1). Resolves each file at the project root first, then
// docs/design/<filename>, then docs/<filename> as fallbacks (a deterministic
// equivalent of the LLM-oriented glob description in
// skills/design/modes/pre-build.md's own fallback discovery step). A file
// absent at every location is simply omitted — not an error, not a finding.
// pathGlobs reuses the same field name (and, in selectTarget, the same
// domain-path branch) as a rule's pathGlobs — see selectTarget below.
function listDesignArtifacts(root) {
  if (readDesignIntegrationFlag(root) !== 'enabled') return [];

  const candidates = [
    { id: 'PRODUCT', filename: 'PRODUCT.md', pathGlobs: [] },
    { id: 'DESIGN', filename: 'DESIGN.md', pathGlobs: DESIGN_DOMAIN_PATHS },
  ];

  const results = [];
  for (const c of candidates) {
    const searchPaths = [
      path.join(root, c.filename),
      path.join(root, 'docs', 'design', c.filename),
      path.join(root, 'docs', c.filename),
    ];
    const resolved = searchPaths.find((p) => fs.existsSync(p));
    if (resolved) {
      results.push({ kind: 'design-artifact', id: c.id, path: resolved, pathGlobs: c.pathGlobs });
    }
  }
  return results;
}

// ─── listTargets cache ──────────────────────────────────────────────────────
// selectTarget is called once per slot in a --budget > 1 loop (see
// harness-health.js's cmdNextTarget), and nothing on disk changes between
// slots of the same run. Without caching, every slot redid listRules' content
// read (parseRulePaths needs each rule's frontmatter) and
// listDesignArtifacts' CLAUDE.md read for every remaining candidate — wasted
// I/O that scaled with budget times target count. Mirrors journey-health/
// scope.js's journeysCache. Keyed on a cheap name+mtime+size fingerprint
// across .claude/skills/*.md, .claude/rules/*.md, CLAUDE.md, and any resolved
// design artifact — computing the fingerprint itself never reads file
// content, only fs.statSync, so a cache hit still avoids every content read.
const targetsCache = new Map(); // root -> { fingerprint, targets }

function statPart(label, filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${label}:${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

function computeTargetsFingerprint(root) {
  const parts = [];
  const skillsDir = path.join(root, '.claude', 'skills');
  try {
    for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md')) {
        const part = statPart(`skill:${e.name}`, path.join(skillsDir, e.name));
        if (part) parts.push(part);
      }
    }
  } catch { /* no skills dir */ }
  const rulesDir = path.join(root, '.claude', 'rules');
  try {
    for (const e of fs.readdirSync(rulesDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md')) {
        const part = statPart(`rule:${e.name}`, path.join(rulesDir, e.name));
        if (part) parts.push(part);
      }
    }
  } catch { /* no rules dir */ }
  const claudeMdPart = statPart('claude-md', path.join(root, 'CLAUDE.md'));
  if (claudeMdPart) parts.push(claudeMdPart);
  for (const artifact of listDesignArtifacts(root)) {
    const part = statPart(`design:${artifact.id}`, artifact.path);
    if (part) parts.push(part);
  }
  return parts.sort().join('|');
}

// ─── listTargets ────────────────────────────────────────────────────────────
// Aggregates listSkills + listRules + listClaudeMd + listDesignArtifacts into
// one flat pool for the unified rotation/selection algorithm. Cached per
// root, validated on each call against computeTargetsFingerprint — a call
// repeated with an unchanged fingerprint in the same process reuses the prior
// result instead of re-reading every rule's content and CLAUDE.md again.
function listTargets(root) {
  const fingerprint = computeTargetsFingerprint(root);
  const cached = targetsCache.get(root);
  if (cached && cached.fingerprint === fingerprint) return cached.targets;

  const targets = [...listSkills(root), ...listRules(root), ...listClaudeMd(root), ...listDesignArtifacts(root)];
  targetsCache.set(root, { fingerprint, targets });
  return targets;
}

// ─── extractDomainPaths ────────────────────────────────────────────────────────
// Mechanical proxy for "what this document documents": backtick-quoted strings
// that look like a file path (no whitespace, a dot-extension, AND a slash).
// Deliberately NOT prose understanding — that's the LLM judge's job, not the
// engine's. Reused unchanged for skills and CLAUDE.md; rules prefer their own
// parsed pathGlobs (a precise, structured signal) when present.
function extractDomainPaths(content) {
  const matches = content.match(/`([^`\s]+\.[a-zA-Z0-9]+)`/g) || [];
  const paths = matches
    .map((m) => m.slice(1, -1))
    .filter((p) => p.includes('/'));
  return [...new Set(paths)];
}

// domainChurn (git-log-based commit counter, memoized) now lives in
// bin/lib/health-core/churn.js, shared with journey-health/scope.js and
// docs-health/scope.js — see the require at the top of this file.

// ─── selectTarget ────────────────────────────────────────────────────────────
// opts: { now?: number, signals?: { [kind:id]: number }, kind?: string }
// Returns { kind, id, path, why: 'stale' | 'hotspot' } or null. Cursor and
// signal lookups are namespaced as `${kind}:${id}` so a skill and a rule that
// happen to share a bare id never collide.
function selectTarget(root, cursors, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const signals = opts.signals || null; // test injection hook — churn override by "kind:id" key
  const kindFilter = opts.kind || null;

  let candidates = listTargets(root);
  if (kindFilter) candidates = candidates.filter((c) => c.kind === kindFilter);

  return selectByStaleThenChurn(candidates, cursors, {
    now,
    staleDays: STALE_DAYS,
    getCursorKey: (candidate) => `${candidate.kind}:${candidate.id}`,
    getLastAuditedMs: (cursor) => (cursor && cursor.lastAuditedMs != null ? cursor.lastAuditedMs : null),
    computeScore: (candidate, cursor, sinceMs) => {
      const key = `${candidate.kind}:${candidate.id}`;
      let churn;
      if (signals) {
        churn = signals[key] || 0;
      } else {
        let content;
        try { content = fs.readFileSync(candidate.path, 'utf8'); } catch { content = ''; }
        const domainPaths = (candidate.kind === 'rule' || candidate.kind === 'design-artifact') && candidate.pathGlobs && candidate.pathGlobs.length > 0
          ? candidate.pathGlobs
          : extractDomainPaths(content);
        // UNION the candidate's own path, so a heavily-rewritten skill/rule
        // whose backtick-quoted references (or a rule's pathGlobs) haven't
        // themselves seen matching commits still registers churn from its
        // own edit history — mirrors docs-health/scope.js's [relDocPath,
        // ...domainPaths] union (a doc/skill/rule that changed a lot
        // recently is itself a drift risk, independent of what it
        // references).
        const relCandidatePath = path.relative(root, candidate.path).split(path.sep).join('/');
        churn = domainChurn(root, [relCandidatePath, ...domainPaths], sinceMs);
      }
      return churn > 0 ? churn : null;
    },
    buildHotspotResult: (candidate, score) => ({ ...candidate, why: 'hotspot', churnCount: score }),
  });
}

// ─── resolveTargetPath ──────────────────────────────────────────────────────
// Maps a finding's (assetType, target-id) pair — the only identity a filed
// finding carries (judge-procedure.md's schema has no path field) — back to
// the concrete file path harness-health scanned it from. issue-payload.js
// uses this to anchor a Premise-check: command against the target's live
// content (#2621). A findings batch always corresponds to one target
// (judge-procedure.md: "Write the findings array to
// /tmp/harness-health-findings-{target.id}.json"), so a caller with `root`
// (and, for memory, `memoryDir`) in scope resolves it once per batch rather
// than per finding. Returns null on any unresolved case — unknown kind/id,
// or a memory kind with no memoryDir — never guesses.
function resolveTargetPath(root, kind, id, memoryDir) {
  if (!kind || !id) return null;
  if (kind === 'memory') {
    if (!memoryDir) return null;
    const found = listMemory(memoryDir).find((t) => t.id === id);
    return found ? found.path : null;
  }
  const found = listTargets(root).find((t) => t.kind === kind && t.id === id);
  return found ? found.path : null;
}

module.exports = {
  listSkills, parseRulePaths, listRules, listClaudeMd, listTargets,
  extractDomainPaths, domainChurn, selectTarget,
  readDesignIntegrationFlag, listDesignArtifacts,
  listMemory, selectMemoryTarget, resolveTargetPath,
};
