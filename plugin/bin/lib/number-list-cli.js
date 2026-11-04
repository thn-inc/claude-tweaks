// plugin/bin/lib/number-list-cli.js — shared scaffold for the
// single-invocation "comma-joined list -> one aliased GraphQL call" CLIs
// (bin/resolve-blockers.js, bin/resolve-linked-prs.js, and since #4793
// bin/resolve-foreign-blockers.js, whose list is owner/name#N refs), factored
// out after a diff showed the first two files identical outside their fetch
// function, USAGE string, error-message prefix, and per-number result shape (#1981).
// Zero runtime npm deps.
//
// makeNumberListCli({ name, usage, fetch, mapResult, ghRequiredNote, parseList, malformedMessage, missingMessage })
//   -> { run, parseArgs, parseNumbers, realDeps }
//
// - name: the CLI's own filename (e.g. "resolve-blockers.js"), used as the
//   error-message prefix ("{name}: ...").
// - usage: the full "usage: ..." string, newline-terminated, printed on
//   --help and appended after every parse-error message.
// - fetch({ numbers, owner, repo, runner }): the per-CLI GraphQL call
//   (fetchNativeDependencies / fetchLinkedPRs) — returns a Map keyed by
//   number, or throws on a GraphQL/transport failure (mapped to exit 3).
// - mapResult(n, fetched): projects fetch's returned Map into this
//   number's result value — usually `(n, byNumber) => byNumber.get(n)`,
//   since both existing CLIs already store the per-record shape they want
//   directly in the Map's values.
// - ghRequiredNote (optional): a trailing note appended to the "`gh` is
//   required" exit-2 message (resolve-blockers.js's own
//   "(work-links: native)" qualifier; resolve-linked-prs.js passes none).
// - parseList (optional): parseList(raw) -> Array|null (null = malformed),
//   defaulting to parseNumbers. bin/resolve-foreign-blockers.js (#4793) passes
//   its own: its list is owner/name#N refs rather than numbers. fetch still
//   receives the parsed list as `numbers`, and mapResult is called once per entry.
// - malformedMessage (optional): the exit-1 message for a null parseList,
//   defaulting to the numbers wording.
// - missingMessage (optional): the exit-1 message when the positional list is
//   absent, defaulting to the numbers wording.
// realDeps.runner's timeout is shared-primitives' GH_BATCH_TIMEOUT_MS, read per call.
'use strict';

const { execFileSync } = require('child_process');
const {
  parseRepo, ghAvailable, remoteUrl, repoResolutionNote, ghOptions, pinExplicitRepoHost, gateOriginRepo,
} = require('./repo-resolve');
const sharedPrimitives = require('./shared-primitives');

const { LARGE_MAX_BUFFER_BYTES } = sharedPrimitives;

const isPos = (n) => Number.isInteger(n) && n > 0;

// Parses the comma-joined positional argument into an array of positive
// integers, or returns null on any malformed entry (empty segment,
// non-numeric, zero/negative) — the caller reports one uniform "malformed"
// error rather than naming which segment failed.
function parseNumbers(raw) {
  const numbers = raw.split(',').map((p) => Number(p));
  if (numbers.some((n) => !isPos(n))) return null;
  return numbers;
}

const NUMBERS_MALFORMED_MESSAGE = 'malformed <n> — every entry must be a positive integer';

function makeNumberListCli({
  name, usage, fetch, mapResult, ghRequiredNote, parseList = parseNumbers, malformedMessage = NUMBERS_MALFORMED_MESSAGE, missingMessage = 'missing <n> argument',
}) {
  function parseArgs(argv) {
    const opts = { numbersRaw: null, repo: null, help: false };
    if (argv[0] === '--help' || argv[0] === '-h') { opts.help = true; return opts; }
    if (argv[0] === undefined || argv[0].startsWith('--')) return { error: missingMessage };
    opts.numbersRaw = argv[0];
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--help' || a === '-h') opts.help = true;
      else if (a === '--repo') {
        const v = argv[i + 1];
        if (!v || v.startsWith('--')) return { error: 'missing value for --repo' };
        opts.repo = v;
        i++;
      }
      else return { error: `unknown argument: ${a}` };
    }
    return opts;
  }

  const realDeps = {
    ghAvailable,
    remoteUrl,
    // #4505: an explicit --repo's host reaches every fetch call, including the
    // GraphQL owner/repo queries that thread no --hostname for github.com.
    pinGhHost: (repoSpec) => pinExplicitRepoHost(repoSpec),
    runner: (args) => execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', timeout: sharedPrimitives.GH_BATCH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true })),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };

  // argv -> exit code. All I/O through deps so tests never touch gh or git.
  function run(argv, deps = realDeps) {
    const opts = parseArgs(argv);
    if (opts.error) { deps.stderr(opts.error + '\n' + usage); return 1; }
    if (opts.help) { deps.stdout(usage); return 0; }
    const numbers = parseList(opts.numbersRaw);
    if (!numbers) { deps.stderr(malformedMessage + '\n' + usage); return 1; }
    if (!deps.ghAvailable()) { deps.stderr(`${name}: \`gh\` is required${ghRequiredNote ? ' ' + ghRequiredNote : ''}\n`); return 2; }

    let remote = null;
    if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
    // A caller-supplied --repo is either a bare `owner/repo` (github.com
    // implied — the historical shape) or a host-qualified `host/owner/repo`
    // slug (repoSlug()'s GHE output). Only the bare form needs the
    // `github.com/` prefix to satisfy parseRepo's 3-segment regex; prefixing
    // an already host-qualified value would produce a 4-segment string that
    // fails to parse at all.
    let repoSpec;
    if (opts.repo) repoSpec = parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`);
    else {
      // #4933: an origin host with no GitHub signal is refused, never sent to gh.
      const gated = gateOriginRepo(remote, deps.gateDeps);
      if (gated.refusal) { deps.stderr(`${name}: ${gated.refusal}\n`); return 2; }
      repoSpec = gated.spec;
    }
    if (!repoSpec) { deps.stderr(`${name}: could not resolve owner/repo — pass --repo owner/name\n`); return 2; }
    if (opts.repo && deps.pinGhHost) deps.pinGhHost(repoSpec);
    const { owner, repo, host } = repoSpec;
    // #2538 Deliverable 3 — visible only for a resolved non-github.com host;
    // see repoResolutionNote's own comment for why the common case stays silent.
    const note = repoResolutionNote(repoSpec);
    if (note) deps.stderr(`${name}: ${note}\n`);

    let fetched;
    try {
      fetched = fetch({
        numbers, owner, repo, host, runner: deps.runner,
      });
    } catch (err) {
      deps.stderr(`${name}: ${err && err.message ? err.message : String(err)}\n`);
      return 3;
    }

    const result = {};
    for (const n of numbers) result[n] = mapResult(n, fetched);
    deps.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  }

  return { run, parseArgs, parseNumbers, realDeps };
}

module.exports = { makeNumberListCli, parseNumbers, parseRepo };
