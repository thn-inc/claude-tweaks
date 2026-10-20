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

test('an applicable repo with no scanners reads pass on every automated row', () => {
  const r = scanScaleReadiness(expressRepo());
  assert.equal(r.notApplicable, false);
  assert.equal(SCANNERS.length, 0);
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
  assert.deepEqual(candidatesScaleReadiness(expressRepo()), []);
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
  SCANNERS.push(scanner);
  try {
    const r = scanScaleReadiness(root);
    assert.equal(r.checklist.find((x) => x.id === 'queries').status, 'fail');
    assert.equal(r.checklist.find((x) => x.id === 'queries').evidence, '1 candidate(s)');
    assert.equal(r.checklist.find((x) => x.id === 'pooling').evidence, '1 route(s) checked');
    assert.equal(r.candidates.length, 1);
  } finally {
    SCANNERS.pop();
  }
});

test('requiring the module directly emits no circular-dependency warning', () => {
  const { spawnSync } = require('node:child_process');
  const modPath = path.resolve(__dirname, '../../../plugin/bin/lib/code-health/candidates-scale-readiness.js');
  const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modPath)})`], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.doesNotMatch(res.stderr, /inside circular dependency/);
});
