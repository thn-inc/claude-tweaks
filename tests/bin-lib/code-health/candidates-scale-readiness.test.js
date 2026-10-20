'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-scale-readiness-'));
}

function tmpGitRepo() {
  const root = tmp();
  execFileSync('git', ['-C', root, 'init', '-q']);
  return root;
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const {
  scanScaleReadiness,
  candidatesScaleReadiness,
  CHECKLIST_ITEMS,
  SCANNERS,
  isRouteFile,
  NON_APP_SEGMENT_RE,
} = require('../../../plugin/bin/lib/code-health/candidates-scale-readiness');
const { FOCUS_GENERATORS } = require('../../../plugin/bin/lib/code-health/focus-generators');

function noServerRepo() {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'lib', dependencies: { lodash: '^4' } }));
  write(root, 'src/index.js', 'module.exports = function helper(x) { return x + 1; };\n');
  return root;
}

function expressRepo() {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'api', dependencies: { express: '^4' } }));
  write(root, 'routes/health.js', "module.exports = (req, res) => res.send('ok');\n");
  return root;
}

test('AC2.3: a repo with no server signal is notApplicable with no candidates', () => {
  const root = noServerRepo();
  const r = scanScaleReadiness(root);
  assert.equal(r.notApplicable, true);
  assert.equal(r.notApplicableReason, 'no server or data-access signal detected');
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.checklist.map((x) => x.status), ['n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a']);
});

test('AC3.1: every firing lists the manual load-test row and a phase on every row', () => {
  const notApplicable = scanScaleReadiness(noServerRepo());
  const applicable = scanScaleReadiness(expressRepo());
  const discoveryFailed = scanScaleReadiness(tmp());
  assert.equal(discoveryFailed.discoveryFailed, true);
  for (const r of [notApplicable, applicable, discoveryFailed]) {
    assert.deepEqual(r.checklist.map((x) => x.id), ['queries', 'background-jobs', 'load-test', 'caching', 'pooling', 'monitoring']);
    assert.deepEqual(r.checklist.map((x) => x.phase), ['pre-launch', 'pre-launch', 'pre-launch', 'pre-scale', 'pre-scale', 'pre-scale']);
  }
  const loadTest = applicable.checklist.find((x) => x.id === 'load-test');
  assert.equal(loadTest.group, 'manual');
  assert.equal(loadTest.status, 'manual');
  assert.match(loadTest.evidence, /k6/);
});

// Runs `fn` with SCANNERS temporarily replaced by `list`, so a test asserts on
// the checklist/merge machinery without depending on which scanners the
// module registers (they grow across the vertical's tasks).
function withScanners(list, fn) {
  const saved = SCANNERS.splice(0, SCANNERS.length, ...list);
  try {
    return fn();
  } finally {
    SCANNERS.splice(0, SCANNERS.length, ...saved);
  }
}

test('an applicable repo whose scanners find nothing reads pass on every automated row', () => {
  const r = withScanners([], () => scanScaleReadiness(expressRepo()));
  assert.equal(r.notApplicable, false);
  assert.deepEqual(r.checklist.map((x) => x.status), ['pass', 'pass', 'manual', 'pass', 'pass', 'pass']);
  assert.equal(r.checklist[0].evidence, 'no issues found');
  assert.deepEqual(r.candidates, []);
});

test('a route file under tests/fixtures does not make a repo applicable', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'lib' }));
  write(root, 'tests/fixtures/app/api/users/route.ts', 'export async function GET() { return Response.json([]); }\n');
  assert.equal(scanScaleReadiness(root).notApplicable, true);
});

test('a package.json and a prisma schema under tests/fixtures do not make a repo applicable', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'lib', dependencies: { lodash: '^4' } }));
  write(root, 'tests/fixtures/api/package.json', JSON.stringify({ name: 'fx', dependencies: { express: '^4' } }));
  write(root, 'tests/fixtures/api/prisma/schema.prisma', 'model User {\n  id Int @id\n}\n');
  const r = scanScaleReadiness(root);
  assert.equal(r.notApplicable, true);
  assert.deepEqual(r.checklist.map((x) => x.status), ['n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a']);
});

