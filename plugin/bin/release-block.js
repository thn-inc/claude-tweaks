#!/usr/bin/env node
// bin/release-block.js — the durable "do not release" signal (#5882). A record carrying the
// `release-block` label, open, stops a release; this CLI reads that label so /release's gate
// (and the callers #5885 and #5887) ask one command instead of each re-deriving the query.
//
// usage: release-block.js check [--repo [host/]owner/name | --records-json <path>] | stamp --record <n> (--finding "<category> at <file:line>|general" | --finding-file <path>) [--repo [host/]owner/name] [--help]
//
//   check   Prints one JSON line. None open: {"blocked":false,"records":[]}. Otherwise
//           {"blocked":true,"records":[{"number":N,"title":"…","url":"…"}]}, ascending by
//           number. The query is `gh issue list --label release-block --state open --limit 100`;
//           --records-json <path> reads the same rows from a file instead (a gh-absent caller
//           fetched them over MCP) and makes no gh call. The same rules apply to both inputs.
//           Exit 0 none open; 1 blocked; 2 usage error, or an unresolvable or refused repo; 3 state
//           unreadable (a failed gh call, a missing gh with no --records-json, malformed or
//           incomplete rows, or a list that filled --limit — unreadable is never reported as clear).
//   stamp   Exit 0 stamped or already stamped; 2 usage error (an unreadable or malformed
//           --finding-file included), an unresolvable or refused repo, no such record, or a PR
//           number; 3 write failure or unreadable state (gh absent, the view unreadable or the
//           wrong shape). --finding-file <path> reads the finding from a file, so a skill passes
//           review-derived text without a shell expanding it.
//
// The exit codes and the exit-1 JSON shape are a stable contract: #5885 and #5887 call them.
// Change them only by expand-contract. The vocabulary is the spec's own domain set, not one of
// the four base vocabularies in gh-api-module-pattern's cli-wrapper-contract.md.
'use strict';

const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const {
  parseRepo, gateOriginRepo, injectedGhDeps, pickInjected, repoSlug, ghOptions,
  ghAvailable, remoteUrl, pinExplicitRepoHost,
} = require('./lib/repo-resolve');
const { resolveAgainst } = require('./lib/health-core/io');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const { invalidateSnapshot } = require('./lib/issues/record-snapshot');
const { LABELS, normalizeLabelNames } = require('./lib/issues/record');
const { ensureLabelPayload } = require('./lib/issues/labels');

const NAME = 'release-block.js';
const USAGE = `usage: ${NAME} check [--repo [host/]owner/name | --records-json <path>]\n`
  + `       ${NAME} stamp --record <n> (--finding "<category> at <file:line>|general" | --finding-file <path>) [--repo [host/]owner/name]\n`
  + `       ${NAME} [--help]\n`
  + '  check: exit 0 none open; 1 blocked; 2 usage, or an unresolvable or refused repo; 3 state unreadable\n'
  + '  stamp: exit 0 stamped or already stamped; 2 usage, an unresolvable or refused repo, no such record, or a PR number; 3 write failure or unreadable state (gh absent, view unreadable)\n';

const EXIT = Object.freeze({ OK: 0, BLOCKED: 1, USAGE: 2, FAILURE: 3 });
const LIST_LIMIT = 100;
const LABEL = Object.freeze({
  name: LABELS.RELEASE_BLOCK,
  description: 'Release gate: releases stop while this is open — close the record or remove this label to clear',
  color: 'B4006E',
});
// `<category> at <file:line>` or `<category> at general`, one line — it lands in a comment body.
// The line may be a range (`a.js:12-15`). Anchored at both ends, so one start position: linear.
const LOCATION_RE = /^\S[^\r\n]*:\d+(?:-\d+)?$/;
// Linear parse, not one regex: a pattern with an unbounded prefix before ` at ` backtracks
// quadratically on a finding with many of them. Split at the LAST ` at `.
function isValidFinding(finding) {
  if (typeof finding !== 'string' || /[\r\n]/.test(finding)) return false;
  const at = finding.lastIndexOf(' at ');
  if (at < 0) return false;
  const category = finding.slice(0, at);
  if (!/\S/.test(category) || /\s$/.test(category)) return false;
  const location = finding.slice(at + 4);
  return location === 'general' || LOCATION_RE.test(location);
}
const RECORD_RE = /^[1-9]\d*$/;
const VIEW_FIELDS = 'number,state,labels,url';
const JSON_FIELDS = 'number,title,url,state';
const GH_ABSENT_HINT = 'gh not found — fetch over MCP and pass --records-json (_shared/release-block.md)';

