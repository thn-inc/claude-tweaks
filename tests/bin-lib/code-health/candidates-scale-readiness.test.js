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

test('unbounded-list-query: only a top-level take/limit key bounds the call', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'api', dependencies: { express: '^4', '@prisma/client': '^5' } }));
  write(root, 'routes/a.js', [
    'const a = await prisma.user.findMany({ where: { price: { lte: limit } } });',
    'const b = await prisma.user.findMany({ include: { posts: { take: 3 } } });',
    'const c = await prisma.user.findMany({ limit, offset });',
    'const d = await prisma.user.findMany({ where: { a: 1 }, take: 5 });',
    'const e = await prisma.user.findMany();',
    '',
  ].join('\n'));
  const lines = ofKind(root, 'unbounded-list-query').map((c) => Number(c.evidence.match(/:(\d+) /)[1])).sort();
  assert.deepEqual(lines, [1, 2, 5]);
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
  // Unbalanced input is skipped, not guessed at: each fixture yields zero
  // candidates of the kinds that need the unmatched bracket.
  const cases = [
    [prismaRoute('for (const a of b) { await prisma.user.findMany('), ['query-in-loop', 'unbounded-list-query', 'unindexed-where-field']],
    // A complete query after an unclosed loop brace / paren: only the missing
    // close keeps it out of the loop body.
    [prismaRoute('for (const a of b) { await prisma.user.findUnique({ where: { id: a } });\n'), ['query-in-loop']],
    [prismaRoute('items.map(async (i) => { await User.findOne({ _id: i });\n'), ['query-in-loop']],
    [prismaRoute('const x = await prisma.user.findMany({ where: { a: 1 }\n'), ['unbounded-list-query']],
    [postRepo(POST_SCHEMA, 'prisma.post.findMany({ where: { authorId: '), ['query-in-loop', 'unbounded-list-query', 'unindexed-where-field']],
  ];
  for (const [root, kinds] of cases) {
    let r;
    assert.doesNotThrow(() => { r = scanScaleReadiness(root); });
    for (const kind of kinds) assert.equal(r.candidates.filter((c) => c.kind === kind).length, 0, kind);
  }
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

// ---- Task 3: slow work, pooling, caching, monitoring ----------------------

function pkg(deps) {
  return JSON.stringify({ name: 'app', dependencies: deps });
}

function repoWith(deps, files) {
  const root = tmpGitRepo();
  write(root, 'package.json', pkg(deps));
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  return root;
}

test('AC2.1 AC2.2 inline-slow-work: flags an OpenAI call in an App Router route with no queue signal', () => {
  const root = repoWith({ next: '^14', openai: '^4', '@prisma/client': '^5' }, {
    'app/api/summarize/route.ts': 'export async function POST(req) {\n  const out = await openai.chat.completions.create({ model: "gpt-4o", messages });\n  return Response.json(out);\n}\n',
  });
  const c = ofKind(root, 'inline-slow-work');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'app/api/summarize/route.ts');
  assert.match(c[0].evidence, /app\/api\/summarize\/route\.ts:2 AI call on the request path with no queue\/background-job signal in the file/);
  assert.equal(scanScaleReadiness(root).checklist.find((x) => x.id === 'background-jobs').status, 'fail');
});

test('AC2.1 AC2.2 inline-slow-work: flags an email send and a third-party fetch in an Express route', () => {
  const root = repoWith({ express: '^4' }, {
    'routes/signup.js': "router.post('/', async (req, res) => {\n  await resend.emails.send({ to: req.body.email });\n  await fetch('https://api.example.com/x');\n  res.sendStatus(201);\n});\n",
  });
  const c = ofKind(root, 'inline-slow-work');
  assert.equal(c.length, 2);
  assert.ok(c.every((x) => x.file === 'routes/signup.js'));
  assert.ok(c.some((x) => /:2 email send on the request path/.test(x.evidence)));
  assert.ok(c.some((x) => /:3 third-party fetch on the request path/.test(x.evidence)));
});

