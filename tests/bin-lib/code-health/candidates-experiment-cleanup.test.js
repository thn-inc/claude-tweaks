'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-expcleanup-'));
}

function tmpGitRepo() {
  const root = tmp();
  execFileSync('git', ['-C', root, 'init', '-q']);
  return root;
}

function writePolicy(root, lines) {
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), lines.join('\n') + '\n');
}

const CALL_SITE_PATTERN = "isEnabled\\(['\"]([\\w.-]+)['\"]";
const REGISTRY_PATTERN = "(\\w+):\\s*\\{\\s*status:";

const {
  compilePatterns,
  isExcluded,
  normalizeBranch,
  matchBrace,
  findGuardBlock,
  scanFileForSites,
  scanExperimentCleanup,
  candidatesExperimentCleanup,
  DEFAULT_EXCLUDES,
} = require('../../../plugin/bin/lib/code-health/candidates-experiment-cleanup');

// ── compilePatterns (AC3) ────────────────────────────────────────────────

test('compilePatterns: valid patterns compile to {source, re} pairs', () => {
  const compiled = compilePatterns([CALL_SITE_PATTERN]);
  assert.strictEqual(compiled.length, 1);
  assert.strictEqual(compiled[0].source, CALL_SITE_PATTERN);
  assert.ok(compiled[0].re instanceof RegExp);
});

test('AC3: an invalid regex pattern fails loud at compile time, naming the offending pattern', () => {
  assert.throws(
    () => compilePatterns(['isEnabled(unterminated[']),
    (err) => err instanceof Error && err.message.includes('isEnabled(unterminated['),
  );
});

test('AC3: candidatesExperimentCleanup itself propagates the compile-time throw (never silently skipped)', () => {
  const root = tmpGitRepo();
  assert.throws(() => candidatesExperimentCleanup(root, ['(unclosed'], []));
});

// ── isExcluded ───────────────────────────────────────────────────────────

test('isExcluded: matches a default exclude name case-insensitively', () => {
  assert.strictEqual(isExcluded('EmergencyOverride', DEFAULT_EXCLUDES), true);
  assert.strictEqual(isExcluded('circuitBreakerFlag', DEFAULT_EXCLUDES), true);
});

test('isExcluded: a flag matching none of the excludes is not excluded', () => {
  assert.strictEqual(isExcluded('betaSearch', DEFAULT_EXCLUDES), false);
});

test('isExcluded: user-provided excludes extend, not replace, the defaults', () => {
  const excludes = DEFAULT_EXCLUDES.concat(['rollback']);
  assert.strictEqual(isExcluded('rollbackSwitch', excludes), true);
  assert.strictEqual(isExcluded('emergencyStop', excludes), true, 'default excludes must still apply after extension');
});

// ── normalizeBranch ──────────────────────────────────────────────────────

test('normalizeBranch: strips line comments and collapses whitespace to empty', () => {
  assert.strictEqual(normalizeBranch('  // cleanup after 2026-01: legacy path\n  '), '');
});

test('normalizeBranch: strips block comments too', () => {
  assert.strictEqual(normalizeBranch('/* old code */'), '');
});

test('normalizeBranch: real code survives comment-stripping and whitespace-collapse', () => {
  assert.strictEqual(normalizeBranch('  doThing();  // note\n'), 'doThing();');
});

test('normalizeBranch: two branches with different whitespace/comments but the same code normalize identically', () => {
  const a = 'doThing();\n// note one\n';
  const b = '  doThing();   /* note two */\n';
  assert.strictEqual(normalizeBranch(a), normalizeBranch(b));
});

// ── matchBrace / findGuardBlock ──────────────────────────────────────────

test('matchBrace: finds the matching closing brace, respecting nesting', () => {
  const text = '{ a: { b: 1 } }';
  assert.strictEqual(matchBrace(text, 0), text.length - 1);
});

test('matchBrace: returns -1 for an unterminated block', () => {
  assert.strictEqual(matchBrace('{ a: 1', 0), -1);
});

