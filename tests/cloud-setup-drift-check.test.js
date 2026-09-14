// Pins and executes the per-plugin drift-verdict node -e snippet embedded in the generated
// scripts/claude-cloud-setup.sh (itself rendered from plugin/skills/init/bootstrap/
// step-14-cloud-routine-parity.md's fenced template — the two are kept byte-identical by
// hand, see that doc's block for the source of truth this test also implicitly guards).
//
// claude-tweaks #860: after #418's mirror cutover, the claude-tweaks marketplace entry is a
// git-subdir source pinned by `sha` with NO entry-level `version` field — the payload's own
// plugin.json is the only version authority. The pre-#860 comparison degraded `expected` to
// "unversioned" whenever a catalog entry had no `version` key, which made claude-tweaks's own
// drift check permanently report "ok" regardless of how stale the installed build was. The
// fix resolves that sha to a manifest version (raw.githubusercontent.com fetch, stubbed here
// via a fake `curl` on PATH) before falling back to "unversioned".
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', 'claude-cloud-setup.sh');
const INSTALLED_JSON = '/tmp/cc-installed.json';
const MARKETPLACES_JSON = '/tmp/cc-marketplaces.json';

// Structurally anchored on the shell substitution markers around the VERDICT node -e block,
// not on any prose sentence inside it — a rewording of the comments cannot break extraction.
function extractVerdictSnippet(scriptSource) {
  const m = scriptSource.match(/VERDICT=\$\(node -e '\n([\s\S]*?)\n {2}' "\$spec" "\$CC_INSTALLED" "\$CC_MARKETPLACES" \|\| true\)/);
  assert.ok(
    m,
    'extraction pattern is out of sync with scripts/claude-cloud-setup.sh — the VERDICT node -e block moved or was reworded',
  );
  return m[1];
}

// The exact pre-#860 VERDICT body (git HEAD at the time #860 was picked up), frozen as a
// string literal so the go-red proof below survives any later edit to the live script
// [IL-105]. Copied verbatim from `git show HEAD:scripts/claude-cloud-setup.sh` before this
// change landed.
const PRE_CHANGE_VERDICT_BODY = `    const fs = require("fs");
    const spec = process.argv[1];
    const [pluginName, marketplaceName] = spec.split("@");
    const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

    // The installed directory decides what a session loads. \`claude plugin list\`s own
    // \`version\` is metadata recorded beside that directory rather than read out of it, and
    // \`installed_plugins.json\`s \`gitCommitSha\` is not refreshed by \`claude plugin update\`
    // at all — neither can be trusted to describe the files actually on disk.
    const entry = (read("/tmp/cc-installed.json") || []).find((p) => p.id === spec);
    const manifest = entry && read(entry.installPath + "/.claude-plugin/plugin.json");
    const installed = (manifest && manifest.version) || "none";

    const mkt = (read("/tmp/cc-marketplaces.json") || []).find((m) => m.name === marketplaceName);
    const catalog = mkt && read(mkt.installLocation + "/.claude-plugin/marketplace.json");
    const declared = catalog && (catalog.plugins || []).find((p) => p.name === pluginName);
    // Not every marketplace declares a per-plugin version (claude-plugins-official does not).
    // An absent declaration is nothing to compare against, not evidence of drift — but that
    // guard must not also swallow a total non-install. On a cold sandbox, the marketplace
    // list/read above can fail for the same underlying reason nothing got installed (first-run
    // race, marketplace not yet resolvable), which degrades \`expected\` to "unversioned" too —
    // indistinguishable, by this variable alone, from a marketplace that legitimately has no
    // version field. \`installed === "none"\` is unambiguous either way and must win.
    const expected = (declared && declared.version) || "unversioned";

    const drift = installed === "none" || (expected !== "unversioned" && installed !== expected);
    console.log([installed, expected, drift ? "DRIFT" : "ok", (entry && entry.installPath) || "-"].join("\\t"));`;

