// bin/lib/policy.js — reads flat kebab-case project policy from
// .claude-tweaks/policy.yml (skills/_shared/policy-key-naming.md); dotted
// names still parse — they are the RENAMED_KEYS aliases.
// No YAML dependency: the plugin ships zero runtime deps, and the only
// supported shape is a top-level `key: value` line, in the flat kebab-case
// convention that file documents.
// Parsing is delegated to bin/lib/policy-schema.js's parseFlatLines, so one
// flat-line parser implementation remains; this module only does the fs read
// plus each reader's own value interpretation.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseFlatLines, RENAMED_KEYS, resolveValue } = require('./policy-schema');

function readPolicyFile(repoRoot) {
  try {
    return fs.readFileSync(path.join(repoRoot, '.claude-tweaks', 'policy.yml'), 'utf8');
  } catch {
    return null;
  }
}

function parsePolicy(repoRoot) {
  return parseFlatLines(readPolicyFile(repoRoot));
}

// Alias-aware raw read for the hook's hot path. `parseFlatLines` returns
// whatever the file literally says, keyed by literal name; a project whose
// policy.yml predates a rename still says the OLD name. RENAMED_KEYS is the
// one place that knows which old name maps to which new one, so consult it
// here rather than hard-coding the pair. Precedence mirrors bin/resolve-policy
// (resolvePolicyKeys' uniform alias rule): the new NAME wins whenever it is
// present, in any file order; the old name contributes only when the new one
// is absent. This is a raw-string read — no type coercion — so each reader
// below still applies its own literal interpretation, exactly as before.
// Assumes the alias's `migrate` is string-preserving (identity), which every
// alias a hook reads is today; a null-migrating alias would read as unset
// here — i.e. gate OFF — so a future non-identity alias for a hook-read key
// must extend this helper rather than rely on it.
//
// { on: boolean, matchedKey: 'worktree-always' | 'worktree.always' | null } —
// the same alias-aware lookup isWorktreeAlwaysOn always did, now exposing
// WHICH key resolved it. session-start.js's verdict banner and this gate
// must never disagree, so both call this — see docs/incident-log.md IL-133.
function resolveWorktreeAlways(repoRoot) {
  const parsed = parsePolicy(repoRoot);
  if (Object.prototype.hasOwnProperty.call(parsed, 'worktree-always')) {
    return { on: parsed['worktree-always'] === 'true', matchedKey: 'worktree-always' };
  }
  const alias = RENAMED_KEYS.find((entry) => entry.replacedBy === 'worktree-always');
  if (alias && Object.prototype.hasOwnProperty.call(parsed, alias.key)) {
    return { on: alias.migrate(parsed[alias.key]) === 'true', matchedKey: alias.key };
  }
  return { on: false, matchedKey: null };
}

// `worktree-always: true` — anything else (absent, `false`, trailing garbage
// that isn't a `# comment`) reads as policy-OFF. Trailing `# comment` after
// the value is stripped by parseFlatLines — policy.yml is documented as
// hand-editable (skills/_shared/git-discipline.md, skills/init/SKILL.md), and
// a user who hand-writes `worktree-always: true  # enabled after the incident
// on 2026-07-10` must not have that natural annotation silently read as
// policy-OFF. The pre-#602 spelling `worktree.always` reads through
// resolveWorktreeAlways's alias path (skills/_shared/policy-deprecations.md
// holds its removal condition).
function isWorktreeAlwaysOn(repoRoot) {
  return resolveWorktreeAlways(repoRoot).on;
}

// `integration-branch: <name>` — where finished work lands. Unset on most
// projects, where each consumer falls back to the repository's own default
// branch. Trailing `# comment` tolerated; a value containing internal
// whitespace is not a branch name git would accept, so it reads as unset.
function readIntegrationBranch(repoRoot) {
  const value = parsePolicy(repoRoot)['integration-branch'];
  if (!value || /\s/.test(value)) return null;
  return value;
}

// Generic single-line comma-separated list-key reader — the same convention
// already documented for merge-sensitive-paths (assess-agent-autonomy/
// SKILL.md): `key: a,b,c` on one line, trailing `# comment` tolerated. Empty
// or absent both return `[]` — a caller needing to distinguish "no value
// configured" from "configured empty" has nothing to distinguish, since a
// hand-written `key: ` line with nothing after the colon is indistinguishable
// from an absent key under this flat-file format. Used by any policy key
// typed `list` in bin/lib/policy-schema.js whose reader needs the parsed
// array rather than the raw string (candidates-experiment-cleanup.js's
// `experiment-flag-patterns` / `experiment-flag-exclude` is the first
// caller).
function readListKey(repoRoot, key) {
  const value = parsePolicy(repoRoot)[key];
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

// `gh-timeout-ms` (#2567) — the one integer-typed lever bin/lib/shared-
// primitives.js reads through this module rather than re-implementing
// policy-schema.js's own validation/default logic. resolveValue already
// does everything a bespoke reader here would: absent/blank -> the schema's
// default (5000), an out-of-[min,max]-range or non-integer value -> the
// same default, a valid value -> the parsed integer. No alias to migrate —
// this key has no prior name.
function readGhTimeoutMs(repoRoot) {
  return resolveValue('gh-timeout-ms', parsePolicy(repoRoot)['gh-timeout-ms']);
}

const SERVICE_NAME_RE = /^[a-z][a-z0-9-]*$/;

// `port-services` (#1792): the list-key convention above, plus per-entry
// name validation and a block-capacity check session-start.js needs to
// render as user-visible lines — kept here rather than folded into
// readListKey since no other list-key caller needs either check.
// Returns { services, invalidNames, overCapacity }: `services` is the
// validated, in-bound-capacity list to actually activate port isolation
// with (empty when overCapacity, so a caller can just check `.length`
// without also checking the flag); `invalidNames` lists entries dropped for
// failing SERVICE_NAME_RE (still dropped even when overCapacity, since a
// malformed name is invalid regardless of how many other entries there
// are); `overCapacity` is true when the validated list is longer than the
// registry's BLOCK_SIZE and therefore cannot fit any one block.
function resolvePortServices(repoRoot) {
  // Required here, not at module top: bin/lib/ports/registry.js pulls in
  // bin/lib/hooks/worktree-detect.js -> bin/lib/hooks/git-exec.js, and this
  // module has no other dependency on anything under hooks/ — a top-level
  // require would add that whole chain to every consumer of policy.js
  // (including pre-tool-use.js's hot path) just for one constant.
  // eslint-disable-next-line global-require
  const { BLOCK_SIZE } = require('./ports/registry');
  const raw = readListKey(repoRoot, 'port-services');
  const services = [];
  const invalidNames = [];
  for (const name of raw) {
    if (SERVICE_NAME_RE.test(name)) services.push(name);
    else invalidNames.push(name);
  }
  if (services.length > BLOCK_SIZE) {
    return { services: [], invalidNames, overCapacity: true, requestedCount: services.length };
  }
  return { services, invalidNames, overCapacity: false, requestedCount: services.length };
}

module.exports = {
  isWorktreeAlwaysOn, resolveWorktreeAlways, readIntegrationBranch, readListKey, resolvePortServices, readGhTimeoutMs,
};