test('each applicability signal on its own makes a repo applicable', () => {
  const a = tmpGitRepo();
  write(a, 'app/api/users/route.ts', 'export async function GET() { return Response.json([]); }\n');

  const b = tmpGitRepo();
  write(b, 'package.json', JSON.stringify({ name: 'b', dependencies: { express: '^4' } }));

  const c = tmpGitRepo();
  write(c, 'package.json', JSON.stringify({ name: 'c', devDependencies: { pg: '^8' } }));

  const d = tmpGitRepo();
  write(d, 'prisma/schema.prisma', 'model User {\n  id Int @id\n}\n');

  for (const root of [a, b, c, d]) {
    const r = scanScaleReadiness(root);
    assert.equal(r.notApplicable, false, root);
    assert.equal(r.discoveryFailed, false, root);
  }
});

test('a lone Next.js dependency is not a server signal', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'site', dependencies: { next: '^14', react: '^18' } }));
  write(root, 'app/page.tsx', 'export default function Page() { return null; }\n');
  assert.equal(scanScaleReadiness(root).notApplicable, true);
});

test('a malformed package.json contributes no dependencies and does not throw', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', '{ not json');
  write(root, 'src/index.js', 'module.exports = 1;\n');
  const r = scanScaleReadiness(root);
  assert.equal(r.notApplicable, true);
});

test('discovery failure is reported, not read as a clean repo', () => {
  const r = scanScaleReadiness(tmp());
  assert.equal(r.discoveryFailed, true);
  assert.equal(r.notApplicable, false);
  assert.deepEqual(r.candidates, []);
  assert.ok(r.discoveryReason);
  assert.deepEqual(r.checklist.map((x) => x.status), ['n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a']);
});

test('isRouteFile recognizes App Router, pages/api, SvelteKit and route directories', () => {
  for (const f of ['app/api/users/route.ts', 'app/dashboard/route.js', 'src/app/api/x/route.ts', 'pages/api/users.ts', 'src/routes/api/+server.ts', 'routes/orders.js', 'src/handlers/user.ts', 'controllers/post.js']) assert.ok(isRouteFile(f), f);
  for (const f of ['lib/db.ts', 'src/components/Route.tsx', 'app/page.tsx']) assert.ok(!isRouteFile(f), f);
});

test('isRouteFile rejects non-JS/TS files, declaration files and excluded directories', () => {
  for (const f of ['routes/readme.md', 'api/types.d.ts', 'tests/fixtures/app/api/users/route.ts', '.next/server/app/api/route.js', 'src/__mocks__/api/x.ts']) assert.ok(!isRouteFile(f), f);
});

test('NON_APP_SEGMENT_RE extends the site exclusions with mocks and framework output', () => {
  for (const p of ['tests/x.js', 'node_modules/x/y.js', '__mocks__/a.js', 'mocks/a.js', '.next/a.js', '.nuxt/a.js', '.svelte-kit/a.js', '.output/a.js']) assert.ok(NON_APP_SEGMENT_RE.test(p), p);
  assert.ok(!NON_APP_SEGMENT_RE.test('src/server/a.js'));
});

test('exports the registered generator and the checklist in the pinned order', () => {
  assert.equal(FOCUS_GENERATORS['scale-readiness'], scanScaleReadiness);
  assert.deepEqual(CHECKLIST_ITEMS.map((i) => i.id), ['queries', 'background-jobs', 'load-test', 'caching', 'pooling', 'monitoring']);
  const root = expressRepo();
  assert.deepEqual(candidatesScaleReadiness(root), scanScaleReadiness(root).candidates);
  assert.ok(Array.isArray(candidatesScaleReadiness(root)));
});