// The exact pre-#1779 VERDICT body (git HEAD at the time #1779 was picked up): the sha-resolution
// fetch's catch swallows a failure with a comment only (no stderr), and the fetch itself is
// attempted unconditionally regardless of source.url's host. Frozen the same way
// PRE_CHANGE_VERDICT_BODY is above, so the go-red proof for #1779's two announced-warning fixes
// survives any later edit to the live script. Copied verbatim from `git show HEAD:scripts/
// claude-cloud-setup.sh` before this change landed.
const PRE_1779_VERDICT_BODY = `    const fs = require("fs");
    const spec = process.argv[1];
    // The two session-scoped snapshot paths reach the script as process.argv args rather
    // than spliced into this single-quoted JS source (_shared/session-tmp-root.md) — a
    // path containing a quote character would otherwise break out of the string literal,
    // the same reason code-health/focus-mode.mds F1 block passes its own values that way.
    const installedPath = process.argv[2];
    const marketplacesPath = process.argv[3];
    const [pluginName, marketplaceName] = spec.split("@");
    const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

    // The installed directory decides what a session loads. \`claude plugin list\`s own
    // \`version\` is metadata recorded beside that directory rather than read out of it, and
    // \`installed_plugins.json\`s \`gitCommitSha\` is not refreshed by \`claude plugin update\`
    // at all — neither can be trusted to describe the files actually on disk.
    const entry = (read(installedPath) || []).find((p) => p.id === spec);
    const manifest = entry && read(entry.installPath + "/.claude-plugin/plugin.json");
    const installed = (manifest && manifest.version) || "none";

    const mkt = (read(marketplacesPath) || []).find((m) => m.name === marketplaceName);
    const catalog = mkt && read(mkt.installLocation + "/.claude-plugin/marketplace.json");
    const declared = catalog && (catalog.plugins || []).find((p) => p.name === pluginName);
    // Not every marketplace declares a per-plugin version (claude-plugins-official does not).
    // An absent declaration is nothing to compare against, not evidence of drift — but that
    // guard must not also swallow a total non-install. On a cold sandbox, the marketplace
    // list/read above can fail for the same underlying reason nothing got installed (first-run
    // race, marketplace not yet resolvable), which degrades \`expected\` to "unversioned" too —
    // indistinguishable, by this variable alone, from a marketplace that legitimately has no
    // version field. \`installed === "none"\` is unambiguous either way and must win.
    let expected = (declared && declared.version) || null;
    // A git-subdir-sourced entry (claude-tweaks, post-#418) carries no entry-level version at
    // all: the payload plugin.json is the single version authority, and the catalog only pins
    // a release commit sha. Resolve that sha to a version by reading the manifest the source
    // repo actually shipped at that commit, instead of treating a missing version field as
    // nothing to compare (claude-tweaks #860, which used to make claude-tweaks drift permanently
    // unverifiable via this comparison).
    if (!expected && declared && declared.source && declared.source.source === "git-subdir" && declared.source.sha && declared.source.url) {
      try {
        const rawBase = declared.source.url.replace(/^https:\\/\\/github\\.com\\//, "https://raw.githubusercontent.com/");
        const rawUrl = rawBase + "/" + declared.source.sha + "/" + declared.source.path + "/.claude-plugin/plugin.json";
        const atSha = JSON.parse(require("child_process").execFileSync("curl", ["-fsSL", rawUrl], { encoding: "utf8", timeout: 10000 }));
        if (atSha && atSha.version) expected = atSha.version;
      } catch {
        // Network failure, missing manifest at that path, or unexpected shape: fall through to
        // "unversioned" below, the same fail-open posture as an unresolvable catalog entry.
      }
    }
    expected = expected || "unversioned";

    const drift = installed === "none" || (expected !== "unversioned" && installed !== expected);
    console.log([installed, expected, drift ? "DRIFT" : "ok", (entry && entry.installPath) || "-"].join("\\t"));`;

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Installs a fake `curl` on PATH that serves canned plugin.json bodies keyed by exact URL, so
// the sha-resolution path can be exercised without a live network call. Any unregistered URL
// exits non-zero — matching real curl -f's behavior on a 404 — which is what drives the fix's
// fail-open `catch` branch when needed.
function makeCurlStub(responses) {
  const dir = tmpDir('cloud-setup-curlstub-');
  const cases = Object.entries(responses)
    .map(([url, body]) => `if [ "$2" = '${url}' ]; then printf '%s' '${body.replace(/'/g, "'\\''")}'; exit 0; fi`)
    .join('\n');
  const script = `#!/bin/sh\n${cases}\nexit 22\n`;
  fs.writeFileSync(path.join(dir, 'curl'), script);
  fs.chmodSync(path.join(dir, 'curl'), 0o755);
  return dir;
}

