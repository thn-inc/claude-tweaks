#!/usr/bin/env node
// bin/implementer-tier.js
//
// CLI wrapper around bin/lib/model-profiles/implementer-tier.js (#5996): which
// work profile a build's implementer runs at, from a materialized spec's header
// `size:` (the pre-rename `effort:` line when there is no `size:`) and its
// distinct `### Key Files` count, under the `implementer-tier` rule. A thin
// shell — the decision lives in the library; this file owns the spec read, the
// header parse and the rule resolution. Zero runtime npm deps.
//
// Usage: implementer-tier.js --spec-file <path> [--rule lane|record] [--run <dir>] [--from <profile>]
//          [--attempt-profile <profile> --attempt-effort <low|medium|high|inherit> --escalations <0|1|2>
//           --trigger <red-tests|fix-round-failed|blocked|cannot-complete>]
// Output: one stdout line, JSON.stringify({ profile, stepUp, rule, size, keyFileCount,
//   startEffort, next, ladder })
// — `size` null when the header has neither line, `profile` null under `lane`
// then, `stepUp` one profile up from --from (else the computed profile), null
// from capable, frontier or null. #6002's effort ladder: `ladder` is true
// exactly when the rule is `record` and policy.yml's `model-effort` is
// `profile`; `startEffort` is the first attempt's effort under the ladder (the
// spec header's `risk:` against the resolved launch effort of --from's profile,
// else the computed one; null when that profile is null or `model-effort` is
// not `profile`, so also null for a Fast profile under an active ladder). It is
// computed whenever that profile resolves, so with `ladder` false (rule `lane`)
// it is still printed but applies to nothing: the standard lane dispatches
// resolve-profile.js's `launchEffort` then (build/dispatch.md); `next`
// is the following attempt `{ profile, effort, escalations }` from the four
// attempt flags (all or none), null without them, when the ladder is off, or
// when the ladder is spent.
//
// Limitation: `startEffort` and `next` resolve the model with policy.yml's `model-stance` only, not the
// run's `--stance` (Manifesto lever) or session failure-avoidance (`failedModels`), so the same-model
// check (`next` null) and the start effort can differ from what resolve-profile.js returns for the dispatch.
//
// Rule: --rule, else the run's config.yml via --run, else policy.yml, else the
// schema default (lane). --run is validated even when --rule is passed (a
// mistyped run id never passes silently); the resolved policy value is then
// ignored, so an invalid implementer-tier value does not fail a --rule call.
// The policy.yml read for the effort ladder is separate: a malformed file (a
// bad model-profiles section, say) exits 1 even under --rule, as in
// resolve-profile.js.
//
// Exit codes (the Payload-1/Invocation-2 family, per
// .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md):
//   0  the line was printed
//   1  the invocation was well-formed but its payload was not: an unreadable
//      spec file, a malformed header (a size:/effort: value outside
//      low/medium/high, or the line given twice), an invalid resolved
//      implementer-tier value from policy.yml or the run's config.yml, or a
//      malformed policy.yml (a missing one is an empty policy)
//   2  malformed invocation: no --spec-file, an unknown flag, a flag without a
//      value, a flag given twice, an invalid --rule or --from, an attempt flag
//      given without the other three or with an invalid value, or a --run that
//      resolvePolicy refuses (anchored-or-outside guard, missing directory)
// Nothing is written to disk.
'use strict';
const fs = require('fs');
const { PROFILES, resolve } = require('./lib/model-profiles/profiles');
const { POLICY_KEY, RULES, SIZES, TRIGGERS, MAX_ESCALATIONS, keyFileCount, implementerProfile, stepUp, startEffort, nextAttempt, riskOf } = require('./lib/model-profiles/implementer-tier');
const { locatePolicyFile } = require('./lib/policy-file');
const { readPolicyModelConfig } = require('./lib/model-profiles/policy-fragment');
const { fsPath } = require('./lib/health-core/io');
const { resolvePolicy, realDeps: policyDeps } = require('./resolve-policy');

const EXIT_OK = 0;
const EXIT_PAYLOAD = 1;
const EXIT_INVOCATION = 2;

