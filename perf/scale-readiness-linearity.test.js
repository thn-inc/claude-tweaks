// Scale-readiness regex linearity budget (#2622) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// scanScaleReadiness runs line- and chain-anchored regexes over every source file. Two inputs expose
// quadratic backtracking: a file opening with a long run of slashes (the "use server" directive
// check) and a long `a.a.a.` dotted run (the Prisma receiver-chain match). Each must scan under a
// generous 1 s bound. Lives outside tests/ because a wall-clock assertion flakes under sibling-suite
// load; the functional halves of both checks stay in tests/bin-lib/code-health/candidates-scale-readiness.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { scanScaleReadiness } = require('../plugin/bin/lib/code-health/candidates-scale-readiness');

function tmpGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-scale-readiness-perf-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  return root;
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function pkg(deps) {
  return JSON.stringify({ name: 'app', dependencies: deps });
}

function repoWith(deps, files) {
  const root = tmpGitRepo();
  write(root, 'package.json', pkg(deps));
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  return root;
}

test('the "use server" check is linear in leading slashes', () => {
  const slashes = tmpGitRepo();
  write(slashes, 'package.json', pkg({ next: '^15', react: '^19' }));
  write(slashes, 'lib/x.ts', `${'/'.repeat(200)}\nexport const x = 1;\n`);
  const start = Date.now();
  const r = scanScaleReadiness(slashes);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `scan took ${elapsed} ms`);
  assert.equal(r.notApplicable, true);
});

test('the Prisma receiver-chain match is linear in a long dotted run', () => {
  const dotted = repoWith({ express: '^4', '@prisma/client': '^5' }, { 'routes/data.js': `const x = ${'a.'.repeat(20000)}b;\n` });
  const start = Date.now();
  scanScaleReadiness(dotted);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `scan took ${elapsed} ms`);
});
