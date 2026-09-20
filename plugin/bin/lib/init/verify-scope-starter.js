// plugin/bin/lib/init/verify-scope-starter.js — /claude-tweaks:init's starter
// .claude-tweaks/verify-scope.json (#1924): detect the workspace, propose one
// suite per test-bearing package, map shared packages to every suite and the
// pipeline's own bookkeeping paths to nothing, and report suite/workspace
// drift for `init --update`. Conservative by construction — a path is its
// package's own tree, shared, bookkeeping, or unmatched (which the engine
// fails closed to full; scope.js). Pure: every fs read goes through fsImpl.
// A `dir/**` glob walks recursively (bounded to MAX_WALK_DEPTH,
// node_modules/.git/dot-dirs skipped) for every nested package.json, distinct
// from `dir/*`'s direct children (which skip the same node_modules/.git/dot-
// dirs); a `.`/`./` member is always skipped (its tree is the whole repo). A
// glob beginning with `!` is an exclusion pattern the starter does not
// implement — it is never expanded, only surfaced in `skipped`, except the
// literal-dir shape (`!packages/legacy`), which is honored by dropping that
// exact path from the result. detectWorkspace also returns `skipped` — per
// parse-signal-discipline, a glob that expanded to zero directories, a glob
// whose recursive walk was cut off by MAX_WALK_DEPTH before it finished, a
// directory with no or unparseable package.json (the root's included), a
// package.json with no string `name`, a name or path that is not shell-safe,
// a symlinked entry (never followed), or an unsupported `!` exclusion are
// distinguishable from "this workspace legitimately has nothing here":
// they're surfaced, not silently dropped into the same empty result. A single-package repo with no
// workspace but a root `test` script still falls back to that script's
// string form (composeStarter), and diffAgainstWorkspace treats that
// string-form `suites: ['tests']` sentinel as non-extra when no package is
// actually named `tests`.
'use strict';

const fs = require('fs');
const path = require('path');

// The pipeline-owned paths no suite reads (ledger rows, run dirs, consumed
// plans and design docs). Always emitted; never a source path.
const BOOKKEEPING_RULES = [
  'docs/plans/*-ledger.md',
  '.claude-tweaks/pipelines/**',
  'docs/superpowers/plans/**',
  'docs/superpowers/specs/**',
];

// Read-and-catch, never exists-then-read: a file that vanishes or loses
// permission between the two calls is "absent" here, not an uncaught throw
// (docs/donts.md's TOCTOU rule; sibling sessions prune concurrently).
function readText(fsImpl, file) {
  try { return String(fsImpl.readFileSync(file, 'utf8')); } catch { return null; }
}

