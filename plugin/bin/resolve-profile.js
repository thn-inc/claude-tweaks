#!/usr/bin/env node
// bin/resolve-profile.js
//
// CLI wrapper around bin/lib/model-profiles — owns ALL I/O (policy read,
// frontier tally read/append, session-scoped model-failure blacklist
// read/write). resolve() itself stays pure. Contract cited by dispatch
// sites: skills/_shared/subagent-dispatch-core.md §Model Selection.
//
// Session-failure blacklist (#763): every normal `<profile>` resolution
// reads the CLAUDE_CODE_SESSION_ID-keyed blacklist
// (bin/lib/model-profiles/session-failures.js) and passes it to resolve()
// as `failedModels`, so a model that already failed with a credit/usage
// exhaustion error this session is never re-resolved. A dispatch site that
// observes such a failure records it via:
//
//   node bin/resolve-profile.js record-failure <model>
//
// before retrying or reporting — see subagent-dispatch-core.md's Model
// Selection section for when to call this.
//
// Recovery (#841 item 3): credit exhaustion is normally a usage window, not
// permanent, so a session degraded early in a long window otherwise has no
// documented way to clear it before the window naturally rolls over. Clear
// the blacklist explicitly:
//
//   node bin/resolve-profile.js clear-failures
//
// or, equivalently, remove the underlying file directly:
//
//   rm "${TMPDIR:-/tmp}/ct-model-failures-${CLAUDE_CODE_SESSION_ID}.json"
//
// No TTL: unlike the sibling blacklist this module mirrors
// (bin/lib/issues/record-snapshot.js, which has both a TTL and
// invalidateSnapshot()), this stays explicit-clear-only for now — a
// time-based expiry needs its own policy.yml key and schema default
// (record-snapshot-ttl-seconds's own wiring), which is disproportionate for
// this low-risk, session-scoped file. Revisit if explicit-clear proves too
// manual in practice.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolve, PROFILES } = require('./lib/model-profiles/profiles');
const { locatePolicyFile } = require('./lib/policy-file');
const { parsePolicyModelConfig } = require('./lib/model-profiles/policy-fragment');
const { readFailedModels, recordFailure, invalidateFailures } = require('./lib/model-profiles/session-failures');
const { anchoredOrOutsideMessage } = require('./lib/run-dir-guard');
const { resolveAgainst } = require('./lib/health-core/io');

// A value-taking flag must be followed by a value. Without this, `--stance`
// at end-of-args resolves as if the flag were absent, and `--stance
// --unattended` eats the next flag as the stance — both silent. Pure: the
// caller writes the refusal and returns 1 on `{ ok: false }`.
function requireValue(args, flag) {
  const v = args.shift();
  // A blank or whitespace-only value (the shape an unset $PIPELINE_RUN_DIR
  // expands to in shell) is rejected the same as a genuinely missing one —
  // it must never reach the --run-dir anchoring check or tally path
  // composition below as a blank string (#1138).
  if (v === undefined || v.startsWith('--') || v.trim() === '') return { ok: false };
  return { ok: true, value: v };
}

