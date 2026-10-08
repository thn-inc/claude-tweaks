// bin/lib/merge-verification.js — derived default for the `merge-verification`
// policy key (#559): how much CI verification a merge into the integration
// branch requires. The four-branch ladder is stated in prose exactly once, in
// skills/_shared/policy-schema-coverage.md's merge-verification coverage block; this
// file is its code twin, the same way bin/lib/policy-schema.js's
// detectIntegrationModel twins skills/_shared/forge-detection.md.
//
// A flat sibling of policy-schema.js rather than part of it: branch (3)/(4)
// reuses bin/lib/hooks/worktree-reap.js's resolveIntegrationBranch — the shared
// code resolver for skills/_shared/integration-branch.md's rank 3 (policy.yml)
// + rank-5 GitHub-default half — and worktree-reap.js -> bin/lib/policy.js ->
// policy-schema.js would make that a require cycle. Never hand-roll branch
// detection here; cite the fragment.
//
// Every branch fails toward 'off' (the permissive default), never toward the
// stricter value. Zero runtime npm deps: no YAML library — the on: trigger
// detector below is line-based and deliberately shallow.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveIntegrationModel } = require('./policy-schema');
const { resolveIntegrationBranch, bareIntegrationName } = require('./hooks/worktree-reap');

const PR_TRIGGERS = new Set(['pull_request', 'pull_request_target']);

function stripQuotes(s) {
  return s.trim().replace(/^['"]|['"]$/g, '');
}

function stripComment(s) {
  const m = /\s#/.exec(s);
  return (m === null ? s : s.slice(0, m.index)).trim();
}

// Depth-aware key scan for a flow mapping like `{ push: { branches: [x] },
// pull_request: {} }`: returns the identifiers that sit immediately before a
// `:` while brace depth is 1 (directly inside the outer `{ }`). A key nested
// inside another trigger's value sits at depth 2+ and is never returned.
// Quoted spans are tracked so a colon inside a quoted value can't be mistaken
// for a key separator.
function flowMappingKeysAtDepth1(s) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let token = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else token += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '{') { depth++; token = ''; continue; }
    if (ch === '}') { depth--; token = ''; continue; }
    if (ch === ',') { token = ''; continue; }
    if (ch === ':') {
      if (depth === 1) keys.push(token.trim());
      token = '';
      continue;
    }
    token += ch;
  }
  return keys;
}