test('a scanner pushes candidates and may return passEvidenceById, merged into the checklist', () => {
  const root = expressRepo();
  const scanner = (ctx, candidates) => {
    assert.ok(ctx.routeFiles.has('routes/health.js'));
    assert.ok(ctx.deps.has('express'));
    assert.deepEqual(ctx.packageFiles, ['package.json']);
    assert.equal(ctx.anchorFile, 'package.json');
    assert.ok(ctx.sourceTexts.some((s) => s.rel === 'routes/health.js'));
    candidates.push({ file: 'routes/health.js', kind: 'query-in-loop', evidence: 'x' });
    return { pooling: '1 route(s) checked' };
  };
  const r = withScanners([scanner], () => scanScaleReadiness(root));
  assert.equal(r.checklist.find((x) => x.id === 'queries').status, 'fail');
  assert.equal(r.checklist.find((x) => x.id === 'queries').evidence, '1 candidate(s)');
  assert.equal(r.checklist.find((x) => x.id === 'pooling').evidence, '1 route(s) checked');
  assert.equal(r.candidates.length, 1);
});

test('requiring the module directly emits no circular-dependency warning', () => {
  const { spawnSync } = require('node:child_process');
  const modPath = path.resolve(__dirname, '../../../plugin/bin/lib/code-health/candidates-scale-readiness.js');
  const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modPath)})`], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.doesNotMatch(res.stderr, /inside circular dependency/);
});

// ---- Task 2: query checks ------------------------------------------------

const { QUERY_CALL_RE, findClose, MAX_SCAN_CHARS } = require('../../../plugin/bin/lib/code-health/candidates-scale-readiness');

const PRISMA_PKG = JSON.stringify({ name: 'app', dependencies: { '@prisma/client': '^5' } });
const EXPRESS_PKG = JSON.stringify({ name: 'api', dependencies: { express: '^4', mongoose: '^8' } });

function ofKind(root, kind) {
  return scanScaleReadiness(root).candidates.filter((x) => x.kind === kind);
}

function prismaRoute(body, rel = 'app/api/users/route.ts') {
  const root = tmpGitRepo();
  write(root, 'package.json', PRISMA_PKG);
  write(root, rel, body);
  return root;
}

test('AC2.1 AC2.2 query-in-loop: flags a Prisma call inside a for loop in an App Router route', () => {
  const root = prismaRoute('export async function GET() {\n  for (const id of ids) {\n    await prisma.user.findUnique({ where: { id } });\n  }\n}\n');
  const c = ofKind(root, 'query-in-loop');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'app/api/users/route.ts');
  assert.match(c[0].evidence, /app\/api\/users\/route\.ts:3 query call inside a loop \(for\)/);
  assert.match(c[0].evidence, /N\+1/);
  assert.equal(scanScaleReadiness(root).checklist.find((x) => x.id === 'queries').status, 'fail');
});

test('AC2.1 AC2.2 query-in-loop: flags a Mongoose call inside .map(async in an Express route', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', EXPRESS_PKG);
  write(root, 'routes/orders.js', 'router.get("/", async (req, res) => {\n  const all = await Promise.all(ids.map(async (id) => Order.findOne({ _id: id })));\n  res.json(all);\n});\n');
  const c = ofKind(root, 'query-in-loop');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'routes/orders.js');
  assert.match(c[0].evidence, /routes\/orders\.js:2 query call inside a loop \(\.map\(async\)/);
});

test('query-in-loop: flags a driver call in a braceless while and a forEach(async', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', EXPRESS_PKG);
  write(root, 'routes/a.js', 'while (more()) await pool.query("select 1");\nitems.forEach(async (i) => {\n  await supabase.from("t").select();\n});\n');
  const lines = ofKind(root, 'query-in-loop').map((c) => Number(c.evidence.match(/:(\d+) /)[1])).sort();
  assert.deepEqual(lines, [1, 3]);
});

test('query-in-loop: one candidate per line even when loops nest', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', EXPRESS_PKG);
  write(root, 'routes/a.js', 'for (const a of as) {\n  for (const b of bs) {\n    await User.findById(b);\n  }\n}\n');
  assert.equal(ofKind(root, 'query-in-loop').length, 1);
});

test('AC2.2 query-in-loop negative: a batched query outside the loop is not flagged', () => {
  const root = prismaRoute('export async function GET() {\n  const users = await prisma.user.findMany({ where: { id: { in: ids } }, take: 50 });\n  for (const u of users) { log(u); }\n}\n');
  assert.equal(ofKind(root, 'query-in-loop').length, 0);
});

test('query-in-loop negative: a query in a for-loop header is not inside the body', () => {
  const root = prismaRoute('export async function GET() {\n  for (const u of await prisma.user.findMany({ take: 5 })) { log(u); }\n}\n');
  assert.equal(ofKind(root, 'query-in-loop').length, 0);
});

test('does not flag array .find inside a loop', () => {
  const root = prismaRoute('export async function GET() {\n  for (const x of xs) { items.find((i) => i.id === x); }\n}\n');
  assert.equal(ofKind(root, 'query-in-loop').length, 0);
});

test('AC2.1 AC2.2 unbounded-list-query: flags findMany with no take in an Express route', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'api', dependencies: { express: '^4', '@prisma/client': '^5' } }));
  write(root, 'routes/users.js', "router.get('/', async (req, res) => res.json(await prisma.user.findMany({ where: { active: true } })));\n");
  const c = ofKind(root, 'unbounded-list-query');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'routes/users.js');
  assert.match(c[0].evidence, /routes\/users\.js:1 prisma\.user\.findMany has no take\/limit/);
});

test('unbounded-list-query: flags Sequelize findAll and Mongoose find without a limit', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', EXPRESS_PKG);
  write(root, 'routes/a.js', 'const a = await Post.findAll({ where: { live: true } });\nconst b = await User.find({ active: true });\n');
  const evidence = ofKind(root, 'unbounded-list-query').map((c) => c.evidence).sort();
  assert.equal(evidence.length, 2);
  assert.match(evidence[0], /routes\/a\.js:1 Post\.findAll has no take\/limit/);
  assert.match(evidence[1], /routes\/a\.js:2 User\.find has no take\/limit/);
});

test('AC2.2 unbounded-list-query negative: findMany with take is not flagged', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'api', dependencies: { express: '^4', '@prisma/client': '^5', mongoose: '^8' } }));
  write(root, 'routes/a.js', [
    'const a = await prisma.user.findMany({ take: 20 });',
    'const b = await User.findAll({ limit: 20 });',
    'const c = await User.find({}).limit(20);',
    'const d = await User.findAll({ where: {}, limit, offset });',
    'const e = await User.find({ a: 1 })\n  .sort({ at: -1 })\n  .limit(10);',
    '',
  ].join('\n'));
  assert.equal(ofKind(root, 'unbounded-list-query').length, 0);
});

const POST_SCHEMA = 'model Post {\n  id Int @id\n  authorId Int\n  title String\n}\n';

function postRepo(schema, route) {
  const root = tmpGitRepo();
  write(root, 'package.json', PRISMA_PKG);
  write(root, 'prisma/schema.prisma', schema);
  write(root, 'app/api/posts/route.ts', route);
  return root;
}

const POST_ROUTE = 'export async function GET() {\n  return prisma.post.findMany({ where: { authorId: userId }, take: 10 });\n}\n';

test('AC2.1 AC2.2 unindexed-where-field: flags a where on an unindexed Prisma field', () => {
  const root = postRepo(POST_SCHEMA, POST_ROUTE);
  const c = ofKind(root, 'unindexed-where-field');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'app/api/posts/route.ts');
  assert.match(c[0].evidence, /Post\.authorId/);
  assert.match(c[0].evidence, /prisma\/schema\.prisma/);
  assert.match(c[0].evidence, /app\/api\/posts\/route\.ts:2 prisma\.post\.findMany filters on Post\.authorId, which has no @id\/@unique\/@@index in prisma\/schema\.prisma/);
});

test('AC2.2 unindexed-where-field negative: @@index, @unique and @id fields are not flagged', () => {
  const schema = 'model Post {\n  id Int @id\n  authorId Int\n  slug String @unique\n  title String\n  @@index([authorId])\n}\n';
  const route = 'export async function GET() {\n  await prisma.post.findMany({ where: { authorId }, take: 1 });\n  await prisma.post.findFirst({ where: { slug } });\n  await prisma.post.findUnique({ where: { id } });\n}\n';
  assert.equal(ofKind(postRepo(schema, route), 'unindexed-where-field').length, 0);
});

test('a composite @@index covers only its leading column', () => {
  const schema = 'model Post {\n  id Int @id\n  authorId Int\n  createdAt DateTime\n  @@index([authorId, createdAt])\n}\n';
  const route = 'export async function GET() {\n  await prisma.post.findMany({ where: { createdAt: since }, take: 1 });\n  await prisma.post.findMany({ where: { authorId }, take: 1 });\n}\n';
  const c = ofKind(postRepo(schema, route), 'unindexed-where-field');
  assert.equal(c.length, 1);
  assert.match(c[0].evidence, /Post\.createdAt/);
});

test('parses a CRLF prisma schema', () => {
  const root = postRepo(POST_SCHEMA.replace(/\n/g, '\r\n'), POST_ROUTE);
  const c = ofKind(root, 'unindexed-where-field');
  assert.equal(c.length, 1);
  assert.match(c[0].evidence, /Post\.authorId/);
});

test('unindexed-where-field: ignores relation fields, AND/OR/NOT, spreads and non-model fields; dedupes per field', () => {
  const schema = 'model User {\n  id Int @id\n  posts Post[]\n}\nmodel Post {\n  id Int @id\n  authorId Int // the author\n  author User @relation(fields: [authorId], references: [id])\n  title String\n}\n';
  const route = [
    'export async function GET() {',
    '  await prisma.post.findMany({ where: { author: { id: 1 }, OR: [{ title }], ...extra, bogus: 1 }, take: 1 });',
    '  await prisma.post.findMany({ where: { authorId }, take: 1 });',
    '  await prisma.post.count({ where: { authorId } });',
    '  await prisma.unknown.findMany({ where: { authorId }, take: 1 });',
    '}',
    '',
  ].join('\n');
  const c = ofKind(postRepo(schema, route), 'unindexed-where-field');
  assert.equal(c.length, 1);
  assert.match(c[0].evidence, /Post\.authorId/);
});

test('unindexed-where-field: no parseable schema means no candidate', () => {
  const root = prismaRoute(POST_ROUTE, 'app/api/posts/route.ts');
  assert.equal(ofKind(root, 'unindexed-where-field').length, 0);
});

test('the queries row reads pass with its source-file and schema counts when nothing is flagged', () => {
  const root = postRepo(POST_SCHEMA, 'export async function GET() {\n  return prisma.post.findMany({ where: { id }, take: 10 });\n}\n');
  const row = scanScaleReadiness(root).checklist.find((x) => x.id === 'queries');
  assert.equal(row.status, 'pass');
  assert.match(row.evidence, /^1 source file\(s\) checked, 1 Prisma schema\(s\) parsed$/);
});

test('unbalanced brackets do not throw', () => {
  const root = prismaRoute('for (const a of b) { await prisma.user.findMany(');
  assert.doesNotThrow(() => scanScaleReadiness(root));
  assert.doesNotThrow(() => scanScaleReadiness(prismaRoute('items.map(async (i) => { await User.find(')));
  assert.doesNotThrow(() => scanScaleReadiness(postRepo(POST_SCHEMA, 'prisma.post.findMany({ where: { authorId: ')));
});

test('exports QUERY_CALL_RE, findClose and MAX_SCAN_CHARS for the pooling checks', () => {
  assert.equal(MAX_SCAN_CHARS, 4000);
  assert.ok(QUERY_CALL_RE.global);
  const hit = (s) => new RegExp(QUERY_CALL_RE.source, 'g').test(s);
  assert.ok(hit('prisma.user.findMany('));
  assert.ok(hit('pool.query('));
  assert.ok(hit('User.findById('));
  assert.ok(hit('supabase.from('));
  assert.ok(!hit('items.find('));
  assert.equal(findClose('a(b(c)d)e', 1, '(', ')'), 7);
  assert.equal(findClose('a(b(c', 1, '(', ')'), -1);
  assert.equal(findClose(`(${'x'.repeat(MAX_SCAN_CHARS + 10)})`, 0, '(', ')'), -1);
});
