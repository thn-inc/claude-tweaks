#!/usr/bin/env node
// bin/release-local.js — the local-merge release engine (#2254, design
// stance 4: pr-first → release-please, local-merge → this CLI, byte-compatible
// artifacts). Reads first-parent conventional commits since the last v* tag,
// derives the semver bump, byte-splices the manifest(s), prepends a
// release-please-grammar CHANGELOG section, commits `chore(release): vX.Y.Z`,
// tags `vX.Y.Z` (annotated), pushes branch + tag when `origin` exists, then
// runs the `release-hook` policy command. run(argv, deps) per
// .claude/skills/gh-api-module-pattern's CLI wrapper contract.
//
//   node plugin/bin/release-local.js [--dry-run] [--root <dir>] [--branch <name>]
//
// Exit codes: 0 released (or the --dry-run plan printed); 1 git/engine
// failure — nothing written, OR a named partial state with a recovery
// command (the commit/tag landed but the push did not; the edits are on disk
// but not committed) — never re-run blind; 2 usage, no
// release-please-config.json (run /claude-tweaks:init first), or a
// malformed/unsupported config; 3 nothing to
// release; 4 version collision (sibling worktree / plan claim); 5 the
// release-hook failed after the tag (and its push) fully landed — the tag is
// final, re-run the hook alone. A `release-hook` policy value of `false`,
// `off`, `none`, or `null` (case-insensitive, after quote stripping) reads
// as unset — a maintainer disabling the hook must not have it run as a
// literal shell command and land here.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { conventionalHistory } = require('./lib/release-local/commits.js');
const { bumpPart } = require('./lib/release-local/bump.js');
const manifest = require('./lib/release-local/manifest.js');
const { renderSection, prependSection, parseGitHubRemote } = require('./lib/release-local/changelog.js');
const { precheck } = require('./lib/release/precheck.js');
const { guardReleasableTree, pushAfterAncestryCheck } = require('./lib/release/run.js');
const { resolvePolicyKeys } = require('./lib/policy-schema.js');

const USAGE = [
  'usage: release-local.js [--dry-run] [--root <dir>] [--branch <name>]',
  'exit 0 released (or dry-run plan printed); 1 git/engine failure — nothing written, or a NAMED PARTIAL STATE with a recovery command;',
  '     2 usage, no release-please-config.json (run /claude-tweaks:init first), or a malformed/unsupported config; 3 nothing to release; 4 version collision;',
  '     5 release-hook failed after the tag (and push) landed — re-run the hook alone',
].join('\n');
const VALUE_FLAGS = new Set(['--root', '--branch']);
const POLICY_FILE = '.claude-tweaks/policy.yml';

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { dryRun: false, branch: null, root: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--dry-run') { opts.dryRun = true; continue; }
    if (VALUE_FLAGS.has(a)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return { error: `${a} requires a value` };
      i += 1;
      if (a === '--root') opts.root = next; else opts.branch = next;
      continue;
    }
    return { error: `unknown argument: ${a}` };
  }
  return opts;
}

// A release-hook value spelling "disabled" — a maintainer's explicit opt-out,
// never a literal command name (running `false`/`off`/etc. as a shell command
// would exit non-zero and misreport as a failed hook).
const RELEASE_HOOK_UNSET_RE = /^(false|off|none|null)$/i;

function policyValue(policyRaw, key) {
  const resolved = resolvePolicyKeys([key], { policyRaw, runConfigRaw: null })[key];
  const value = resolved && resolved.value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (key === 'release-hook' && RELEASE_HOOK_UNSET_RE.test(trimmed)) return null;
  return trimmed;
}

// Only "there is no origin" reads as no origin. Any other git failure here (a
// broken config, a permissions error) propagates rather than silently
// downgrading the run to the no-origin path, which would skip the push.
const NO_ORIGIN_RE = /No such remote|not a git repository|does not appear to be a git repository/i;

function remoteUrl(deps) {
  try {
    return deps.git(['remote', 'get-url', 'origin']).trim() || null;
  } catch (err) {
    if (NO_ORIGIN_RE.test(String((err && err.message) || err))) return null;
    throw err;
  }
}

