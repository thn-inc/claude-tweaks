'use strict';

// candidates-scale-readiness.js — deterministic pre-scale hardening checklist
// generator for code-health's `focus=scale-readiness` scoping mode (see
// skills/code-health/focus-mode.md). Reports pass/fail/needs-manual-check for
// the six-item checklist of `focus=scale-readiness` (#2622): query patterns, slow work off the request
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
//   - Query checks (`query-in-loop`, `unbounded-list-query`,
//     `unindexed-where-field`) use text-window and bracket-depth matching
//     (`findClose`), not an AST: the depth counter has no string or comment
//     awareness and gives up after `MAX_SCAN_CHARS`, so a loop body or call
//     longer than that, or one with a stray bracket inside a string, is
//     skipped silently rather than guessed at.
//   - Recognized query shapes are Prisma (`prisma.<model>.<op>(`), a
//     `db|pool|client|sql|knex|connection|conn` `.query`/`.execute` driver
//     call, a capitalized-receiver model call (`User.find`, `Order.findOne`,
//     `Post.findAll` — Mongoose/Sequelize style) and `supabase.from(`. A
//     query reached through a wrapper function or an unlisted ORM is
//     invisible, and a loop that reaches a query only through a helper is
//     not seen as a loop-with-query.
//   - The unindexed-field check is Prisma-schema-only: it needs a
//     `.prisma` file the generator can parse and a `prisma.<model>` call in
//     JS/TS whose `where` is an inline object literal. A `where` built in a
//     variable, a raw SQL filter or an index defined only by a migration is
//     not seen. A composite `@@index([a, b])` covers only its leading column
//     `a`: a `where` on `b` alone still reads as unindexed, which matches how
//     most databases use a composite index.
//   - The capitalized-receiver shape also matches an in-memory constant array
//     (`COUNTRIES.find(`), so a loop or an unbounded-list flag on one is a
//     possible false positive. A `findMany(args)` whose argument is a variable
//     rather than an object literal reads as unbounded, because a `take` set
//     elsewhere is not visible.
//   - `inline-slow-work` scans route files only. It looks for three categories
//     — an AI call (`chat.completions.create`, `responses.create`,
//     `messages.create`, `embeddings.create`, `createChatCompletion`,
//     `generateText`, `generateObject`), an email send (`.sendMail`,
//     `emails.send`, `sgMail.send`, `sendEmail`, `SendEmailCommand`) and a
//     third-party fetch (`fetch`, `axios`, `axios.<verb>`, `got`, `ky` whose
//     first argument is a string literal starting `http://` or `https://`) —
//     and reports the first match of each category per file. `streamText` and
//     `streamObject` are deliberately excluded: a streamed response is
//     request-bound by design. A queue or background-job signal anywhere in
//     the file (`bullmq`, `bee-queue`, `inngest`, `@trigger.dev`, `qstash`,
//     `pg-boss`, `graphile-worker`, `SendMessageCommand`, `enqueue*`,
//     `waitUntil`, `<name>Queue.add(`, `new Queue(`, `after(async`) suppresses
//     every finding in that file, even for a slow call the signal does not
//     cover. A client wrapped in a helper, or a fetch to a URL held in a
//     variable, is invisible.
//   - `per-request-db-client` scans route files for `new PrismaClient(`,
//     `new Pool(`, `new Client(`, `new MongoClient(`, `mysql.createConnection(`,
//     `mysql.createPool(` and `postgres(` at brace depth above zero. Depth is a
//     `{`/`}` count from the start of the file with no string or comment
//     awareness, and `new Client(` matches any class of that name. A client
//     built in a module-scope factory called per request is not seen.
//   - `unbounded-pool` scans all source for `new Pool(` without a `max`
//     option, `createPool(` without `connectionLimit` and `new MongoClient(`
//     without `maxPoolSize`, and names the driver default in its evidence. It
//     inspects only the literal call arguments: a config held in a variable
//     reads as uncapped.
//   - `no-cache-layer` is a presence check, not a quality check. It applies
//     when at least one route file contains a query call, and passes if any
//     of `redis`, `ioredis`, `@upstash/redis`, `@vercel/kv`, `lru-cache`,
//     `node-cache`, `keyv`, `cache-manager` or `memcached` is a dependency, or
//     any source file mentions `unstable_cache`, `"use cache"`, `export const
//     revalidate`, `Cache-Control` or `s-maxage`. It cannot tell whether the
//     cache covers the routes that need it, and it anchors to the shallowest
//     `package.json`.
//   - `no-monitoring` is a presence check too: it passes if any dependency is
//     `@sentry/*`, `@bugsnag/*`, `rollbar`, `@honeybadger-io/*`, `newrelic`,
//     `dd-trace`, `@datadog/*`, `@opentelemetry/*`, `@highlight-run/*`,
//     `@appsignal/*`, `elastic-apm-node`, `raygun` or `@airbrake/*`. It cannot
//     tell whether the SDK is initialized, and a platform-level agent or a
//     hosted log drain with no dependency reads as missing.

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

