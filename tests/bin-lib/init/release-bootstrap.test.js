'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rb = require('../../../plugin/bin/lib/init/release-bootstrap');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'release-bootstrap-')); }
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
const SHAPED = JSON.stringify({ packages: { '.': { 'release-type': 'node' } } });

test('detectReleaseProcess: nothing at all -> fresh', () => {
  assert.deepEqual(rb.detectReleaseProcess(tmp()), { verdict: 'fresh' });
});

test('detectReleaseProcess: semantic-release, changesets, goreleaser markers -> conflict naming the tool and evidence', () => {
  const a = tmp(); write(a, '.releaserc.json', '{}');
  assert.deepEqual(rb.detectReleaseProcess(a), { verdict: 'conflict', tool: 'semantic-release', evidence: '.releaserc.json' });
  const b = tmp(); write(b, 'release.config.js', 'module.exports = {}');
  assert.equal(rb.detectReleaseProcess(b).tool, 'semantic-release');
  const c = tmp(); fs.mkdirSync(path.join(c, '.changeset'));
  assert.deepEqual(rb.detectReleaseProcess(c), { verdict: 'conflict', tool: 'changesets', evidence: '.changeset/' });
  const d = tmp(); write(d, '.goreleaser.yaml', 'builds: []');
  assert.equal(rb.detectReleaseProcess(d).tool, 'goreleaser');
});

test('detectReleaseProcess: a foreign release-please config -> conflict; the bootstrap shape -> already-bootstrapped', () => {
  const a = tmp(); write(a, 'release-please-config.json', JSON.stringify({ 'release-type': 'node' }));
  assert.deepEqual(rb.detectReleaseProcess(a), { verdict: 'conflict', tool: 'release-please (foreign config)', evidence: 'release-please-config.json' });
  const b = tmp(); write(b, 'release-please-config.json', SHAPED); write(b, '.release-please-manifest.json', '{".":"1.2.3"}');
  assert.deepEqual(rb.detectReleaseProcess(b), { verdict: 'already-bootstrapped' });
  const c = tmp(); write(c, 'release-please-config.json', 'not json');
  assert.equal(rb.detectReleaseProcess(c).verdict, 'conflict');
  const d = tmp(); write(d, 'release-please-config.json', SHAPED);
  assert.deepEqual(rb.detectReleaseProcess(d), { verdict: 'fresh' });
});

test('detectReleaseProcess: v* tags are never conflict evidence (root scan only, no tag input)', () => {
  const a = tmp(); write(a, 'package.json', '{"version":"1.0.0"}');
  assert.deepEqual(rb.detectReleaseProcess(a), { verdict: 'fresh' });
});

test('resolveReleaseType: exactly one stack row -> its type; zero or two rows -> simple', () => {
  const node = tmp(); write(node, 'package.json', '{"name":"x","version":"1.0.0"}');
  assert.deepEqual(rb.resolveReleaseType(node), { releaseType: 'node', extraFiles: [] });
  const rust = tmp(); write(rust, 'Cargo.toml', '[package]\nname = "x"\nversion = "0.3.0"\n');
  assert.equal(rb.resolveReleaseType(rust).releaseType, 'rust');
  const dotnet = tmp(); write(dotnet, 'App.csproj', '<Project />');
  assert.equal(rb.resolveReleaseType(dotnet).releaseType, 'dotnet');
  const two = tmp(); write(two, 'package.json', '{}'); write(two, 'go.mod', 'module x');
  assert.equal(rb.resolveReleaseType(two).releaseType, 'simple');
  assert.equal(rb.resolveReleaseType(tmp()).releaseType, 'simple');
  const dirPkg = tmp(); fs.mkdirSync(path.join(dirPkg, 'package.json'));
  assert.equal(rb.resolveReleaseType(dirPkg).releaseType, 'simple');
});