function writeFixtures({ pluginId, installedVersion, catalogPlugin, marketplaceName }) {
  const installPath = tmpDir('cloud-setup-install-');
  fs.mkdirSync(path.join(installPath, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(installPath, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ version: installedVersion }),
  );
  fs.writeFileSync(INSTALLED_JSON, JSON.stringify([{ id: pluginId, installPath }]));

  const mktLocation = tmpDir('cloud-setup-mkt-');
  fs.mkdirSync(path.join(mktLocation, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(mktLocation, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ plugins: [catalogPlugin] }),
  );
  fs.writeFileSync(MARKETPLACES_JSON, JSON.stringify([{ name: marketplaceName, installLocation: mktLocation }]));
}

// Runs a VERDICT node -e body (live or frozen) against whatever fixtures are currently at
// INSTALLED_JSON / MARKETPLACES_JSON, with `curlDir` prepended to PATH so a stubbed `curl`
// answers the sha-resolution fetch. The live body (#923) reads the two session-scoped
// snapshot paths from process.argv[2]/[3] rather than hardcoding them (_shared/
// session-tmp-root.md) — the frozen pre-#860 body ignores the extra args harmlessly, since it
// still hardcodes its own literals internally.
function runVerdict(body, spec, curlDir) {
  const result = spawnSync('node', ['-e', body, spec, INSTALLED_JSON, MARKETPLACES_JSON], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${curlDir}:${process.env.PATH}` },
    timeout: 15_000,
  });
  assert.strictEqual(result.status, 0, `node -e exited nonzero (stderr: ${result.stderr})`);
  const [installed, expected, status, installPath] = result.stdout.trim().split('\t');
  return { installed, expected, status, installPath, stderr: result.stderr };
}

const SPEC = 'claude-tweaks@claude-tweaks-marketplace';
const SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const RAW_URL = `https://raw.githubusercontent.com/thomasholknielsen/claude-tweaks/${SHA}/plugin/.claude-plugin/plugin.json`;
const SHA_PINNED_CATALOG_ENTRY = {
  name: 'claude-tweaks',
  source: { source: 'git-subdir', url: 'https://github.com/thomasholknielsen/claude-tweaks', path: 'plugin', sha: SHA },
};

let liveSnippet;

test('setup: extract the live VERDICT snippet and confirm it is byte-identical to the template doc', () => {
  const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');
  liveSnippet = extractVerdictSnippet(scriptSource);

  const docPath = path.resolve(
    __dirname,
    '..',
    'plugin',
    'skills',
    'init',
    'bootstrap',
    'step-14-cloud-routine-parity.md',
  );
  const docSnippet = extractVerdictSnippet(fs.readFileSync(docPath, 'utf8'));
  assert.strictEqual(
    liveSnippet,
    docSnippet,
    'the generated script and its template doc have drifted apart — regenerate scripts/claude-cloud-setup.sh from the template',
  );
});

test('sha-pinned catalog entry: stale resolved version vs newer installed build reports DRIFT', () => {
  const curlDir = makeCurlStub({ [RAW_URL]: JSON.stringify({ version: '6.90.0' }) });
  writeFixtures({
    pluginId: SPEC,
    installedVersion: '6.97.0',
    catalogPlugin: SHA_PINNED_CATALOG_ENTRY,
    marketplaceName: 'claude-tweaks-marketplace',
  });
  const verdict = runVerdict(liveSnippet, SPEC, curlDir);
  assert.strictEqual(verdict.installed, '6.97.0');
  assert.strictEqual(verdict.expected, '6.90.0', 'expected should resolve to the sha-pinned manifest version, not "unversioned"');
  assert.strictEqual(verdict.status, 'DRIFT');
});

test('sha-pinned catalog entry: newer resolved version vs stale installed build reports DRIFT (reverse direction)', () => {
  const curlDir = makeCurlStub({ [RAW_URL]: JSON.stringify({ version: '6.97.0' }) });
  writeFixtures({
    pluginId: SPEC,
    installedVersion: '6.90.0',
    catalogPlugin: SHA_PINNED_CATALOG_ENTRY,
    marketplaceName: 'claude-tweaks-marketplace',
  });
  const verdict = runVerdict(liveSnippet, SPEC, curlDir);
  assert.strictEqual(verdict.installed, '6.90.0');
  assert.strictEqual(verdict.expected, '6.97.0');
  assert.strictEqual(verdict.status, 'DRIFT');
});

test('sha-pinned catalog entry: identical resolved and installed versions report ok (no drift)', () => {
  const curlDir = makeCurlStub({ [RAW_URL]: JSON.stringify({ version: '6.97.0' }) });
  writeFixtures({
    pluginId: SPEC,
    installedVersion: '6.97.0',
    catalogPlugin: SHA_PINNED_CATALOG_ENTRY,
    marketplaceName: 'claude-tweaks-marketplace',
  });
  const verdict = runVerdict(liveSnippet, SPEC, curlDir);
  assert.strictEqual(verdict.expected, '6.97.0');
  assert.strictEqual(verdict.status, 'ok');
});

test('legacy entry-level version field still compares directly (unaffected by the sha fallback)', () => {
  const curlDir = makeCurlStub({}); // must not be consulted at all when declared.version is set
  writeFixtures({
    pluginId: 'superpowers@claude-plugins-official',
    installedVersion: '1.2.0',
    catalogPlugin: { name: 'superpowers', version: '1.3.0' },
    marketplaceName: 'claude-plugins-official',
  });
  const verdict = runVerdict(liveSnippet, 'superpowers@claude-plugins-official', curlDir);
  assert.strictEqual(verdict.installed, '1.2.0');
  assert.strictEqual(verdict.expected, '1.3.0');
  assert.strictEqual(verdict.status, 'DRIFT');
});

test('go-red proof: the pre-#860 VERDICT body reports "unversioned"/ok on the same sha-pinned mismatch fixture', () => {
  // Same fixture as the first sha-pinned DRIFT case above — a real, detectable mismatch — but
  // run through the frozen pre-change body. If this did not report the bug, the new tests
  // above would not be able to go red against the old code [IL-105].
  const curlDir = makeCurlStub({ [RAW_URL]: JSON.stringify({ version: '6.90.0' }) });
  writeFixtures({
    pluginId: SPEC,
    installedVersion: '6.97.0',
    catalogPlugin: SHA_PINNED_CATALOG_ENTRY,
    marketplaceName: 'claude-tweaks-marketplace',
  });
  const verdict = runVerdict(PRE_CHANGE_VERDICT_BODY, SPEC, curlDir);
  assert.strictEqual(verdict.expected, 'unversioned', 'pre-change code should have degraded to "unversioned" on a sha-pinned entry');
  assert.strictEqual(verdict.status, 'ok', 'pre-change code should have silently reported no drift despite the real version mismatch');
});

// #1779: two more silent-swallow defects in the same VERDICT block, plus an unguarded `set -u`
// expansion crash a few lines above it in the plugin-freshness block.

test('non-github.com catalog source url: skip the raw-manifest fetch and announce why, instead of fetching a meaningless rewrite', () => {
  const NON_GITHUB_ENTRY = {
    name: 'claude-tweaks',
    source: { source: 'git-subdir', url: 'https://gitlab.com/thomasholknielsen/claude-tweaks', path: 'plugin', sha: SHA },
  };
  // Must not be consulted at all -- the host gate should skip the fetch before any curl call.
  const curlDir = makeCurlStub({});
  writeFixtures({
    pluginId: SPEC,
    installedVersion: '6.97.0',
    catalogPlugin: NON_GITHUB_ENTRY,
    marketplaceName: 'claude-tweaks-marketplace',
  });
  const verdict = runVerdict(liveSnippet, SPEC, curlDir);
  assert.strictEqual(verdict.expected, 'unversioned');
  assert.match(
    verdict.stderr,
    /\[claude-cloud-setup\] WARNING: could not resolve the pinned version of claude-tweaks@claude-tweaks-marketplace at [a-f0-9]+ \(non-github\.com source url\) — freshness unverified\./,
  );
});

test('github.com source url: a failed raw-manifest fetch announces a WARNING naming the spec and sha, instead of swallowing it', () => {
  const curlDir = makeCurlStub({}); // unregistered URL -> stub exits 22, matching real curl -f on a 404
  writeFixtures({
    pluginId: SPEC,
    installedVersion: '6.97.0',
    catalogPlugin: SHA_PINNED_CATALOG_ENTRY,
    marketplaceName: 'claude-tweaks-marketplace',
  });
  const verdict = runVerdict(liveSnippet, SPEC, curlDir);
  assert.strictEqual(verdict.expected, 'unversioned');
  assert.match(
    verdict.stderr,
    new RegExp(`\\[claude-cloud-setup\\] WARNING: could not resolve the pinned version of ${SPEC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} at ${SHA} \\(.*\\) — freshness unverified\\.`),
  );
});

test('go-red proof: the pre-#1779 VERDICT body swallows both the fetch-failure and non-github cases with zero stderr', () => {
  const curlDir = makeCurlStub({});
  writeFixtures({
    pluginId: SPEC,
    installedVersion: '6.97.0',
    catalogPlugin: SHA_PINNED_CATALOG_ENTRY,
    marketplaceName: 'claude-tweaks-marketplace',
  });
  const verdict = runVerdict(PRE_1779_VERDICT_BODY, SPEC, curlDir);
  assert.strictEqual(verdict.expected, 'unversioned');
  assert.strictEqual(verdict.stderr.trim(), '', 'pre-#1779 code should have swallowed the fetch failure with no stderr output');
});

// The session-id guard lives a few lines above the VERDICT block, in the plugin-freshness
// block's CC_TMP_DIR resolution -- extracted and run standalone under `set -euo pipefail` (the
// script's own header) so the go-red proof exercises the real `set -u` abort, not a simulation.
function extractTmpDirBlock(scriptSource) {
  const m = scriptSource.match(/(CC_TMP_DIR="\$\{TMPDIR:-\/tmp\}"\n[\s\S]*?\nfi)\nCC_INSTALLED=/);
  assert.ok(
    m,
    'extraction pattern is out of sync with scripts/claude-cloud-setup.sh — the CC_TMP_DIR block moved or was reworded',
  );
  return m[1];
}

const PRE_1779_TMPDIR_BLOCK = `CC_TMP_DIR="\${TMPDIR:-/tmp}"
if [ -n "$CLAUDE_CODE_SESSION_ID" ]; then
  CC_TMP_DIR="$CC_TMP_DIR/ct-session-$CLAUDE_CODE_SESSION_ID"
  mkdir -p "$CC_TMP_DIR"
fi`;

function runTmpDirBlock(block, sessionId) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (sessionId !== undefined) env.CLAUDE_CODE_SESSION_ID = sessionId;
  env.TMPDIR = tmpDir('cloud-setup-tmpdir-test-');
  const script = `set -euo pipefail\n${block}\necho "$CC_TMP_DIR"`;
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env, timeout: 5000 });
  return { ...result, tmpdir: env.TMPDIR };
}