test('inline-slow-work: recognizes sendMail, axios verbs, got and the other AI call shapes; one candidate per category per file', () => {
  const root = repoWith({ express: '^4' }, {
    'routes/a.js': "await transporter.sendMail({});\nawait sgMail.send(msg);\nawait axios.post('https://x.test/a', body);\n",
    'routes/b.js': "await got('https://x.test/b');\nawait generateObject({ model });\n",
    'routes/c.js': "await anthropic.messages.create({});\nawait openai.embeddings.create({});\n",
  });
  const byFile = {};
  for (const x of ofKind(root, 'inline-slow-work')) (byFile[x.file] ||= []).push(x.evidence.match(/ (AI call|email send|third-party fetch) /)[1]);
  assert.deepEqual(byFile['routes/a.js'].sort(), ['email send', 'third-party fetch']);
  assert.deepEqual(byFile['routes/b.js'].sort(), ['AI call', 'third-party fetch']);
  assert.deepEqual(byFile['routes/c.js'], ['AI call']);
});

test('inline-slow-work: a relative or variable fetch URL and a prisma model named messages are not slow work', () => {
  const root = repoWith({ express: '^4', '@prisma/client': '^5' }, {
    'routes/a.js': "await fetch('/api/internal');\nawait fetch(url);\nawait api.fetch('https://x.test');\nawait prisma.messages.create({ data });\n",
  });
  assert.equal(ofKind(root, 'inline-slow-work').length, 0);
});

test('AC2.2 inline-slow-work negative: a queue signal in the route suppresses it', () => {
  const root = repoWith({ express: '^4' }, {
    'routes/signup.js': "router.post('/', async (req, res) => {\n  await emailQueue.add('welcome', { to: req.body.email });\n  await resend.emails.send({ to: 'ops@example.com' });\n  res.sendStatus(202);\n});\n",
  });
  assert.equal(ofKind(root, 'inline-slow-work').length, 0);
  assert.equal(scanScaleReadiness(root).checklist.find((x) => x.id === 'background-jobs').status, 'pass');
});

test('AC2.2 inline-slow-work negative: streamText is request-bound by design', () => {
  const root = repoWith({ next: '^14', ai: '^3' }, {
    'app/api/chat/route.ts': "import { streamText } from 'ai';\nexport async function POST(req) {\n  const result = await streamText({ model, messages });\n  return result.toDataStreamResponse();\n}\n",
  });
  assert.equal(ofKind(root, 'inline-slow-work').length, 0);
});

test('inline-slow-work: each queue-signal shape suppresses, including a scoped @trigger.dev import', () => {
  const signals = [
    "import { tasks } from '@trigger.dev/sdk';",
    "import { Queue } from 'bullmq'; const q = new Queue('mail');",
    'after(async () => { await sendEmail(x); });',
    'waitUntil(sendEmail(x));',
    'await enqueueWelcomeEmail(user);',
    "await inngest.send({ name: 'x' });",
  ];
  for (const signal of signals) {
    const root = repoWith({ express: '^4' }, { 'routes/a.js': `${signal}\nawait resend.emails.send({});\n` });
    assert.equal(ofKind(root, 'inline-slow-work').length, 0, signal);
  }
});

test('inline-slow-work ignores slow calls outside route/handler files', () => {
  const root = repoWith({ express: '^4' }, {
    'routes/health.js': "module.exports = (req, res) => res.send('ok');\n",
    'lib/mailer.js': 'await resend.emails.send({});\n',
  });
  assert.equal(ofKind(root, 'inline-slow-work').length, 0);
});

test('AC2.1 AC2.2 per-request-db-client: flags new PrismaClient inside a handler', () => {
  const root = repoWith({ '@prisma/client': '^5' }, {
    'app/api/users/route.ts': 'export async function GET() {\n  const prisma = new PrismaClient();\n  return Response.json(await prisma.user.findMany({ take: 5 }));\n}\n',
  });
  const c = ofKind(root, 'per-request-db-client');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'app/api/users/route.ts');
  assert.match(c[0].evidence, /app\/api\/users\/route\.ts:2 new PrismaClient created inside a handler/);
  assert.equal(scanScaleReadiness(root).checklist.find((x) => x.id === 'pooling').status, 'fail');
});

test('per-request-db-client: flags a pg Pool, a MongoClient and postgres() built inside an Express handler', () => {
  const root = repoWith({ express: '^4', pg: '^8' }, {
    'routes/a.js': "router.get('/', async (req, res) => {\n  const pool = new Pool({ max: 5 });\n  const m = new MongoClient(url);\n  const sql = postgres(url);\n  const c = mysql.createConnection(cfg);\n});\n",
  });
  const lines = ofKind(root, 'per-request-db-client').map((c) => Number(c.evidence.match(/:(\d+) /)[1])).sort();
  assert.deepEqual(lines, [2, 3, 4, 5]);
});