test('resolveReleaseType: simple names the first version-bearing JSON manifest as an extra-file', () => {
  const a = tmp(); write(a, 'plugin/.claude-plugin/plugin.json', '{"name":"p","version":"6.1.0"}');
  assert.deepEqual(rb.resolveReleaseType(a), { releaseType: 'simple', extraFiles: [{ type: 'json', path: 'plugin/.claude-plugin/plugin.json', jsonpath: '$.version' }] });
  const b = tmp(); write(b, 'thing.json', '{"version":"2.0.0"}'); write(b, 'other.json', '{"noversion":true}');
  assert.deepEqual(rb.resolveReleaseType(b).extraFiles, [{ type: 'json', path: 'thing.json', jsonpath: '$.version' }]);
});

test('readStackManifestVersion: node/php read JSON version, python/rust read the TOML version line, others null', () => {
  const node = tmp(); write(node, 'package.json', '{"version":"1.4.2"}');
  assert.equal(rb.readStackManifestVersion(node, 'node'), '1.4.2');
  const py = tmp(); write(py, 'pyproject.toml', '[project]\nname = "x"\nversion = "0.9.1"\n');
  assert.equal(rb.readStackManifestVersion(py, 'python'), '0.9.1');
  const rust = tmp(); write(rust, 'Cargo.toml', '[package]\nversion = "0.3.0"\n');
  assert.equal(rb.readStackManifestVersion(rust, 'rust'), '0.3.0');
  assert.equal(rb.readStackManifestVersion(tmp(), 'go'), null);
  const bad = tmp(); write(bad, 'package.json', '{"version":"not-semver"}');
  assert.equal(rb.readStackManifestVersion(bad, 'node'), null);
});

test('seedManifestVersion: newest v* tag by semver precedence, never lexicographic (AC 8)', () => {
  assert.equal(rb.seedManifestVersion({ tags: ['v1.9.0', 'v1.10.0'], manifestVersion: '0.0.1' }), '1.10.0');
  assert.equal(rb.seedManifestVersion({ tags: ['v1.10.0', 'v1.9.0', 'v0.2.0'], manifestVersion: null }), '1.10.0');
  assert.equal(rb.seedManifestVersion({ tags: ['release-2024', 'v1.2'], manifestVersion: '3.0.0' }), '3.0.0'); // non-semver tags ignored
  assert.equal(rb.seedManifestVersion({ tags: [], manifestVersion: '2.5.0' }), '2.5.0');
  assert.equal(rb.seedManifestVersion({ tags: [], manifestVersion: null }), '0.1.0');
});

test('isValidBranchName: rejects whitespace/control chars, forbidden ref characters, "..", a leading "-", a trailing "/" or ".lock", "//", and non-strings; accepts ordinary names (ledger row 34)', () => {
  for (const bad of ['main\n  pull_request_target:', '', 'bad branch', '-lead', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a..b', 'a/', 'a.lock', 'a//b', null, undefined, 42]) {
    assert.equal(rb.isValidBranchName(bad), false, `expected ${JSON.stringify(bad)} to be invalid`);
  }
  for (const good of ['develop', 'release/2.x', 'feat.v1', 'main']) {
    assert.equal(rb.isValidBranchName(good), true, `expected ${JSON.stringify(good)} to be valid`);
  }
});

test('renderWorkflowYaml: throws on an invalid branch name instead of silently defaulting to main (ledger row 34)', () => {
  assert.throws(() => rb.renderWorkflowYaml({ branch: 'main\n  pull_request_target:' }), /invalid branch name/);
  assert.throws(() => rb.renderWorkflowYaml({ branch: '' }), /invalid branch name/);
  assert.throws(() => rb.renderWorkflowYaml({ branch: 'bad branch' }), /invalid branch name/);
  assert.throws(() => rb.renderWorkflowYaml({ branch: '-lead' }), /invalid branch name/);
  assert.throws(() => rb.renderWorkflowYaml({}), /invalid branch name/);
  assert.doesNotThrow(() => rb.renderWorkflowYaml({ branch: 'develop' }));
  assert.doesNotThrow(() => rb.renderWorkflowYaml({ branch: 'release/2.x' }));
  assert.doesNotThrow(() => rb.renderWorkflowYaml({ branch: 'feat.v1' }));
});

test('bootstrapRelease: refuses an invalid branch on the pr-first path before any write; local-merge ignores an invalid branch entirely (ledger row 34)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  assert.throws(() => rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'bad branch', listTags: () => [] }), /invalid branch name/);
  assert.equal(fs.existsSync(path.join(root, 'release-please-config.json')), false);
  const r = rb.bootstrapRelease({ root, integrationModel: 'local-merge', branch: 'bad branch', listTags: () => [] });
  assert.equal(r.verdict, 'fresh');
  assert.deepEqual(r.written, ['release-please-config.json', '.release-please-manifest.json']);
});

