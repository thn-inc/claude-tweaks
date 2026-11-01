#!/usr/bin/env node
// bin/pr-resume-line.js — the Resume line of a run's PR body, or why none is
// usable. The tombstone-PR path of skills/flow/claim-targets.md and the Unsettled
// run report of skills/_shared/github-pr-scan.md (item 10) call this instead of
// restating the Resume-line grammar in prose (#4659); the verdict is
// pr-body.js's resumeVerdict, the one the `--resume` mode of stale-claim-pr.js
// reads too. A Resume line is untrusted input rendered as a paste command, so
// only a line parseResumeLine accepts for this run is ever printed as `resume`.
//
// Usage: pr-resume-line.js --body-file <path> --run-id <id> [--help]
//   --body-file  the PR body's raw text, read from this file.
//   --run-id     the run whose Resume line is expected (the line's run dir must
//                end in it).
// Output: one JSON line, exit 0, for every verdict — failure included:
//   {"resume":"<line>","runDir":"<dir>","target":"<target>","steps":"<steps>","failure":null}
//   {"resolve":"no-resume-line"|"resume-line-shape","failure":null}
//   {"resolve":null,"failure":"<message>"}   the body file could not be read
// `no-resume-line` — no Resume line under the body's last `### Resume` heading;
// `resume-line-shape` — one is there but is not exactly the line
// composeResumeLine emits for this run.
// Exit codes (a CLI-specific vocabulary — verdicts are data on stdout):
//   1  malformed invocation (unknown flag, a flag missing its value, no
//      --body-file, no --run-id, a --run-id that does not match RUN_ID_SHAPE);
//      usage on stderr, no stdout.
'use strict';

const fs = require('fs');
const { resumeVerdict } = require('./lib/flow/pr-body');
const { RUN_ID_SHAPE } = require('./lib/issues/claim-store');

const USAGE = 'usage: pr-resume-line.js --body-file <path> --run-id <id> [--help]\n';

function parseArgs(argv) {
  const o = { bodyFile: null, runId: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // A value-taking flag given last, empty, or followed by another flag reads
    // as a missing value, never as a path.
    const value = () => {
      const v = argv[++i];
      return typeof v !== 'string' || !v.trim() || v.startsWith('--') ? undefined : v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--body-file' || a === '--run-id') {
      const v = value();
      if (v === undefined) return { error: `${a} requires a value` };
      o[a === '--body-file' ? 'bodyFile' : 'runId'] = v;
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (opts.error) { deps.stderr(`pr-resume-line.js: ${opts.error}\n${USAGE}`); return 1; }
  if (!opts.bodyFile) { deps.stderr(`pr-resume-line.js: --body-file is required\n${USAGE}`); return 1; }
  if (!opts.runId) { deps.stderr(`pr-resume-line.js: --run-id is required\n${USAGE}`); return 1; }
  if (!RUN_ID_SHAPE.test(opts.runId)) {
    deps.stderr(`pr-resume-line.js: --run-id is not a valid run id: ${JSON.stringify(opts.runId)}\n${USAGE}`);
    return 1;
  }

  let body;
  try {
    body = deps.readFile(opts.bodyFile);
  } catch (e) {
    deps.stdout(`${JSON.stringify({ resolve: null, failure: e && e.message ? e.message : String(e) })}\n`);
    return 0;
  }
  deps.stdout(`${JSON.stringify({ ...resumeVerdict(body, opts.runId), failure: null })}\n`);
  return 0;
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
