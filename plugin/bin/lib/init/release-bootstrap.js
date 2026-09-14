// bin/lib/init/release-bootstrap.js — the code twin of /claude-tweaks:init's
// Step 21 (bootstrap/step-21-release.md, #2253): release-process detection,
// the stack → release-type table, semver-aware manifest seeding, and the
// renderers for the three release-please files plus the two commented
// policy rows. bin/release-bootstrap.js is the CLI the prose step calls;
// this module is what the tests pin. Pure functions over a root path —
// the only I/O is reading the root directory and the files it names.
//
// Detection is deliberately a self-contained presence check, not
// _shared/existing-convention-detection.md's genre-grammar procedure: that
// file's ≥3-file floor and grammar parse answer "which naming convention do
// many files agree on", while this step asks "does exactly one of these
// markers exist". Only the plugin/project/conflict vocabulary is shared,
// and even that is narrowed to fresh / already-bootstrapped / conflict.
// `v*` tags are never conflict evidence — a repo that tags releases by
// hand is the common onboarding case, not a competing engine.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { compareVersions } = require('../changelog');

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
// Pre-release/build-metadata tags (e.g. `v2.0.0-rc.1`) are not full releases
// and are ignored by the seed — only a bare `vMAJOR.MINOR.PATCH` tag matches.
const V_TAG_RE = /^v(\d+\.\d+\.\d+)$/;

// Canonical prose copy: bootstrap/step-21-release.md's stack table (pinned
// by tests/init-release-bootstrap-conformance.test.js). Exactly one
// matching row selects its release-type; zero or two-plus fall through to
// `simple` — a multi-stack repo is out of #2253's scope by design.
const RELEASE_STACK_TABLE = [
  { releaseType: 'node', markers: ['package.json'] },
  { releaseType: 'python', markers: ['pyproject.toml', 'setup.py'] },
  { releaseType: 'rust', markers: ['Cargo.toml'] },
  { releaseType: 'go', markers: ['go.mod'] },
  { releaseType: 'java', markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { releaseType: 'ruby', markers: ['Gemfile', '*.gemspec'] },
  { releaseType: 'php', markers: ['composer.json'] },
  { releaseType: 'dotnet', markers: ['*.csproj', '*.sln'] },
];

const RELEASE_TYPE_VALUES = new Set([...RELEASE_STACK_TABLE.map((row) => row.releaseType), 'simple']);

const CONFLICT_MARKERS = [
  { tool: 'semantic-release', test: (name, isDir) => !isDir && /^\.releaserc(\..+)?$/.test(name) },
  { tool: 'semantic-release', test: (name, isDir) => !isDir && /^release\.config\..+$/.test(name) },
  { tool: 'changesets', test: (name, isDir) => isDir && name === '.changeset' },
  { tool: 'goreleaser', test: (name, isDir) => !isDir && /^\.goreleaser\..+$/.test(name) },
];

const CONFIG_FILE = 'release-please-config.json';
const MANIFEST_FILE = '.release-please-manifest.json';
const WORKFLOW_FILE = '.github/workflows/release-please.yml';
const CONFIG_SCHEMA = 'https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json';

function rootEntries(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return []; // missing root — detection/resolution are read-only probes
    throw e;
  }
}

function isDirectory(root) {
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

// lstat, not stat/existsSync — a symlink counts as "existing" here even
// though it may point at nothing, because the question this answers is
// "is there already something at this path we must not clobber", not
// "does a regular file resolve here".
function lexists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

// { parsed } on success ({ parsed: undefined } for a missing file — ENOENT is
// "absent", not a failure); { error: 'unparseable' } on a JSON parse failure;
// { error: <e.code> } on any other read failure (e.g. EACCES) — callers that
// need to tell "absent"/"foreign" apart from "couldn't even read it" read
// `error` rather than collapsing every case to a bare undefined.
function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { parsed: undefined };
    return { error: (e && e.code) || 'read-error' };
  }
  try {
    return { parsed: JSON.parse(text) };
  } catch {
    return { error: 'unparseable' };
  }
}