test('AC2.2 per-request-db-client negative: a module-scope client is not flagged', () => {
  const root = repoWith({ '@prisma/client': '^5' }, {
    'app/api/users/route.ts': "const prisma = new PrismaClient();\nexport async function GET() {\n  return Response.json(await prisma.user.findMany({ take: 5 }));\n}\n",
  });
  assert.equal(ofKind(root, 'per-request-db-client').length, 0);
});

test('per-request-db-client: a module-scope client after a long function is still module scope', () => {
  const filler = `export async function GET() {\n${'  // filler line that pads the handler body\n'.repeat(150)}  return Response.json([]);\n}\n`;
  assert.ok(filler.length > MAX_SCAN_CHARS);
  const root = repoWith({ '@prisma/client': '^5' }, { 'app/api/users/route.ts': `${filler}const prisma = new PrismaClient();\n` });
  assert.equal(ofKind(root, 'per-request-db-client').length, 0);
});

test('per-request-db-client: a client inside a handler past the scan window is still flagged', () => {
  const pad = '  // filler line that pads the handler body\n'.repeat(150);
  const root = repoWith({ '@prisma/client': '^5' }, { 'app/api/users/route.ts': `export async function GET() {\n${pad}  const prisma = new PrismaClient();\n}\n` });
  assert.equal(ofKind(root, 'per-request-db-client').length, 1);
});

test('per-request-db-client only looks in route files', () => {
  const root = repoWith({ express: '^4' }, {
    'routes/health.js': "module.exports = (req, res) => res.send('ok');\n",
    'lib/db.js': 'function make() {\n  return new PrismaClient();\n}\n',
  });
  assert.equal(ofKind(root, 'per-request-db-client').length, 0);
});

test('AC2.1 AC2.2 unbounded-pool: flags a pg Pool with no max', () => {
  const root = repoWith({ pg: '^8' }, {
    'lib/db.ts': 'export const pool = new Pool({ connectionString: process.env.DATABASE_URL });\n',
  });
  const c = ofKind(root, 'unbounded-pool');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'lib/db.ts');
  assert.match(c[0].evidence, /lib\/db\.ts:1 new Pool\(\) sets no explicit pool cap \(pg default max 10 per instance\)/);
});

test('unbounded-pool: flags createPool without connectionLimit and MongoClient without maxPoolSize', () => {
  const root = repoWith({ mysql2: '^3', mongodb: '^6' }, {
    'lib/a.js': "const a = mysql.createPool({ host });\nconst b = new MongoClient(url, { retryWrites: true });\nconst c = new Pool();\n",
  });
  const evidence = ofKind(root, 'unbounded-pool').map((x) => x.evidence).sort();
  assert.equal(evidence.length, 3);
  assert.match(evidence[0], /lib\/a\.js:1 createPool\(\) sets no explicit pool cap \(mysql default connectionLimit 10 per pool\)/);
  assert.match(evidence[1], /lib\/a\.js:2 new MongoClient\(\) sets no explicit pool cap \(mongodb default maxPoolSize 100 per client\)/);
  assert.match(evidence[2], /lib\/a\.js:3 new Pool\(\) /);
});

test('AC2.2 unbounded-pool negative: a capped pool is not flagged', () => {
  const root = repoWith({ pg: '^8', mysql2: '^3', mongodb: '^6' }, {
    'lib/a.js': [
      'const a = new Pool({ connectionString, max: 10 });',
      'const b = mysql.createPool({ host, connectionLimit: 5 });',
      'const c = new MongoClient(url, { maxPoolSize: 20 });',
      'const d = new Pool({ connectionString, max });',
      'const e = new Pool({ max: Math.min(cores, 10), idleTimeoutMillis: 1 });',
      '',
    ].join('\n'),
  });
  assert.equal(ofKind(root, 'unbounded-pool').length, 0);
});

test('unbounded-pool: an unbalanced call is skipped, not guessed at', () => {
  const root = repoWith({ pg: '^8' }, { 'lib/a.js': 'const a = new Pool({ connectionString: x' });
  assert.doesNotThrow(() => scanScaleReadiness(root));
  assert.equal(ofKind(root, 'unbounded-pool').length, 0);
});

