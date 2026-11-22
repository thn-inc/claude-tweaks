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
// Output: one stdout line, JSON.stringify({ profile, stepUp, rule, size, keyFileCount })
// — `size` null when the header has neither line, `profile` null under `lane`
// then, `stepUp` one profile up from --from (else the computed profile), null
// from capable, frontier or null.
//
// Rule: --rule, else the run's config.yml via --run, else policy.yml, else the
// schema default (lane). --run is validated even when --rule is passed (a
// mistyped run id never passes silently); the resolved policy value is then
// ignored, so an invalid policy.yml value does not fail a --rule call.
//
// Exit codes (the Payload-1/Invocation-2 family, per
// .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md):
//   0  the line was printed
//   1  the invocation was well-formed but its payload was not: an unreadable
//      spec file, a malformed header (a size:/effort: value outside
//      low/medium/high, or the line given twice), or an invalid resolved
//      implementer-tier value from policy.yml or the run's config.yml
//   2  malformed invocation: no --spec-file, an unknown flag, a flag without a
//      value, a flag given twice, an invalid --rule or --from, or a --run that
//      resolvePolicy refuses (anchored-or-outside guard, missing directory)
// Nothing is written to disk.
'use strict';
const fs = require('fs');
const { PROFILES } = require('./lib/model-profiles/profiles');
const { POLICY_KEY, RULES, SIZES, keyFileCount, implementerProfile, stepUp } = require('./lib/model-profiles/implementer-tier');
const { fsPath } = require('./lib/health-core/io');
const { resolvePolicy, realDeps: policyDeps } = require('./resolve-policy');

const EXIT_OK = 0;
const EXIT_PAYLOAD = 1;
const EXIT_INVOCATION = 2;

const USAGE = 'usage: implementer-tier.js --spec-file <path> [--rule lane|record] [--run <dir>] [--from <profile>]';
const FLAGS = ['--spec-file', '--rule', '--run', '--from'];
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
  if (specFile === undefined) return fail(EXIT_INVOCATION, `--spec-file is required\n${USAGE}`);
  if (ruleFlag !== undefined && !RULES.includes(ruleFlag)) {
    return fail(EXIT_INVOCATION, `--rule ${JSON.stringify(ruleFlag)} is not valid — expected lane or record`);
  }
  if (from !== undefined && !Object.hasOwn(PROFILES, from)) {
    return fail(EXIT_INVOCATION, `--from ${JSON.stringify(from)} is not a profile — expected ${Object.keys(PROFILES).join(', ')}`);
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
    line = JSON.stringify({ profile, stepUp: stepUp(from ?? profile), rule, size: header.size ?? null, keyFileCount: count });
  } catch (err) {
    return fail(EXIT_PAYLOAD, err.message);
  }
  deps.stdout(`${line}\n`);
  return EXIT_OK;
}

const realDeps = { ...policyDeps };

module.exports = { run, realDeps, EXIT_OK, EXIT_PAYLOAD, EXIT_INVOCATION };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
