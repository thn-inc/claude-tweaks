'use strict';
// bin/lib/release-preflight/pack.js — the /claude-tweaks:release Step 1 fact
// pack (#2255): engine, last tag, unreleased commits, proposed version, open
// release PR, CI on the tip, a human-edited release PR, hook presence — one
// {ok, value | error} envelope per field, gathered concurrently, each
// degrading only itself (run-directory-fact-packs). Read-only. Every fs, git
// and gh call goes through `deps`. Reuses bin/lib/release-local's commit
// parser and bump precedence by reference — never a second copy.
const fs = require('fs');
const path = require('path');
const { execFile: execFileCb, execFileSync } = require('child_process');
const { promisify } = require('util');
const { conventionalHistory } = require('../release-local/commits.js');
const { bumpPart } = require('../release-local/bump.js');
const { nextVersion } = require('../release/compose.js');
const { readConfig, resolveTargets, versionAtRef, MANIFEST_FILE } = require('../release-local/manifest.js');
const { compareVersions } = require('../changelog.js');
const { resolvePolicyConfig } = require('../policy-schema.js');
const { wrapProbe, withTimeout } = require('../wrap-up/pack.js');

const PROBE_NAMES = ['engine', 'lastTag', 'unreleased', 'proposedVersion', 'releasePr', 'ciTip', 'openReleasePrConflict', 'hook'];
const PROBE_TIMEOUT_MS = 60000;
const EXEC_OPTS = { maxBuffer: 32 * 1024 * 1024, timeout: 30000 };
const ENGINES = new Set(['pr-first', 'local-merge']);
const CONFIG_SOURCES = new Set(['policy', 'run-config']);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const PR_LIST_LIMIT = 200;
// Only genuine path absence at a ref reads as "no version here" — the same
// split release-local/manifest.js draws, so a bad ref (`invalid object name`)
// degrades the field loudly instead of passing for an unversioned repo.
const PATH_ABSENT_RE = /does not exist|exists on disk, but not in/i;
const HOOK_DISABLED = new Set(['false', 'off', 'none', 'null']);
// Some workflows quote the key ("on":) to dodge YAML 1.1's boolean coercion —
// the same trigger, the same block (re-review of the #2255 fix wave).
const ON_LINE_RE = /^(?:on|"on"|'on'):[ \t]*(.*)$/;
const PUBLISHED_RE = /\bpublished\b/;

// Ruling 10: `hook` reads the workflow's `on:` TRIGGER, never any line that
// says `release:`. The two whole-file regexes this replaced called a job named
// `release` beside the word "published" a release hook (false positive) and
// missed `on: release` and `on: [push, release]` (false negatives, where every
// activity type — published included — fires). A small text scanner, not a
// YAML parser: one `on:` block, its three spellings.
function indentOf(line) { return /^[ \t]*/.exec(line)[0].length; }