test('AC2.1 AC2.2 no-cache-layer: DB-backed routes with no cache signal anchor to package.json', () => {
  const root = repoWith({ '@prisma/client': '^5' }, {
    'routes/users.js': "router.get('/', async (req, res) => res.json(await prisma.user.findMany({ take: 10 })));\n",
  });
  const c = ofKind(root, 'no-cache-layer');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'package.json');
  assert.match(c[0].evidence, /^1 DB-backed route file\(s\) \(e\.g\. routes\/users\.js\) and no cache-layer signal \(looked for: redis, ioredis/);
  assert.equal(scanScaleReadiness(root).checklist.find((x) => x.id === 'caching').status, 'fail');
});

test('AC2.2 no-cache-layer negative: a redis dependency or unstable_cache counts as a cache layer', () => {
  const route = "router.get('/', async (req, res) => res.json(await prisma.user.findMany({ take: 10 })));\n";
  const withDep = repoWith({ '@prisma/client': '^5', ioredis: '^5' }, { 'routes/users.js': route });
  assert.equal(ofKind(withDep, 'no-cache-layer').length, 0);
  assert.match(scanScaleReadiness(withDep).checklist.find((x) => x.id === 'caching').evidence, /ioredis/);

  const withCall = repoWith({ '@prisma/client': '^5' }, {
    'app/api/users/route.ts': "const list = unstable_cache(() => prisma.user.findMany({ take: 10 }), ['users']);\nexport async function GET() { return Response.json(await list()); }\n",
  });
  assert.equal(ofKind(withCall, 'no-cache-layer').length, 0);

  const withHeader = repoWith({ '@prisma/client': '^5' }, {
    'routes/users.js': `${route}res.set('Cache-Control', 'public, s-maxage=60');\n`,
  });
  assert.equal(ofKind(withHeader, 'no-cache-layer').length, 0);
});

test('no-cache-layer: no DB-backed route means pass with its own evidence, not a candidate', () => {
  const root = repoWith({ express: '^4' }, { 'routes/health.js': "module.exports = (req, res) => res.send('ok');\n" });
  assert.equal(ofKind(root, 'no-cache-layer').length, 0);
  const row = scanScaleReadiness(root).checklist.find((x) => x.id === 'caching');
  assert.equal(row.status, 'pass');
  assert.equal(row.evidence, 'no DB-backed routes detected');
});

test('no-cache-layer: a query outside route files does not make a route DB-backed', () => {
  const root = repoWith({ express: '^4', '@prisma/client': '^5' }, {
    'routes/health.js': "module.exports = (req, res) => res.send('ok');\n",
    'lib/repo.js': 'module.exports = () => prisma.user.findMany({ take: 1 });\n',
  });
  assert.equal(ofKind(root, 'no-cache-layer').length, 0);
});

test('no-cache-layer: with no package.json the candidate anchors to the first route file', () => {
  // A framework-explicit route: a ROUTE_DIR_RE-only file with no package.json
  // is not a route at all.
  const root = tmpGitRepo();
  write(root, 'app/api/users/route.ts', 'export async function GET() { return Response.json(await prisma.user.findMany({ take: 1 })); }\n');
  const c = ofKind(root, 'no-cache-layer');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'app/api/users/route.ts');
});

test('AC2.1 AC2.2 no-monitoring: a server repo with no error-tracking dependency anchors to package.json', () => {
  const root = repoWith({ express: '^4' }, { 'routes/health.js': "module.exports = (req, res) => res.send('ok');\n" });
  const c = ofKind(root, 'no-monitoring');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'package.json');
  assert.match(c[0].evidence, /no error-tracking or APM dependency among 1 declared \(looked for: @sentry\/\*/);
  assert.equal(scanScaleReadiness(root).checklist.find((x) => x.id === 'monitoring').status, 'fail');
});

test('AC2.2 no-monitoring negative: @sentry/node and other tracking dependencies count as monitoring', () => {
  for (const dep of ['@sentry/node', '@bugsnag/js', 'rollbar', 'dd-trace', '@opentelemetry/api', 'newrelic', '@sentry/nextjs']) {
    const root = repoWith({ express: '^4', [dep]: '^1' }, { 'routes/health.js': "module.exports = (req, res) => res.send('ok');\n" });
    assert.equal(ofKind(root, 'no-monitoring').length, 0, dep);
  }
  const root = repoWith({ express: '^4', '@sentry/node': '^8' }, { 'routes/health.js': 'module.exports = 1;\n' });
  assert.match(scanScaleReadiness(root).checklist.find((x) => x.id === 'monitoring').evidence, /@sentry\/node/);
});