const USAGE = 'usage: implementer-tier.js --spec-file <path> [--rule lane|record] [--run <dir>] [--from <profile>] [--attempt-profile <profile> --attempt-effort <low|medium|high|inherit> --escalations <0|1|2> --trigger <red-tests|fix-round-failed|blocked|cannot-complete>]';
const ATTEMPT_FLAGS = ['--attempt-profile', '--attempt-effort', '--escalations', '--trigger'];
const FLAGS = ['--spec-file', '--rule', '--run', '--from', ...ATTEMPT_FLAGS];
const ATTEMPT_EFFORTS = ['low', 'medium', 'high', 'inherit'];
const HEADING_RE = /^#{1,6}\s/;

// The CRLF-normalized lines before the first blank line or the first heading.
function headerLines(text) {
  const lines = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line === '' || HEADING_RE.test(line)) break;
    lines.push(line);
  }
  return lines;
}

// { size } — undefined when the header names neither field — or { error }.
function readSize(text) {
  const lines = headerLines(text);
  for (const field of ['size', 'effort']) {
    // A prefix test plus trim, not `^field:\s*(.*?)\s*$` — that is quadratic on a long whitespace run.
    const prefix = `${field}:`;
    const values = lines.filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length).trim());
    if (values.length === 0) continue;
    if (values.length > 1) return { error: `${field}: given more than once in the spec header` };
    if (!SIZES.includes(values[0])) {
      return { error: `${field}: invalid value ${JSON.stringify(values[0])} in the spec header — expected low, medium or high` };
    }
    return { size: values[0] };
  }
  return { size: undefined };
}

// The header's `risk:` value — never an error: zero lines, two or more, or a
// value outside low/medium/high all read as undefined (no risk).
function readRisk(text) {
  const prefix = 'risk:';
  const values = headerLines(text).filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length).trim());
  return riskOf(values);
}

// The model-profiles policy fragment, through the reader resolve-profile.js
// uses (readPolicyModelConfig): a missing file is an empty policy, a malformed
// one throws. Only locating the file differs: an unreadable cwd (a deleted
// working directory) is an empty policy here, with a stderr warning — the
// ladder is then off — where resolve-profile.js lets the error stop the call.
function readPolicy(deps) {
  let policyPath;
  try {
    policyPath = locatePolicyFile(deps.cwd()).path;
  } catch {
    deps.stderr('implementer-tier: warning: cannot read the working directory — policy read skipped, startEffort/next/ladder reflect an empty policy\n');
    return {};
  }
  return readPolicyModelConfig(policyPath);
}

// { opts } or { error }. A value-taking flag needs a value: a missing, blank or
// `--`-led one is refused, as resolve-profile.js's requireValue does.
function parseArgs(argv) {
  const args = [...argv];
  const opts = {};
  while (args.length) {
    const flag = args.shift();
    if (!FLAGS.includes(flag)) return { error: `unknown argument ${JSON.stringify(flag)}` };
    if (Object.hasOwn(opts, flag)) return { error: `${flag} given more than once` };
    const value = args.shift();
    if (value === undefined || value.startsWith('--') || value.trim() === '') return { error: `${flag} requires a value` };
    opts[flag] = value;
  }
  return { opts };
}

