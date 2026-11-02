#!/usr/bin/env node
// bin/qa-scrub.js — scrubs one QA story's artifacts of the values its `secrets:`
// block declares (#4477). The qa-agent runs it after closing a story's session,
// only when its prompt carries a `**Secrets file:**` (agents/qa-agent.md §6.5);
// a story without `secrets:` never reaches this CLI.
//
//   node bin/qa-scrub.js --secrets <file.json> --screenshots <dir>
//                        [--traces <dir>] [--cli-dir <dir> --since <ISO-8601>]
//
// --secrets is the story's `secrets:` block as a JSON array, written by /test
// qa's dispatcher (skills/test/qa-prompts.md): patterns and locators only, never
// a value. --cli-dir is playwright-cli's shared output dir (.playwright-cli/),
// which parallel stories write into, so it needs --since (the story's start) to
// bound which of its files belong in scope. lib/qa-scrub/scrub.js does the work.
//
// Stdout is one JSON line: the scrub outcome (exit 0 or 3) — counts, paths and
// the `line` "{N} secret value(s) scrubbed from {M} artifact(s); {K}
// screenshot(s) removed" — or {ok:false, error} (exit 1). No secret value is
// ever printed. Exit vocabulary (Payload-1/Invocation-2, like qa-report.js):
//   0  scrubbed clean, including "nothing matched" (`no_matches: true`)
//   1  the --secrets payload is unreadable, unparseable, or invalid — nothing
//      scrubbed — or the scrub itself threw (`scrub-crashed`); either way the
//      caller reports the story FAIL with every artifact dir unproven
//   2  malformed invocation (usage on stderr)
//   3  scrub incomplete — `remaining` lists every path that still holds a match
//      or could not be checked; the caller reports the story FAIL
'use strict';

const fs = require('fs');
const { parseSecrets } = require('./lib/qa-scrub/secrets');
const { scrubStoryArtifacts } = require('./lib/qa-scrub/scrub');

const USAGE = 'usage: qa-scrub.js --secrets <file.json> --screenshots <dir> [--traces <dir>] [--cli-dir <dir> --since <ISO-8601>]\n'
  + '  exit 0 scrubbed clean, 1 secrets payload unreadable/invalid, 2 malformed invocation, 3 scrub incomplete (paths remain)\n';

const FLAGS = {
  '--secrets': 'secrets', '--screenshots': 'screenshots', '--traces': 'traces', '--cli-dir': 'cliDir', '--since': 'since',
};

function parseArgs(argv) {
  const o = { secrets: null, screenshots: null, traces: null, cliDir: null, since: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const key = FLAGS[a];
    const v = argv[++i];
    if (typeof v !== 'string' || v === '' || v.startsWith('--')) return { error: `${a} requires a value` };
    if (o[key] !== null) return { error: `${a} given more than once` };
    o[key] = v;
  }
  if (!o.secrets) return { error: '--secrets <file.json> is required' };
  if (!o.screenshots) return { error: '--screenshots <dir> is required' };
  if (o.cliDir !== null && o.since === null) return { error: '--cli-dir needs --since (the dir is shared by parallel stories)' };
  if (o.since !== null) {
    const d = new Date(o.since);
    if (Number.isNaN(d.getTime())) return { error: `--since is not a valid ISO-8601 time: ${o.since}` };
    o.since = d;
  }
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  scrub: scrubStoryArtifacts,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`qa-scrub.js: ${o.error}\n${USAGE}`); return 2; }
  const refuse = (error) => {
    deps.stdout(`${JSON.stringify({ ok: false, error })}\n`);
    deps.stderr(`qa-scrub.js: ${error}\n`);
    return 1;
  };

  let text;
  try { text = deps.readFile(o.secrets); } catch (err) {
    return refuse(`secrets-unreadable (${(err && err.code) || 'read-failed'})`);
  }
  let input;
  try { input = JSON.parse(text); } catch { return refuse('secrets-unparseable'); }
  const parsed = parseSecrets(input);
  if (parsed.error) return refuse(parsed.error);

  let outcome;
  try {
    outcome = deps.scrub({
      secrets: parsed.secrets, screenshots: o.screenshots, traces: o.traces, cliDir: o.cliDir, since: o.since,
    });
  } catch (err) {
    return refuse(`scrub-crashed (${(err && err.code) || 'error'})`);
  }
  deps.stdout(`${JSON.stringify(outcome)}\n`);
  return outcome.ok ? 0 : 3;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