test('a clean Express + Prisma repo passes every automated row', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', pkg({ express: '^4', '@prisma/client': '^5', ioredis: '^5', '@sentry/node': '^8' }));
  write(root, 'prisma/schema.prisma', 'model Post {\n  id Int @id\n  authorId Int\n  @@index([authorId])\n}\n');
  write(root, 'lib/db.js', 'const pool = new Pool({ connectionString, max: 10 });\nmodule.exports = { pool };\n');
  write(root, 'routes/posts.js', [
    'const prisma = new PrismaClient();',
    "router.post('/', async (req, res) => {",
    '  const posts = await prisma.post.findMany({ where: { authorId: req.user.id }, take: 20 });',
    "  await emailQueue.add('digest', { posts });",
    "  await resend.emails.send({ to: 'ops@example.com' });",
    '  res.json(posts);',
    '});',
    '',
  ].join('\n'));
  const r = scanScaleReadiness(root);
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.checklist.map((x) => x.status), ['pass', 'pass', 'manual', 'pass', 'pass', 'pass']);
});

// ---- Final-review fixes: real framework layouts --------------------------

function lineOfEvidence(c) {
  return Number(c.evidence.match(/:(\d+) /)[1]);
}

test('create-t3-app layout: ctx.db.<model> calls raise the N+1, unbounded and unindexed candidates', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', pkg({ next: '^15', '@prisma/client': '^6', '@trpc/server': '^11', '@tanstack/react-query': '^5', zod: '^3' }));
  write(root, 'prisma/schema.prisma', [
    'model Post {',
    '  id          Int      @id @default(autoincrement())',
    '  name        String',
    '  createdAt   DateTime @default(now())',
    '  createdBy   User     @relation(fields: [createdById], references: [id])',
    '  createdById String',
    '  @@index([name])',
    '}',
    'model User {',
    '  id    String @id @default(cuid())',
    '  posts Post[]',
    '}',
    '',
  ].join('\n'));
  write(root, 'src/server/api/routers/post.ts', [
    "import { createTRPCRouter, publicProcedure, protectedProcedure } from '~/server/api/trpc';",
    'export const postRouter = createTRPCRouter({',
    '  list: publicProcedure.query(async ({ ctx }) => {',
    "    return ctx.db.post.findMany({ orderBy: { createdAt: 'desc' } });",
    '  }),',
    '  mine: protectedProcedure.query(async ({ ctx }) => {',
    '    return ctx.db.post.findFirst({ where: { createdById: ctx.session.user.id } });',
    '  }),',
    '  authors: publicProcedure.query(async ({ ctx }) => {',
    '    const posts = await ctx.db.post.findMany({ take: 10 });',
    '    for (const p of posts) {',
    '      p.author = await ctx.db.user.findUnique({ where: { id: p.createdById } });',
    '    }',
    '    return posts;',
    '  }),',
    '});',
    '',
  ].join('\n'));
  write(root, 'src/app/api/trpc/[trpc]/route.ts', "import { fetchRequestHandler } from '@trpc/server/adapters/fetch';\nconst handler = (req) => fetchRequestHandler({ endpoint: '/api/trpc', req, router: appRouter });\nexport { handler as GET, handler as POST };\n");
  write(root, 'src/server/db.ts', "import { PrismaClient } from '@prisma/client';\nexport const db = globalForPrisma.prisma ?? new PrismaClient();\n");
  const r = scanScaleReadiness(root);
  const rel = 'src/server/api/routers/post.ts';
  const loop = r.candidates.filter((c) => c.kind === 'query-in-loop');
  assert.deepEqual(loop.map((c) => [c.file, lineOfEvidence(c)]), [[rel, 12]]);
  const unbounded = r.candidates.filter((c) => c.kind === 'unbounded-list-query');
  assert.equal(unbounded.length, 1);
  assert.match(unbounded[0].evidence, /post\.ts:4 ctx\.db\.post\.findMany has no take\/limit/);
  const unindexed = r.candidates.filter((c) => c.kind === 'unindexed-where-field');
  assert.equal(unindexed.length, 1);
  assert.match(unindexed[0].evidence, /post\.ts:7 ctx\.db\.post\.findFirst filters on Post\.createdById/);
  assert.equal(r.checklist.find((x) => x.id === 'queries').status, 'fail');
  assert.equal(r.checklist.find((x) => x.id === 'caching').status, 'fail');
});