function run(argv, deps = realDeps) {
  const fail = (code, msg) => {
    deps.stderr(`implementer-tier: ${msg}\n`);
    return code;
  };

  const parsed = parseArgs(argv);
  if (parsed.error) return fail(EXIT_INVOCATION, `${parsed.error}\n${USAGE}`);
  const { '--spec-file': specFile, '--rule': ruleFlag, '--run': runDir, '--from': from } = parsed.opts;
  const attempt = ATTEMPT_FLAGS.filter((f) => parsed.opts[f] !== undefined);
  if (attempt.length > 0 && attempt.length < ATTEMPT_FLAGS.length) {
    const missing = ATTEMPT_FLAGS.filter((f) => parsed.opts[f] === undefined);
    return fail(EXIT_INVOCATION, `the attempt flags are all-or-none — missing ${missing.join(', ')}\n${USAGE}`);
  }
  if (specFile === undefined) return fail(EXIT_INVOCATION, `--spec-file is required\n${USAGE}`);
  if (ruleFlag !== undefined && !RULES.includes(ruleFlag)) {
    return fail(EXIT_INVOCATION, `--rule ${JSON.stringify(ruleFlag)} is not valid — expected lane or record`);
  }
  if (from !== undefined && !Object.hasOwn(PROFILES, from)) {
    return fail(EXIT_INVOCATION, `--from ${JSON.stringify(from)} is not a profile — expected ${Object.keys(PROFILES).join(', ')}`);
  }

  if (attempt.length > 0) {
    const { '--attempt-profile': ap, '--attempt-effort': ae, '--escalations': esc, '--trigger': trig } = parsed.opts;
    if (!Object.hasOwn(PROFILES, ap)) return fail(EXIT_INVOCATION, `--attempt-profile ${JSON.stringify(ap)} is not a profile — expected ${Object.keys(PROFILES).join(', ')}`);
    if (!ATTEMPT_EFFORTS.includes(ae)) return fail(EXIT_INVOCATION, `--attempt-effort ${JSON.stringify(ae)} is not valid — expected ${ATTEMPT_EFFORTS.join(', ')}`);
    if (!/^[0-9]$/.test(esc) || Number(esc) > MAX_ESCALATIONS) return fail(EXIT_INVOCATION, `--escalations ${JSON.stringify(esc)} is not valid — expected 0..${MAX_ESCALATIONS}`);
    if (!TRIGGERS.includes(trig)) return fail(EXIT_INVOCATION, `--trigger ${JSON.stringify(trig)} is not valid — expected ${TRIGGERS.join(', ')}`);
  }

  let text;
  try {
    const resolved = fsPath(deps, specFile);
    try {
      text = fs.readFileSync(resolved, 'utf8');
    } catch (err) {
      // Node names the resolved path; print the spelling the caller typed.
      return fail(EXIT_PAYLOAD, `cannot read spec file ${specFile}: ${err.message.split(resolved).join(specFile)}`);
    }
  } catch (err) {
    return fail(EXIT_PAYLOAD, `cannot read spec file ${specFile}: ${err.message}`);
  }

  const header = readSize(text);
  if (header.error) return fail(EXIT_PAYLOAD, header.error);

  // resolvePolicy is the one validator for --run, so it runs whenever --run is
  // given even though --rule then wins over what it resolved.
  let rule = ruleFlag;
  if (ruleFlag === undefined || runDir !== undefined) {
    let out;
    try {
      out = resolvePolicy({ keys: [POLICY_KEY], runDir: runDir ?? null }, deps);
    } catch (err) {
      return fail(EXIT_PAYLOAD, `cannot resolve the ${POLICY_KEY} policy: ${err.message}`);
    }
    if (out.code !== 0) return fail(EXIT_INVOCATION, out.message);
    if (ruleFlag === undefined) {
      const entry = out.result[POLICY_KEY];
      if (entry.invalid === true) {
        return fail(EXIT_PAYLOAD, `invalid ${POLICY_KEY} value ${JSON.stringify(out.invalidRaw.get(POLICY_KEY))} — expected lane or record`);
      }
      rule = entry.value;
    }
  }

  let line;
  try {
    const count = keyFileCount(text);
    const profile = implementerProfile({ size: header.size, keyFileCount: count, rule });
    const policy = readPolicy(deps);
    const base = from ?? profile;
    const ladder = rule === 'record' && policy['model-effort'] === 'profile';
    const start = base === null ? null : startEffort({ risk: readRisk(text), launchEffort: resolve(base, { policy }).launchEffort });
    let next = null;
    if (ladder && attempt.length > 0) {
      const { '--attempt-profile': ap, '--attempt-effort': ae, '--escalations': esc, '--trigger': trig } = parsed.opts;
      next = nextAttempt({
        profile: ap,
        effort: ae === 'inherit' ? null : ae,
        escalations: Number(esc),
        trigger: trig,
        resolveProfile: (p) => {
          const r = resolve(p, { policy });
          return { model: r.model, launchEffort: r.launchEffort };
        },
      });
    }
    line = JSON.stringify({ profile, stepUp: stepUp(base), rule, size: header.size ?? null, keyFileCount: count, startEffort: start, next, ladder });
  } catch (err) {
    return fail(EXIT_PAYLOAD, err.message);
  }
  deps.stdout(`${line}\n`);
  return EXIT_OK;
}

const realDeps = { ...policyDeps };

module.exports = { run, realDeps, EXIT_OK, EXIT_PAYLOAD, EXIT_INVOCATION };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