test('findGuardBlock: extracts if-body and else-body from a simple guard', () => {
  const text = "if (isEnabled('x')) {\n  doA();\n} else {\n  doB();\n}\n";
  const idx = text.indexOf("isEnabled('x')");
  const block = findGuardBlock(text, idx);
  assert.ok(block);
  assert.strictEqual(normalizeBranch(block.ifBody), 'doA();');
  assert.strictEqual(normalizeBranch(block.elseBody), 'doB();');
});

test('findGuardBlock: no else clause yields elseBody: null', () => {
  const text = "if (isEnabled('x')) {\n  doA();\n}\n";
  const idx = text.indexOf("isEnabled('x')");
  const block = findGuardBlock(text, idx);
  assert.ok(block);
  assert.strictEqual(block.elseBody, null);
});

test('findGuardBlock: no brace within lookahead returns null (not an if-guard)', () => {
  const text = "const x = isEnabled('x');\n".padEnd(500, ' ') + '{ later block }';
  const idx = text.indexOf("isEnabled('x')");
  assert.strictEqual(findGuardBlock(text, idx, 50), null);
});

// ── scanFileForSites: line-length cap ───────────────────────────────────

test('scanFileForSites: an over-length line is skipped and counted, never matched', () => {
  const compiled = compilePatterns([CALL_SITE_PATTERN]);
  const longLine = ' '.repeat(50) + "isEnabled('longLineFlag')" + ' '.repeat(2000);
  const { sites, overLengthLines } = scanFileForSites(longLine, compiled, 100);
  assert.deepStrictEqual(sites, []);
  assert.strictEqual(overLengthLines, 1);
});

test('scanFileForSites: a normal-length line matches and reports the captured flag identifier', () => {
  const compiled = compilePatterns([CALL_SITE_PATTERN]);
  const { sites } = scanFileForSites("if (isEnabled('betaSearch')) {}", compiled, 1000);
  assert.strictEqual(sites.length, 1);
  assert.strictEqual(sites[0].flag, 'betaSearch');
  assert.strictEqual(sites[0].line, 1);
});

// ── AC2: key absent → generator returns [] with noIdiomConfigured, no scan ─

test('AC2: no policy.yml at all → candidates: [], noIdiomConfigured: true, no file discovery performed', () => {
  const root = tmpGitRepo();
  const result = scanExperimentCleanup(root);
  assert.deepStrictEqual(result.candidates, []);
  assert.strictEqual(result.noIdiomConfigured, true);
  assert.strictEqual(result.scannedFiles, 0);
  assert.strictEqual(result.sitesMatched, 0);
  assert.strictEqual(result.discoveryFailed, false);
});

test('AC2: policy.yml present but experiment-flag-patterns unset → same no-idiom result', () => {
  const root = tmpGitRepo();
  writePolicy(root, ['autonomy: supervised']);
  const result = scanExperimentCleanup(root);
  assert.strictEqual(result.noIdiomConfigured, true);
  assert.deepStrictEqual(result.candidates, []);
});

test('AC2: candidatesExperimentCleanup with an explicit empty patterns array also returns []', () => {
  const root = tmpGitRepo();
  assert.deepStrictEqual(candidatesExperimentCleanup(root, [], []), []);
});

// ── AC1: fixture with one decided flag (dead-branch + dated comment) and
// one live flag (both branches substantive) yields exactly the decided flag.

function buildAc1Fixture() {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'checkout.js'),
    [
      "function doNewCheckout() { return 1; }",
      "if (isEnabled('newCheckout')) {",
      "  doNewCheckout();",
      "} else {",
      "  // cleanup after 2026-01: legacy path, remove once newCheckout ships",
      "}",
      "",
      "function doNewSearch() { return 2; }",
      "function doOldSearch() { return 3; }",
      "if (isEnabled('betaSearch')) {",
      "  doNewSearch();",
      "} else {",
      "  doOldSearch();",
      "}",
      "",
    ].join('\n'),
  );
  return root;
}