test('with no Prisma schema, prisma and db receivers (ctx.db., this.prisma.) are recognized', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', pkg({ '@nestjs/core': '^10', '@prisma/client': '^5' }));
  write(root, 'src/users/users.service.ts', 'export class UsersService {\n  list() {\n    return this.prisma.user.findMany();\n  }\n}\n');
  write(root, 'src/server/api/routers/a.ts', 'for (const id of ids) {\n  await ctx.db.post.findUnique({ where: { id } });\n}\n');
  const r = scanScaleReadiness(root);
  const unbounded = r.candidates.filter((c) => c.kind === 'unbounded-list-query');
  assert.equal(unbounded.length, 1);
  assert.match(unbounded[0].evidence, /users\.service\.ts:3 this\.prisma\.user\.findMany has no take\/limit/);
  assert.deepEqual(r.candidates.filter((c) => c.kind === 'query-in-loop').map((c) => [c.file, lineOfEvidence(c)]), [['src/server/api/routers/a.ts', 2]]);
});

test('Prisma receivers reached through ?. / !. separators or a parenthesized expression are recognized', () => {
  const lines = [
    'export async function GET() {',
    '  await ctx!.db.post.findMany();',
    '  await ctx?.prisma.post.findMany();',
    '  await (await getCtx()).prisma.post.findMany();',
    '  await ctx?.db.post.findFirst({ where: { authorId } });',
    '}',
    '',
  ].join('\n');
  const noSchema = prismaRoute(lines, 'app/api/posts/route.ts');
  assert.deepEqual(ofKind(noSchema, 'unbounded-list-query').map(lineOfEvidence).sort(), [2, 3, 4]);
  const withSchema = postRepo(POST_SCHEMA, lines);
  assert.deepEqual(ofKind(withSchema, 'unbounded-list-query').map(lineOfEvidence).sort(), [2, 3, 4]);
  const unindexed = ofKind(withSchema, 'unindexed-where-field');
  assert.equal(unindexed.length, 1);
  assert.match(unindexed[0].evidence, /route\.ts:5 ctx\?\.db\.post\.findFirst filters on Post\.authorId/);
});

test('the db SQL-driver arm still matches alongside the db.<model> arm, once per line', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', pkg({ express: '^4', mysql2: '^3' }));
  write(root, 'routes/a.js', 'for (const id of ids) {\n  await db.query("select 1", [id]);\n  await db.execute("select 2");\n  db.query.users;\n}\n');
  assert.deepEqual(ofKind(root, 'query-in-loop').map(lineOfEvidence).sort(), [2, 3]);
});

test('with a parsed schema, a db.<name> call on a name that is not a model is not a query', () => {
  const root = postRepo(POST_SCHEMA, 'export async function GET() {\n  for (const f of friends) { await db.friends.update(f.id, f); }\n  for (const p of ps) { await db.post.update({ where: { id: p }, data: {} }); }\n}\n');
  assert.deepEqual(ofKind(root, 'query-in-loop').map(lineOfEvidence), [3]);
});

test('a Vite SPA with file routes and an API client is not applicable', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'spa', dependencies: { react: '^18', 'react-dom': '^18', '@tanstack/react-router': '^1' }, devDependencies: { vite: '^5' } }));
  write(root, 'src/routes/__root.tsx', "export const Route = createRootRoute({ component: Root });\n");
  write(root, 'src/routes/users.tsx', "export const Route = createFileRoute('/users')({ component: Users });\n");
  write(root, 'src/api/client.ts', "export const getUsers = () => fetch('https://api.example.com/users');\n");
  const r = scanScaleReadiness(root);
  assert.equal(r.notApplicable, true);
  assert.deepEqual(r.candidates, []);
});