function stripComment(value) { return value.replace(/\s+#.*$/, '').trim(); }

// The value side of a `release` key in flow form. Empty (a key with no value,
// or the next entry starting) means every activity type; otherwise `published`
// must be among its `types:`.
function releaseValuePublishes(value) {
  const v = value.trim();
  if (v === '' || v.startsWith(',') || v.startsWith('}')) return true;
  const types = /types\s*:\s*\[([^\]]*)\]/.exec(v);
  return types ? PUBLISHED_RE.test(types[1]) : false;
}

// `on: release`, `on: [push, release]`, `on: { release: { types: [published] } }`.
function flowTriggersRelease(inline) {
  if (inline === 'release') return true;
  const list = /^\[(.*)\]$/.exec(inline);
  if (list) return list[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).includes('release');
  const map = /^\{(.*)\}$/.exec(inline);
  const body = map ? map[1] : inline;
  const at = /(^|[{,\s])release\s*:/.exec(body);
  return at ? releaseValuePublishes(body.slice(at.index + at[0].length)) : false;
}

// A `types:` line inside the release sub-block, plus whatever lines are nested
// under it (`types:\n  - published` as well as `types: [published]`).
function subBlockPublishes(sub) {
  const idx = sub.findIndex((l) => /^\s*types\s*:/.test(l));
  if (idx === -1) return false;
  let region = /^\s*types\s*:[ \t]*(.*)$/.exec(sub[idx])[1];
  const typesIndent = indentOf(sub[idx]);
  for (let i = idx + 1; i < sub.length && indentOf(sub[i]) > typesIndent; i += 1) region += `\n${sub[i]}`;
  return PUBLISHED_RE.test(region);
}

function blockTriggersRelease(lines, start, onIndent) {
  const block = [];
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    if (indentOf(lines[i]) <= onIndent) break; // dedent — the on: block ended
    block.push(lines[i]);
  }
  const idx = block.findIndex((l) => /^\s*release\s*:/.test(l));
  if (idx === -1) return false;
  const value = stripComment(/^\s*release\s*:[ \t]*(.*)$/.exec(block[idx])[1]);
  if (value !== '') return releaseValuePublishes(value);
  const releaseIndent = indentOf(block[idx]);
  const sub = [];
  for (let i = idx + 1; i < block.length && indentOf(block[i]) > releaseIndent; i += 1) sub.push(block[i]);
  return sub.length === 0 ? true : subBlockPublishes(sub); // bare `release:` = every activity type
}

function workflowPublishesRelease(text) {
  const lines = String(text).split('\n');
  const i = lines.findIndex((l) => ON_LINE_RE.test(l));
  if (i === -1) return false;
  const inline = stripComment(ON_LINE_RE.exec(lines[i])[1]);
  return inline !== '' ? flowTriggersRelease(inline) : blockTriggersRelease(lines, i + 1, indentOf(lines[i]));
}

function defaultDeps(cwd) {
  const execFileAsync = promisify(execFileCb);
  return {
    // EXEC_OPTS here too, not only on the async runner: `git log --first-parent`
    // over a whole untagged history is the one call that outgrows execFileSync's
    // 1 MB default (this repo's own is ~1.02 MB at 6.121.0), and an ENOBUFS
    // there degrades unreleased, proposedVersion and lastTag together.
    git: (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...EXEC_OPTS }),
    execFileAsync: async (cmd, args, opts = {}) => (await execFileAsync(cmd, args, { cwd, encoding: 'utf8', ...EXEC_OPTS, ...opts })).stdout,
    readFile: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; } },
    readdir: (p) => { try { return fs.readdirSync(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []; throw e; } },
    now: () => Date.now(),
  };
}

// Ruling 5: a bot is any author identity GitHub renders with a [bot] suffix.
function isBotAuthor(a) {
  if (!a) return false;
  return /\[bot\]$/.test(String(a.login || '')) || /\[bot\]$/.test(String(a.name || '')) || /\[bot\]@users\.noreply\.github\.com$/.test(String(a.email || ''));
}

// Ruling 4: release-please's own branch prefix, or its PR title shape — a
// version number after "release " distinguishes it from an unrelated
// "chore: release notes"-style commit message.
function isReleasePr(pr) {
  return /^release-please--/.test(String(pr.headRefName || '')) || /^chore(\([^)]*\))?: release \d/.test(String(pr.title || ''));
}