test('renderers: workflow, config, manifest, policy rows', () => {
  const wf = rb.renderWorkflowYaml({ branch: 'develop' });
  assert.match(wf, /uses: googleapis\/release-please-action@v4/);
  assert.match(wf, /branches:\n\s+- develop/);
  assert.match(wf, /contents: write/);
  assert.match(wf, /pull-requests: write/);
  assert.match(wf, /config-file: release-please-config\.json/);
  assert.match(wf, /manifest-file: \.release-please-manifest\.json/);
  assert.match(wf, /target-branch: develop/); // F4
  assert.match(wf, /# token: \$\{\{ secrets\.RELEASE_PLEASE_TOKEN \}\}/); // F5
  assert.match(wf, /do not trigger/); // F5
  const cfg = JSON.parse(rb.renderConfig({ releaseType: 'node', extraFiles: [] }));
  assert.equal(cfg.packages['.']['release-type'], 'node');
  assert.equal(cfg.packages['.']['bump-minor-pre-major'], false);
  assert.equal(cfg.packages['.']['include-component-in-tag'], false);
  assert.equal('extra-files' in cfg.packages['.'], false);
  assert.ok(rb.isBootstrapShaped(cfg));
  const simple = JSON.parse(rb.renderConfig({ releaseType: 'simple', extraFiles: [{ type: 'json', path: 'p.json', jsonpath: '$.version' }] }));
  assert.deepEqual(simple.packages['.']['extra-files'], [{ type: 'json', path: 'p.json', jsonpath: '$.version' }]);
  assert.deepEqual(JSON.parse(rb.renderManifest('1.10.0')), { '.': '1.10.0' });
  assert.ok(rb.renderConfig({ releaseType: 'node', extraFiles: [] }).endsWith('\n'));
  const rows = rb.renderPolicyRows();
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^# release-hook: /);
  assert.equal(rows[1], '# release-train: false');
});

const { execFileSync } = require('child_process');
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function gitRepo(root) {
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  write(root, 'README.md', 'x\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'init');
}
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('bootstrapRelease: fresh Node repo, pr-first -> three files, release-type node, manifest 0.1.0 (AC 1)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const r = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => [] });
  assert.equal(r.verdict, 'fresh');
  assert.equal(r.releaseType, 'node');
  assert.equal(r.version, '0.1.0');
  assert.deepEqual(r.written, ['release-please-config.json', '.release-please-manifest.json', '.github/workflows/release-please.yml']);
  assert.equal(JSON.parse(read(root, 'release-please-config.json')).packages['.']['release-type'], 'node');
  assert.deepEqual(JSON.parse(read(root, '.release-please-manifest.json')), { '.': '0.1.0' });
  assert.match(read(root, '.github/workflows/release-please.yml'), /release-please-action@v4/);
  assert.deepEqual(r.policyRows, rb.renderPolicyRows());
});

test('bootstrapRelease: same fixture, local-merge -> config + manifest only, no workflow (AC 2)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const r = rb.bootstrapRelease({ root, integrationModel: 'local-merge', listTags: () => [] });
  assert.deepEqual(r.written, ['release-please-config.json', '.release-please-manifest.json']);
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/release-please.yml')), false);
  assert.equal(r.releaseType, 'node');
  assert.equal(r.version, '0.1.0');
});