// run(argv, deps) -> 0 | 1. `argv` is the arguments after the script name;
// every outside-world read goes through `deps` (stdout, stderr, cwd, env,
// tmpDir — the directory the session-failure file lives under).
function run(argv, deps) {
  const fail = (msg) => { deps.stderr(`resolve-profile: ${msg}\n`); return 1; };
  const args = argv.slice();
  const profile = args.shift();
  if (!profile) {
    return fail('usage: resolve-profile.js <profile>|record-failure <model>|clear-failures [--stance <s>] [--unattended] [--run-dir <path>] [--diff-facts <json>]');
  }

  if (profile === 'record-failure') {
    const model = args.shift();
    if (!model) return fail('record-failure requires a model name');
    const validModels = Object.values(PROFILES).map((p) => p.model);
    if (!validModels.includes(model)) {
      return fail(`record-failure: "${model}" is not a known model family alias — valid options: ${validModels.join(', ')}`);
    }
    const sessionId = deps.env.CLAUDE_CODE_SESSION_ID;
    if (!sessionId) return fail('record-failure requires CLAUDE_CODE_SESSION_ID to be set — nothing recorded');
    recordFailure(sessionId, model, { dir: deps.tmpDir() });
    deps.stdout(`${JSON.stringify({ recorded: true, model, sessionId })}\n`);
    return 0;
  }

  if (profile === 'clear-failures') {
    const sessionId = deps.env.CLAUDE_CODE_SESSION_ID;
    if (!sessionId) return fail('clear-failures requires CLAUDE_CODE_SESSION_ID to be set — nothing to clear');
    invalidateFailures(sessionId, { dir: deps.tmpDir() });
    deps.stdout(`${JSON.stringify({ cleared: true, sessionId })}\n`);
    return 0;
  }

  let stance;
  let unattended = false;
  let runDir;
  let diffFactsRaw;
  while (args.length) {
    const a = args.shift();
    if (a === '--unattended') { unattended = true; continue; }
    if (a !== '--stance' && a !== '--run-dir' && a !== '--diff-facts') return fail(`unknown argument "${a}"`);
    const v = requireValue(args, a);
    if (!v.ok) return fail(`${a} requires a value`);
    if (a === '--stance') stance = v.value;
    else if (a === '--run-dir') runDir = v.value;
    else diffFactsRaw = v.value;
  }

  // #1912: `--diff-facts` carries `computeDiffFacts`'s own JSON shape
  // (`bin/lib/dispatch/ceremony-derive.js`) — malformed JSON fails loud
  // rather than silently resolving as if the flag were absent, since a
  // caller passing garbage almost certainly meant to bound the tier.
  let diffFacts;
  if (diffFactsRaw !== undefined) {
    try {
      diffFacts = JSON.parse(diffFactsRaw);
    } catch (e) {
      return fail(`--diff-facts is not valid JSON: ${e.message}`);
    }
  }

  // #1065: anchored-or-outside guard — reject a worktree-shadow run dir
  // before any policy read or tally I/O. Outside-any-checkout paths (the
  // journey's /tmp demo, tmp-fixture tests) stay accepted with no flag; the
  // raw runDir string is kept for all downstream use — the reject message
  // names the realpath-resolved candidate instead.
  if (runDir !== undefined) {
    const message = anchoredOrOutsideMessage(runDir, deps.cwd(), '--run-dir');
    if (message) return fail(message);
  }

  let policy = {};
  const policyPath = locatePolicyFile(deps.cwd()).path;
  if (fs.existsSync(policyPath)) {
    try {
      policy = parsePolicyModelConfig(fs.readFileSync(policyPath, 'utf8'));
    } catch (e) {
      return fail(`malformed ${policyPath}: ${e.message}`);
    }
  }

  let frontierUsed = 0;
  // A relative --run-dir is read and appended against the injected cwd, not the
  // process's own: resolved against it, then joined (normalized, as before).
  const tallyPath = runDir ? path.join(resolveAgainst(deps.cwd(), runDir), 'frontier-tally.log') : null;
  if (tallyPath && fs.existsSync(tallyPath)) {
    frontierUsed = fs.readFileSync(tallyPath, 'utf8')
      .split('\n').filter((l) => l.startsWith('frontier\t')).length;
  }

  const failedModels = readFailedModels(deps.env.CLAUDE_CODE_SESSION_ID, { dir: deps.tmpDir() });

  let result;
  try {
    result = resolve(profile, { policy, stance, unattended, frontierUsed, failedModels, diffFacts });
  } catch (e) {
    return fail(e.message);
  }

  // The read side degrades to 0 on a missing tally, but the append cannot
  // degrade: a run-dir that does not exist throws ENOENT, and an uncaught
  // throw here is a raw stack trace on stderr. Failing loud is right — a lost
  // append silently under-counts the frontier cap on every later resolution.
  if (tallyPath && result.model === 'fable') {
    try {
      fs.appendFileSync(tallyPath, `frontier\t${new Date().toISOString()}\n`);
    } catch (e) {
      // The message embeds the path handed to fs; print the spelling the user gave.
      return fail(`cannot append frontier tally: ${e.message.split(tallyPath).join(path.join(runDir, 'frontier-tally.log'))}`);
    }
  }
  deps.stdout(`${JSON.stringify(result)}\n`);
  return 0;
}

const realDeps = {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  cwd: () => process.cwd(),
  env: process.env,
  tmpDir: () => os.tmpdir(),
};

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