function policyString(entry) {
  const v = entry && entry.value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function memo(fn) {
  let p;
  return () => { if (p === undefined) p = Promise.resolve().then(fn); return p; };
}

// The preamble every probe depends on — policy, root, branch, tip ref — plus
// the probe table itself. Separated from gatherReleasePreflight so that a
// failure here can be caught once and turned into a degraded envelope per
// probe (ruling 13): the pack is still produced, every field says
// `preamble failed: …`, and nobody reads a half-resolved context.
//
// `root`, when the caller already resolved it (the CLI's own exit-3 check runs
// `git rev-parse --show-toplevel` before any run-dir handling), is used as-is —
// one rev-parse per process rather than the same spawn twice. `runDir`, when
// the CLI resolved one, is where a run's pinned config.yml overrides policy.yml
// — the same precedence every other consumer of resolvePolicyConfig honours.
function prepare({ deps, rootArg, runDir }) {
  const gitForPolicy = rootArg
    ? (args) => (args.join(' ') === 'rev-parse --show-toplevel' ? `${rootArg}\n` : deps.git(args))
    : deps.git;
  const { root, result: policy } = resolvePolicyConfig({ git: gitForPolicy, readFile: deps.readFile, runDir, keys: ['integration-model', 'integration-branch', 'release-hook'] });
  const branch = policyString(policy['integration-branch']) || 'main';
  let tipRef = `refs/heads/${branch}`;
  try { deps.git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]); tipRef = `origin/${branch}`; } catch { /* no remote-tracking ref: read the local branch */ }

  // Ruling 2: an explicitly configured value only — a guessed engine is exactly
  // what AC 6 forbids. Either config source counts: a run's pinned config.yml
  // is as explicit as policy.yml, and it is what the rest of the run obeys.
  const engineEntry = policy['integration-model'];
  const engine = engineEntry && CONFIG_SOURCES.has(engineEntry.source) && ENGINES.has(engineEntry.value) ? engineEntry.value : null;
  const needEngine = () => { if (!engine) throw new Error('engine unresolved'); return engine; };

  // Ruling 12: the base is derived exactly as the release engines derive it —
  // the highest strict `v*` tag (a tag off the first-parent chain counts),
  // the manifest version at tipRef, and the first-parent tag. `git show` is
  // the reader, so the base describes the ref the pack reports on, not the
  // working tree. A path that is absent at that ref reads as "no version"; any
  // other git error (a bad ref) propagates and degrades the field.
  const showAtTip = (p) => {
    try { return deps.git(['show', `${tipRef}:${p}`]); } catch (err) {
      if (PATH_ABSENT_RE.test(String(err.message || err))) return null;
      throw err;
    }
  };
  const manifestVersion = () => {
    const config = readConfig(showAtTip);
    if (config) return versionAtRef(resolveTargets(config), showAtTip);
    const raw = showAtTip(MANIFEST_FILE);
    if (raw === null) return null;
    // F11: a hand-broken manifest is "no version here", not a thrown probe.
    try {
      const value = JSON.parse(raw)['.'];
      return SEMVER_RE.test(String(value || '')) ? value : null;
    } catch { return null; }
  };
  const highestTagVersion = () => {
    let tip = null;
    for (const line of deps.git(['tag', '-l', 'v*']).split('\n')) {
      const v = line.trim().replace(/^v/, '');
      if (SEMVER_RE.test(v) && (!tip || compareVersions(v, tip) > 0)) tip = v;
    }
    return tip;
  };
  const versionBase = (lastTag) => {
    const candidates = [
      { baseSource: 'tag', base: highestTagVersion() },
      { baseSource: 'manifest', base: manifestVersion() },
      { baseSource: 'first-parent-tag', base: lastTag ? lastTag.replace(/^v/, '') : null },
    ];
    let best = null;
    for (const candidate of candidates) {
      if (!candidate.base || !SEMVER_RE.test(candidate.base)) continue;
      if (!best || compareVersions(candidate.base, best.base) > 0) best = candidate;
    }
    if (!best) throw new Error(`no version base resolvable (no v* tag, no manifest at ${tipRef})`);
    return best;
  };

  // A field that depends on another field's work names that dependency in its
  // error (`engine unresolved`'s convention), so a degraded pack never reads as
  // if the dependent probe itself is what broke.
  const dependency = async (name, fn) => {
    try { return await fn(); } catch (err) { throw new Error(`${name} unresolved: ${String((err && err.message) || err)}`); }
  };

  const history = memo(() => conventionalHistory(deps.git, tipRef));
  const historyOf = () => dependency('history', history);
  const releasePr = memo(async () => {
    if (needEngine() === 'local-merge') return 'none';
    const prs = JSON.parse(await deps.execFileAsync('gh', ['pr', 'list', '--state', 'open', '--limit', String(PR_LIST_LIMIT), '--json', 'number,state,mergeable,headRefName,title']));
    const pr = prs.find(isReleasePr);
    // A miss on a full page is not "there is no release PR" — the release PR
    // may simply be off the end of the page. Say so rather than reporting a
    // clean `none` the skill would act on.
    if (!pr && prs.length >= PR_LIST_LIMIT) throw new Error(`release PR search inconclusive: more than ${PR_LIST_LIMIT} open PRs`);
    return pr ? { number: pr.number, state: pr.state, mergeable: pr.mergeable, headRefName: pr.headRefName, title: pr.title } : 'none';
  });

  const probes = {
    engine: () => { if (!engine) throw new Error('integration-model unresolved'); return engine; },
    lastTag: async () => {
      const { lastTag } = await historyOf();
      if (!lastTag) throw new Error(`no v* tag reachable from ${tipRef}`);
      return { tag: lastTag, version: lastTag.replace(/^v/, ''), tipRef };
    },
    unreleased: async () => {
      const { lastTag, commits } = await historyOf();
      return { since: lastTag, tipRef, commits: commits.map((c) => ({ sha: c.sha, type: c.type, scope: c.scope, breaking: c.breaking, breakingNote: c.breakingNote, subject: c.subject, description: c.description, unconventional: c.unconventional })) };
    },
    proposedVersion: async () => {
      const { lastTag, commits } = await historyOf();
      const part = bumpPart(commits);
      if (part === 'none') throw new Error(`nothing to release: ${commits.length} commit(s) since ${lastTag || 'the first commit'}, none feat/fix/breaking`);
      const { base, baseSource } = versionBase(lastTag);
      return { version: nextVersion(base, part), part, base, baseSource, tipRef };
    },
    releasePr,
    // Ruling 11: GitHub is asked for the BRANCH by name, so it resolves its own
    // tip — this pack never fetches, so the local origin/{branch} ref may trail
    // it. The skew is recorded (`localSha`/`headSha`/`tipBehind`) rather than
    // silently read as the tip, and a commit with more check runs than one page
    // holds says so (`truncated`) instead of reporting a partial count as whole.
    ciTip: async () => {
      if (needEngine() === 'local-merge') return 'n/a';
      const localSha = deps.git(['rev-parse', tipRef]).trim();
      const { nameWithOwner } = JSON.parse(await deps.execFileAsync('gh', ['repo', 'view', '--json', 'nameWithOwner']));
      // per_page belongs in the query string, not in `-f`: any -f/-F parameter
      // flips `gh api` to POST, and this endpoint answers a POST with 404 (seen
      // live against this repo before the switch). Every sibling call site in
      // the repo spells a GET parameter the same way.
      const runs = JSON.parse(await deps.execFileAsync('gh', ['api', `repos/${nameWithOwner}/commits/${branch}/check-runs?per_page=100`]));
      const list = runs.check_runs || [];
      const counts = { total: runs.total_count || 0, success: 0, failure: 0, pending: 0 };
      for (const r of list) {
        if (r.status !== 'completed') counts.pending += 1;
        else if (r.conclusion === 'success' || r.conclusion === 'skipped' || r.conclusion === 'neutral') counts.success += 1;
        else counts.failure += 1;
      }
      const headSha = list.length && list[0].head_sha
        ? String(list[0].head_sha)
        : (await deps.execFileAsync('gh', ['api', `repos/${nameWithOwner}/commits/${branch}`, '--jq', '.sha'])).trim();
      let state;
      if (counts.total === 0) state = 'none';
      else if (counts.failure) state = 'failure';
      else if (counts.pending) state = 'pending';
      else state = 'success';
      return { ref: branch, headSha, localSha, tipBehind: headSha !== localSha, state, ...counts, truncated: counts.total > list.length };
    },
    // ANY human-authored commit on the branch is a human edit — release-please
    // force-pushes its own commit on top of one it did not write, so the last
    // commit alone decides nothing. Authorship GitHub did not return is
    // unknown, and a degraded field says so rather than guessing `true`.
    openReleasePrConflict: async () => {
      const pr = await dependency('releasePr', releasePr);
      if (pr === 'none') return false;
      const { commits } = JSON.parse(await deps.execFileAsync('gh', ['pr', 'view', String(pr.number), '--json', 'commits']));
      const list = commits || [];
      if (list.some((c) => !c.authors || !c.authors.length)) throw new Error('release PR commit authorship unavailable');
      return !list.every((c) => c.authors.every(isBotAuthor));
    },
    hook: () => {
      if (needEngine() === 'local-merge') {
        const v = policyString(policy['release-hook']);
        return v !== null && !HOOK_DISABLED.has(v.toLowerCase());
      }
      const dir = path.join(root, '.github', 'workflows');
      return deps.readdir(dir).filter((f) => /\.ya?ml$/.test(f)).some((f) => workflowPublishesRelease(deps.readFile(path.join(dir, f)) || ''));
    },
  };

  return { branch, tipRef, probes };
}