const messageOf = (err) => (err && err.message ? err.message : String(err));

function parseStampArgs(rest) {
  const out = { verb: 'stamp', repo: undefined, record: undefined, finding: undefined, findingFile: undefined, help: false };
  const keys = { '--record': 'record', '--finding': 'finding', '--finding-file': 'findingFile', '--repo': 'repo' };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    const key = keys[flag];
    if (!key) return { error: `unknown argument: ${flag}` };
    if (out[key] !== undefined) return { error: `${flag} given more than once` };
    const value = rest[++i];
    if (typeof value !== 'string' || !value.trim() || (key !== 'finding' && value.startsWith('-'))) return { error: `${flag} requires a value` };
    out[key] = value;
  }
  if (out.record === undefined || !RECORD_RE.test(out.record)) return { error: '--record must be a positive integer record number' };
  if (out.finding !== undefined && out.findingFile !== undefined) return { error: '--finding and --finding-file are mutually exclusive' };
  // --finding-file is read and validated in stamp(), where deps can read it.
  if (out.findingFile !== undefined) return out;
  if (out.finding === undefined || !isValidFinding(out.finding)) return { error: '--finding must be "<category> at <file:line>" or "<category> at general"' };
  return out;
}

// The finding text from --finding-file: a skill writes review-derived text to a file so no shell
// ever expands it (docs/skill-authoring.md's "Untrusted text into a shell or paste command").
// One trailing line break is the file's, not the finding's. Returns { finding } or { error }.
function readFindingFile(opts, deps) {
  let text;
  try {
    text = String(deps.readFile(resolveAgainst(deps.cwd(), opts.findingFile)));
  } catch (err) {
    return { error: `could not read --finding-file ${opts.findingFile} (${messageOf(err)})` };
  }
  const finding = text.replace(/\r?\n$/, '');
  if (!isValidFinding(finding)) return { error: `--finding-file ${opts.findingFile} must hold one line "<category> at <file:line>" or "<category> at general"` };
  return { finding };
}

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  if (verb === '--help' || verb === '-h') return { help: true };
  if (verb === undefined) return { error: 'a subcommand is required' };
  if (verb === 'stamp') return parseStampArgs(rest);
  if (verb !== 'check') return { error: `unknown subcommand: ${verb}` };
  const out = { verb, repo: undefined, recordsJson: undefined, record: undefined, finding: undefined, help: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (flag !== '--repo' && flag !== '--records-json') return { error: `unknown argument: ${flag}` };
    const key = flag === '--repo' ? 'repo' : 'recordsJson';
    if (out[key] !== undefined) return { error: `${flag} given more than once` };
    const value = rest[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) return { error: `${flag} requires a value` };
    out[key] = value;
  }
  if (out.repo !== undefined && out.recordsJson !== undefined) return { error: '--repo and --records-json are mutually exclusive' };
  return out;
}

// The one validator both inputs share: gh's stdout and a --records-json file arrive here as
// text. A truncated list is refused before any filtering, since a full page may hide an open
// record behind closed ones.
function checkRows(text) {
  let rows;
  try {
    rows = JSON.parse(text);
  } catch (err) {
    return { error: `malformed JSON (${messageOf(err)})` };
  }
  if (!Array.isArray(rows)) return { error: 'expected a JSON array of records' };
  if (rows.length >= LIST_LIMIT) return { error: `truncated: the list filled --limit ${LIST_LIMIT}` };
  const records = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return { error: 'a record is not an object' };
    if (!Number.isInteger(row.number) || row.number <= 0) return { error: 'a record has no positive integer number' };
    if (typeof row.title !== 'string') return { error: `record #${row.number} has no title` };
    if (typeof row.url !== 'string' || !row.url) return { error: `record #${row.number} has no url` };
    if (row.state !== undefined) {
      const state = typeof row.state === 'string' ? row.state.toLowerCase() : null;
      if (state !== 'open' && state !== 'closed') return { error: `record #${row.number} has an unrecognised state` };
      if (state === 'closed') continue;
    }
    records.push({ number: row.number, title: row.title, url: row.url });
  }
  records.sort((a, b) => a.number - b.number);
  return { records };
}

