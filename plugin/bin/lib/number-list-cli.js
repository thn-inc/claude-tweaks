// plugin/bin/lib/number-list-cli.js — shared scaffold for the two
// single-invocation "comma-joined number list -> one aliased GraphQL call"
// CLIs (bin/resolve-blockers.js, bin/resolve-linked-prs.js), factored out
// after a diff showed the two files identical outside their fetch function,
// USAGE string, error-message prefix, and per-number result shape (#1981).
// Zero runtime npm deps.
//
// makeNumberListCli({ name, usage, fetch, mapResult, ghRequiredNote,
//   runnerTimeoutMs }) -> { run, parseArgs, parseNumbers, realDeps }
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
// - runnerTimeoutMs (optional, default 30000): the runner's execFileSync
//   timeout — 30s bound for ONE GraphQL call covering the whole aliased
//   batch, whatever its size — matches fetch-sub-issues.js's precedent for
//   its own 50-alias batch shape rather than #1154's 5s single-call
//   default, since a comma-list here can legitimately span the full
//   ~200-record queues unblocked-records.md/queue-pull-script.md build
//   from `--limit 200`.
'use strict';

const { execFileSync } = require('child_process');
const { parseRepo, ghAvailable, remoteUrl } = require('./repo-resolve');
const { LARGE_MAX_BUFFER_BYTES } = require('./shared-primitives');

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

function makeNumberListCli({ name, usage, fetch, mapResult, ghRequiredNote, runnerTimeoutMs = 30000 }) {
  function parseArgs(argv) {
    const opts = { numbersRaw: null, repo: null, help: false };
    if (argv[0] === '--help' || argv[0] === '-h') { opts.help = true; return opts; }
    if (argv[0] === undefined || argv[0].startsWith('--')) return { error: 'missing <n> argument' };
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
    runner: (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: runnerTimeoutMs, maxBuffer: LARGE_MAX_BUFFER_BYTES }),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };

  // argv -> exit code. All I/O through deps so tests never touch gh or git.
  function run(argv, deps = realDeps) {
    const opts = parseArgs(argv);
    if (opts.error) { deps.stderr(opts.error + '\n' + usage); return 1; }
    if (opts.help) { deps.stdout(usage); return 0; }
    const numbers = parseNumbers(opts.numbersRaw);
    if (!numbers) { deps.stderr('malformed <n> — every entry must be a positive integer\n' + usage); return 1; }
    if (!deps.ghAvailable()) { deps.stderr(`${name}: \`gh\` is required${ghRequiredNote ? ' ' + ghRequiredNote : ''}\n`); return 2; }

    let remote = null;
    if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
    const repoSpec = opts.repo ? parseRepo(`github.com/${opts.repo}`) : parseRepo(remote);
    if (!repoSpec) { deps.stderr(`${name}: could not resolve owner/repo — pass --repo owner/name\n`); return 2; }
    const { owner, repo } = repoSpec;

    let fetched;
    try {
      fetched = fetch({ numbers, owner, repo, runner: deps.runner });
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
