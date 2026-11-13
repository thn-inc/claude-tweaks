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
      let sequence = false;
      for (let j = onIdx + 1; j < lines.length; j++) {
        const line = lines[j];
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const indent = /^(\s*)/.exec(line)[1].length;
        // An indentless top-level sequence (`on:\n- push`) keeps `- ` items at col 0.
        if (indent === 0 && !/^-(?:\s|$)/.test(line)) break;
        if (triggerIndent === null) {
          triggerIndent = indent;
          // The first item decides the `on:` value's shape. Under a mapping, a `- ` line at
          // the trigger indent is an indentless sequence value of the key above it
          // (`  schedule:\n  - cron: …`), never a trigger.
          sequence = /^\s*-(?:\s|$)/.test(line);
        }
        if (indent !== triggerIndent) continue;
        if (!sequence && /^\s*-(?:\s|$)/.test(line)) continue;
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

// --- Workflow shape reader (#5162) ---
//
// init's CI workflow review (bin/lib/init/ci-workflow-review.js) reads a whole
// workflow's shape from here, so every YAML-shape read stays in this one file:
// the filters under the PR triggers, push's branch filter, each job's id, its
// job-level `if:` text, its step-level `if:` count and job-level concurrency,
// and the workflow-level concurrency. Line-based like the readers above, no
// YAML library. It never guesses: a shape it cannot follow adds a reason string
// to `unparsed`, and the review reports that workflow as unparsed rather than
// judging it. The readers above are called, never changed.

const PR_FILTER_KEYS = Object.freeze(['branches', 'branches-ignore', 'paths', 'paths-ignore']);

// A push branch-filter item, optionally quoted with balanced quotes: BLOCK_ITEM
// widened with digits and the glob/path characters `*`, `/`, `.`, `-`.
const BRANCH_ITEM = /^(['"]?)[A-Za-z0-9_*/.-]+\1$/;
const BLOCK_SCALAR = /^[|>][-+0-9]*$/;
const PLAIN_KEY = /^[^\s#'"[\]{},&*!|>%@`-]\S*$/;
// Every `(.*)` below carries the `s` flag: a stray `\r` or U+2028 left in a
// line by split(/\r?\n/) must never turn a match into a null and a throw.
const JOB_ID = /^(?:([A-Za-z_][A-Za-z0-9_-]*)|'([A-Za-z_][A-Za-z0-9_-]*)'|"([A-Za-z_][A-Za-z0-9_-]*)")[ \t]*:(.*)$/s;
const DASH = /^ *-(?:[ \t]|$)/;

// The text after a top-level key line's colon (the key is a plain name, so the
// first colon is its separator).
const afterColon = (line) => line.slice(line.indexOf(':') + 1);

function emptyWorkflowShape() {
  return {
    name: null, prTrigger: false, types: [], typesDeclared: false, draftReference: false, prFilters: [],
    pushTrigger: false, pushBranches: 'absent', pushBranchesIgnore: false, pushTags: false,
    jobs: [], concurrency: 'absent', unparsed: [],
  };
}

const leadSpaces = (line) => /^ */.exec(line)[0].length;
const isSkippable = (line) => { const t = line.trim(); return t === '' || t.startsWith('#'); };

// One pair of surrounding quotes off, with that quote style's escapes undone
// (`''` in single quotes; `\"` and `\\` in double quotes), else the text unchanged.
function stripQuotePair(s) {
  if (s.length < 2 || (s[0] !== "'" && s[0] !== '"') || s[s.length - 1] !== s[0]) return s;
  const inner = s.slice(1, -1);
  return s[0] === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\(["\\])/g, '$1');
}

// `{key, rest}` for a block-mapping entry's content (indentation and any `- `
// already removed), or null when the content is no `key:` entry. Hand-written
// and linear: a plain key ends at the first `:` followed by whitespace or the
// end of the line, and holds no whitespace.
function splitKey(content) {
  const q = content[0];
  let keyEnd;
  let key;
  if (q === "'" || q === '"') {
    let k = 1;
    while (k < content.length && content[k] !== q) k += q === '"' && content[k] === '\\' ? 2 : 1;
    if (k >= content.length) return null;
    key = content.slice(1, k);
    keyEnd = k + 1;
    while (keyEnd < content.length && (content[keyEnd] === ' ' || content[keyEnd] === '\t')) keyEnd++;
    if (content[keyEnd] !== ':') return null;
  } else {
    keyEnd = -1;
    for (let k = 0; k < content.length; k++) {
      if (content[k] === ':' && (k + 1 === content.length || content[k + 1] === ' ' || content[k + 1] === '\t')) { keyEnd = k; break; }
    }
    if (keyEnd < 0) return null;
    key = content.slice(0, keyEnd).trimEnd();
    if (!PLAIN_KEY.test(key)) return null;
  }
  const rest = content.slice(keyEnd + 1);
  if (rest !== '' && rest[0] !== ' ' && rest[0] !== '\t') return null;
  return { key, rest };
}

// The line with every quoted span replaced by `~` (column-preserving), quotes
// opening only after a non-word character as in stripCommentQuoteAware.
function blankQuotedSpans(s) {
  let out = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (quote === '"' && ch === '\\') { out += '~~'; i++; continue; }
      if (ch === quote) { quote = null; out += ch; continue; }
      out += '~';
      continue;
    }
    if ((ch === "'" || ch === '"') && (i === 0 || !/[\p{L}\p{M}\p{N}_]/u.test(s[i - 1]))) quote = ch;
    out += ch;
  }
  return out;
}

// Whether one region line (comment-stripped, quoted spans blanked) carries an
// anchor or alias at a value start, or is a `<<:` merge key.
function hasAnchorOrAlias(line) {
  const s = blankQuotedSpans(stripCommentQuoteAware(line));
  if (/^[ \t]*(?:-[ \t]+)?<<[ \t]*:/.test(s)) return true;
  const values = [];
  const item = /^[ \t]*-[ \t]+(.*)$/s.exec(s);
  if (item) values.push(item[1]);
  const sep = /:[ \t]/.exec(s);
  if (sep) values.push(s.slice(sep.index + 1).trimStart());
  for (const v of values) {
    if (/^[&*][A-Za-z0-9_]/.test(v)) return true;
    if ((v[0] === '[' || v[0] === '{') && /[[{,][ \t]*[&*][A-Za-z0-9_]/.test(v)) return true;
  }
  return false;
}

// The value of an entry line, when it is a block-scalar indicator: the column
// its content must sit deeper than, else null.
function blockScalarColumn(line) {
  const ind = leadSpaces(line);
  let col = ind;
  let content = line.slice(ind);
  const item = /^-[ \t]+/.exec(content);
  if (item) {
    col = ind + item[0].length;
    content = content.slice(item[0].length);
    if (BLOCK_SCALAR.test(stripCommentQuoteAware(content))) return ind;
  }
  const kv = splitKey(content);
  return kv && BLOCK_SCALAR.test(stripCommentQuoteAware(kv.rest)) ? col : null;
}

// The region checks that run before any other read of a region (lines
// [start, end)): a tab in a line's indentation, then an anchor or alias.
// Block-scalar content is text, not YAML, so neither check reads it.
function regionReasons(lines, start, end, region) {
  let tab = false;
  let alias = false;
  let scalarCol = null;
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (scalarCol !== null) {
      if (leadSpaces(line) > scalarCol) continue;
      scalarCol = null;
    }
    if (/^[ \t]*/.exec(line)[0].includes('\t')) { tab = true; continue; }
    if (line.trim().startsWith('#')) continue;
    if (hasAnchorOrAlias(line)) alias = true;
    scalarCol = blockScalarColumn(line);
  }
  const out = [];
  if (tab) out.push(`tab indentation in ${region}`);
  if (alias) out.push(`anchor or alias in ${region}`);
  return out;
}

// A scalar's text from its inline value plus every deeper line before `end`
// (block, folded or plain continuation): the trimmed lines joined by one space,
// then one pair of surrounding quotes stripped. `next` is the first unread line.
function readJoinedScalar(lines, i, end, keyIndent, inline) {
  const v = stripCommentQuoteAware(inline);
  const block = BLOCK_SCALAR.test(v);
  const parts = block || v === '' ? [] : [v];
  for (; i < end; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t === '') continue;
    const deeper = leadSpaces(line) > keyIndent;
    if (t.startsWith('#')) {
      if (block && deeper) parts.push(t);
      continue;
    }
    if (!deeper) break;
    parts.push(block ? t : stripCommentQuoteAware(t));
  }
  return { text: stripQuotePair(parts.join(' ').trim()), next: i };
}

// A trigger value given inline: '' / null / ~ / {} read as no sub-keys, a
// balanced one-line flow mapping as its entries; anything else is unreadable.
function readInlineTriggerKeys(value, line) {
  const v = value.trim();
  if (v === '' || v === 'null' || v === '~') return new Map();
  if (!v.startsWith('{')) return null;
  const { entries, balanced } = flowMappingEntries(v);
  if (!balanced) return null;
  return new Map(entries.map((e) => [e.key, { rest: e.value, line }]));
}

// The sub-keys of the push, pull_request and pull_request_target triggers, as
// Map<trigger, Map<subKey, {rest, line}>> (`rest` is the raw text after the
// sub-key's colon, `line` its line index), or the reason 'on: block not read'.
// Twin: readPullRequestWorkflow's `on:` walk (above) reads the same scalar,
// flow-list, flow-mapping and block forms for `types:` only. This one reads only
// trigger sub-keys and fails toward `unparsed` on any shape it cannot follow.
// `end` is the on: region's end (the indentless `- ` sequence rule included).
function readTriggerKeys(lines, onIdx, end) {
  const NOT_READ = 'on: block not read';
  const WANTED = new Set(['push', 'pull_request', 'pull_request_target']);
  const out = new Map();
  const rest = stripCommentQuoteAware(afterColon(lines[onIdx]));
  if (rest !== '') {
    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) return NOT_READ;
      const names = readFlowItems(rest.slice(1, -1));
      if (names === null) return NOT_READ;
      for (const n of names) if (WANTED.has(n)) out.set(n, new Map());
      return out;
    }
    if (rest.startsWith('{')) {
      const { entries, balanced } = flowMappingEntries(rest);
      if (!balanced) return NOT_READ;
      for (const e of entries) {
        if (!WANTED.has(e.key)) continue;
        const sub = readInlineTriggerKeys(e.value, onIdx);
        if (sub === null) return NOT_READ;
        out.set(e.key, sub);
      }
      return out;
    }
    const name = stripQuotes(rest);
    if (!TYPE_ITEM.test(name)) return NOT_READ;
    if (WANTED.has(name)) out.set(name, new Map());
    return out;
  }
  let triggerIndent = null;
  let sequence = false;
  for (let j = onIdx + 1; j < end; j++) {
    const line = lines[j];
    if (isSkippable(line)) continue;
    const indent = leadSpaces(line);
    if (triggerIndent === null) {
      triggerIndent = indent;
      sequence = DASH.test(line);
    }
    if (indent > triggerIndent) continue; // a trigger's sub-block, read below from its key line
    if (indent < triggerIndent) return NOT_READ;
    if (sequence) {
      const li = /^ *-[ \t]*(.*)$/s.exec(line);
      if (!li) return NOT_READ;
      const item = stripCommentQuoteAware(li[1]);
      if (!BLOCK_ITEM.test(item)) return NOT_READ;
      if (WANTED.has(stripQuotes(item))) out.set(stripQuotes(item), new Map());
      continue;
    }
    if (DASH.test(line)) continue; // an indentless sequence value of the key above
    const kv = splitKey(line.slice(indent));
    if (!kv) return NOT_READ;
    if (!WANTED.has(kv.key)) continue;
    if (stripCommentQuoteAware(kv.rest) !== '') {
      const sub = readInlineTriggerKeys(stripCommentQuoteAware(kv.rest), j);
      if (sub === null) return NOT_READ;
      out.set(kv.key, sub);
      continue;
    }
    const sub = new Map();
    let subIndent = null;
    for (let k = j + 1; k < end; k++) {
      const l = lines[k];
      if (isSkippable(l)) continue;
      const ind = leadSpaces(l);
      if (ind <= triggerIndent) break;
      if (subIndent === null) subIndent = ind;
      if (ind > subIndent) continue;
      if (ind < subIndent) return NOT_READ;
      if (DASH.test(l)) continue; // an indentless sequence value of the sub-key above
      const skv = splitKey(l.slice(ind));
      if (!skv) return NOT_READ;
      sub.set(skv.key, { rest: skv.rest, line: k });
    }
    out.set(kv.key, sub);
  }
  return out;
}

// push's `branches:` items, or null when they cannot be read: a one-line flow
// list, a scalar, or a block list read like readBlockTrigger's.
function readBranchItems(lines, entry, end) {
  const v = stripCommentQuoteAware(entry.rest);
  const items = [];
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) return null;
    for (const raw of v.slice(1, -1).split(',')) {
      const it = raw.trim();
      if (it === '') continue;
      if (!BRANCH_ITEM.test(it)) return null;
      items.push(stripQuotes(it));
    }
    return items;
  }
  if (v !== '') return BRANCH_ITEM.test(v) ? [stripQuotes(v)] : null;
  const ind = leadSpaces(lines[entry.line]);
  // An empty value inside a one-line flow mapping has no block list beneath it.
  const own = splitKey(lines[entry.line].slice(ind));
  if (!own || own.key !== 'branches') return null;
  for (let k = entry.line + 1; k < end; k++) {
    const l = lines[k];
    if (isSkippable(l)) continue;
    const im = /^ *-[ \t]+(.*)$/s.exec(l);
    if (leadSpaces(l) < ind || !im) break;
    const it = stripCommentQuoteAware(im[1]);
    if (!BRANCH_ITEM.test(it)) return null;
    items.push(stripQuotes(it));
  }
  return items.length > 0 ? items : null;
}

