// tests/verify-scope-declaration.test.js — pins this repo's own
// .claude-tweaks/verify-scope.json (#1924): it parses, no source path maps
// to [], and the engine classifies the two canonical deltas as the parent
// design intends (ledger rows → none, skill prose → impact-selected via the
// test-impact map, #4024). Reads the live file deliberately — the
// declaration IS the contract.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const DECL = path.join(REPO_ROOT, '.claude-tweaks', 'verify-scope.json');
const { readDeclaration } = require(path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'verify', 'declaration.js'));
const { selectScope } = require(path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'verify', 'scope.js'));
const { encodeImpactMap, parseImpactMap } = require(path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'verify', 'impact.js'));
const { BOOKKEEPING_RULES } = require(path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'init', 'verify-scope-starter.js'));
const { readText } = require('./helpers/read-skill');
const STAMP = { sha: 'a'.repeat(40), fullSha: 'a'.repeat(40), scope: 'full' };

test('this repo declares its own verify scope and it passes readDeclaration (#1924 AC5, #3337)', () => {
  assert.ok(fs.existsSync(DECL), 'missing .claude-tweaks/verify-scope.json');
  const r = readDeclaration(DECL);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.decl.suites, ['tests', 'journeys']);
  assert.strictEqual(r.decl.checks.tests.tests, 'npm test');
  for (const rule of r.decl.rules) {
    if (rule.match === 'docs/journeys/**') {
      assert.deepStrictEqual(rule.suites, ['journeys'], 'docs/journeys/** maps to the journeys suite only');
      continue;
    }
    if (rule.impact === true) continue;
    assert.ok(rule.suites === '*' || (Array.isArray(rule.suites) && rule.suites.length === 0), `rule ${rule.match} must be "*" or []`);
  }
  // #4024: the test runner and the map builder change how every test runs or
  // how the map is built, not what a test reads — every suite; the rest of
  // plugin/tests/tools goes through the test-impact map.
  const EVERY_SUITE = ['tools/run-tests.js', 'tools/test-impact/**'];
  for (const rule of r.decl.rules) {
    if (!/^(plugin|tests|tools)\//.test(rule.match)) continue;
    if (EVERY_SUITE.includes(rule.match)) assert.strictEqual(rule.suites, '*', `${rule.match} must map to every suite`);
    else assert.strictEqual(rule.impact, true, `${rule.match} must be an impact rule`);
  }
  const matches = r.decl.rules.map((rule) => rule.match);
  for (const m of [...EVERY_SUITE, 'plugin/**', 'tests/**', 'tools/**']) assert.ok(matches.includes(m), `missing rule ${m}`);
  for (const m of EVERY_SUITE) assert.ok(matches.indexOf(m) < matches.indexOf('tools/**'), `${m} must precede tools/** (first match wins)`);
  assert.ok(!matches.includes('plugin/skills/**'), 'plugin/skills/** is covered by plugin/**');
  // Root markdown and docs go through the map too; docs/** sits below every
  // specific docs rule so those keep winning, and nothing catches everything.
  for (const m of ['docs/**', '*.md']) {
    const rule = r.decl.rules[matches.indexOf(m)];
    assert.ok(rule && rule.impact === true, `${m} must be an impact rule`);
  }
  for (const m of matches.filter((x) => x.startsWith('docs/') && x !== 'docs/**')) {
    assert.ok(matches.indexOf(m) < matches.indexOf('docs/**'), `${m} must precede docs/** (first match wins)`);
  }
  assert.ok(!matches.includes('**'), 'no catch-all rule — an unknown path fails closed to full');
  assert.strictEqual(r.decl.impact.suite, 'tests');
  assert.ok(r.decl.impact.command.includes('--files-from {files}'), r.decl.impact.command);
  assert.ok(r.decl.impact.fetch.includes('tools/test-impact.js fetch'), r.decl.impact.fetch);
});