test('session-id guard: CLAUDE_CODE_SESSION_ID unset does not abort under set -u, CC_TMP_DIR stays unscoped', () => {
  const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const block = extractTmpDirBlock(scriptSource);
  const result = runTmpDirBlock(block, undefined);
  assert.strictEqual(result.status, 0, `expected the guarded block to run clean under set -u (stderr: ${result.stderr})`);
  assert.strictEqual(result.stdout.trim(), result.tmpdir);
});

test('session-id guard: CLAUDE_CODE_SESSION_ID exported still resolves the ct-session-{id} subdirectory unchanged', () => {
  const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const block = extractTmpDirBlock(scriptSource);
  const result = runTmpDirBlock(block, 'abc123');
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const expectedDir = `${result.tmpdir}/ct-session-abc123`;
  assert.strictEqual(result.stdout.trim(), expectedDir);
  assert.ok(fs.existsSync(expectedDir), 'the ct-session-{id} subdirectory should have been created');
});

test('go-red proof: the pre-#1779 unguarded session-id test aborts with "unbound variable" under set -u', () => {
  const result = runTmpDirBlock(PRE_1779_TMPDIR_BLOCK, undefined);
  assert.notStrictEqual(result.status, 0, 'pre-#1779 code should abort when CLAUDE_CODE_SESSION_ID is unset under set -u');
  assert.match(result.stderr, /unbound variable/);
});