const realDeps = {
  cwd: () => process.cwd(),
  get env() { return process.env; },
  homeDir: () => os.homedir(),
  ghAvailable: ({ env, cwd } = {}) => ghAvailable({ env, cwd }),
  remoteUrl: ({ cwd, env } = {}) => remoteUrl({ cwd, env }),
  pinGhHost: (repoSpec, { env, cwd } = {}) => pinExplicitRepoHost(repoSpec, { env, cwd }),
  // `{ cwd, env, stderr, homeDir }` is the injected process context; `input` is a stdin body.
  gh: (args, { cwd, env, stderr, homeDir, input } = {}) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES,
    ...(input !== undefined ? { input } : {}),
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
  }, injectedGhDeps({ env, stderr, homeDir }))),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  invalidateSnapshot,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function resolveRepoSpec(opts, deps) {
  if (opts.repo !== undefined) return { spec: parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`) };
  let remote = null;
  try {
    remote = deps.remoteUrl({ cwd: deps.cwd(), env: deps.env });
  } catch {
    remote = null;
  }
  const gated = gateOriginRepo(remote, injectedGhDeps(pickInjected(deps)));
  return { spec: gated.spec, refusal: gated.refusal };
}

const ghCtx = (deps) => ({ cwd: deps.cwd(), env: deps.env, stderr: deps.stderr, homeDir: deps.homeDir });

const firstLine = (text) => String(text || '').trim().split(/\r?\n/, 1)[0];

// Resolves the repo, pins an explicit --repo's host, and reports a usage failure itself: the
// caller returns `exit` when it is set, otherwise uses `spec`.
function resolveRepoOrFail(opts, deps) {
  const { spec, refusal } = resolveRepoSpec(opts, deps);
  if (refusal) { deps.stderr(`${NAME}: ${refusal}\n`); return { exit: EXIT.USAGE }; }
  if (!spec) { deps.stderr(`${NAME}: could not resolve owner/repo — pass --repo [host/]owner/name\n`); return { exit: EXIT.USAGE }; }
  if (opts.repo !== undefined) deps.pinGhHost(spec, { env: deps.env, cwd: deps.cwd() });
  return { spec };
}

const unreadable = (deps, why) => {
  deps.stderr(`${NAME}: state unreadable — ${why}\n`);
  return EXIT.FAILURE;
};

function check(opts, deps) {
  let text;
  if (opts.recordsJson !== undefined) {
    try {
      text = deps.readFile(resolveAgainst(deps.cwd(), opts.recordsJson));
    } catch (err) {
      return unreadable(deps, `could not read ${opts.recordsJson} (${messageOf(err)})`);
    }
  } else {
    if (!deps.ghAvailable({ env: deps.env, cwd: deps.cwd() })) {
      deps.stderr(`${NAME}: ${GH_ABSENT_HINT}\n`);
      return EXIT.FAILURE;
    }
    const { spec, exit } = resolveRepoOrFail(opts, deps);
    if (exit !== undefined) return exit;
    try {
      text = deps.gh(
        ['issue', 'list', '--repo', repoSlug(spec), '--label', LABEL.name, '--state', 'open', '--limit', String(LIST_LIMIT), '--json', JSON_FIELDS],
        ghCtx(deps),
      );
    } catch (err) {
      return unreadable(deps, `gh issue list failed (${firstLine(err && err.stderr) || messageOf(err)})`);
    }
  }
  const parsed = checkRows(String(text ?? ''));
  if (parsed.error) return unreadable(deps, parsed.error);
  const blocked = parsed.records.length > 0;
  deps.stdout(`${JSON.stringify({ blocked, records: parsed.records })}\n`);
  return blocked ? EXIT.BLOCKED : EXIT.OK;
}

const stampCommentBody = (finding) => `**Release block:** ${finding}\n\nReleases stop while this record is open and carries the \`${LABEL.name}\` label. To clear the block, close this record or remove the label.\n`;

const labelListed = (deps, slug) => {
  const text = deps.gh(['label', 'list', '--repo', slug, '--search', LABEL.name, '--json', 'name', '-q', '.[].name'], ghCtx(deps));
  return String(text ?? '').split(/\r?\n/).some((line) => line.trim() === LABEL.name);
};

function ensureLabel(deps, slug) {
  if (labelListed(deps, slug)) return true;
  const { name, description, color } = ensureLabelPayload(LABEL.name, LABEL.description, LABEL.color);
  try {
    deps.gh(['label', 'create', name, '--repo', slug, '--color', color, '--description', description], ghCtx(deps));
    return true;
  } catch {
    // A concurrent stamp may have created it first: only a re-list that still misses it is a failure.
    try { return labelListed(deps, slug); } catch { return false; }
  }
}

function stamp(opts, deps) {
  const n = opts.record;
  let finding = opts.finding;
  if (opts.findingFile !== undefined) {
    const read = readFindingFile(opts, deps);
    if (read.error) { deps.stderr(`${NAME}: ${read.error}\n${USAGE}`); return EXIT.USAGE; }
    finding = read.finding;
  }
  if (!deps.ghAvailable({ env: deps.env, cwd: deps.cwd() })) {
    deps.stderr(`${NAME}: gh not found — stamp has no MCP path here; add the label and comment by hand (_shared/release-block.md)\n`);
    return EXIT.FAILURE;
  }
  const { spec, exit } = resolveRepoOrFail(opts, deps);
  if (exit !== undefined) return exit;
  const slug = repoSlug(spec);
  let view;
  try {
    view = JSON.parse(deps.gh(['issue', 'view', n, '--repo', slug, '--json', VIEW_FIELDS], ghCtx(deps)));
  } catch (err) {
    if (/Could not resolve to an issue or pull request/.test((err && err.stderr) || messageOf(err))) {
      deps.stderr(`${NAME}: no such record #${n}\n`);
      return EXIT.USAGE;
    }
    deps.stderr(`${NAME}: could not read #${n} (${firstLine(err && err.stderr) || messageOf(err)})\n`);
    return EXIT.FAILURE;
  }
  if (!view || typeof view !== 'object' || typeof view.url !== 'string' || !Array.isArray(view.labels)) { deps.stderr(`${NAME}: could not read #${n} (unexpected answer)\n`); return EXIT.FAILURE; }
  if (view.url.includes('/pull/')) {
    deps.stderr(`${NAME}: #${n} is a pull request, not a record\n`);
    return EXIT.USAGE;
  }
  if (normalizeLabelNames(view.labels).includes(LABEL.name)) {
    deps.stdout(`${JSON.stringify({ record: Number(n), outcome: 'already-stamped' })}\n`);
    return EXIT.OK;
  }
  if (typeof view.state === 'string' && view.state.toLowerCase() === 'closed') {
    deps.stderr(`${NAME}: #${n} is closed — a closed record never blocks a release\n`);
  }
  const writeFailed = (what, err) => {
    deps.stderr(`${NAME}: ${what} failed on #${n} (${firstLine(err && err.stderr) || messageOf(err)})\n`);
    return EXIT.FAILURE;
  };
  try {
    if (!ensureLabel(deps, slug)) return writeFailed('label create', new Error('label still absent after create'));
  } catch (err) {
    return writeFailed('label list', err);
  }
  try {
    deps.gh(['issue', 'edit', n, '--repo', slug, '--add-label', LABEL.name], ghCtx(deps));
  } catch (err) {
    return writeFailed('issue edit', err);
  }
  try {
    deps.invalidateSnapshot(deps.env.CLAUDE_CODE_SESSION_ID);
  } catch (err) {
    // The label already landed; a stale session snapshot is not a write failure.
    deps.stderr(`${NAME}: could not invalidate the session record snapshot (${messageOf(err)}) — continuing\n`);
  }
  try {
    deps.gh(['issue', 'comment', n, '--repo', slug, '--body-file', '-'], { ...ghCtx(deps), input: stampCommentBody(finding) });
  } catch (err) {
    deps.stderr(`${NAME}: label added to #${n} but the comment failed (${firstLine(err && err.stderr) || messageOf(err)}) — the label stays and the block stands; post the comment by hand\n`);
    return EXIT.FAILURE;
  }
  deps.stdout(`${JSON.stringify({ record: Number(n), outcome: 'stamped' })}\n`);
  return EXIT.OK;
}

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return EXIT.OK; }
  if (opts.error) { deps.stderr(`${NAME}: ${opts.error}\n${USAGE}`); return EXIT.USAGE; }
  // Read the working directory once, inside a try: process.cwd() throws when it was deleted, and
  // an uncaught throw exits 1 — the code that means "blocked". Every later deps.cwd() reuses it.
  let cwd;
  try {
    cwd = deps.cwd();
  } catch (err) {
    return unreadable(deps, `working directory unavailable (${messageOf(err)})`);
  }
  const pinned = { ...deps, cwd: () => cwd };
  return opts.verb === 'stamp' ? stamp(opts, pinned) : check(opts, pinned);
}

module.exports = { run, realDeps, parseArgs, EXIT, LIST_LIMIT, checkRows, LABEL, isValidFinding, stampCommentBody };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