test('bootstrapRelease: .changeset/ -> conflict, nothing written; manual v* tags alone stay fresh (AC 3)', () => {
  const a = tmp(); fs.mkdirSync(path.join(a, '.changeset')); write(a, 'package.json', '{}');
  const r = rb.bootstrapRelease({ root: a, integrationModel: 'pr-first', branch: 'main', listTags: () => [] });
  assert.equal(r.verdict, 'conflict');
  assert.equal(r.tool, 'changesets');
  assert.deepEqual(r.written, []);
  assert.equal(fs.existsSync(path.join(a, 'release-please-config.json')), false);
  const b = tmp(); gitRepo(b); write(b, 'package.json', '{"name":"x","version":"1.0.0"}');
  git(b, 'tag', 'v1.0.0');
  const r2 = rb.bootstrapRelease({ root: b, integrationModel: 'pr-first', branch: 'main' }); // default listTags reads the real repo
  assert.equal(r2.verdict, 'fresh');
  assert.equal(r2.version, '1.0.0');
});

test('bootstrapRelease: conflict cleared on a later run proceeds to write (AC 6)', () => {
  const root = tmp(); write(root, 'package.json', '{}'); write(root, '.releaserc', '{}');
  assert.equal(rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => [] }).verdict, 'conflict');
  fs.unlinkSync(path.join(root, '.releaserc'));
  const r = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => [] });
  assert.equal(r.verdict, 'fresh');
  assert.equal(r.written.length, 3);
});

test('bootstrapRelease: re-running on an already-bootstrapped repo writes nothing and does not clobber (AC 7)', () => {
  const root = tmp(); write(root, 'package.json', '{}');
  rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v2.0.0'] });
  const before = read(root, '.release-please-manifest.json');
  const r = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v9.9.9'] });
  assert.equal(r.verdict, 'already-bootstrapped');
  assert.deepEqual(r.written, []);
  assert.equal(read(root, '.release-please-manifest.json'), before);
});

test('bootstrapRelease: manifest seeded from the semver-newest tag on a real repo (AC 8)', () => {
  const root = tmp(); gitRepo(root); write(root, 'package.json', '{"name":"x","version":"0.0.1"}');
  git(root, 'tag', 'v1.9.0');
  git(root, 'tag', 'v1.10.0');
  const r = rb.bootstrapRelease({ root, integrationModel: 'local-merge' });
  assert.equal(r.version, '1.10.0');
  assert.deepEqual(JSON.parse(read(root, '.release-please-manifest.json')), { '.': '1.10.0' });
});

test('bootstrapRelease: unresolved integration-model -> skipped before any detection; dry-run writes nothing', () => {
  const a = tmp(); fs.mkdirSync(path.join(a, '.changeset'));
  assert.deepEqual(rb.bootstrapRelease({ root: a, integrationModel: null }), { verdict: 'skipped', reason: 'integration-model unresolved', written: [], policyRows: [] });
  const b = tmp(); write(b, 'package.json', '{}');
  const r = rb.bootstrapRelease({ root: b, integrationModel: 'pr-first', branch: 'main', dryRun: true, listTags: () => [] });
  assert.equal(r.verdict, 'fresh');
  assert.deepEqual(r.written, ['release-please-config.json', '.release-please-manifest.json', '.github/workflows/release-please.yml']);
  assert.equal(fs.existsSync(path.join(b, 'release-please-config.json')), false);
});

test('bootstrapRelease: a missing manifest after a config write is a half-written bootstrap, not a done one — re-run completes it (fix round 1)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const first = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v2.0.0'] });
  assert.equal(first.verdict, 'fresh');
  const configBefore = read(root, 'release-please-config.json');
  fs.unlinkSync(path.join(root, '.release-please-manifest.json'));
  const second = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v2.0.0'] });
  assert.equal(second.verdict, 'fresh');
  assert.equal(fs.existsSync(path.join(root, '.release-please-manifest.json')), true);
  assert.equal(read(root, 'release-please-config.json'), configBefore);
});