// A step list under `steps:` (key at `keyIndent`, items deeper or an
// indentless `- ` sequence at it): the number of `if:` keys at each step's key
// column, or null when the list's shape cannot be followed. Deeper lines (a
// `with:` child, a `run: |` script) are skipped. Step content at a key column
// that is no `key:` entry (a flow-mapping step `- {if: x}`, a stray scalar) is
// unreadable, never "a step with no if:".
function walkSteps(lines, i, end, keyIndent) {
  let stepIndent = null;
  let stepKeyCol = null;
  let count = 0;
  let unreadable = false;
  const isIf = (content) => {
    const kv = splitKey(content);
    if (kv === null) unreadable = true;
    return kv !== null && kv.key === 'if';
  };
  for (; i < end; i++) {
    const line = lines[i];
    if (isSkippable(line)) continue;
    const ind = leadSpaces(line);
    const dash = DASH.test(line);
    if (stepIndent === null) {
      if (ind < keyIndent || (ind === keyIndent && !dash)) break;
      if (!dash) return null;
      stepIndent = ind;
    }
    if (ind < stepIndent || (ind === stepIndent && !dash)) {
      if (ind <= keyIndent) break;
      return null;
    }
    if (ind === stepIndent) {
      const after = line.slice(ind + 1);
      const sp = /^[ \t]*/.exec(after)[0].length;
      const content = after.slice(sp);
      if (content === '' || content.startsWith('#')) {
        stepKeyCol = null; // the item's keys start on the next line
      } else {
        stepKeyCol = ind + 1 + sp;
        if (isIf(content)) count++;
        if (unreadable) return null;
      }
      continue;
    }
    if (stepKeyCol === null) stepKeyCol = ind;
    if (ind < stepKeyCol) return null;
    if (ind === stepKeyCol) {
      if (isIf(line.slice(ind))) count++;
      if (unreadable) return null;
    }
  }
  return { count, next: i };
}

