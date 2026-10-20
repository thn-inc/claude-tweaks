'use strict';

// candidates-scale-readiness.js — deterministic pre-scale hardening checklist
// generator for code-health's `focus=scale-readiness` scoping mode (see
// skills/code-health/focus-mode.md). Reports pass/fail/needs-manual-check for
// the six-item checklist of #2622: query patterns, slow work off the request
// path, a load test, a cache layer, connection pooling and error tracking/
// APM. Each row carries a `phase` (`pre-launch` or `pre-scale`) so the
// summary can say which items block a launch and which can wait for traffic.
// Candidates are INPUT to the judge (skills/code-health/SKILL.md Step 5) —
// this generator never concludes anything on its own, never runs anything
// against a live app, never fixes anything, and never edits files.
//
// Scope boundary vs. sibling verticals: this vertical owns exactly the six
// checklist items above. The rotating `scalability` and `observability`
// criteria (which judge the whole codebase, not a fixed checklist) and the
// `prelaunch` (site launch checklist), `security-hardening` (secrets/
// ownership/AI-endpoint guards) and `app-store-readiness` verticals are out
// of scope — no overlapping category is claimed by more than one of them.
// See `criteria-scale-readiness.md` for the judging side of this boundary.
//
// Coverage (stated explicitly, never implied total — IL-110):
//   - Discovery reuses `candidates-dead-code.js`'s `listTrackedFiles` — same
//     git-ls-files discovery, same `.gitignore` handling, same
//     discoveryFailed/discoveryReason IL-115 distinction — but with no
//     extension filter, since applicability also reads `package.json` and
//     `.prisma` files that the source-only view excludes.
//   - Files under test/fixture/example/mock/dependency/build-output and
//     framework-output directories (`NON_APP_SEGMENT_RE`) are never scanned
//     and never count toward applicability.
//   - Per-file scans read JS/TS source only (`.js .jsx .ts .tsx .mjs .cjs`,
//     minus `.d.ts`) — a server written in another language, or logic in a
//     `.vue`/`.svelte`/`.astro` file, is invisible to every per-file check.
//   - Route detection is a path heuristic (`isRouteFile`): Next.js App
//     Router `route.*`, `pages/api/`, SvelteKit `+server.*`, and a
//     `routes`/`api`/`handlers`/`controllers`/`endpoints` directory segment.
//     A handler outside those shapes is not a route here, and a non-handler
//     file inside one is a possible false positive.
//   - Applicability reads only route paths, `package.json` dependencies
//     (`dependencies` and `devDependencies`) and `.prisma` files. `next`
//     alone is not a signal — a static Next.js site has no server work — and
//     a server whose dependency this list does not name reads as not
//     applicable.

const fs = require('fs');
const path = require('path');
// `./focus-generators` first: requiring `./candidates-dead-code` first from
// a direct entry leaves sibling verticals bound to an in-progress exports
// object (candidates-abstraction-police.js's header documents the order).
const { registerGenerator } = require('./focus-generators');
const { listTrackedFiles } = require('./candidates-dead-code');

// Directory segments whose contents never ship as the app itself — the
// prelaunch vertical's NON_SITE_SEGMENT_RE plus mocks and framework build
// output, which hold route-shaped files that are not the app's routes.
const NON_APP_SEGMENT_RE = /(^|\/)(tests?|__tests__|spec|e2e|cypress|fixtures|__fixtures__|examples?|node_modules|vendor|dist|build|out|coverage|\.storybook|__mocks__|mocks?|\.next|\.nuxt|\.svelte-kit|\.output)\//;

// Re-derived from candidates-security-hardening.js's ROUTE_DIR_RE rather than
// required from it: that gate also admits a bare trailing segment, which is
// right for its diff-path pre-check but wrong for a file path here, and a
// copied gate is not automatically right for a new check's semantics.
const ROUTE_DIR_RE = /(^|\/)(routes?|api|handlers?|controllers?|endpoints?)\//i;

const SOURCE_EXT_RE = /\.(jsx?|tsx?|mjs|cjs)$/;