function isBootstrapShaped(parsed) {
  return Boolean(parsed && typeof parsed === 'object' && parsed.packages && typeof parsed.packages === 'object'
    && parsed.packages['.'] && typeof parsed.packages['.'] === 'object'
    && typeof parsed.packages['.']['release-type'] === 'string');
}

// already-bootstrapped requires BOTH the config and the manifest present
// (matching the shape), not the config alone: bootstrapRelease writes its
// files sequentially with no rollback, so a config-written-manifest-missing
// state is a half-written bootstrap, not a done one — it must re-run to
// completion (idempotently, since the config content is unchanged) rather
// than be read as finished and have the missing files hidden forever.
// `integrationModel` only ever narrows the already-bootstrapped check: an
// undefined model (every caller that predates #2253's model-switch support,
// and every direct detectReleaseProcess(root) call) is treated as
// local-merge for the workflow question — i.e. the workflow's presence is
// never asked about, matching this function's pre-model-switch behavior.
function detectReleaseProcess(root, { integrationModel } = {}) {
  const entries = rootEntries(root);
  for (const { name, isDir } of entries) {
    for (const marker of CONFLICT_MARKERS) {
      if (marker.test(name, isDir)) return { verdict: 'conflict', tool: marker.tool, evidence: isDir ? `${name}/` : name };
    }
  }
  if (entries.some((e) => !e.isDir && e.name === CONFIG_FILE)) {
    const result = readJson(path.join(root, CONFIG_FILE));
    if (result.error && result.error !== 'unparseable') {
      return { verdict: 'conflict', tool: `release-please (config unreadable: ${result.error})`, evidence: CONFIG_FILE };
    }
    if (!isBootstrapShaped(result.parsed)) return { verdict: 'conflict', tool: 'release-please (foreign config)', evidence: CONFIG_FILE };
    const manifestExists = entries.some((e) => !e.isDir && e.name === MANIFEST_FILE);
    if (manifestExists) {
      // A local-merge bootstrap re-run under pr-first: config and manifest
      // are already correct, only the workflow is missing — that is a
      // completion, not a done state, so it must still route through
      // `fresh` (bootstrapRelease's write-only-missing-files logic is what
      // actually completes it) rather than report already-bootstrapped and
      // leave the workflow permanently missing.
      if (integrationModel === 'pr-first' && !lexists(path.join(root, WORKFLOW_FILE))) {
        return { verdict: 'fresh', partial: 'workflow' };
      }
      return { verdict: 'already-bootstrapped' };
    }
  }
  return { verdict: 'fresh' };
}

function markerMatches(marker, entries) {
  if (marker.startsWith('*.')) {
    const suffix = marker.slice(1);
    return entries.some((e) => !e.isDir && e.name.endsWith(suffix));
  }
  return entries.some((e) => !e.isDir && e.name === marker);
}

function versionOfJson(file) {
  const { parsed } = readJson(file); // any error (including unparseable) leaves parsed undefined -> null
  const v = parsed && typeof parsed === 'object' ? parsed.version : undefined;
  return typeof v === 'string' && SEMVER_RE.test(v) ? v : null;
}

function findSimpleExtraFile(root, entries) {
  const candidates = ['.claude-plugin/plugin.json', 'plugin/.claude-plugin/plugin.json',
    ...entries.filter((e) => !e.isDir && e.name.endsWith('.json')).map((e) => e.name).sort()];
  for (const rel of candidates) {
    if (versionOfJson(path.join(root, rel)) !== null) return [{ type: 'json', path: rel, jsonpath: '$.version' }];
  }
  return [];
}