// The jobs under `jobs:` (region lines (jobsIdx, end)), in one forward pass with
// a persistent index: never a rescan from `jobs:` per job.
function readJobs(lines, jobsIdx, end, unparsed) {
  const NOT_READ = 'jobs: not read';
  const inline = stripCommentQuoteAware(afterColon(lines[jobsIdx]));
  if (inline !== '') { unparsed.push(NOT_READ); return []; }
  const jobs = [];
  let jobIndent = null;
  let i = jobsIdx + 1;
  while (i < end) {
    const line = lines[i];
    if (isSkippable(line)) { i++; continue; }
    const ind = leadSpaces(line);
    if (jobIndent === null) jobIndent = ind;
    const m = ind === jobIndent ? JOB_ID.exec(line.slice(ind)) : null;
    if (!m || stripCommentQuoteAware(m[4]) !== '') { unparsed.push(NOT_READ); return []; }
    const job = { id: m[1] || m[2] || m[3], if: null, stepIfCount: 0, concurrency: false };
    jobs.push(job);
    i++;
    let keyIndent = null;
    let sawKey = false;
    while (i < end) {
      const l = lines[i];
      if (isSkippable(l)) { i++; continue; }
      const kind = leadSpaces(l);
      if (kind <= jobIndent) break;
      if (keyIndent === null) keyIndent = kind;
      if (kind < keyIndent) { unparsed.push(NOT_READ); return []; }
      if (kind > keyIndent) { i++; continue; } // a deeper line of a key not read here
      if (DASH.test(l)) {
        if (!sawKey) { unparsed.push(NOT_READ); return []; }
        i++; // an indentless sequence value of the key above
        continue;
      }
      const kv = splitKey(l.slice(kind));
      if (!kv) { unparsed.push(NOT_READ); return []; }
      sawKey = true;
      i++;
      if (kv.key === 'if') {
        const r = readJoinedScalar(lines, i, end, keyIndent, kv.rest);
        i = r.next;
        if (r.text === '') unparsed.push(`job ${job.id} if: not read`);
        else job.if = r.text;
      } else if (kv.key === 'concurrency') {
        job.concurrency = true;
      } else if (kv.key === 'steps') {
        const v = stripCommentQuoteAware(kv.rest);
        if (v === '') {
          const r = walkSteps(lines, i, end, keyIndent);
          if (r === null) { unparsed.push(NOT_READ); return []; }
          job.stepIfCount = r.count;
          i = r.next;
        } else if (v !== '[]') {
          unparsed.push(NOT_READ);
          return [];
        }
      }
    }
  }
  if (jobs.length === 0) unparsed.push(NOT_READ);
  return jobs;
}