// #4024 expand-contract: the installed plugin build reads this committed file with code that predates
// `impact`, and that reader rejects any rule lacking `suites` (a usage error, not a full-run fallback).
// Every impact rule therefore also carries `"suites": "*"` — older readers run full, current ones ignore it.
// Removal condition: once no installed build older than the release shipping `impact` can read this file.
test('every impact rule also carries the "*" legacy fallback an older reader needs (#4024 expand-contract)', () => {
  const raw = JSON.parse(fs.readFileSync(DECL, 'utf8'));
  const impactRules = raw.rules.filter((rule) => rule.impact === true);
  assert.ok(impactRules.length > 0, 'no impact rules found');
  for (const rule of impactRules) assert.strictEqual(rule.suites, '*', `${rule.match} lacks the legacy suites fallback`);
});

test('a ledger-row delta resolves to none; a skill-prose delta is impact-selected, else its suite runs full (#1924 AC5, #4024)', () => {
  const { decl } = readDeclaration(DECL);
  const sel = (files, impact = null) => selectScope({ decl, files, stamp: STAMP, impact });
  assert.strictEqual(sel(['docs/plans/2026-09-05-spec-1921-ledger.md']).mode, 'none');
  assert.strictEqual(sel(['.claude-tweaks/pipelines/2026-09-05T193518-x/spec-1/work/1-spec.md']).mode, 'none');
  // No catch-all: a path no rule names (a workflow, package.json) fails closed to full.
  for (const p of ['.github/workflows/x.yml', 'package.json', '.claude-tweaks/verify-scope.json']) {
    assert.strictEqual(sel([p]).mode, 'full', p);
    assert.deepStrictEqual(sel([p]).unmatched, [p]);
  }

  // A fixture map: one test reads the skill file, one reads verify.js.
  const parsed = parseImpactMap(JSON.stringify(encodeImpactMap({
    commit: 'b'.repeat(40), tracedAt: '2026-10-24T00:00:00Z', exitCode: 0, node: 'v20.0.0',
    tests: { 'tests/a.test.js': { f: ['plugin/skills/test/SKILL.md'] }, 'tests/b.test.js': { f: ['plugin/bin/verify.js'] } },
  })));
  assert.strictEqual(parsed.ok, true);
  const ctx = { map: parsed.map, problem: null, headTests: ['tests/a.test.js', 'tests/b.test.js'] };
  const prose = sel(['plugin/skills/test/SKILL.md'], ctx);
  assert.strictEqual(prose.mode, 'scoped');
  assert.deepStrictEqual(prose.suites, ['tests']);
  assert.deepStrictEqual(prose.impact.files, ['tests/a.test.js']);
  assert.strictEqual(prose.impact.fallback, null);
  assert.deepStrictEqual(sel(['plugin/bin/verify.js', 'docs/plans/x-ledger.md'], ctx).impact.files, ['tests/b.test.js']);

  // No map context: the impact suite runs its full command and names why.
  const noMap = sel(['plugin/skills/test/SKILL.md']);
  assert.strictEqual(noMap.impact.fallback, 'map-missing');
  assert.strictEqual(noMap.impact.files, null);
  assert.deepStrictEqual(noMap.suites, ['tests']);
  // A changed test runner is never impact-selected: every suite runs.
  assert.strictEqual(sel(['tools/run-tests.js'], ctx).mode, 'full');
  assert.strictEqual(sel(['tools/test-impact/tracer.js'], ctx).mode, 'full');
});

test('the spec AC1 pair — a skill template plus root CLAUDE.md — is impact-selected, not forced full (#4024)', () => {
  const { decl } = readDeclaration(DECL);
  const parsed = parseImpactMap(JSON.stringify(encodeImpactMap({
    commit: 'b'.repeat(40), tracedAt: '2026-10-24T00:00:00Z', exitCode: 0, node: 'v20.0.0',
    tests: {
      'tests/c.test.js': { f: ['plugin/skills/init/claude-md-template.md', 'CLAUDE.md'] },
      'tests/d.test.js': { f: ['plugin/bin/verify.js'] },
    },
  })));
  assert.strictEqual(parsed.ok, true);
  const ctx = { map: parsed.map, problem: null, headTests: ['tests/c.test.js', 'tests/d.test.js'] };
  const files = ['plugin/skills/init/claude-md-template.md', 'CLAUDE.md'];
  const statuses = { [files[0]]: 'M', [files[1]]: 'M' };
  const sel = selectScope({ decl, files, stamp: STAMP, statuses, impact: ctx });
  assert.strictEqual(sel.mode, 'scoped');
  assert.deepStrictEqual(sel.unmatched, []);
  assert.deepStrictEqual(sel.suites, ['tests']);
  assert.deepStrictEqual(sel.impact.files, ['tests/c.test.js']);
  // A docs file that is not a journey also goes through the map.
  const docs = selectScope({ decl, files: ['docs/skill-graph.md'], stamp: STAMP, impact: ctx });
  assert.deepStrictEqual(docs.unmatched, []);
  assert.strictEqual(docs.impact.fallback, 'untraced-path: docs/skill-graph.md');
});