function resolveReleaseType(root, override) {
  if (override && (override.releaseType !== undefined || override.extraFile !== undefined)) {
    // Both or neither: if one is set, both must be set
    const hasReleaseType = override.releaseType !== undefined;
    const hasExtraFile = override.extraFile !== undefined;
    if (hasReleaseType !== hasExtraFile) {
      throw new Error('--release-type and --extra-file must be given together');
    }
    if (!RELEASE_TYPE_VALUES.has(override.releaseType)) {
      throw new Error(`invalid release-type override: ${override.releaseType}`);
    }
    const extraFiles = override.extraFile
      ? [{ type: 'json', path: override.extraFile, jsonpath: '$.version' }]
      : [];
    if (override.extraFile !== undefined) {
      if (versionOfJson(path.join(root, override.extraFile)) === null) {
        throw new Error(`--extra-file names no readable JSON manifest with a semver version: ${override.extraFile}`);
      }
    }
    return { releaseType: override.releaseType, extraFiles };
  }
  const entries = rootEntries(root);
  const matched = RELEASE_STACK_TABLE.filter((row) => row.markers.some((m) => markerMatches(m, entries)));
  if (matched.length === 1) return { releaseType: matched[0].releaseType, extraFiles: [] };
  return { releaseType: 'simple', extraFiles: findSimpleExtraFile(root, entries) };
}

function versionOfToml(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = /^\s*version\s*=\s*"(\d+\.\d+\.\d+)"/m.exec(text);
  return m ? m[1] : null;
}

function readStackManifestVersion(root, releaseType) {
  switch (releaseType) {
    case 'node': return versionOfJson(path.join(root, 'package.json'));
    case 'php': return versionOfJson(path.join(root, 'composer.json'));
    case 'python': return versionOfToml(path.join(root, 'pyproject.toml'));
    case 'rust': return versionOfToml(path.join(root, 'Cargo.toml'));
    default: return null;
  }
}

// Newest v* tag wins by semver precedence (compareVersions, never a string
// sort — `v1.9.0` must lose to `v1.10.0`); non-semver tags are ignored.
function seedManifestVersion({ tags, manifestVersion } = {}) {
  const versions = (Array.isArray(tags) ? tags : [])
    .map((t) => { const m = V_TAG_RE.exec(String(t).trim()); return m ? m[1] : null; })
    .filter(Boolean);
  if (versions.length > 0) return versions.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
  if (typeof manifestVersion === 'string' && SEMVER_RE.test(manifestVersion)) return manifestVersion;
  return '0.1.0';
}

// The practical subset of `git check-ref-format --branch`: a non-empty
// string, no whitespace or control characters, none of the ref-forbidding
// characters, no "..", no leading "-", no trailing "/" or ".lock", no "//".
const INVALID_BRANCH_CHARS_RE = /[~^:?*[\\]/;
function isValidBranchName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (/[\s\x00-\x1f\x7f]/.test(name)) return false;
  if (INVALID_BRANCH_CHARS_RE.test(name)) return false;
  if (name.includes('..')) return false;
  if (name.includes('//')) return false;
  if (name.startsWith('-')) return false;
  if (name.endsWith('/') || name.endsWith('.lock')) return false;
  return true;
}

function renderWorkflowYaml({ branch } = {}) {
  if (!isValidBranchName(branch)) throw new Error(`invalid branch name: ${JSON.stringify(branch)}`);
  const b = branch;
  return [
    'name: release-please',
    '',
    'on:',
    '  push:',
    '    branches:',
    `      - ${b}`,
    '',
    'permissions:',
    '  contents: write',
    '  pull-requests: write',
    '',
    'jobs:',
    '  release-please:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: googleapis/release-please-action@v4',
    '        with:',
    '          # Releases created with the default GITHUB_TOKEN do not trigger other',
    '          # workflows (a `release: published` publish/deploy hook stays silent) — set a PAT:',
    '          # token: ${{ secrets.RELEASE_PLEASE_TOKEN }}',
    '          config-file: release-please-config.json',
    '          manifest-file: .release-please-manifest.json',
    `          target-branch: ${b}`,
    '',
  ].join('\n');
}