// The workflow-level `concurrency:` (region lines [idx, end)) as one of
// 'no-cancel' | 'cancel-true' | 'cancel-false' | 'cancel-expression', or null
// after pushing the reason it could not be read.
function readConcurrency(lines, idx, end, unparsed) {
  const cancel = (raw) => {
    const v = stripCommentQuoteAware(raw);
    if (v === 'true') return 'cancel-true';
    if (v === 'false') return 'cancel-false';
    if (v.includes('${{')) return 'cancel-expression';
    unparsed.push('cancel-in-progress value not read');
    return null;
  };
  const inline = stripCommentQuoteAware(afterColon(lines[idx]));
  if (inline.startsWith('{')) {
    const { entries, balanced } = flowMappingEntries(inline);
    // flowMappingEntries ignores text after the closing brace; that text is unread here.
    if (!balanced || !inline.endsWith('}')) { unparsed.push('concurrency not read'); return null; }
    const e = entries.find((x) => x.key === 'cancel-in-progress');
    return e ? cancel(e.value) : 'no-cancel';
  }
  if (inline !== '') return 'no-cancel';
  let subIndent = null;
  for (let k = idx + 1; k < end; k++) {
    const l = lines[k];
    if (isSkippable(l)) continue;
    const ind = leadSpaces(l);
    if (subIndent === null) subIndent = ind;
    if (ind < subIndent) { unparsed.push('concurrency not read'); return null; }
    if (ind > subIndent) continue;
    const kv = splitKey(l.slice(ind));
    if (kv && kv.key === 'cancel-in-progress') return cancel(kv.rest);
  }
  if (subIndent === null) { unparsed.push('concurrency not read'); return null; }
  return 'no-cancel';
}

