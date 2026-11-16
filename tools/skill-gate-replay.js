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
// Cost: a fixed handful of git processes whatever the window holds. One `git log --name-only` gives the
// commits and their changed files; `git cat-file --batch-check` maps every commit to its CLAUDE.md blob and
// docs/journeys tree id; each unique blob is read once (`cat-file --batch`) and each unique journeys tree is
// listed and parsed only when a rule asks for the journeys (decide's loadJourneys is lazy).
//
// Exit codes: 0 success; 2 malformed invocation or a ref that does not resolve.
// Seam: replay({ repo, ref, since, until, execImpl }) — execImpl(args, { input, latin1 }) returns git's stdout.

const { execFileSync } = require('node:child_process');
const {
  decide, SKILLS, WRAPPER_MODES, isJourneyPath, inNoSurfaceSet, journeyEntryMatch, pathShapeProblem, parseJourneyText,
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
  return (args, { input, latin1 } = {}) => execFileSync('git', args, {
    cwd: repo, env, encoding: latin1 ? 'latin1' : 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true, maxBuffer: 1024 * 1024 * 1024,
  });
}

function splitNul(out) {
  const parts = out.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function resolveRef(exec, ref) {
  const candidates = ref ? [ref] : ['origin/main', 'main'];
  for (const c of candidates) {
    try {
      exec(['rev-parse', '--verify', '--quiet', '--end-of-options', `${c}^{commit}`]);
      return c;
    } catch { /* try the next candidate */ }
  }
  throw new Error(`ref ${candidates.join(' or ')} does not resolve`);
}

// [{ sha, files }] for the work commits, from one `git log --name-only -z`. A record is
// `\x01<sha>\0<subject>\0\n<file>\0<file>\0…`; a merge shows its diff against its first parent.
function workCommits(exec, ref, since, until) {
  const out = exec([
    '-c', 'log.showRoot=true', 'log', '--first-parent', '-m', '--name-only', '-z', '--format=%x01%H%x00%s',
    `--since=${since}`, `--until=${until}`, '--end-of-options', ref,
  ]);
  const commits = [];
  for (const block of out.split('\x01').slice(1)) {
    const [sha, subject, ...rest] = block.split('\0');
    if (NOT_WORK.some((re) => re.test(subject))) continue;
    if (rest.length > 0) rest[0] = rest[0].replace(/^\n/, '');
    commits.push({ sha, files: rest.filter((f) => f !== '') });
  }
  return commits;
}

// Object ids for `<sha>:<path>` specs, one `cat-file --batch-check` process; null where the path is absent
// or is not an object of `wantType` (a symlinked docs/journeys reads as no journeys).
function objectIds(exec, specs, wantType) {
  if (specs.length === 0) return [];
  const lines = exec(['cat-file', '--batch-check=%(objectname) %(objecttype)'], { input: `${specs.join('\n')}\n` })
    .split('\n');
  return specs.map((_, i) => {
    const [id, type] = (lines[i] || '').split(' ');
    return type === wantType && /^[0-9a-f]{40,64}$/.test(id) ? id : null;
  });
}

// Texts of blobs by id, one `cat-file --batch` process. latin1 keeps one char per byte so the size header
// indexes the stream; the text is decoded to utf8 afterwards.
function readBlobs(exec, ids) {
  const texts = new Map();
  if (ids.length === 0) return texts;
  const out = exec(['cat-file', '--batch'], { input: `${ids.join('\n')}\n`, latin1: true });
  let pos = 0;
  for (const id of ids) {
    const eol = out.indexOf('\n', pos);
    const [, type, size] = out.slice(pos, eol).split(' ');
    if (type === 'missing') { pos = eol + 1; continue; }
    const start = eol + 1;
    texts.set(id, Buffer.from(out.slice(start, start + Number(size)), 'latin1').toString('utf8'));
    pos = start + Number(size) + 1;
  }
  return texts;
}

// The journeys of one docs/journeys tree (top-level .md only), cached by tree id; blobs parsed once each.
function makeJourneyLoader(exec) {
  const byTree = new Map();
  const byBlob = new Map();
  const stats = { treeReads: 0 };
  function load(treeId) {
    if (treeId === null) return { journeys: [] };
    if (byTree.has(treeId)) return byTree.get(treeId);
    stats.treeReads += 1;
    const entries = splitNul(exec(['ls-tree', '-z', '--end-of-options', treeId]))
      .map((e) => /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(e))
      .filter((m) => m && m[3].endsWith('.md'))
      .map((m) => ({ mode: m[1], id: m[2], name: m[3] }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    // A symlinked journey is never read (the shipped gate's rule): its commit's verdict is cannot tell.
    const link = entries.find((e) => e.mode === '120000');
    if (link) {
      const result = { error: `journey ${link.name} is a symlink` };
      byTree.set(treeId, result);
      return result;
    }
    const missing = [...new Set(entries.map((e) => e.id).filter((id) => !byBlob.has(id)))];
    const texts = readBlobs(exec, missing);
    for (const id of missing) byBlob.set(id, texts.has(id) ? parseJourneyText(texts.get(id)) : { error: 'unreadable' });
    let result = { journeys: [] };
    for (const e of entries) {
      const parsed = byBlob.get(e.id);
      if (parsed.error) { result = { error: `journey ${e.name}: ${parsed.error}` }; break; }
      result.journeys.push({ name: e.name.slice(0, -'.md'.length), files: parsed.files });
    }
    byTree.set(treeId, result);
    return result;
  }
  return { load, stats };
}

// The journeys rule with its docs/journeys/ condition off: would the no-surface and `files:` conditions
// alone skip this commit? Reads the journeys only when every changed file is in the no-surface set.
function skipsWithoutJourneyGuard(files, loadJourneys) {
  if (files.length === 0 || files.some((f) => pathShapeProblem(f) !== null)) return false;
  if (!files.every((f) => inNoSurfaceSet(f))) return false;
  const loaded = loadJourneys();
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

  const claudeIds = objectIds(exec, commits.map((c) => `${c.sha}:CLAUDE.md`), 'blob');
  const treeIds = objectIds(exec, commits.map((c) => `${c.sha}:docs/journeys`), 'tree');
  const claudeTexts = readBlobs(exec, [...new Set(claudeIds.filter((id) => id !== null))]);
  const flagByBlob = new Map();
  const journeyLoader = makeJourneyLoader(exec);

  const keys = [];
  for (const skill of SKILLS) {
    if (skill === 'design-wrapper') WRAPPER_MODES.forEach((m) => keys.push({ skill, mode: m, label: `${skill} ${m}` }));
    else keys.push({ skill, label: skill });
  }
  const results = Object.fromEntries(keys.map((k) => [k.label, { skip: 0, proceed: 0 }]));
  let journeysWrongSkips = 0;
  let guardOffSkips = 0;
  let guardOffWrong = 0;

  commits.forEach(({ files }, i) => {
    const blobId = claudeIds[i];
    if (blobId !== null && !flagByBlob.has(blobId)) flagByBlob.set(blobId, readDesignIntegrationFlag(claudeTexts.get(blobId) || ''));
    const designIntegration = blobId === null ? null : flagByBlob.get(blobId);
    const loadJourneys = () => journeyLoader.load(treeIds[i]);
    for (const k of keys) {
      const r = decide({ skill: k.skill, mode: k.mode, files, designIntegration, loadJourneys });
      results[k.label][r.decision] += 1;
      if (k.skill === 'journeys' && r.decision === 'skip' && files.some(isJourneyPath)) journeysWrongSkips += 1;
    }
    if (skipsWithoutJourneyGuard(files, loadJourneys)) {
      guardOffSkips += 1;
      if (files.some(isJourneyPath)) guardOffWrong += 1;
    }
  });

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