test('monorepo: a ROUTE_DIR_RE file is a route only when its nearest package.json declares a server or data dependency', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', JSON.stringify({ name: 'mono', private: true, workspaces: ['apps/*'], devDependencies: { turbo: '^2' } }));
  write(root, 'apps/web/package.json', JSON.stringify({ name: 'web', dependencies: { react: '^18' }, devDependencies: { vite: '^5' } }));
  write(root, 'apps/web/src/api/users.ts', "export const getUsers = () => fetch('https://api.example.com/users');\n");
  write(root, 'apps/api/package.json', JSON.stringify({ name: 'api', dependencies: { express: '^4' } }));
  write(root, 'apps/api/routes/x.js', "router.get('/', async (req, res) => {\n  res.json(await fetch('https://api.example.com/x'));\n});\n");
  const r = scanScaleReadiness(root);
  assert.equal(r.notApplicable, false);
  assert.deepEqual(r.candidates.filter((c) => c.kind === 'inline-slow-work').map((c) => c.file), ['apps/api/routes/x.js']);
});

test('a ROUTE_DIR_RE file with no enclosing package.json is not a route', () => {
  const root = tmpGitRepo();
  write(root, 'api/x.js', "export default async () => fetch('https://api.example.com/x');\n");
  assert.equal(scanScaleReadiness(root).notApplicable, true);
});

test('Mongoose .find limit is read from the call chain only, not the next statement', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', EXPRESS_PKG);
  write(root, 'routes/posts.js', [
    "router.get('/all', async (req, res) => {",
    '  res.json(await Post.find({}))',
    '})',
    "router.get('/top', async (req, res) => {",
    '  res.json(await Post.find({}).sort({ score: -1 }).limit(5))',
    '})',
    '',
  ].join('\n'));
  assert.deepEqual(ofKind(root, 'unbounded-list-query').map(lineOfEvidence), [2]);
});

test('cache-disabling directives do not count as a cache layer', () => {
  const query = 'export async function GET() { return Response.json(await prisma.user.findMany({ take: 10 })); }\n';
  const disabled = [
    'export const revalidate = 0;\n',
    "const headers = { 'Cache-Control': 'no-store' };\n",
    "res.set('Cache-Control', 'no-cache');\n",
    "res.set('Cache-Control', 'public, max-age=0');\n",
  ];
  for (const extra of disabled) {
    const root = repoWith({ '@prisma/client': '^5' }, { 'app/api/users/route.ts': `${extra}${query}` });
    assert.equal(ofKind(root, 'no-cache-layer').length, 1, extra);
  }
  const enabled = [
    'export const revalidate = 60;\n',
    "res.set('Cache-Control', 'public, max-age=0, s-maxage=60');\n",
    "const headers = { 'Cache-Control': cacheValue };\n",
  ];
  for (const extra of enabled) {
    const root = repoWith({ '@prisma/client': '^5' }, { 'app/api/users/route.ts': `${extra}${query}` });
    assert.equal(ofKind(root, 'no-cache-layer').length, 0, extra);
  }
});

test('query-in-loop: a non-async .map callback that issues a query is an N+1', () => {
  const root = prismaRoute('export async function GET() {\n  const users = await Promise.all(ids.map((id) => prisma.user.findUnique({ where: { id } })));\n  return Response.json(users);\n}\n');
  const c = ofKind(root, 'query-in-loop');
  assert.equal(c.length, 1);
  assert.match(c[0].evidence, /route\.ts:2 query call inside a loop \(\.map\)/);
});

test('a capitalized constant array searched with a callback is not a query', () => {
  const root = tmpGitRepo();
  write(root, 'package.json', EXPRESS_PKG);
  write(root, 'routes/billing.js', [
    'const plan = PLANS.find((p) => p.id === req.body.plan);',
    'const tier = TIERS.find(function (t) { return t.min <= n; });',
    'for (const id of ids) { const c = COUNTRIES.find(async (x) => x.code === id); }',
    'const posts = await Post.find({ live: true });',
    '',
  ].join('\n'));
  const r = scanScaleReadiness(root);
  assert.deepEqual(r.candidates.filter((c) => c.kind === 'unbounded-list-query').map(lineOfEvidence), [4]);
  assert.equal(r.candidates.filter((c) => c.kind === 'query-in-loop').length, 0);
});

test('seed scripts are excluded from the per-file query scans', () => {
  const body = 'async function main() {\n  for (const u of users) {\n    await prisma.user.create({ data: u });\n  }\n  await prisma.user.findMany();\n}\n';
  const root = repoWith({ '@prisma/client': '^5' }, {
    'prisma/seed.ts': body,
    'seeds/users.js': body,
    'db/seeders/20240101-users.js': body,
    'lib/import.ts': body,
  });
  const r = scanScaleReadiness(root);
  const queryKinds = ['query-in-loop', 'unbounded-list-query', 'unindexed-where-field'];
  assert.deepEqual([...new Set(r.candidates.filter((c) => queryKinds.includes(c.kind)).map((c) => c.file))], ['lib/import.ts']);

  const seedsOnly = repoWith({ '@prisma/client': '^5' }, { 'prisma/seed.ts': body, 'seeds/users.js': body, 'db/seeders/20240101-users.js': body });
  const row = scanScaleReadiness(seedsOnly).checklist.find((x) => x.id === 'queries');
  assert.equal(row.status, 'pass');
  assert.match(row.evidence, /, 3 seed file\(s\) skipped$/);
});

test('a "use server" actions file is a handler: applicable and scanned for inline slow work', () => {
  const root = repoWith({ next: '^15', react: '^19', ai: '^4' }, {
    'app/actions.ts': "// server actions\n'use server';\n\nimport { generateText } from 'ai';\nexport async function summarize(text) {\n  const { text: out } = await generateText({ model, prompt: text });\n  return out;\n}\n",
  });
  const r = scanScaleReadiness(root);
  assert.equal(r.notApplicable, false);
  const c = r.candidates.filter((x) => x.kind === 'inline-slow-work');
  assert.equal(c.length, 1);
  assert.match(c[0].evidence, /app\/actions\.ts:6 AI call on the request path/);
});

test('the "use server" check is linear in leading slashes, and still sees a directive after comments', () => {
  const slashes = tmpGitRepo();
  write(slashes, 'package.json', pkg({ next: '^15', react: '^19' }));
  write(slashes, 'lib/x.ts', `${'/'.repeat(200)}\nexport const x = 1;\n`);
  const start = Date.now();
  const r = scanScaleReadiness(slashes);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `scan took ${elapsed} ms`);
  assert.equal(r.notApplicable, true);

  const directive = repoWith({ next: '^15', react: '^19' }, { 'app/actions.ts': '// comment\n/* block */\n"use server";\nexport async function act() {}\n' });
  assert.equal(scanScaleReadiness(directive).notApplicable, false);
});