const SERVER_DEPS = new Set(['express', 'fastify', 'koa', '@koa/router', 'hono', '@hapi/hapi', '@nestjs/core']);
const DATA_DEPS = new Set([
  '@prisma/client', 'prisma', 'pg', 'postgres', 'mysql', 'mysql2', 'mongoose', 'mongodb', 'knex',
  'drizzle-orm', 'sequelize', 'typeorm', 'kysely', 'better-sqlite3', '@supabase/supabase-js',
  '@neondatabase/serverless', '@planetscale/database',
]);

const MANUAL_LOAD_TEST_EVIDENCE = 'needs manual check — run a k6 load test against signup, login and the main dashboard; record p95 latency and error rate before and after (see criteria-scale-readiness.md)';

// The six-item checklist, in the exact order the record names them. `kinds`
// are the candidate `kind`s that make an automated row `fail`.
const CHECKLIST_ITEMS = [
  { id: 'queries', label: 'Query patterns (N+1, unpaginated lists, unindexed filters)', group: 'automated', phase: 'pre-launch', kinds: ['query-in-loop', 'unbounded-list-query', 'unindexed-where-field'] },
  { id: 'background-jobs', label: 'Slow work off the request path', group: 'automated', phase: 'pre-launch', kinds: ['inline-slow-work'] },
  { id: 'load-test', label: 'Load test (k6: signup, login, main dashboard)', group: 'manual', phase: 'pre-launch' },
  { id: 'caching', label: 'Cache layer for DB-backed routes', group: 'automated', phase: 'pre-scale', kinds: ['no-cache-layer'] },
  { id: 'pooling', label: 'Connection pooling (shared client, capped pool)', group: 'automated', phase: 'pre-scale', kinds: ['per-request-db-client', 'unbounded-pool'] },
  { id: 'monitoring', label: 'Error tracking / APM', group: 'automated', phase: 'pre-scale', kinds: ['no-monitoring'] },
];

// The ordered check functions the scan calls. Each is `scanX(ctx, candidates)`:
// it pushes candidates and may return `{ [checklistId]: evidenceString }`,
// which the scan merges into the pass evidence of those rows.
const SCANNERS = [];

function isRouteFile(rel) {
  if (NON_APP_SEGMENT_RE.test(rel)) return false;
  if (!SOURCE_EXT_RE.test(rel) || /\.d\.ts$/.test(rel)) return false;
  const base = path.basename(rel);
  if (/^route\.(js|ts|mjs)$/.test(base)) return true; // Next.js App Router
  if (/^\+server\.(js|ts)$/.test(base)) return true; // SvelteKit
  if (/(^|\/)pages\/api\//.test(rel)) return true; // Next.js pages router
  return ROUTE_DIR_RE.test(rel);
}

const byDepth = (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b);

function checklistRows(status, evidence) {
  return CHECKLIST_ITEMS.map((item) => ({ id: item.id, label: item.label, group: item.group, phase: item.phase, status, evidence }));
}

// Names listed in `dependencies`/`devDependencies` of one package.json text;
// malformed JSON or a non-object section contributes nothing.
function readDeps(text) {
  const names = [];
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return names;
  }
  if (!pkg || typeof pkg !== 'object') return names;
  for (const key of ['dependencies', 'devDependencies']) {
    const section = pkg[key];
    if (section && typeof section === 'object' && !Array.isArray(section)) names.push(...Object.keys(section));
  }
  return names;
}

function readText(rootDir, rel, skippedFiles) {
  let buf;
  try {
    buf = fs.readFileSync(path.join(rootDir, rel));
  } catch {
    skippedFiles.push({ file: rel, reason: 'unreadable' });
    return null;
  }
  if (buf.includes(0)) {
    skippedFiles.push({ file: rel, reason: 'binary-or-nul' });
    return null;
  }
  return buf.toString('utf8');
}