function planLines({ version, part, history, hook, edits, unconventional }) {
  const counts = { feat: 0, fix: 0, breaking: 0 };
  for (const c of history.commits) {
    if (c.breaking) counts.breaking += 1;
    if (c.type === 'feat') counts.feat += 1;
    if (c.type === 'fix') counts.fix += 1;
  }
  const lines = [
    `release-local: v${version} (${part}) from ${history.lastTag || 'no prior tag'} — ${history.commits.length} commit(s): ${counts.feat} feat, ${counts.fix} fix, ${counts.breaking} breaking`,
    `hook: ${hook || 'no hook configured'}`,
    `manifest: ${edits.length ? edits.join(', ') : 'none (tag only)'}`,
  ];
  if (unconventional.length) {
    lines.push(`unconventional (${unconventional.length}):`);
    for (const c of unconventional) lines.push(`  ${c.sha.slice(0, 7)} ${c.subject}`);
  }
  return lines;
}

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(`${opts.error}\n${USAGE}\n`); return 2; }
  if (opts.help) { deps.stdout(`${USAGE}\n`); return 0; }

  // Stage tracks what is already on disk / in git so a failure names the
  // exact partial state and its recovery command (run.js's "do NOT re-run").
  let stage = 'planning';
  let version = null;
  let branch = null;
  let editedPaths = [];
  // Subset of editedPaths that did not exist before the run — recovery deletes
  // those rather than restoring them (there is nothing to restore them from).
  let createdPaths = [];
  let hook = null;
  let hasOrigin = false;
  // Whether origin already carried <branch> when the run started — the recovery
  // for a failed FIRST push must not name an origin/<branch> that cannot exist.
  let remoteBranchExists = false;
  try {
    const policyRaw = deps.readFile(POLICY_FILE);
    const config = manifest.readConfig(deps.readFile);
    if (!config) throw new UsageError(`${manifest.CONFIG_FILE} not found — run /claude-tweaks:init to bootstrap the release process first`);
    branch = opts.branch || policyValue(policyRaw, 'integration-branch') || 'main';
    guardReleasableTree(deps, { branch });
    const originRemote = remoteUrl(deps);
    hasOrigin = originRemote !== null;
    // A remote whose <branch> was never pushed has no origin/<branch>: precheck's
    // fetch would die with "couldn't find remote ref" on an otherwise valid first
    // release. Probe once and treat it as origin-less for reading, not for pushing.
    remoteBranchExists = hasOrigin && deps.git(['ls-remote', '--heads', 'origin', branch]).trim() !== '';

    const history = conventionalHistory(deps.git);
    const part = bumpPart(history.commits);
    if (part === 'none') {
      deps.stdout(`nothing to release: ${history.commits.length} commit(s) since ${history.lastTag || 'the first commit'}, none feat/fix/breaking\n`);
      return 3;
    }
    const targets = manifest.resolveTargets(config);
    const current = manifest.currentVersion(targets, deps.readFile);
    const check = precheck(deps, part, {
      keySource: 'tags', branch, hasOrigin: remoteBranchExists,
      versionAtRef: (ref) => manifest.versionAtRef(targets, (p) => deps.git(['show', `${ref}:${p}`])),
    });
    version = check.candidate;
    if (!check.result.ok) {
      const lines = check.result.conflicts.map((c) => `  - ${c.source}: ${c.detail} claims v${c.version}`);
      deps.stderr(`version collision on v${version}:\n${lines.join('\n')}\nSuggested renumber: v${check.result.suggested}. Resolve and re-run.\n`);
      return 4;
    }
    hook = policyValue(policyRaw, 'release-hook');
    const repo = hasOrigin ? parseGitHubRemote(originRemote) : null;
    const section = renderSection({ version, previousTag: history.lastTag, date: deps.today(), commits: history.commits, repo });
    const unconventional = history.commits.filter((c) => c.unconventional);
    const edits = manifest.plannedWrites(targets, version, deps.readFile);
    for (const line of planLines({ version, part, history, hook, edits, unconventional })) deps.stdout(`${line}\n`);
    if (hasOrigin && !remoteBranchExists) deps.stdout(`origin: ${branch} is not on origin yet — first push\n`);
    if (history.lastTag && current && current !== history.lastTag.replace(/^v/, '')) {
      deps.stdout(`manifest-drift: manifest says ${current}, last tag is ${history.lastTag} — the tag is the version of record\n`);
    }
    deps.stdout(`\n${section}\n`);
    if (opts.dryRun) { deps.stdout(`[dry-run] v${version} — no changes written\n`); return 0; }

    stage = 'editing';
    // Every write is recorded as it lands, so a throw part-way through
    // applyVersion still leaves editedPaths naming exactly what is on disk
    // (ruling 11: the recovery command must list the real partial state).
    const trackedWrite = (p, text) => {
      const before = deps.readFile(p);
      deps.writeFile(p, text);
      editedPaths.push(p);
      if (before === null || before === undefined) createdPaths.push(p);
    };
    manifest.applyVersion(targets, version, deps.readFile, trackedWrite);
    trackedWrite('CHANGELOG.md', prependSection(deps.readFile('CHANGELOG.md'), section));
    deps.git(['add', '--', ...editedPaths]);
    deps.git(['commit', '-m', `chore(release): v${version}`]);
    stage = 'committed';
    deps.git(['tag', '-a', `v${version}`, '-m', `v${version}`]);
    stage = 'tagged';
    if (hasOrigin) {
      pushAfterAncestryCheck(deps, { branch, refs: [branch, `v${version}`], remoteBranchExists, onDiverged: `origin/${branch} moved between pre-check and push` });
      stage = 'pushed';
    }
    if (hook) {
      const code = deps.runHook(hook);
      if (code !== 0) {
        deps.stderr(`partial: v${version} is committed, tagged${hasOrigin ? ' and pushed' : ''}; the release-hook exited ${code}. ` +
          `Do NOT re-run release-local (the tag is final). Recover: re-run the hook alone: ${hook}\n`);
        return 5;
      }
    }
    deps.stdout(`released v${version}\n`);
    return 0;
  } catch (err) {
    const message = String((err && err.message) || err);
    if (err instanceof UsageError) { deps.stderr(`${message}\n${USAGE}\n`); return 2; }
    // A ManifestError before any write is a bad release-please-config.json —
    // malformed, an unknown/unsupported release-type, an unsupported extra-files
    // entry. That is a usage problem the operator fixes, not a git failure.
    if (err instanceof manifest.ManifestError && stage === 'planning') { deps.stderr(`${message}\n${USAGE}\n`); return 2; }
    if (stage === 'planning') { deps.stderr(`release-local: ${message} — nothing written\n`); return 1; }
    if (stage === 'editing') {
      if (editedPaths.length === 0) { deps.stderr(`release-local: ${message} — nothing written\n`); return 1; }
      // `git checkout --` restores from the index, so anything already `git add`ed
      // would stay staged at its bumped value; `git restore --staged --worktree`
      // undoes both. A file this run created has no pre-image to restore — remove it.
      const modified = editedPaths.filter((p) => !createdPaths.includes(p));
      const clauses = [];
      if (modified.length) clauses.push(`git restore --staged --worktree -- ${modified.join(' ')}`);
      if (createdPaths.length) clauses.push(`rm ${createdPaths.join(' ')}`);
      deps.stderr(`partial: ${editedPaths.join(', ')} edited on disk but NOT committed (${message}). ` +
        `Do NOT re-run release-local. Recover: ${clauses.join(' && ')}\n`);
      return 1;
    }
    if (stage === 'pushed' || (stage === 'tagged' && !hasOrigin)) {
      // Only deps.runHook can throw here — the tag (and push) are final.
      deps.stderr(`partial: v${version} is committed, tagged${hasOrigin ? ' and pushed' : ''}; the release-hook threw (${message}). ` +
        `Do NOT re-run release-local (the tag is final). Recover: re-run the hook alone: ${hook}\n`);
      return 5;
    }
    if (stage === 'committed') {
      deps.stderr(`partial: the chore(release): v${version} commit landed but the tag did NOT (${message}). ` +
        `Do NOT re-run release-local (it would bump again). Recover: git tag -a v${version} -m v${version}${hasOrigin ? ` && git push origin ${branch} v${version}` : ''}${hook ? `, then run the hook: ${hook}` : ''}\n`);
      return 1;
    }
    // The rebase rewrites the chore(release) commit, so the annotated tag would keep
    // pointing at the pre-rebase object and publish an orphan — re-tag after the
    // rebase and force-publish the tag (never `git pull --rebase` + a plain push).
    // A FIRST push has no origin/<branch> to fetch or rebase onto: retry it plain.
    const recovery = remoteBranchExists
      ? `git fetch origin ${branch} && git rebase origin/${branch} && git tag -f -a v${version} -m v${version} && ` +
        `git push origin ${branch} && git push --force origin v${version}`
      : `git push origin ${branch} v${version}`;
    deps.stderr(`partial: v${version} is committed and tagged locally but NOT pushed (${message}). ` +
      `Do NOT re-run release-local (it would bump again). Recover: ${recovery}${hook ? `, then run the hook: ${hook}` : ''}\n`);
    return 1;
  }
}