test('AC1: exact-set — a decided flag (dead-branch + dated cleanup comment) yields exactly that flag as a candidate; a live flag with substantive branches does not', () => {
  const root = buildAc1Fixture();
  const candidates = candidatesExperimentCleanup(root, [CALL_SITE_PATTERN], []);
  assert.deepStrictEqual(candidates.map((c) => c.flag), ['newCheckout']);
  const decided = candidates[0];
  assert.deepStrictEqual([...decided.signals].sort(), ['dated-cleanup-comment', 'dead-branch']);
  assert.strictEqual(decided.sites.length, 1);
  assert.strictEqual(decided.sites[0].file, 'src/checkout.js');
  assert.ok(decided.evidence.length >= 2, 'evidence should name both firing signals');
});

test('AC1: sitesMatched/flagsMatched report both flags even though only one becomes a candidate', () => {
  const root = buildAc1Fixture();
  const result = scanExperimentCleanup(root, { patterns: [CALL_SITE_PATTERN], excludes: [] });
  assert.strictEqual(result.sitesMatched, 2);
  assert.strictEqual(result.flagsMatched, 2);
  assert.strictEqual(result.candidates.length, 1);
});

// ── AC5: kill-switch exclusion suppresses an otherwise-decided flag ────────

test('AC5: a flag matching a kill-switch exclude pattern is suppressed even though it carries a decision signal', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'safety.js'),
    [
      "function doNormalPath() { return 1; }",
      "if (isEnabled('emergencyKillSwitch')) {",
      "  doNormalPath();",
      "} else {",
      "  // cleanup after 2026-01: remove after incident review",
      "}",
      "",
    ].join('\n'),
  );
  // DEFAULT_EXCLUDES ("emergency"/"circuit"/"kill") is concatenated
  // unconditionally, so even an explicit empty excludes array leaves the
  // shipped defaults active — 'emergencyKillSwitch' matches both 'emergency'
  // and 'kill'.
  const viaWrapper = candidatesExperimentCleanup(root, [CALL_SITE_PATTERN], []);
  assert.deepStrictEqual(viaWrapper, []);

  const result = scanExperimentCleanup(root, { patterns: [CALL_SITE_PATTERN], excludes: [] });
  assert.strictEqual(result.sitesMatched, 1, 'the site is still matched — only candidate emission is suppressed');
  assert.strictEqual(result.flagsMatched, 1);
  assert.deepStrictEqual(result.candidates, [], 'the decision signal fired (dead-branch + dated comment) but the flag name matches a default exclude, so no candidate is emitted');
});

test('AC5: a user-configured exclude pattern (beyond the defaults) also suppresses an otherwise-decided flag', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'rollback.js'),
    [
      "function doNormalPath() { return 1; }",
      "if (isEnabled('rollbackSwitch')) {",
      "  doNormalPath();",
      "} else {",
      "  // cleanup after 2026-01: remove after incident review",
      "}",
      "",
    ].join('\n'),
  );
  const result = scanExperimentCleanup(root, { patterns: [CALL_SITE_PATTERN], excludes: ['rollback'] });
  assert.deepStrictEqual(result.candidates, []);
  assert.strictEqual(result.sitesMatched, 1);
});

// ── registry-terminal-state signal (second idiom style — Gotchas: must
// model at least two distinct idiom styles) ────────────────────────────────

test('registry-terminal-state: a registry entry declaring a terminal marker is a decided candidate under the registry pattern', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'flags.js'),
    "const FLAGS = {\n  legacyExport: { status: 'always-on' },\n  liveExperiment: { status: 'rolling-out' },\n};\nmodule.exports = { FLAGS };\n",
  );
  const result = scanExperimentCleanup(root, { patterns: [REGISTRY_PATTERN], excludes: [] });
  assert.deepStrictEqual(result.candidates.map((c) => c.flag), ['legacyExport']);
  assert.ok(result.candidates[0].signals.includes('registry-terminal-state'));
});

// ── identical-branches signal ───────────────────────────────────────────

