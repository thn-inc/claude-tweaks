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
const { ghOptions } = require('./repo-resolve');

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
// Twin: flowMappingEntries (below) scans the same shape for readPullRequestWorkflow.
// This one feeds workflowHasPullRequestTrigger and fails toward "no PR trigger"
// (off); the twin's callers fail toward "unparsed" (wait for a ready run).
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
// Twin: readPullRequestWorkflow (below) repeats this `on:` walk, and the two
// have diverged on purpose. This one is unchanged and fails toward `false` ("no
// PR trigger", the permissive `off` direction) on any shape it cannot read; the
// twin additionally strips a leading `&anchor`, reads the `on:` line with a
// quote-aware comment strip, walks an indentless top-level sequence, and
// reports every unreadable shape as `unparsed` (fail closed) instead.
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

// --- Workflow reader: PR trigger `types:`, draft reference, unparsed (#5153) ---
//
// The merge gate must wait for the CI run `gh pr ready` starts, but only when a
// workflow actually runs on ready_for_review. This reader answers, per workflow
// file and line-based like workflowHasPullRequestTrigger (no YAML library):
// which activity types its pull_request/pull_request_target triggers fire on,
// and whether any job `if:` references the PR's draft flag.
//
// Two failure directions, both deliberate. A miss — a trigger or draft guard
// that lives in a reusable workflow (`uses:`) this reader never opens — leaves
// today's behaviour (no ready-run wait). A false hit — an `on:` it cannot read
// (an unbalanced flow list/mapping, an alias or expression scalar, a `<<:`
// merge key) or a `types:` value it cannot read — is reported as `unparsed`
// with prTrigger true: the gate waits for a ready run and parks with a named
// reason (spec Gotcha 3). Unreadable is never read as "no PR trigger" and never
// collapsed into the default types. (workflowHasPullRequestTrigger, by
// contrast, keeps its fail-toward-off direction.)

// GitHub's default activity types for pull_request / pull_request_target.
const DEFAULT_PR_TYPES = Object.freeze(['opened', 'synchronize', 'reopened']);