// Every path the engine writes comes from committed repo content
// (release-please-config.json's extra-files, the stack manifest names), so a
// planted symlink is an ordinary PR away — the IL-150 class: decide on the
// real path, never the literal one. The parent directory is realpath-resolved
// and must sit inside the real root; the leaf is opened with O_NOFOLLOW so a
// symlinked file is refused at the kernel (no lstat-then-write window).
function writeInsideRoot(root, p, text) {
  const target = path.join(root, p);
  const realRoot = fs.realpathSync(root);
  let realDir;
  try {
    realDir = fs.realpathSync(path.dirname(target));
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`refusing to write ${p}: its directory does not exist`);
    throw e;
  }
  if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) {
    throw new Error(`refusing to write ${p}: its real location ${realDir} is outside the repo root`);
  }
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW } = fs.constants;
  let fd;
  try {
    fd = fs.openSync(path.join(realDir, path.basename(target)), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o644);
  } catch (e) {
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw new Error(`refusing to write ${p}: it is a symlink`);
    throw e;
  }
  try { fs.writeFileSync(fd, text); } finally { fs.closeSync(fd); }
}

function defaultDeps(root) {
  const abs = (p) => path.join(root, p);
  return {
    git: (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    readFile: (p) => { try { return fs.readFileSync(abs(p), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    writeFile: (p, text) => writeInsideRoot(root, p, text),
    // precheck's plan-claim source, as plugin/bin/release.js provides it: a
    // project without docs/superpowers/plans simply has no plan claims. Read
    // and catch rather than exists-then-read — a sibling session can prune the
    // directory between the two calls ([IL-146]); a vanished directory is "no
    // plan claims", anything else propagates.
    listPlanFiles: () => {
      let entries;
      try {
        entries = fs.readdirSync(abs('docs/superpowers/plans'));
      } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
        throw e;
      }
      return entries.filter((f) => f.endsWith('.md')).map((f) => path.join('docs/superpowers/plans', f));
    },
    // The hook is the project's own shell command (policy release-hook) — a
    // shell string by design; its exit code becomes this CLI's exit 5.
    runHook: (cmd) => { const r = spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit' }); return r.status === null ? 1 : r.status; },
    today: () => new Date().toISOString().slice(0, 10),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  };
}

function main(argv) {
  const opts = parseArgs(argv);
  const root = opts.root ? path.resolve(opts.root) : process.cwd();
  let stat;
  try { stat = fs.statSync(root); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) { process.stderr.write(`root is not a directory: ${root}\n${USAGE}\n`); return 2; }
  return run(argv, defaultDeps(root));
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { run, parseArgs, defaultDeps, writeInsideRoot, USAGE };
