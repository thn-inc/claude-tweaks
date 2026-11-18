#!/usr/bin/env node
// bin/release-block.js — the durable "do not release" signal (#5882). A record carrying the
// `release-block` label, open, stops a release; this CLI reads that label so /release's gate
// (and the callers #5885 and #5887) ask one command instead of each re-deriving the query.
//
// usage: release-block.js check [--repo [host/]owner/name | --records-json <path>] | stamp --record <n> --finding "<category> at <file:line>|general" [--repo [host/]owner/name] [--help]
//
//   check   Prints one JSON line. None open: {"blocked":false,"records":[]}. Otherwise
//           {"blocked":true,"records":[{"number":N,"title":"…","url":"…"}]}, ascending by
//           number. The query is `gh issue list --label release-block --state open --limit 100`;
//           --records-json <path> reads the same rows from a file instead (a gh-absent caller
//           fetched them over MCP) and makes no gh call. The same rules apply to both inputs.
//           Exit 0 none open; 1 blocked; 2 usage error; 3 state unreadable (a failed gh call, a
//           missing gh with no --records-json, malformed or incomplete rows, or a list that
//           filled --limit — unreadable is never reported as clear).
//   stamp   Exit 0 stamped or already stamped; 2 usage error or no such record; 3 write failure.
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

const NAME = 'release-block.js';
const USAGE = `usage: ${NAME} check [--repo [host/]owner/name | --records-json <path>]\n`
  + `       ${NAME} stamp --record <n> --finding "<category> at <file:line>|general" [--repo [host/]owner/name]\n`
  + `       ${NAME} [--help]\n`
  + '  check: exit 0 none open; 1 blocked; 2 usage; 3 state unreadable\n';

const EXIT = Object.freeze({ OK: 0, BLOCKED: 1, USAGE: 2, FAILURE: 3 });
const LIST_LIMIT = 100;
const LABEL = 'release-block';
const JSON_FIELDS = 'number,title,url,state';
const GH_ABSENT_HINT = 'gh not found — fetch over MCP and pass --records-json (_shared/release-block.md)';

const messageOf = (err) => (err && err.message ? err.message : String(err));

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  if (verb === '--help' || verb === '-h') return { help: true };
  if (verb === undefined) return { error: 'a subcommand is required' };
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
    const { spec, refusal } = resolveRepoSpec(opts, deps);
    if (refusal) { deps.stderr(`${NAME}: ${refusal}\n`); return EXIT.USAGE; }
    if (!spec) { deps.stderr(`${NAME}: could not resolve owner/repo — pass --repo [host/]owner/name\n`); return EXIT.USAGE; }
    if (opts.repo !== undefined) deps.pinGhHost(spec, { env: deps.env, cwd: deps.cwd() });
    try {
      text = deps.gh(
        ['issue', 'list', '--repo', repoSlug(spec), '--label', LABEL, '--state', 'open', '--limit', String(LIST_LIMIT), '--json', JSON_FIELDS],
        { cwd: deps.cwd(), env: deps.env, stderr: deps.stderr, homeDir: deps.homeDir },
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

const firstLine = (text) => String(text || '').trim().split(/\r?\n/, 1)[0];

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return EXIT.OK; }
  if (opts.error) { deps.stderr(`${NAME}: ${opts.error}\n${USAGE}`); return EXIT.USAGE; }
  return check(opts, deps);
}

module.exports = { run, realDeps, parseArgs, EXIT, LIST_LIMIT, checkRows };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