async function gatherReleasePreflight({ cwd = process.cwd(), only = null, deps: overrides = {}, root: rootArg = null, runDir = null } = {}) {
  const deps = { ...defaultDeps(cwd), ...overrides };
  const limit = Number.isFinite(deps.probeTimeoutMs) ? deps.probeTimeoutMs : PROBE_TIMEOUT_MS;
  const t0 = deps.now();
  const names = PROBE_NAMES.filter((n) => !only || only.includes(n));
  let context;
  try {
    context = prepare({ deps, rootArg, runDir });
  } catch (err) {
    // Ruling 13: the preamble is inside the envelope discipline. Every probe
    // degrades with the same cause and the pack is still written (exit 0) with
    // branch/tipRef null — a consumer reads a fact pack that says what failed,
    // not a stack trace instead of a file.
    const failed = () => { throw new Error(`preamble failed: ${String((err && err.message) || err)}`); };
    context = { branch: null, tipRef: null, probes: Object.fromEntries(names.map((n) => [n, failed])) };
  }
  const pack = { generatedAt: new Date(t0).toISOString(), branch: context.branch, tipRef: context.tipRef };
  const results = await Promise.all(names.map((n) => wrapProbe(n, withTimeout(context.probes[n], limit), deps.now)));
  names.forEach((n, i) => { pack[n] = results[i]; });
  pack.durationMs = deps.now() - t0;
  return pack;
}

module.exports = { PROBE_NAMES, defaultDeps, isBotAuthor, isReleasePr, gatherReleasePreflight };