// Never throws. Reasons in `unparsed` arrive in detection order, deduped.
function readWorkflowShape(text) {
  const out = emptyWorkflowShape();
  if (typeof text !== 'string' || !text) return { ...out, unparsed: ['no on: block'] };
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  const unparsed = [];

  // Top-level lines: col 0, not blank, not a comment. A region runs from its key
  // line to the line before the next top-level line; on:'s region also keeps an
  // indentless `- ` sequence (readPullRequestWorkflow's rule).
  const tops = [];
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i][0];
    if (c !== undefined && c !== ' ' && c !== '\t' && c !== '#' && lines[i].trim() !== '') tops.push(i);
  }
  const region = (re, keepDash) => {
    const t = tops.findIndex((i) => re.test(lines[i]));
    if (t < 0) return null;
    let n = t + 1;
    while (keepDash && n < tops.length && /^-(?:[ \t]|$)/.test(lines[tops[n]])) n++;
    return { start: tops[t], end: n < tops.length ? tops[n] : lines.length };
  };
  const onR = region(/^(?:on|'on'|"on")[ \t]*:/, true);
  const jobsR = region(/^(?:jobs|'jobs'|"jobs")[ \t]*:/, false);
  const concR = region(/^(?:concurrency|'concurrency'|"concurrency")[ \t]*:/, false);
  const nameR = region(/^(?:name|'name'|"name")[ \t]*:/, false);

  // A name: region with a tab or an anchor/alias leaves `name` null, never a
  // literal like '*n'. It adds no reason: the name only matches `ci` sources, and
  // a null name just matches none of them.
  if (nameR && regionReasons(lines, nameR.start, nameR.end, 'name:').length === 0) {
    const r = readJoinedScalar(lines, nameR.start + 1, nameR.end, 0, afterColon(lines[nameR.start]));
    out.name = r.text === '' ? null : r.text;
  }

  if (!onR) {
    unparsed.push('no on: block');
  } else {
    const checks = regionReasons(lines, onR.start, onR.end, 'on:');
    unparsed.push(...checks);
    if (checks.length === 0) {
      const triggers = readTriggerKeys(lines, onR.start, onR.end);
      if (typeof triggers === 'string') {
        unparsed.push(triggers);
      } else {
        const filters = new Set();
        for (const t of ['pull_request', 'pull_request_target']) {
          for (const k of (triggers.get(t) || new Map()).keys()) if (PR_FILTER_KEYS.includes(k)) filters.add(k);
        }
        out.prFilters = [...filters].sort();
        const push = triggers.get('push');
        if (push) {
          out.pushTrigger = true;
          out.pushBranchesIgnore = push.has('branches-ignore');
          out.pushTags = push.has('tags') || push.has('tags-ignore');
          if (push.has('branches')) {
            const items = readBranchItems(lines, push.get('branches'), onR.end);
            if (items === null) unparsed.push('push branches not read');
            else out.pushBranches = items.length === 1 && items[0] === '**' ? 'all' : 'some';
          }
        }
      }
    }
  }

  // readPullRequestWorkflow throws on a stray `\r` or U+2028 left on its `on:`
  // line; that read is unparsed here, never a throw out of this reader.
  let pr = null;
  try { pr = readPullRequestWorkflow(text); } catch {}
  if (pr === null) {
    unparsed.push('pull_request trigger not read');
  } else {
    out.prTrigger = pr.prTrigger;
    out.types = pr.types;
    out.typesDeclared = pr.typesDeclared;
    out.draftReference = pr.draftReference;
    if (pr.unparsed) unparsed.push('pull_request trigger not read');
  }

  if (!jobsR) {
    unparsed.push('no jobs: key');
  } else {
    const checks = regionReasons(lines, jobsR.start, jobsR.end, 'jobs:');
    unparsed.push(...checks);
    if (checks.length === 0) out.jobs = readJobs(lines, jobsR.start, jobsR.end, unparsed);
  }

  if (concR) {
    const checks = regionReasons(lines, concR.start, concR.end, 'concurrency:');
    unparsed.push(...checks);
    if (checks.length === 0) {
      const c = readConcurrency(lines, concR.start, concR.end, unparsed);
      if (c !== null) out.concurrency = c;
    }
  }

  out.unparsed = [...new Set(unparsed)];
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
  readWorkflowShape, DRAFT_REF, PR_FILTER_KEYS,
};