test('a journey-only delta runs only the journeys suite; a mixed delta stays full (#3337)', () => {
  const { decl } = readDeclaration(DECL);
  const sel = (files) => selectScope({ decl, files, stamp: STAMP });
  const journeyOnly = sel(['docs/journeys/recover-from-a-dispatch-config-deny-3225.md']);
  assert.strictEqual(journeyOnly.mode, 'scoped');
  assert.deepStrictEqual(journeyOnly.suites, ['journeys']);
  assert.deepStrictEqual(journeyOnly.unmatched, []);
  assert.strictEqual(journeyOnly.static, false);
  assert.strictEqual(sel(['docs/journeys/a.md', 'docs/plans/x-ledger.md']).mode, 'scoped');
  assert.strictEqual(sel(['docs/journeys/a.md', 'plugin/bin/verify.js']).mode, 'full');
  const files = decl.checks.tests.journeys.split(/\s+/).filter((t) => t.startsWith('tests/'));
  assert.ok(files.length > 0, 'journeys suite names no test files');
  for (const f of files) assert.ok(fs.existsSync(path.join(REPO_ROOT, f)), `journeys suite names a missing file: ${f}`);
  assert.ok(decl.retry.journeys && decl.retry.journeys.includes('{file}'), 'journeys suite needs a retry template for baseline adjudication');
});

test('every rule with suites:[] is one of the bookkeeping-only globs — no source tree can ever be mapped to nothing (#1924 A8)', () => {
  const { decl } = readDeclaration(DECL);
  for (const rule of decl.rules) {
    if (Array.isArray(rule.suites) && rule.suites.length === 0) {
      assert.ok(BOOKKEEPING_RULES.includes(rule.match), `${rule.match} maps to no suite but is not a bookkeeping rule`);
    }
  }
});

// #4024: impact.tests names the test files an impact run may select, and tools/run-tests.js's default
// roots name the files the full suite runs (and so the files a trace records). A root added to one and
// not the other makes a traced test unselectable, or a selectable test one the full suite never ran.
test('impact.tests globs and tools/run-tests.js default roots name the same test files (#4024)', () => {
  const { execFileSync } = require('node:child_process');
  const { globToRegExp } = require(path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'issues', 'blast-radius.js'));
  const { listTestFiles } = require(path.join(REPO_ROOT, 'tools', 'run-tests.js'));
  const { decl } = readDeclaration(DECL);
  const patterns = decl.impact.tests.map((g) => globToRegExp(g));
  const ran = listTestFiles().map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'));
  assert.ok(ran.length > 0, 'the default roots list no test files');
  for (const f of ran) assert.ok(patterns.some((re) => re.test(f)), `${f} runs in the full suite but no impact.tests glob names it`);
  const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.test.js'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    .split('\0').filter(Boolean);
  const ranSet = new Set(ran);
  for (const f of tracked) {
    if (patterns.some((re) => re.test(f))) assert.ok(ranSet.has(f), `${f} matches impact.tests but the full suite's default roots never run it`);
  }
});

test('init/SKILL.md lists Step 6.6 and its sub-file exists (#1924)', () => {
  const skill = readText(path.join(REPO_ROOT, 'plugin', 'skills', 'init', 'SKILL.md'));
  assert.ok(skill.includes('### Step 6.6: Verify-Scope Starter'));
  assert.ok(skill.includes('bootstrap/step-06-6-verify-scope.md'));
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'plugin', 'skills', 'init', 'bootstrap', 'step-06-6-verify-scope.md')));
});