test('identical-branches: a guard whose two branches are token-identical (whitespace/comment-normalized) fires the signal', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'converged.js'),
    [
      "if (isEnabled('convergedFlag')) {",
      "  doSameThing(); // path A",
      "} else {",
      "  doSameThing();   /* path B, different comment */",
      "}",
      "",
    ].join('\n'),
  );
  const result = scanExperimentCleanup(root, { patterns: [CALL_SITE_PATTERN], excludes: [] });
  assert.deepStrictEqual(result.candidates.map((c) => c.flag), ['convergedFlag']);
  assert.ok(result.candidates[0].signals.includes('identical-branches'));
});

test('zero-signal flag: substantive, distinct branches with no terminal/dated marker never becomes a candidate', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'live.js'),
    "if (isEnabled('liveFlag')) {\n  doPathA();\n} else {\n  doPathB();\n}\n",
  );
  const result = scanExperimentCleanup(root, { patterns: [CALL_SITE_PATTERN], excludes: [] });
  assert.deepStrictEqual(result.candidates, []);
  assert.strictEqual(result.sitesMatched, 1);
  assert.strictEqual(result.flagsMatched, 1);
});

// ── discoveryFailed passthrough (non-git root) ──────────────────────────

test('discoveryFailed: true propagates from listTrackedSourceFiles when patterns are configured against a non-git root', () => {
  const root = tmp(); // no git init
  const result = scanExperimentCleanup(root, { patterns: [CALL_SITE_PATTERN], excludes: [] });
  assert.strictEqual(result.discoveryFailed, true);
  assert.ok(typeof result.discoveryReason === 'string' && result.discoveryReason.length > 0);
  assert.deepStrictEqual(result.candidates, []);
});

// ── FOCUS_GENERATORS registration ───────────────────────────────────────

test('the experiment-cleanup vertical self-registers into FOCUS_GENERATORS', () => {
  const { FOCUS_GENERATORS } = require('../../../plugin/bin/lib/code-health/focus-generators');
  assert.ok(Object.keys(FOCUS_GENERATORS).includes('experiment-cleanup'));
  assert.strictEqual(FOCUS_GENERATORS['experiment-cleanup'], scanExperimentCleanup);
});

// ── binary/unreadable file handling (mirrors candidates-dead-code.js) ──────

test('a NUL-byte file is skipped, never scanned for matches, reported in skippedFiles', () => {
  const root = tmpGitRepo();
  fs.writeFileSync(path.join(root, 'blob.js'), Buffer.from([0x69, 0x00, 0x66]));
  const result = scanExperimentCleanup(root, { patterns: [CALL_SITE_PATTERN], excludes: [] });
  assert.deepStrictEqual(result.candidates, []);
  assert.deepStrictEqual(result.skippedFiles, [{ file: 'blob.js', reason: 'binary-or-nul' }]);
});

// ── policy.yml reading (readListKey integration, via scanExperimentCleanup
// with no explicit opts.patterns override) ─────────────────────────────────

test('policy.yml integration: experiment-flag-patterns and experiment-flag-exclude are read from .claude-tweaks/policy.yml when opts omit them', () => {
  const root = buildAc1Fixture();
  writePolicy(root, [`experiment-flag-patterns: ${CALL_SITE_PATTERN}`, 'experiment-flag-exclude: '].filter(Boolean));
  const result = scanExperimentCleanup(root);
  assert.strictEqual(result.noIdiomConfigured, false);
  assert.deepStrictEqual(result.candidates.map((c) => c.flag), ['newCheckout']);
});

// ── fresh-process load (refs #3330) ─────────────────────────────────────────
// An in-process require hits the module cache, so the check that this module
// loads without a circular-dependency warning runs in a child process.

const MODULE_PATH = path.join(__dirname, '../../../plugin/bin/lib/code-health/candidates-experiment-cleanup.js');

test('candidates-experiment-cleanup.js loads in a fresh process with no circular-dependency warning', () => {
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(MODULE_PATH)})`], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `load exited non-zero: ${result.stderr}`);
  assert.ok(
    !/inside circular dependency/i.test(result.stderr || ''),
    `candidates-experiment-cleanup.js emitted a circular-dependency warning on load:\n${result.stderr}`
  );
});