// `github.event.pull_request.draft` and its index forms `['draft']` / `["draft"]`.
const DRAFT_REF = /\bgithub\.event\.pull_request(?:\.draft\b(?!\w)|\[\s*['"]draft['"]\s*\])/;

// stripComment, but a `#` inside a quoted string is not a comment start (an `if:`
// expression such as contains(x, ' #wip') carries one). A quote opens only after
// a non-word character, so an in-word apostrophe (`Don't`) never swallows a
// later real comment.
function stripCommentQuoteAware(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (quote === '"' && ch === '\\') i++; // an escaped character never closes the quote
      else if (ch === quote) quote = null;
      continue;
    }
    if ((ch === "'" || ch === '"') && (i === 0 || !/[\p{L}\p{M}\p{N}_]/u.test(s[i - 1]))) { quote = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trim();
  }
  return s.trim();
}
const TYPE_ITEM = /^[A-Za-z_]+$/;
const BLOCK_ITEM = /^['"]?[A-Za-z_]+['"]?$/;

// A trigger that fires on GitHub's default activity types.
const defaultTrigger = () => ({ types: [...DEFAULT_PR_TYPES], declared: false, unparsed: false });

// A trigger the reader knows exists but cannot read: contributes no types, sets
// prTrigger and unparsed.
const UNREADABLE_TRIGGER = () => ({ types: [], declared: false, unparsed: true });

function emptyWorkflowRead() {
  return { prTrigger: false, types: [], typesDeclared: false, draftReference: false, unparsed: false };
}

// Entries {key, value} sitting directly inside the outer `{ }` of a one-line
// flow mapping, plus whether the braces balanced on this line. Commas and
// colons inside nested braces/brackets or quotes never split an entry.
// Twin: flowMappingKeysAtDepth1 (above) — it feeds workflowHasPullRequestTrigger
// and fails toward "no PR trigger"; this one's callers fail toward `unparsed`.
function flowMappingEntries(s) {
  const entries = [];
  let depth = 0;
  let bracket = 0;
  let quote = null;
  let cur = '';
  let key = null;
  const flush = () => {
    if (key !== null) entries.push({ key, value: cur.trim() });
    key = null;
    cur = '';
  };
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '{') {
      depth++;
      if (depth === 1) cur = ''; else cur += ch;
      continue;
    }
    if (ch === '}') {
      if (depth === 1) flush(); else cur += ch;
      depth--;
      continue;
    }
    if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    if (depth === 1 && bracket === 0) {
      if (ch === ',') { flush(); continue; }
      if (ch === ':' && key === null) { key = stripQuotes(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  flush();
  return { entries, balanced: depth === 0 };
}

// Items of a one-line `[a, b]`; null when any item is not a plain identifier.
function readFlowItems(inner) {
  const items = inner.split(',').map(stripQuotes).filter((x) => x !== '');
  return items.every((x) => TYPE_ITEM.test(x)) ? items : null;
}

// The effective types of a PR trigger whose value sits on the trigger's own
// line (scalar-less key value or a flow-mapping value): {} / null / ~ / empty
// are the defaults; a value mentioning `types` is read only from a one-line
// `types: [..]`; a value without `types` declares none (defaults).
function readInlineTriggerValue(value) {
  const v = stripComment(value);
  if (v === '' || v === '{}' || v === 'null' || v === '~') return defaultTrigger();
  if (!/\btypes\b/.test(v)) {
    return v.startsWith('{')
      ? defaultTrigger()
      : { types: [], declared: false, unparsed: true };
  }
  const m = /\btypes\s*:\s*\[([^\][]*)\]/.exec(v);
  const items = m ? readFlowItems(m[1]) : null;
  return items ? { types: items, declared: true, unparsed: false } : { types: [], declared: true, unparsed: true };
}

// The effective types of a block-form trigger key at lines[at] (indent
// `indent`, text after the colon `rest`): scan its sub-block for a `types:` key
// at the sub-block's first indent.
function readBlockTrigger(lines, at, indent, rest) {
  if (stripComment(rest) !== '') return readInlineTriggerValue(rest);
  let subIndent = null;
  for (let j = at + 1; j < lines.length; j++) {
    const line = lines[j];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const ind = /^(\s*)/.exec(line)[1].length;
    if (ind <= indent) break;
    if (subIndent === null) subIndent = ind;
    if (ind !== subIndent) continue;
    const km = /^\s*(?:types|'types'|"types")\s*:(.*)$/.exec(line);
    if (!km) continue;
    const val = stripComment(km[1]);
    if (val.startsWith('[')) {
      const items = val.endsWith(']') ? readFlowItems(val.slice(1, -1)) : null;
      return items ? { types: items, declared: true, unparsed: false } : { types: [], declared: true, unparsed: true };
    }
    if (val !== '') {
      return TYPE_ITEM.test(val)
        ? { types: [val], declared: true, unparsed: false }
        : { types: [], declared: true, unparsed: true };
    }
    // Empty value: `- item` lines at an indent >= the key's (the indentless
    // `types:\n- opened` form included).
    const items = [];
    for (let k = j + 1; k < lines.length; k++) {
      const l = lines[k];
      if (!l.trim() || l.trim().startsWith('#')) continue;
      const lind = /^(\s*)/.exec(l)[1].length;
      const im = /^\s*-\s+(.*)$/.exec(l);
      if (lind < ind || !im) break;
      const item = stripComment(im[1]);
      if (!BLOCK_ITEM.test(item)) return { types: [], declared: true, unparsed: true };
      items.push(stripQuotes(item));
    }
    return items.length > 0
      ? { types: items, declared: true, unparsed: false }
      : { types: [], declared: true, unparsed: true };
  }
  return defaultTrigger();
}

// Never throws; a non-string or empty input reads as all-false.
function readPullRequestWorkflow(text) {
  const out = emptyWorkflowRead();
  if (typeof text !== 'string' || !text) return out;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  out.draftReference = lines.some((l) => !l.trim().startsWith('#') && DRAFT_REF.test(stripCommentQuoteAware(l)));
  // A file that never spells `pull_request` cannot name a PR trigger, however
  // its `on:` is shaped, so a shape this reader cannot follow (an alias, a merge
  // key, an indentless schedule list) costs no ready-run wait there. A
  // double-quoted escape is the one way to spell the name without the literal,
  // so a backslash inside double quotes keeps the full, fail-closed read.
  if (!text.includes('pull_request') && !/"[^"]*\\/.test(text)) return out;

  const triggers = [];
  const onIdx = lines.findIndex((l) => /^(?:on|'on'|"on")\s*:/.test(l));
  if (onIdx >= 0) {
    // A leading `&anchor` only names the node; the block (if any) still follows.
    const rest = stripCommentQuoteAware(/^(?:on|'on'|"on")\s*:(.*)$/.exec(lines[onIdx])[1]).replace(/^&[^\s[\]{},]+\s*/, '');
    if (rest) {
      if (rest.startsWith('[')) {
        if (!rest.endsWith(']')) {
          triggers.push(UNREADABLE_TRIGGER()); // multi-line flow list
        } else {
          const names = rest.slice(1, -1).split(',').map(stripQuotes).filter((k) => k !== '');
          if (!names.every((k) => TYPE_ITEM.test(k))) {
            triggers.push(UNREADABLE_TRIGGER()); // *alias, ${{ … }} or another non-name item
          } else if (names.some((k) => PR_TRIGGERS.has(k))) {
            triggers.push(defaultTrigger());
          }
        }
      } else if (rest.startsWith('{')) {
        const { entries, balanced } = flowMappingEntries(rest);
        for (const e of entries) {
          if (PR_TRIGGERS.has(e.key)) triggers.push(readInlineTriggerValue(e.value));
        }
        // Multi-line flow mapping: the PR key may sit on a later line.
        if (!balanced) triggers.push(UNREADABLE_TRIGGER());
      } else if (!TYPE_ITEM.test(stripQuotes(rest))) {
        triggers.push(UNREADABLE_TRIGGER()); // *alias, ${{ … }}, anything but a name (a leading &anchor was stripped above)
      } else if (PR_TRIGGERS.has(stripQuotes(rest))) {
        triggers.push(defaultTrigger());
      }
    } else {
      let triggerIndent = null;
      for (let j = onIdx + 1; j < lines.length; j++) {
        const line = lines[j];
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const indent = /^(\s*)/.exec(line)[1].length;
        // An indentless top-level sequence (`on:\n- push`) keeps `- ` items at col 0.
        if (indent === 0 && !/^-(?:\s|$)/.test(line)) break;
        if (triggerIndent === null) triggerIndent = indent;
        if (indent !== triggerIndent) continue;
        if (/^\s*<<\s*:/.test(line)) { // merge key: triggers come from an anchor
          triggers.push(UNREADABLE_TRIGGER());
          continue;
        }
        const li = /^\s*-\s*(.*)$/.exec(line);
        if (li) {
          const item = stripCommentQuoteAware(li[1]);
          if (!BLOCK_ITEM.test(item)) triggers.push(UNREADABLE_TRIGGER()); // `- *pr`, `- ${{ … }}`
          else if (PR_TRIGGERS.has(stripQuotes(item))) triggers.push(defaultTrigger());
          continue;
        }
        const key = /^\s*(['"]?[A-Za-z_]+['"]?)\s*:(.*)$/.exec(line);
        if (key && PR_TRIGGERS.has(stripQuotes(key[1]))) triggers.push(readBlockTrigger(lines, j, indent, key[2]));
      }
    }
  }

  if (triggers.length === 0) return out;
  out.prTrigger = true;
  const union = new Set();
  for (const t of triggers) {
    for (const ty of t.types) union.add(ty);
    if (t.declared) out.typesDeclared = true;
    if (t.unparsed) out.unparsed = true;
  }
  out.types = [...union];
  return out;
}

// Classifies readPullRequestWorkflow rows ({ file, ...result }, input order,
// PR-triggered rows only): a workflow that fires on ready_for_review — or whose
// `types:` could not be read — needs the ready run's CI waited on; one that
// references the draft flag without firing on ready_for_review skips drafts
// with nothing re-running at ready. `unparsed` rows are listed in both
// readyWorkflows and unparsed so the caller can name the reason.
function readyRequirement(workflows) {
  const out = { readyWorkflows: [], draftSkipWithoutReadyTrigger: [], unparsed: [] };
  if (!Array.isArray(workflows)) return out;
  for (const w of workflows) {
    if (!w || !w.prTrigger) continue;
    if (w.unparsed) {
      out.readyWorkflows.push(w.file);
      out.unparsed.push(w.file);
    } else if (Array.isArray(w.types) && w.types.includes('ready_for_review')) {
      out.readyWorkflows.push(w.file);
    } else if (w.draftReference) {
      out.draftSkipWithoutReadyTrigger.push(w.file);
    }
  }
  return out;
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
    // windowsHide restated in the call: the windows-hide scan reads a bare
    // opts, never one wrapped in ghOptions (#4505's GH_HOST seam).
    const args = ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'];
    const name = execFileSync('gh', args, ghOptions(args, { ...opts, windowsHide: true })).trim();
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
  DEFAULT_PR_TYPES, readPullRequestWorkflow, readyRequirement,
  deriveMergeVerification, PR_TRIGGERS,
};