// The rich-shape scan — registered under 'scale-readiness' in FOCUS_GENERATORS.
function scanScaleReadiness(rootDir) {
  const discovery = listTrackedFiles(rootDir);
  if (discovery.discoveryFailed) {
    return {
      candidates: [],
      scannedFiles: 0,
      skippedFiles: [],
      discoveryFailed: true,
      discoveryReason: discovery.reason,
      notApplicable: false,
      checklist: checklistRows('n/a', 'discovery failed'),
    };
  }

  const appFiles = discovery.files.filter((f) => !NON_APP_SEGMENT_RE.test(f));
  const skippedFiles = [];
  const routeFiles = appFiles.filter(isRouteFile).sort(byDepth);
  const packageFiles = appFiles.filter((f) => path.basename(f) === 'package.json').sort(byDepth);
  const prismaFiles = appFiles.filter((f) => f.endsWith('.prisma')).sort(byDepth);

  const deps = new Set();
  for (const rel of packageFiles) {
    const text = readText(rootDir, rel, skippedFiles);
    if (text !== null) for (const name of readDeps(text)) deps.add(name);
  }
  const hasServerSignal = routeFiles.length > 0
    || prismaFiles.length > 0
    || [...deps].some((d) => SERVER_DEPS.has(d) || DATA_DEPS.has(d));

  if (!hasServerSignal) {
    const reason = 'no server or data-access signal detected';
    return {
      candidates: [],
      scannedFiles: discovery.files.length,
      skippedFiles,
      discoveryFailed: false,
      notApplicable: true,
      notApplicableReason: reason,
      checklist: checklistRows('n/a', reason),
    };
  }

  const sourceTexts = [];
  for (const rel of appFiles.filter((f) => SOURCE_EXT_RE.test(f) && !/\.d\.ts$/.test(f)).sort()) {
    const text = readText(rootDir, rel, skippedFiles);
    if (text !== null) sourceTexts.push({ rel, text });
  }
  const prismaSchemas = [];
  for (const rel of prismaFiles) {
    const text = readText(rootDir, rel, skippedFiles);
    if (text !== null) prismaSchemas.push({ rel, text });
  }

  // A repo-level candidate (no-cache-layer, no-monitoring) anchors to a real
  // file, never a directory: the shallowest package.json, else the first
  // route file, else the first Prisma schema.
  const anchorFile = packageFiles[0] || routeFiles[0] || prismaFiles[0];

  const ctx = { sourceTexts, routeFiles: new Set(routeFiles), deps, packageFiles, prismaSchemas, anchorFile };

  const candidates = [];
  const passEvidenceById = {};
  for (const scanner of SCANNERS) {
    const evidence = scanner(ctx, candidates);
    if (evidence && typeof evidence === 'object') Object.assign(passEvidenceById, evidence);
  }

  candidates.sort((a, b) => (a.file === b.file ? a.evidence.localeCompare(b.evidence) : a.file.localeCompare(b.file)));

  const checklist = CHECKLIST_ITEMS.map((item) => {
    const row = { id: item.id, label: item.label, group: item.group, phase: item.phase };
    if (item.group === 'manual') return { ...row, status: 'manual', evidence: MANUAL_LOAD_TEST_EVIDENCE };
    const matching = candidates.filter((c) => item.kinds.includes(c.kind));
    if (matching.length > 0) return { ...row, status: 'fail', evidence: `${matching.length} candidate(s)` };
    return { ...row, status: 'pass', evidence: passEvidenceById[item.id] || 'no issues found' };
  });

  return {
    candidates,
    scannedFiles: discovery.files.length,
    skippedFiles,
    discoveryFailed: false,
    notApplicable: false,
    checklist,
  };
}

// Spec-pinned Data/API Surface signature — a bare array, mirroring the
// sibling verticals' direct entry point for unit tests / a future
// non-focus-mode caller.
function candidatesScaleReadiness(rootDir) {
  return scanScaleReadiness(rootDir).candidates;
}

registerGenerator('scale-readiness', scanScaleReadiness);

module.exports = {
  scanScaleReadiness,
  candidatesScaleReadiness,
  CHECKLIST_ITEMS,
  SCANNERS,
  isRouteFile,
  NON_APP_SEGMENT_RE,
};
