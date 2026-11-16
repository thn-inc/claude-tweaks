#!/usr/bin/env node
'use strict';
// tools/skill-gate-replay.js — record #5605: replays the skill-load gate (plugin/bin/lib/skill-gate) over
// every work commit merged to a ref in a date window, using each commit's own changed files (no surface),
// and prints how many commits the gate would skip and how many would proceed, per skill and mode.
//
//   node tools/skill-gate-replay.js [--repo <dir>] [--ref <ref>] [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>]
//
// Defaults: --repo the cwd; --ref origin/main, else main; --since 30 days before today; --until today.
// Work commits are `git log --first-parent` of the ref; subjects starting `[reconcile]` or
// `chore(main): release` are not work and are excluded.
//
// Output, one JSON object: { ref, since, until, commits, results: { "<skill>[ <mode>]": { skip, proceed } },
//   journeysWrongSkips, journeysSkipsWithoutJourneyGuard, journeysWrongSkipsWithoutJourneyGuard }
//   journeysWrongSkips   commits where `journeys` skipped and a changed file is under docs/journeys/
//                        (structurally 0: the rule proceeds on any such file).
//   journeysSkipsWithoutJourneyGuard  commits the other two conditions alone (every changed file in the
//                        no-surface set; no changed file listed in a journey's `files:`) would skip, with the
//                        docs/journeys/ condition switched off; journeysWrongSkipsWithoutJourneyGuard counts
//                        those that changed a file under docs/journeys/.
//
// Exit codes: 0 success; 2 malformed invocation or a ref that does not resolve.
// Seam: replay({ repo, ref, since, until, execImpl }) — execImpl(args) returns git's stdout as a string.

const { execFileSync } = require('node:child_process');
const {
  decide, SKILLS, WRAPPER_MODES, isJourneyPath, inNoSurfaceSet, journeyEntryMatch, parseJourneyText,
} = require('../plugin/bin/lib/skill-gate');
const { readDesignIntegrationFlag } = require('../plugin/bin/lib/design-detect');

const USAGE = 'usage: node tools/skill-gate-replay.js [--repo <dir>] [--ref <ref>] [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>]';
const NOT_WORK = [/^\[reconcile\]/, /^chore\(main\): release/];
const DAY_MS = 86400e3;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function gitEnv() {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[k];
  return env;
}

function defaultExec(repo) {
  const env = gitEnv();
  return (args) => execFileSync('git', args, {
    cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 256 * 1024 * 1024,
  });
}

function splitNul(out) {
  const parts = out.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function tryExec(exec, args) {
  try {
    return exec(args);
  } catch {
    return null;
  }
}

function resolveRef(exec, ref) {
  const candidates = ref ? [ref] : ['origin/main', 'main'];
  for (const c of candidates) {
    if (tryExec(exec, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${c}^{commit}`]) !== null) return c;
  }
  throw new Error(`ref ${candidates.join(' or ')} does not resolve`);
}

function workCommits(exec, ref, since, until) {
  const parts = splitNul(exec([
    'log', '--first-parent', '--format=%H%x00%s', '-z', `--since=${since}`, `--until=${until}`, '--end-of-options', ref,
  ]));
  const commits = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (!NOT_WORK.some((re) => re.test(parts[i + 1]))) commits.push(parts[i]);
  }
  return commits;
}

function changedFiles(exec, sha) {
  return splitNul(exec([
    'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '-m', '--first-parent', '--root', '--end-of-options', sha,
  ]));
}

// Top-level docs/journeys/*.md at `sha`, parsed; `{ error }` when one cannot be read or parsed.
function journeysAt(exec, sha) {
  const listed = tryExec(exec, ['ls-tree', '-z', '--name-only', '--end-of-options', sha, '--', 'docs/journeys/']);
  if (listed === null) return { journeys: [] };
  const journeys = [];
  for (const p of splitNul(listed).filter((f) => f.split('/').length === 3 && f.endsWith('.md')).sort()) {
    const text = tryExec(exec, ['show', `${sha}:${p}`]);
    if (text === null) return { error: `journey ${p} could not be read` };
    const parsed = parseJourneyText(text);
    if (parsed.error) return { error: `journey ${p}: ${parsed.error}` };
    journeys.push({ name: p.slice('docs/journeys/'.length, -'.md'.length), files: parsed.files });
  }
  return { journeys };
}

// The journeys rule with its docs/journeys/ condition off: would the no-surface and `files:` conditions
// alone skip this commit?
function skipsWithoutJourneyGuard(files, loaded) {
  if (files.length === 0 || !files.every((f) => inNoSurfaceSet(f))) return false;
  if (!loaded.journeys) return false;
  for (const j of loaded.journeys) {
    for (const entry of Array.isArray(j.files) ? j.files : []) {
      if (files.some((f) => journeyEntryMatch(entry, f) !== 'no-match')) return false;
    }
  }
  return true;
}

function replay({ repo = process.cwd(), ref, since, until, execImpl } = {}) {
  const exec = execImpl || defaultExec(repo);
  const today = new Date();
  const untilDate = until || today.toISOString().slice(0, 10);
  const sinceDate = since || new Date(today.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
  const resolvedRef = resolveRef(exec, ref);
  const commits = workCommits(exec, resolvedRef, sinceDate, untilDate);

  const keys = [];
  for (const skill of SKILLS) {
    if (skill === 'design-wrapper') WRAPPER_MODES.forEach((m) => keys.push({ skill, mode: m, label: `${skill} ${m}` }));
    else keys.push({ skill, label: skill });
  }
  const results = Object.fromEntries(keys.map((k) => [k.label, { skip: 0, proceed: 0 }]));
  let journeysWrongSkips = 0;
  let guardOffSkips = 0;
  let guardOffWrong = 0;

  for (const sha of commits) {
    const files = changedFiles(exec, sha);
    const claudeMd = tryExec(exec, ['show', `${sha}:CLAUDE.md`]);
    const designIntegration = claudeMd === null ? null : readDesignIntegrationFlag(claudeMd);
    const loaded = journeysAt(exec, sha);
    const loadJourneys = () => loaded;
    for (const k of keys) {
      const r = decide({ skill: k.skill, mode: k.mode, files, designIntegration, loadJourneys });
      results[k.label][r.decision] += 1;
      if (k.skill === 'journeys' && r.decision === 'skip' && files.some(isJourneyPath)) journeysWrongSkips += 1;
    }
    if (skipsWithoutJourneyGuard(files, loaded)) {
      guardOffSkips += 1;
      if (files.some(isJourneyPath)) guardOffWrong += 1;
    }
  }

  return {
    ref: resolvedRef,
    since: sinceDate,
    until: untilDate,
    commits: commits.length,
    results,
    journeysWrongSkips,
    journeysSkipsWithoutJourneyGuard: guardOffSkips,
    journeysWrongSkipsWithoutJourneyGuard: guardOffWrong,
  };
}

function parseArgs(argv) {
  const opts = {};
  const flags = { '--repo': 'repo', '--ref': 'ref', '--since': 'since', '--until': 'until' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = flags[argv[i]];
    if (!key || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) return null;
    opts[key] = argv[i + 1];
  }
  for (const d of [opts.since, opts.until]) if (d !== undefined && !DATE.test(d)) return null;
  return opts;
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const opts = parseArgs(argv);
  if (!opts) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  try {
    process.stdout.write(`${JSON.stringify(replay(opts), null, 2)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`skill-gate-replay: ${e.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { replay, main };