test('bootstrapRelease: a bootstrap-shaped config surviving a manifest-missing re-run is never rewritten — hand-edits to it survive (F8.5, fix round 2)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const first = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v2.0.0'] });
  assert.equal(first.verdict, 'fresh');
  const config = JSON.parse(read(root, 'release-please-config.json'));
  config['extra-option'] = true;
  fs.writeFileSync(path.join(root, 'release-please-config.json'), JSON.stringify(config, null, 2));
  fs.unlinkSync(path.join(root, '.release-please-manifest.json'));
  const second = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v2.0.0'] });
  assert.equal(second.verdict, 'fresh');
  assert.equal(fs.existsSync(path.join(root, '.release-please-manifest.json')), true);
  const configAfter = JSON.parse(read(root, 'release-please-config.json'));
  assert.equal(configAfter['extra-option'], true);
  // The workflow already exists untouched from the first run (never deleted
  // here) and — per ledger row 35's never-overwrite rule — is no longer
  // blindly rewritten; only the file actually missing (the manifest) is.
  assert.deepEqual(second.written, ['.release-please-manifest.json']);
});

test('bootstrapRelease: a pre-existing hand-written workflow with no config is a partial-files conflict, and the file is left byte-identical (ledger row 35)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const handWritten = 'name: my-own-workflow\n';
  write(root, '.github/workflows/release-please.yml', handWritten);
  const r = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => [] });
  assert.equal(r.verdict, 'conflict');
  assert.equal(r.tool, 'release-please (partial files)');
  assert.equal(r.evidence, '.github/workflows/release-please.yml');
  assert.deepEqual(r.written, []);
  assert.equal(fs.existsSync(path.join(root, 'release-please-config.json')), false);
  assert.equal(read(root, '.github/workflows/release-please.yml'), handWritten);
});

test('bootstrapRelease: a pre-existing manifest with no config is the same partial-files conflict, byte-identical after (ledger row 35)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const handWritten = '{".":"9.9.9"}';
  write(root, '.release-please-manifest.json', handWritten);
  const r = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => [] });
  assert.equal(r.verdict, 'conflict');
  assert.equal(r.tool, 'release-please (partial files)');
  assert.equal(r.evidence, '.release-please-manifest.json');
  assert.deepEqual(r.written, []);
  assert.equal(fs.existsSync(path.join(root, 'release-please-config.json')), false);
  assert.equal(read(root, '.release-please-manifest.json'), handWritten);
});

test('bootstrapRelease: a symlinked .github refuses to write through it; nothing lands outside root (ledger row 36)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const outside = tmp();
  fs.symlinkSync(outside, path.join(root, '.github'), 'dir');
  assert.throws(
    () => rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => [] }),
    /refusing to write through a symlink: \.github\/workflows\/release-please\.yml/,
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('bootstrapRelease: a local-merge bootstrap followed by a pr-first re-run writes only the missing workflow — config/manifest untouched (ledger row 37)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const first = rb.bootstrapRelease({ root, integrationModel: 'local-merge', listTags: () => ['v2.0.0'] });
  assert.equal(first.verdict, 'fresh');
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/release-please.yml')), false);
  const configBefore = read(root, 'release-please-config.json');
  const manifestBefore = read(root, '.release-please-manifest.json');
  const second = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v2.0.0'] });
  assert.equal(second.verdict, 'fresh');
  assert.deepEqual(second.written, ['.github/workflows/release-please.yml']);
  assert.equal(read(root, 'release-please-config.json'), configBefore);
  assert.equal(read(root, '.release-please-manifest.json'), manifestBefore);
  assert.match(read(root, '.github/workflows/release-please.yml'), /release-please-action@v4/);
});

test('bootstrapRelease: a pr-first bootstrap followed by a pr-first re-run is already-bootstrapped (ledger row 37)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const first = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v2.0.0'] });
  assert.equal(first.verdict, 'fresh');
  const r = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v9.9.9'] });
  assert.equal(r.verdict, 'already-bootstrapped');
  assert.deepEqual(r.written, []);
});