// True iff the workflow's top-level `on:` (col 0; `on`, 'on', or "on") names
// pull_request or pull_request_target — as a bare scalar, inside a flow array
// [a, b], as a flow-mapping key { pull_request: … }, as a block-list item
// (`  - pull_request`), or as a block-mapping key at the trigger indent
// (`  pull_request:`). Keys nested deeper than the trigger level (e.g. a
// `branches:` under push:) never count. Trigger PRESENCE is the proxy for "CI
// verification is requested" — enforcement (branch protection) is out of scope.
function workflowHasPullRequestTrigger(text) {
  if (typeof text !== 'string' || !text) return false;
  // Strip a leading UTF-8 BOM (some editors/tools save workflow YAML with
  // one) so the on: line-anchor regex below still matches at col 0.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:on|'on'|"on")\s*:(.*)$/.exec(lines[i]);
    if (!m) continue;
    const rest = stripComment(m[1]);
    if (rest) {
      if (rest.startsWith('[')) {
        return rest.replace(/^\[|\]$/g, '').split(',').map(stripQuotes).some((k) => PR_TRIGGERS.has(k));
      }
      if (rest.startsWith('{')) {
        return flowMappingKeysAtDepth1(rest).some((k) => PR_TRIGGERS.has(k));
      }
      return PR_TRIGGERS.has(stripQuotes(rest));
    }
    // Block form: the trigger level is the indent of the first non-blank,
    // non-comment line after `on:`; only lines at exactly that indent count.
    let triggerIndent = null;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const indent = /^(\s*)/.exec(line)[1].length;
      if (indent === 0) break; // next top-level key — end of the on: block
      if (triggerIndent === null) triggerIndent = indent;
      if (indent !== triggerIndent) continue;
      const item = /^\s*-\s*(['"]?[A-Za-z_]+['"]?)\s*(?:#.*)?$/.exec(line);
      if (item && PR_TRIGGERS.has(stripQuotes(item[1]))) return true;
      const key = /^\s*(['"]?[A-Za-z_]+['"]?)\s*:/.exec(line);
      if (key && PR_TRIGGERS.has(stripQuotes(key[1]))) return true;
    }
    return false;
  }
  return false;
}

// Reads every *.yml / *.yaml directly under {root}/.github/workflows. An
// absent directory is the ordinary "no CI" case and returns []; any other fs
// error throws so hasPullRequestCi can degrade uniformly.
function readWorkflowFiles(repoRoot) {
  const dir = path.join(repoRoot, '.github', 'workflows');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((n) => /\.ya?ml$/i.test(n))
    .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

// Detection is GitHub Actions-only by intent (spec Non-Goals): a repo on
// another CI system reads as "no PR CI" and opts in with an explicit value.
// Never throws — a read/parse failure resolves toward `off` in the ladder.
function hasPullRequestCi(repoRoot, { readWorkflows = readWorkflowFiles } = {}) {
  try {
    return readWorkflows(repoRoot).some((f) => workflowHasPullRequestTrigger(f && f.text));
  } catch {
    return false;
  }
}

// The repository's default branch — skills/_shared/integration-branch.md's
// rank-5 GitHub-default half, in code: gh's defaultBranchRef, else the local
// origin/HEAD symref (what a clone records), else null. Never throws.
//
// Accepted asymmetry (branch (3)/(4) below): resolveIntegrationBranch answers
// from policy.yml, else the local origin/HEAD symref; this function prefers
// gh's live defaultBranchRef first, THEN the same local origin/HEAD fallback.
// A stale local origin/HEAD (e.g. after a remote default-branch rename) can
// therefore make the two disagree online vs. offline — the mismatch fails
// toward `off`, never toward the stricter `merge-when-green`.
function readDefaultBranch(repoRoot) {
  const opts = { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, encoding: 'utf8', windowsHide: true };
  try {
    const name = execFileSync('gh', ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], opts).trim();
    if (name) return name;
  } catch {}
  try {
    const ref = execFileSync('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD'], opts).trim();
    const name = ref.replace(/^origin\//, '');
    if (name) return name;
  } catch {}
  return null;
}

// The four-branch ladder — first match wins, no fall-through. `deps` lets tests
// inject each lookup; production callers pass nothing.
//   (1) integration-model resolves local-merge          -> off
//   (2) no PR-triggered CI under .github/workflows       -> off
//   (3) integration branch is the repo's default branch -> merge-when-green
//   (4) any other (non-default) integration branch       -> off
// Prose statement of record: skills/_shared/policy-schema-coverage.md's coverage block.
// integration-model per skills/_shared/integration-model.md; the branch pair
// per skills/_shared/integration-branch.md via the shared resolvers, never a
// hand-rolled detection. Any lookup failure resolves toward off.
function deriveMergeVerification(repoRoot, deps = {}) {
  const integrationModel = deps.integrationModel || resolveIntegrationModel;
  const readWorkflows = deps.readWorkflows || readWorkflowFiles;
  const integrationBranch = deps.integrationBranch || resolveIntegrationBranch;
  const defaultBranch = deps.defaultBranch || readDefaultBranch;

  let model;
  try { model = integrationModel(repoRoot); } catch { return 'off'; }
  if (model === 'local-merge') return 'off';                       // (1)

  if (!hasPullRequestCi(repoRoot, { readWorkflows })) return 'off'; // (2)

  let target;
  let fallback;
  try {
    // #1688: resolveIntegrationBranch's policy-configured path can now
    // return an `origin/{name}` remote-tracking ref (preferRemoteTrackingRef,
    // worktree-reap.js). `fallback` below is always bare (readDefaultBranch
    // strips any `origin/` prefix itself), so `target` needs the same
    // normalization or a policy-configured integration branch that matches
    // the default branch silently reads as (4) instead of (3) below.
    target = bareIntegrationName(integrationBranch(repoRoot));
    fallback = defaultBranch(repoRoot);
  } catch {
    return 'off';
  }
  if (!target || !fallback) return 'off';
  return target === fallback ? 'merge-when-green' : 'off';         // (3) / (4)
}

// The one resolution path is bin/resolve-policy.js: explicit policy.yml value
// (ordinary enum validation) wins, an invalid value stays visible as
// `invalid: true` (never silently re-derived), and only an *absent* key reaches
// deriveMergeVerification. There is deliberately no in-process resolver twin
// here — the merge sites read the lever through the CLI (`--run … --values
// merge-verification`, _shared/pr-first-merge.md Step 2.5), so a second
// resolver would carry a second contract with no consumer.

// readDefaultBranch stays internal: deriveMergeVerification's callers inject
// `deps.defaultBranch` when they need a stand-in, and nothing imports the
// real lookup on its own.
module.exports = {
  workflowHasPullRequestTrigger, readWorkflowFiles, hasPullRequestCi,
  deriveMergeVerification,
};