function renderConfig({ releaseType, extraFiles } = {}) {
  const pkg = { 'release-type': releaseType, 'bump-minor-pre-major': false, 'include-component-in-tag': false };
  if (Array.isArray(extraFiles) && extraFiles.length > 0) pkg['extra-files'] = extraFiles;
  return `${JSON.stringify({ $schema: CONFIG_SCHEMA, packages: { '.': pkg } }, null, 2)}\n`;
}

function renderManifest(version) {
  return `${JSON.stringify({ '.': version }, null, 2)}\n`;
}

function renderPolicyRows() {
  return [
    '# release-hook: <command run after the local engine tags a release — local-merge only; under pr-first the release: published workflow is the hook — it needs a PAT, GITHUB_TOKEN-created releases do not trigger it>',
    '# release-train: false',
  ];
}

// { tags, failure: null } on success; { tags: [], failure: <e.code or
// 'git-error'> } on any throw (not a git repo, git absent, permission
// denied, …) — a git failure must read as distinguishable from "no tags",
// even though both fall through to the same manifest/0.1.0 seed.
function defaultListTags(root) {
  try {
    const tags = execFileSync('git', ['-C', root, 'tag', '-l', 'v*'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      .split('\n').map((s) => s.trim()).filter(Boolean);
    return { tags, failure: null };
  } catch (e) {
    return { tags: [], failure: (e && e.code) || 'git-error' };
  }
}

// The injected listTags seam may still return a plain array (older callers,
// tests) — normalize that to the { tags, failure } shape so bootstrapRelease
// has one thing to read.
function normalizeListTagsResult(result) {
  return Array.isArray(result) ? { tags: result, failure: null } : result;
}

// The step's whole decision, in one call: verdict first, then the writes.
// Never touches .claude-tweaks/policy.yml — the two rows are returned for
// the prose step to land through init/worktree-policy-finalization.md's
// isolated-worktree write (a direct edit would be denied under
// worktree-always, the same reason Step 6 defers its own row).
function bootstrapRelease({ root, integrationModel, branch, dryRun = false, listTags, releaseType: releaseTypeOverride, extraFile } = {}) {
  const empty = { written: [], policyRows: [] };
  // A missing/non-directory root is a caller bug (a mistyped --root), never
  // a state this step should detect its way around — throw before any
  // detection so the lib can't manufacture a bootstrap out of thin air even
  // when called without the CLI's own validation in front of it.
  if (!isDirectory(root)) throw new Error(`root is not a directory: ${root}`);
  if (integrationModel !== 'pr-first' && integrationModel !== 'local-merge') {
    return { verdict: 'skipped', reason: 'integration-model unresolved', ...empty };
  }
  // local-merge never writes the workflow file, so an invalid branch there
  // is inert — only pr-first needs the check, and it needs it before any
  // detection work, not just before the eventual render call.
  if (integrationModel === 'pr-first' && !isValidBranchName(branch)) {
    throw new Error(`invalid branch name: ${JSON.stringify(branch)}`);
  }
  const detected = detectReleaseProcess(root, { integrationModel });
  if (detected.verdict !== 'fresh') return { ...detected, ...empty };
  const { releaseType, extraFiles } = resolveReleaseType(root, { releaseType: releaseTypeOverride, extraFile });
  const { tags, failure: tagsFailure } = normalizeListTagsResult((listTags || defaultListTags)(root));
  const seedSourceVersion = extraFiles.length
    ? versionOfJson(path.join(root, extraFiles[0].path))
    : readStackManifestVersion(root, releaseType);
  const version = seedManifestVersion({ tags, manifestVersion: seedSourceVersion });
  // A manifest-missing re-run (detectReleaseProcess still reports `fresh`
  // when the config already exists in this step's own shape) must not
  // rewrite an already-correct — possibly hand-edited — config; only the
  // files actually missing get (re)written.
  const configShaped = isBootstrapShaped(readJson(path.join(root, CONFIG_FILE)).parsed);
  const files = [];
  if (!configShaped) files.push([CONFIG_FILE, renderConfig({ releaseType, extraFiles })]);
  files.push([MANIFEST_FILE, renderManifest(version)]);
  if (integrationModel === 'pr-first') files.push([WORKFLOW_FILE, renderWorkflowYaml({ branch })]);
  // Never overwrite a file this run did not itself create. When the config
  // is genuinely absent (not merely shaped-but-incomplete — detection above
  // already turned a foreign, differently-shaped config into its own
  // conflict before we ever get here), any of the other files already
  // existing on disk is somebody else's file wearing this step's filename,
  // not a partial bootstrap of ours to complete — refuse rather than
  // clobber it. A shaped config with a missing manifest/workflow is the one
  // exception: that IS this step's own partial bootstrap, completed below
  // by writing only what's actually missing.
  const existing = files.filter(([rel]) => lexists(path.join(root, rel)));
  if (!configShaped && existing.length > 0) {
    return { verdict: 'conflict', tool: 'release-please (partial files)', evidence: existing[0][0], ...empty };
  }
  const toWrite = configShaped ? files.filter(([rel]) => !lexists(path.join(root, rel))) : files;
  const realRoot = fs.realpathSync(root);
  const written = [];
  for (const [rel, content] of toWrite) {
    const full = path.join(root, rel);
    if (!dryRun) {
      assertSafeWriteTarget(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const resolvedDir = fs.realpathSync(path.dirname(full));
      if (resolvedDir !== realRoot && !resolvedDir.startsWith(realRoot + path.sep)) {
        throw new Error(`refusing to write through a symlink: ${rel}`);
      }
      try {
        fs.writeFileSync(full, content, { flag: 'wx' });
      } catch (err) {
        // A sibling process created this exact path in the window between
        // the lexists() check above and this write — the same "never
        // overwrite a file this run did not itself create" invariant the
        // pre-write check exists for, closed here at the write itself
        // rather than left as a TOCTOU gap.
        if (err.code === 'EEXIST') {
          return { verdict: 'conflict', tool: 'release-please (partial files)', evidence: rel, written, policyRows: [] };
        }
        throw err;
      }
    }
    written.push(rel);
  }
  const envelope = { verdict: 'fresh', releaseType, version, written, policyRows: renderPolicyRows() };
  if (tagsFailure) envelope.tagsFailure = tagsFailure;
  return envelope;
}

// Refuses to write through a symlink anywhere between root and the target:
// any existing path segment between root and the file's own directory that
// is itself a symlink, or the target file path itself being a symlink. The
// realpath boundary check after mkdirSync (in the caller) is the second,
// belt-and-suspenders half of this — a TOCTOU between this check and the
// write is still closed because mkdirSync/writeFileSync never themselves
// follow a symlink into existence.
function assertSafeWriteTarget(root, rel) {
  const dirRel = path.dirname(rel);
  const segments = dirRel === '.' ? [] : dirRel.split(path.sep);
  let cur = root;
  for (const seg of segments) {
    cur = path.join(cur, seg);
    let st;
    try { st = fs.lstatSync(cur); } catch { continue; } // doesn't exist yet — mkdirSync will create a real directory
    if (st.isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${rel}`);
  }
  const full = path.join(root, rel);
  let targetStat;
  try { targetStat = fs.lstatSync(full); } catch { targetStat = null; }
  if (targetStat && targetStat.isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${rel}`);
}

module.exports = {
  RELEASE_STACK_TABLE, RELEASE_TYPE_VALUES, CONFLICT_MARKERS, CONFIG_FILE, MANIFEST_FILE, WORKFLOW_FILE,
  isBootstrapShaped, detectReleaseProcess, resolveReleaseType, readStackManifestVersion, seedManifestVersion,
  isValidBranchName, renderWorkflowYaml, renderConfig, renderManifest, renderPolicyRows,
  defaultListTags, bootstrapRelease,
};