test('detectReleaseProcess: shaped config + manifest + missing workflow under pr-first is "fresh" with partial "workflow"; the same state under no model or local-merge is already-bootstrapped (ledger row 37)', () => {
  const root = tmp(); write(root, 'release-please-config.json', SHAPED); write(root, '.release-please-manifest.json', '{".":"1.0.0"}');
  assert.deepEqual(rb.detectReleaseProcess(root, { integrationModel: 'pr-first' }), { verdict: 'fresh', partial: 'workflow' });
  assert.deepEqual(rb.detectReleaseProcess(root), { verdict: 'already-bootstrapped' });
  assert.deepEqual(rb.detectReleaseProcess(root, { integrationModel: 'local-merge' }), { verdict: 'already-bootstrapped' });
  write(root, '.github/workflows/release-please.yml', 'name: x\n');
  assert.deepEqual(rb.detectReleaseProcess(root, { integrationModel: 'pr-first' }), { verdict: 'already-bootstrapped' });
});

test('bootstrapRelease: a missing or non-directory root throws before any detection and creates nothing (F2)', () => {
  const root = tmp();
  const missing = path.join(root, 'nope');
  assert.throws(() => rb.bootstrapRelease({ root: missing, integrationModel: 'pr-first', branch: 'main', listTags: () => [] }), /not a directory/);
  assert.equal(fs.existsSync(missing), false);
  const filePath = path.join(root, 'not-a-dir.txt');
  fs.writeFileSync(filePath, 'x');
  assert.throws(() => rb.bootstrapRelease({ root: filePath, integrationModel: 'pr-first', listTags: () => [] }), /not a directory/);
});

test('bootstrapRelease: an injected listTags reporting a git failure surfaces tagsFailure and still falls back to the manifest/0.1.0 seed (ledger row 38)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const r = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ({ tags: [], failure: 'EACCES' }) });
  assert.equal(r.verdict, 'fresh');
  assert.equal(r.tagsFailure, 'EACCES');
  assert.equal(r.version, '0.1.0');
});

test('bootstrapRelease: an injected listTags returning a plain array (no failure signal) carries no tagsFailure key (ledger row 38)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const r = rb.bootstrapRelease({ root, integrationModel: 'pr-first', branch: 'main', listTags: () => ['v2.0.0'] });
  assert.equal(r.verdict, 'fresh');
  assert.equal('tagsFailure' in r, false);
  assert.equal(r.version, '2.0.0');
});

test('defaultListTags: a plain directory with no .git reports a git failure distinguishable from "no tags" (ledger row 38)', () => {
  const root = tmp();
  const result = rb.defaultListTags(root);
  assert.deepEqual(result.tags, []);
  assert.equal(result.failure, 'git-error');
});

test('bootstrapRelease: the real (non-injected) listTags path on a plain directory carries tagsFailure in the fresh envelope (ledger row 38)', () => {
  const root = tmp(); write(root, 'package.json', '{"name":"x"}');
  const r = rb.bootstrapRelease({ root, integrationModel: 'local-merge', branch: 'main' });
  assert.equal(r.verdict, 'fresh');
  assert.equal(r.tagsFailure, 'git-error');
  assert.equal(r.version, '0.1.0');
});

test('detectReleaseProcess: an unreadable config (EACCES) is a conflict naming the real cause, not "foreign config" (ledger row 39)', () => {
  if (process.getuid && process.getuid() === 0) return; // root bypasses chmod restrictions
  const root = tmp(); write(root, 'release-please-config.json', SHAPED);
  fs.chmodSync(path.join(root, 'release-please-config.json'), 0o000);
  try {
    const r = rb.detectReleaseProcess(root);
    assert.equal(r.verdict, 'conflict');
    assert.match(r.tool, /config unreadable: EACCES/);
    assert.equal(r.evidence, 'release-please-config.json');
  } finally {
    fs.chmodSync(path.join(root, 'release-please-config.json'), 0o644);
  }
});

test('detectReleaseProcess: an unparseable config still reports "foreign config" unchanged (ledger row 39)', () => {
  const root = tmp(); write(root, 'release-please-config.json', 'not json');
  const r = rb.detectReleaseProcess(root);
  assert.equal(r.verdict, 'conflict');
  assert.equal(r.tool, 'release-please (foreign config)');
});