// ---- Query checks ----------------------------------------------------------

// Bound on every bracket-matching window: a loop body or call longer than this
// is skipped, never guessed at.
const MAX_SCAN_CHARS = 4000;

// Read and write query-call shapes (global — copy with `new RegExp(source, 'g')`
// when a caller needs its own lastIndex): Prisma, a driver `.query`/`.execute`,
// a capitalized-receiver model call (Mongoose/Sequelize) and Supabase.
const QUERY_CALL_RE = /\bprisma\.\w+\.(?:findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy|create|update|upsert|delete)\s*\(|\b(?:db|pool|client|sql|knex|connection|conn)\.(?:query|execute)\s*\(|\b[A-Z]\w*\.(?:find|findOne|findById|findAll|findByPk|countDocuments)\s*\(|\bsupabase\.from\s*\(/g;

// Index of the `close` matching the `open` at `openIdx`, or -1. A plain depth
// counter — no string or comment awareness — that gives up after
// MAX_SCAN_CHARS characters or at the end of the text.
function findClose(text, openIdx, open, close) {
  const end = Math.min(text.length, openIdx + MAX_SCAN_CHARS);
  let depth = 0;
  for (let i = openIdx; i < end; i++) {
    const ch = text[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineOf(text, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

const LOOP_OPENER_RE = /\bfor\s*(?:await\s*)?\(|\bwhile\s*\(|\.(?:map|forEach|flatMap)\s*\(\s*async\b/g;

// `{ start, end }` of the loop body for one LOOP_OPENER_RE match, or null when
// the brackets do not balance inside the scan window.
function loopBody(text, m) {
  const parenIdx = text.indexOf('(', m.index);
  const closeParen = findClose(text, parenIdx, '(', ')');
  if (closeParen === -1) return null;
  if (m[0].startsWith('.')) return { start: parenIdx + 1, end: closeParen };
  let i = closeParen + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === '{') {
    const closeBrace = findClose(text, i, '{', '}');
    return closeBrace === -1 ? null : { start: i + 1, end: closeBrace };
  }
  const semi = text.indexOf(';', i);
  return { start: i, end: semi === -1 ? Math.min(text.length, i + MAX_SCAN_CHARS) : semi };
}

function scanQueryInLoop(ctx, candidates) {
  for (const { rel, text } of ctx.sourceTexts) {
    const seen = new Set();
    const loops = new RegExp(LOOP_OPENER_RE.source, 'g');
    let m;
    while ((m = loops.exec(text)) !== null) {
      const body = loopBody(text, m);
      if (!body) continue;
      const opener = m[0].replace(/\s+/g, ' ').replace(/\(\s+/, '(').replace(/\s*\($/, '');
      const queries = new RegExp(QUERY_CALL_RE.source, 'g');
      const slice = text.slice(body.start, body.end);
      let q;
      while ((q = queries.exec(slice)) !== null) {
        const line = lineOf(text, body.start + q.index);
        if (seen.has(line)) continue;
        seen.add(line);
        candidates.push({ file: rel, kind: 'query-in-loop', evidence: `${rel}:${line} query call inside a loop (${opener}) — N+1 pattern` });
      }
    }
  }
}

// True when the call's args are an object literal with a top-level `take` or
// `limit` key (`key: v` or bare shorthand). A nested `include: { x: { take } }`
// or a `limit` used as a value inside `where` does not bound the outer call.
function hasTopLevelLimit(args) {
  const trimmed = args.trim();
  if (!trimmed.startsWith('{')) return false;
  const inner = braceInner(trimmed, 0);
  if (inner === null) return false;
  return splitTopLevel(inner).some((seg) => /^['"]?(?:take|limit)['"]?\s*(?::|$)/.test(seg));
}

function scanUnboundedListQuery(ctx, candidates) {
  const listCall = /\bprisma\.(\w+)\.findMany\s*\(|\b([A-Z]\w*)\.(findAll|find)\s*\(/g;
  for (const { rel, text } of ctx.sourceTexts) {
    const calls = new RegExp(listCall.source, 'g');
    let m;
    while ((m = calls.exec(text)) !== null) {
      const parenIdx = m.index + m[0].length - 1;
      const name = m[1] ? `prisma.${m[1]}.findMany` : `${m[2]}.${m[3]}`;
      let unbounded;
      if (m[3] === 'find') {
        const semi = text.indexOf(';', parenIdx);
        const stmtEnd = semi === -1 ? text.length : semi;
        unbounded = !/\.limit\s*\(/.test(text.slice(parenIdx, Math.min(stmtEnd, parenIdx + 300)));
      } else {
        const close = findClose(text, parenIdx, '(', ')');
        if (close === -1) continue;
        unbounded = !hasTopLevelLimit(text.slice(parenIdx + 1, close));
      }
      if (unbounded) {
        candidates.push({ file: rel, kind: 'unbounded-list-query', evidence: `${rel}:${lineOf(text, m.index)} ${name} has no take/limit — an unbounded list` });
      }
    }
  }
}

// Depth-0 comma-separated segments of an object/array body.
function splitTopLevel(inner) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Text inside the braces of the object literal that starts at `text[idx]`
// (which must be `{`), or null when it does not balance.
function braceInner(text, idx) {
  const close = findClose(text, idx, '{', '}');
  return close === -1 ? null : text.slice(idx + 1, close);
}

// { client -> { model, fields:Set, indexed:Set, schemaRel } } for every model
// in the given schemas; the shallowest schema wins a duplicate model name.
function parsePrismaModels(prismaSchemas) {
  const models = new Map();
  let parsedSchemas = 0;
  for (const { rel, text } of prismaSchemas) {
    const clean = text.replace(/\r\n?/g, '\n').replace(/(^|\s)\/\/.*$/gm, '$1');
    const blocks = [...clean.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)];
    if (blocks.length === 0) continue;
    parsedSchemas++;
    const modelNames = new Set(blocks.map((b) => b[1]));
    for (const [, name, body] of blocks) {
      const fields = new Set();
      const indexed = new Set();
      for (const line of body.split('\n')) {
        const f = line.match(/^\s*(\w+)\s+(\w+)/);
        if (!f || line.trim().startsWith('@@')) continue;
        if (modelNames.has(f[2])) continue; // a relation field, not a column
        fields.add(f[1]);
        if (/@id\b/.test(line) || /@unique\b/.test(line)) indexed.add(f[1]);
      }
      for (const g of body.matchAll(/@@(?:id|unique|index)\s*\((?:[^[\]]*?\bfields\s*:\s*)?\[\s*(\w+)/g)) indexed.add(g[1]);
      const client = name[0].toLowerCase() + name.slice(1);
      if (!models.has(client)) models.set(client, { model: name, fields, indexed, schemaRel: rel });
    }
  }
  return { models, parsedSchemas };
}

function scanUnindexedWhereField(ctx, candidates) {
  const { models, parsedSchemas } = parsePrismaModels(ctx.prismaSchemas);
  if (models.size > 0) {
    for (const { rel, text } of ctx.sourceTexts) {
      const seen = new Set();
      const calls = /\bprisma\.(\w+)\.(\w+)\s*\(/g;
      let m;
      while ((m = calls.exec(text)) !== null) {
        const info = models.get(m[1]);
        if (!info) continue;
        const parenIdx = m.index + m[0].length - 1;
        const argsClose = findClose(text, parenIdx, '(', ')');
        if (argsClose === -1) continue;
        const args = text.slice(parenIdx + 1, argsClose).trim();
        if (!args.startsWith('{')) continue;
        const argsInner = braceInner(args, 0);
        if (argsInner === null) continue;
        const whereSeg = splitTopLevel(argsInner).find((s) => /^where\s*:\s*\{/.test(s));
        if (!whereSeg) continue;
        const whereInner = braceInner(whereSeg, whereSeg.indexOf('{'));
        if (whereInner === null) continue;
        for (const seg of splitTopLevel(whereInner)) {
          const k = seg.match(/^['"]?(\w+)['"]?\s*(?::|$)/);
          if (!k || /^(?:AND|OR|NOT)$/.test(k[1])) continue;
          const field = k[1];
          if (!info.fields.has(field) || info.indexed.has(field)) continue;
          const key = `${info.model}.${field}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({
            file: rel,
            kind: 'unindexed-where-field',
            evidence: `${rel}:${lineOf(text, m.index)} prisma.${m[1]}.${m[2]} filters on ${info.model}.${field}, which has no @id/@unique/@@index in ${info.schemaRel}`,
          });
        }
      }
    }
  }
  return { queries: `${ctx.sourceTexts.length} source file(s) checked, ${parsedSchemas} Prisma schema(s) parsed` };
}

// ---- Slow work, pooling, caching, monitoring -------------------------------

// A queue / background-job signal anywhere in a route file suppresses every
// inline-slow-work finding in it. `@trigger.dev` sits outside the `\b` group:
// `\b` cannot precede `@`.
const QUEUE_SIGNAL_RE = /\b(?:bullmq|bee-queue|inngest|qstash|pg-boss|graphile-worker|SendMessageCommand|enqueue\w*|waitUntil)\b|@trigger\.dev|\b\w*[qQ]ueue\.add\s*\(|\bnew\s+Queue\s*\(|\bafter\s*\(\s*(?:async\b|\()/;

// `streamText`/`streamObject` are deliberately absent: a streamed response is
// request-bound by design. A DB model that shares a method name
// (`prisma.messages.create(`) is not an AI call.
const SLOW_CALL_CATEGORIES = [
  { category: 'AI call', re: /(?<!\bprisma\.)\b(?:chat\.completions|responses|messages|embeddings)\.create\s*\(|\bcreateChatCompletion\s*\(|\b(?:generateText|generateObject)\s*\(/ },
  { category: 'email send', re: /\.sendMail\s*\(|\bemails\.send\s*\(|\bsgMail\.send\s*\(|\bsendEmail\s*\(|\bSendEmailCommand\b/ },
  { category: 'third-party fetch', re: /(?<![\w$.])(?:fetch|got|ky|axios(?:\.(?:get|post|put|patch|delete|head|request))?)\s*\(\s*['"`]https?:\/\// },
];

function scanInlineSlowWork(ctx, candidates) {
  let checked = 0;
  for (const { rel, text } of ctx.sourceTexts) {
    if (!ctx.routeFiles.has(rel)) continue;
    checked++;
    if (QUEUE_SIGNAL_RE.test(text)) continue;
    for (const { category, re } of SLOW_CALL_CATEGORIES) {
      const m = re.exec(text);
      if (!m) continue;
      candidates.push({ file: rel, kind: 'inline-slow-work', evidence: `${rel}:${lineOf(text, m.index)} ${category} on the request path with no queue/background-job signal in the file` });
    }
  }
  return { 'background-jobs': `${checked} route file(s) checked for AI calls, email sends and third-party fetches` };
}

const REQUEST_CLIENT_RE = /\bnew\s+(?:PrismaClient|Pool|Client|MongoClient)\s*\(|\bmysql2?\.create(?:Connection|Pool)\s*\(|(?<![\w$.])postgres\s*\(/g;

// `{` minus `}` in text[0, idx). Counted from the start of the file, not a
// window before the match: a handler longer than MAX_SCAN_CHARS would
// otherwise lose its opening brace and read as module scope.
function braceDepthAt(text, idx) {
  let depth = 0;
  for (let i = 0; i < idx; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
  }
  return depth;
}

// [call regex, option that caps the pool, driver default named in the evidence]
const POOL_CHECKS = [
  { re: /\bnew\s+Pool\s*\(/g, capped: (args) => /(?:^|[\s,{])max\s*(?::|,|\}|$)/.test(args), name: 'new Pool(', note: 'pg default max 10 per instance' },
  { re: /\bcreatePool\s*\(/g, capped: (args) => /\bconnectionLimit\b/.test(args), name: 'createPool(', note: 'mysql default connectionLimit 10 per pool' },
  { re: /\bnew\s+MongoClient\s*\(/g, capped: (args) => /\bmaxPoolSize\b/.test(args), name: 'new MongoClient(', note: 'mongodb default maxPoolSize 100 per client' },
];

function scanPooling(ctx, candidates) {
  let routeChecked = 0;
  for (const { rel, text } of ctx.sourceTexts) {
    if (ctx.routeFiles.has(rel)) {
      routeChecked++;
      const seen = new Set();
      const calls = new RegExp(REQUEST_CLIENT_RE.source, 'g');
      let m;
      while ((m = calls.exec(text)) !== null) {
        if (braceDepthAt(text, m.index) <= 0) continue;
        const line = lineOf(text, m.index);
        if (seen.has(line)) continue;
        seen.add(line);
        candidates.push({ file: rel, kind: 'per-request-db-client', evidence: `${rel}:${line} ${m[0].replace(/\s*\($/, '').replace(/\s+/g, ' ')} created inside a handler — a new client or pool per request instead of one shared at module scope` });
      }
    }
    for (const { re, capped, name, note } of POOL_CHECKS) {
      const calls = new RegExp(re.source, 'g');
      let m;
      while ((m = calls.exec(text)) !== null) {
        const parenIdx = m.index + m[0].length - 1;
        const close = findClose(text, parenIdx, '(', ')');
        if (close === -1) continue;
        if (capped(text.slice(parenIdx + 1, close))) continue;
        candidates.push({ file: rel, kind: 'unbounded-pool', evidence: `${rel}:${lineOf(text, m.index)} ${name}) sets no explicit pool cap (${note})` });
      }
    }
  }
  return { pooling: `${routeChecked} route file(s) checked for per-request clients, ${ctx.sourceTexts.length} source file(s) checked for uncapped pools` };
}

const CACHE_DEPS = new Set(['redis', 'ioredis', '@upstash/redis', '@vercel/kv', 'lru-cache', 'node-cache', 'keyv', 'cache-manager', 'memcached']);
const CACHE_SOURCE_RE = /unstable_cache|['"]use cache['"]|export\s+const\s+revalidate|Cache-Control|s-maxage/;

function scanCacheLayer(ctx, candidates) {
  const queryCall = new RegExp(QUERY_CALL_RE.source);
  const dbRoutes = ctx.sourceTexts.filter(({ rel, text }) => ctx.routeFiles.has(rel) && queryCall.test(text));
  if (dbRoutes.length === 0) return { caching: 'no DB-backed routes detected' };
  const dep = [...ctx.deps].find((d) => CACHE_DEPS.has(d));
  if (dep) return { caching: `cache dependency found: ${dep}` };
  const hit = ctx.sourceTexts.find(({ text }) => CACHE_SOURCE_RE.test(text));
  if (hit) return { caching: `cache signal found in ${hit.rel}` };
  candidates.push({
    file: ctx.anchorFile,
    kind: 'no-cache-layer',
    evidence: `${dbRoutes.length} DB-backed route file(s) (e.g. ${dbRoutes[0].rel}) and no cache-layer signal (looked for: ${[...CACHE_DEPS].join(', ')} dependencies; unstable_cache, "use cache", export const revalidate, Cache-Control, s-maxage)`,
  });
  return undefined;
}

const MONITORING_DEP_RE = /^(@sentry\/|@bugsnag\/|rollbar$|@honeybadger-io\/|newrelic$|dd-trace$|@datadog\/|@opentelemetry\/|@highlight-run\/|@appsignal\/|elastic-apm-node$|raygun$|@airbrake\/)/;

function scanMonitoring(ctx, candidates) {
  const dep = [...ctx.deps].find((d) => MONITORING_DEP_RE.test(d));
  if (dep) return { monitoring: `error-tracking/APM dependency found: ${dep}` };
  candidates.push({
    file: ctx.anchorFile,
    kind: 'no-monitoring',
    evidence: `no error-tracking or APM dependency among ${ctx.deps.size} declared (looked for: @sentry/*, @bugsnag/*, rollbar, @honeybadger-io/*, newrelic, dd-trace, @datadog/*, @opentelemetry/*, @highlight-run/*, @appsignal/*, elastic-apm-node, raygun, @airbrake/*)`,
  });
  return undefined;
}

SCANNERS.push(scanQueryInLoop);
SCANNERS.push(scanUnboundedListQuery);
SCANNERS.push(scanUnindexedWhereField);
SCANNERS.push(scanInlineSlowWork);
SCANNERS.push(scanPooling);
SCANNERS.push(scanCacheLayer);
SCANNERS.push(scanMonitoring);

registerGenerator('scale-readiness', scanScaleReadiness);

module.exports = {
  scanScaleReadiness,
  candidatesScaleReadiness,
  CHECKLIST_ITEMS,
  SCANNERS,
  isRouteFile,
  NON_APP_SEGMENT_RE,
  scanQueryInLoop,
  scanUnboundedListQuery,
  scanUnindexedWhereField,
  scanInlineSlowWork,
  scanPooling,
  scanCacheLayer,
  scanMonitoring,
  QUERY_CALL_RE,
  findClose,
  MAX_SCAN_CHARS,
};