test('the Prisma receiver-chain match is linear in a long dotted run, and still sees a call behind a long chain', () => {
  const dotted = repoWith({ express: '^4', '@prisma/client': '^5' }, { 'routes/data.js': `const x = ${'a.'.repeat(20000)}b;\n` });
  const start = Date.now();
  scanScaleReadiness(dotted);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `scan took ${elapsed} ms`);

  const deep = repoWith({ express: '^4', '@prisma/client': '^5' }, { 'routes/users.js': 'module.exports = async () => a.b.c.d.e.f.g.h.i.j.k.prisma.user.findMany();\n' });
  assert.equal(ofKind(deep, 'unbounded-list-query').length, 1);
});

test('a "use server" directive that is not the first statement does not make a file a handler', () => {
  const root = repoWith({ next: '^15', react: '^19', ai: '^4' }, {
    'app/page.tsx': "import { generateText } from 'ai';\nexport default function Page() {\n  async function act() {\n    'use server';\n    await generateText({ model });\n  }\n  return null;\n}\n",
  });
  assert.equal(scanScaleReadiness(root).notApplicable, true);
});

test('inline-slow-work: a Twilio messages.create is an SMS send, not an AI call', () => {
  const root = repoWith({ express: '^4', twilio: '^5' }, {
    'routes/sms.js': "const twilio = require('twilio')(sid, token);\nrouter.post('/', async (req, res) => {\n  await twilio.messages.create({ to, from, body });\n  res.sendStatus(201);\n});\n",
    'routes/notify.js': "import Twilio from 'twilio';\nconst client = new Twilio(sid, token);\nexport default async (req, res) => {\n  await client.messages.create({ to, from, body });\n};\n",
    'routes/chat.js': "import Anthropic from '@anthropic-ai/sdk';\nconst client = new Anthropic();\nexport default async (req, res) => {\n  await client.messages.create({ model, messages });\n};\n",
  });
  const byFile = {};
  for (const x of ofKind(root, 'inline-slow-work')) (byFile[x.file] ||= []).push(x.evidence.match(/:\d+ (.+?) on the request path/)[1]);
  assert.deepEqual(byFile, { 'routes/sms.js': ['SMS send'], 'routes/notify.js': ['SMS send'], 'routes/chat.js': ['AI call'] });
});