// A package name outside npm's own grammar, or a member path with anything
// beyond path characters, is never interpolated into a suite command —
// suiteCommand's output runs through a shell verbatim (verify/run.js).
const SAFE_PACKAGE_NAME = /^(@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i;
const SAFE_PACKAGE_PATH = /^[A-Za-z0-9@._-]+(\/[A-Za-z0-9@._-]+)*$/;

function exists(fsImpl, file) {
  try { return fsImpl.existsSync(file); } catch { return false; }
}

// pnpm-workspace.yaml is a two-key file; read the `packages:` list with a line
// regex (the policy.yml posture) rather than a YAML dependency.
function pnpmGlobs(text) {
  const globs = [];
  let inList = false;
  for (const line of text.split('\n')) {
    if (/^packages:\s*$/.test(line)) { inList = true; continue; }
    if (inList && /^\s*(#.*)?$/.test(line)) continue;
    if (inList && /^\S/.test(line)) break;
    if (!inList) continue;
    const m = line.match(/^\s*-\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[1];
    const quote = value[0];
    if (quote === "'" || quote === '"') {
      // A `#` inside the quoted value is content, not a comment — take
      // everything between the opening quote and its matching close.
      const close = value.indexOf(quote, 1);
      if (close === -1) continue;
      value = value.slice(1, close);
    } else {
      // Unquoted: only a `#` preceded by whitespace is a trailing comment.
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (value) globs.push(value);
  }
  return globs;
}

const MAX_WALK_DEPTH = 6;

// Recursively collect every directory (relative to root) that holds a
// package.json, starting at relDir itself, bounded to MAX_WALK_DEPTH levels
// below it and skipping node_modules/.git/dot-dirs. limitHit is a shared
// mutable {hit} record: set true the moment the walk is cut off by the
// depth bound, so the caller can report that packages beyond it may exist
// unscanned rather than reading a shallow result as exhaustive.
function walkForPackageDirs(fsImpl, root, relDir, depth, found, limitHit, symlinks) {
  if (exists(fsImpl, path.join(root, relDir, 'package.json'))) found.push(relDir.replace(/\\/g, '/'));
  if (depth >= MAX_WALK_DEPTH) { limitHit.hit = true; return; }
  let entries;
  try { entries = fsImpl.readdirSync(path.join(root, relDir), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isSymbolicLink()) { symlinks.push(`${relDir}/${e.name}`); continue; }
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
    walkForPackageDirs(fsImpl, root, `${relDir}/${e.name}`, depth + 1, found, limitHit, symlinks);
  }
}

// True for a glob whose member is the repo root itself (`.`, `./`, or a
// `**` rooted at it) — its tree is the whole repo, never one member among
// others, so it is skipped entirely rather than expanded or diagnosed as
// "no packages under glob" (that reason is for a glob that legitimately
// tried and found nothing, not this deliberate no-op).
function isRootGlobMember(glob) {
  const clean = glob.replace(/\/+$/, '');
  if (clean === '.' || clean === '') return true;
  if (clean.endsWith('/**')) {
    const parent = clean.slice(0, -3);
    return parent === '.' || parent === '';
  }
  return false;
}

// A literal dir, a trailing `/*` expanded to its direct children, or a
// trailing `/**` walked recursively for every nested package.json (bounded,
// dir/node_modules/.git/dot-dirs skipped). A `.`/`./` member — the repo root
// itself — is always skipped: its tree is the whole repo, never one member
// among others. Anything else with a `*` is ignored — the starter proposes,
// it never guesses. Returns `{dirs, limitHit, symlinks}`: limitHit is only
// ever true for a `/**` walk cut off by MAX_WALK_DEPTH; symlinks lists the
// entries neither shape follows (a symlinked member is surfaced, not
// silently dropped — the walk never leaves the tree it was given).
function expandGlob(fsImpl, root, glob) {
  const none = { dirs: [], limitHit: false, symlinks: [] };
  if (isRootGlobMember(glob)) return none;
  const clean = glob.replace(/\/+$/, '');
  if (clean.endsWith('/**')) {
    const parent = clean.slice(0, -3);
    const found = [];
    const symlinks = [];
    const limitHit = { hit: false };
    walkForPackageDirs(fsImpl, root, parent, 0, found, limitHit, symlinks);
    return { dirs: found.sort(), limitHit: limitHit.hit, symlinks };
  }
  if (clean.endsWith('/*')) {
    const parent = clean.slice(0, -2);
    let entries;
    try { entries = fsImpl.readdirSync(path.join(root, parent), { withFileTypes: true }); } catch { return none; }
    const symlinks = entries.filter((e) => e.isSymbolicLink()).map((e) => `${parent}/${e.name}`);
    const dirs = entries
      .filter((e) => !e.isSymbolicLink() && e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git' && !e.name.startsWith('.'))
      .map((e) => `${parent}/${e.name}`);
    return { dirs, limitHit: false, symlinks };
  }
  if (clean.includes('*')) return none;
  return { dirs: [clean], limitHit: false, symlinks: [] };
}

// Distinguishes "no package.json here" from "package.json exists but is not
// valid JSON" from "valid JSON but no string name" — three different reasons
// a directory contributes no package, none of which is "this glob correctly
// has nothing" (parse-signal-discipline: a merged null would hide all three).
function readPackageAt(fsImpl, root, rel) {
  let text;
  try { text = fsImpl.readFileSync(path.join(root, rel, 'package.json'), 'utf8'); } catch { return { reason: 'no package.json' }; }
  let pkg;
  try { pkg = JSON.parse(text); } catch { return { reason: 'unparseable package.json' }; }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg) || typeof pkg.name !== 'string') return { reason: 'package.json has no name' };
  return { pkg };
}

function detectWorkspace({ root, fsImpl = fs }) {
  let tool = null;
  let globs = [];
  const packages = [];
  const skipped = [];
  const exclusions = [];
  // The root package.json is read exactly once, here, for both its
  // `workspaces` (below) and its `scripts` (returned as rootScripts for
  // composeStarter) — same three-way split as readPackageAt: absent,
  // unparseable, and parseable are different reasons, and only the middle
  // one is worth a skipped entry.
  const rootText = readText(fsImpl, path.join(root, 'package.json'));
  let rootPkg = null;
  if (rootText !== null) {
    try { rootPkg = JSON.parse(rootText); } catch { skipped.push({ path: 'package.json', reason: 'unparseable package.json' }); }
  }
  const rootScripts = rootPkg && rootPkg.scripts && typeof rootPkg.scripts === 'object' ? rootPkg.scripts : {};
  const pnpmText = readText(fsImpl, path.join(root, 'pnpm-workspace.yaml'));
  if (pnpmText !== null) {
    tool = 'pnpm';
    globs = pnpmGlobs(pnpmText);
  } else {
    const ws = rootPkg && rootPkg.workspaces;
    let list = null;
    if (Array.isArray(ws)) list = ws;
    else if (ws && Array.isArray(ws.packages)) list = ws.packages;
    if (list) {
      tool = exists(fsImpl, path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';
      globs = list;
    }
  }
  for (const glob of globs) {
    if (isRootGlobMember(glob)) continue;
    if (glob.startsWith('!')) {
      skipped.push({ glob, reason: 'unsupported exclusion pattern — packages it excludes may still be proposed' });
      exclusions.push(glob.slice(1));
      continue;
    }
    const expanded = expandGlob(fsImpl, root, glob);
    for (const link of expanded.symlinks) skipped.push({ path: link, reason: 'symlinked entry not followed' });
    if (expanded.limitHit) {
      skipped.push({ glob, reason: `walk depth limit reached (${MAX_WALK_DEPTH}) — deeper packages not scanned` });
    } else if (expanded.dirs.length === 0) {
      skipped.push({ glob, reason: 'no packages under glob' });
      continue;
    }
    for (const rel of expanded.dirs) {
      const { pkg, reason } = readPackageAt(fsImpl, root, rel);
      const relPath = rel.replace(/\\/g, '/');
      if (reason) { skipped.push({ path: relPath, reason }); continue; }
      if (!SAFE_PACKAGE_NAME.test(pkg.name) || !SAFE_PACKAGE_PATH.test(relPath)) {
        skipped.push({ path: relPath, reason: 'package name or path is not shell-safe — not proposed as a suite' });
        continue;
      }
      const test = pkg.scripts && pkg.scripts.test;
      packages.push({
        name: pkg.name,
        path: relPath,
        hasTest: typeof test === 'string' && test.trim() !== '',
        dependencies: Object.keys(pkg.dependencies || {}),
      });
    }
  }
  // The literal-dir exclusion shape (`!packages/legacy`) is honored by
  // dropping that exact path; a wildcard exclusion is surfaced above but
  // otherwise left alone — the starter proposes, it never guesses.
  const filtered = exclusions.length ? packages.filter((p) => !exclusions.includes(p.path)) : packages;
  return { tool, packages: filtered, skipped, rootScripts };
}

function suiteCommand(tool, pkg) {
  if (tool === 'yarn') return `yarn workspace ${pkg.name} test`;
  if (tool === 'npm') return `npm test -w ${pkg.path}`;
  return `pnpm --filter ${pkg.name} test`;
}

function composeStarter({ workspace, rootScripts = workspace.rootScripts || {}, bookkeeping = BOOKKEEPING_RULES }) {
  const checks = {};
  const script = (k) => (typeof rootScripts[k] === 'string' && rootScripts[k].trim() !== '' ? rootScripts[k] : null);
  const typecheckScript = script('typecheck');
  const lintScript = script('lint');
  const testScript = script('test');
  if (typecheckScript) checks.types = typecheckScript;
  if (lintScript) checks.lint = lintScript;
  const rules = [];
  const packages = workspace && Array.isArray(workspace.packages) ? workspace.packages : [];
  if (packages.length > 0) {
    const tested = packages.filter((p) => p.hasTest);
    if (tested.length) checks.tests = Object.fromEntries(tested.map((p) => [p.name, suiteCommand(workspace.tool, p)]));
    else if (testScript) checks.tests = testScript;
    const dependedOn = new Set(packages.flatMap((p) => p.dependencies));
    for (const p of packages) {
      if (dependedOn.has(p.name)) rules.push({ match: `${p.path}/**`, suites: '*', static: true });
      else if (p.hasTest) rules.push({ match: `${p.path}/**`, suites: [p.name], static: true });
    }
  } else if (testScript) {
    checks.tests = testScript;
  }
  for (const match of bookkeeping) rules.push({ match, suites: [], static: false });
  return { checks, rules };
}

// decl is readDeclaration's normalized shape (decl.suites). A string-form
// checks.tests declares the single suite `tests`, which matches no package —
// that sentinel is never reported as an extra suite unless some package is
// actually (confusingly) named `tests`.
function diffAgainstWorkspace(decl, workspace) {
  const packages = workspace && Array.isArray(workspace.packages) ? workspace.packages : [];
  const names = new Set(packages.map((p) => p.name));
  const declSuites = decl && Array.isArray(decl.suites) ? decl.suites : [];
  const isStringFormSentinel = declSuites.length === 1 && declSuites[0] === 'tests' && !names.has('tests');
  const suites = new Set(declSuites);
  const missingSuites = packages.filter((p) => p.hasTest && !suites.has(p.name)).map((p) => p.name);
  const extraSuites = isStringFormSentinel ? [] : [...suites].filter((s) => !names.has(s) && packages.length > 0);
  return { missingSuites, extraSuites };
}

module.exports = {
  detectWorkspace, composeStarter, diffAgainstWorkspace, BOOKKEEPING_RULES,
};
