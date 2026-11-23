'use strict';
// tools/review-replay/reviews-branch.js — the branch roles of extract-reviews: picks a run's archived task-review
// (`--role task`) or whole-branch-review (`--role whole-branch`) dispatches a replay can rerun. A slot's range is the
// prompt's own sha pair (the first sha the base, the second the head); its prompt is the transcript's first user
// message, or the file a one-line pointer prompt names, read as the reviewer saw it. Its archived findings are the
// verdict (task) and each Critical, Important and Minor item with its location, every path the prompt's worktrees or the
// main checkout prefix stripped first. Rendering, the leak barrier and the writes are reviews-extract.js's, shared
// with the lens role.

const path = require('path');
const { lastAssistantText } = require('./counterfactual.js');
const { transcriptEffort } = require('./score.js');
const { shaPairOf, pointerPathOf, runInputsOf, originRefsOf, unrewrittenPaths } = require('./reviews-rewrite.js');
const { parseReviewItems, parseBranchReply } = require('./reviews-score.js');
const { parseTaskVerdict } = require('../pipeline-cost-report/reviews.js');
const { isWholeBranch } = require('../pipeline-cost-report/guards.js');
// reviews-extract.js requires this module lazily, so this top-level require never sees a partial export.
const { renderSlot, promptOf, strippedReply, readRunInput } = require('./reviews-extract.js');

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Per branch role: which dispatches it selects and how it reads an archived reply -> { verdict, items, itemsUnparsed }
// or null when the reply does not parse (report-unparsed).
const BRANCH_ROLES = {
  task: {
    isDispatch: (item) => item.role === 'task review',
    readReply: (text) => {
      const verdict = parseTaskVerdict(text);
      if (verdict === null) return null;
      const parsed = parseReviewItems(text);
      // A Needs fixes reply with no severity heading keeps its slot: its verdict scores, its items cannot.
      return { verdict, items: parsed ? parsed.items : [], itemsUnparsed: parsed === null && verdict === 'needs-fixes' };
    },
  },
  'whole-branch': {
    isDispatch: isWholeBranch,
    readReply: (text) => {
      const parsed = parseBranchReply(text);
      return parsed ? { verdict: null, items: parsed.items, itemsUnparsed: false } : null;
    },
  },
};

// The prompt an archived dispatch was given -> { prompt, transcript, file } or { reason }: the transcript's first user
// message, or, when that is a pointer prompt, the text of the file it names (any read failure is prompt-file-gone).
// A prompt that names a file but carries its own sha pair while the file's text has none is a full or hybrid prompt
// citing a template or rules file, not a pointer: the original prompt is kept.
function promptFor(item, c, fs) {
  const file = item.agentId != null ? c.transcripts.get(item.agentId) : undefined;
  let transcript = null;
  try {
    transcript = file === undefined ? null : fs.readFileSync(file, 'utf8');
  } catch {
    transcript = null;
  }
  const first = transcript === null ? null : promptOf(transcript);
  if (first === null) return { reason: 'no-transcript' };
  const pointer = pointerPathOf(first);
  if (pointer === null) return { prompt: first, transcript, file };
  let named;
  try {
    named = fs.readFileSync(pointer, 'utf8');
  } catch {
    return { reason: 'prompt-file-gone' };
  }
  if (shaPairOf(named) === null && shaPairOf(first) !== null) return { prompt: first, transcript, file };
  return { prompt: named, transcript, file };
}

// One branch dispatch -> { reason, tier? } (the first check it fails) or { candidate }.
function examineBranch(r, item, c, deps, row) {
  const fs = deps.fs;
  const tier = item.tier;
  if (typeof tier !== 'string' || !hasOwn(c.PROFILES, tier)) return { reason: 'no-archived-tier' };
  const got = promptFor(item, c, fs);
  if (got.reason) return { tier, reason: got.reason };
  const { prompt, transcript, file } = got;
  // A row with no readReply (the whole-branch prompt task-vs-branch replays) has no archived findings of its own.
  let reply = { verdict: null, items: [], itemsUnparsed: false };
  if (row.readReply) {
    const raw = lastAssistantText(file, fs);
    reply = raw === null ? null : row.readReply(strippedReply(raw, prompt, c.mainRoot));
    if (reply === null) return { tier, reason: 'report-unparsed' };
  }
  const pair = shaPairOf(prompt);
  if (pair === null) return { tier, reason: 'no-sha-range' };
  const resolved = [];
  for (const sha of [pair.base, pair.head]) {
    try {
      resolved.push(String(deps.git(['rev-parse', '--verify', `${sha}^{commit}`])).trim());
    } catch {
      return { tier, reason: 'commit-not-in-clone' };
    }
  }
  const { inputs, unknown } = runInputsOf(prompt, { mainRoot: c.mainRoot, runName: r.run });
  if (unknown.length > 0) return { tier, reason: 'unknown-run-input' };
  for (const i of inputs) {
    if (i.kind === 'scratch') continue;
    try {
      i.source = readRunInput(r, i, fs);
    } catch {
      return { tier, reason: 'run-input-gone' };
    }
  }
  const effort = transcriptEffort(transcript).effort;
  return {
    candidate: {
      role: c.role.key, name: null, run: r, agentId: item.agentId, prompt, inputs,
      archivedBase: resolved[0], archivedHead: resolved[1], promptBase: resolved[0], promptHead: resolved[1],
      archivedTier: tier, archivedEffort: c.EFFORT_SCALE.includes(effort) ? effort : c.PROFILES[tier].effort,
      originRefs: originRefsOf(prompt), lens: null, side: null,
      verdict: reply.verdict, items: reply.items, itemsUnparsed: reply.itemsUnparsed,
      taskTier: null, at: null, baseFrom: null, taskAgentId: null,
    },
  };
}

// Whether the rendered-text barrier flags slot s: its texts as they will be written, but for the archived shas.
function leaks(s, r, c) {
  const texts = renderSlot(s, { mainRoot: c.mainRoot, out: c.out, repoDir: path.join(c.out, 'repos', `${r.run}--r0`), shaMap: {}, arms: c.arms });
  return [...texts.copies, ...texts.prompts].some((t) => unrewrittenPaths(t.text, { mainRoot: c.mainRoot, runName: r.run, outDir: c.out, exists: c.exists }).length > 0);
}

const excludeRow = (r, item, x) => ({ run: r.run, ...(item.agentId != null ? { agentId: item.agentId } : {}), ...(x.tier !== undefined ? { tier: x.tier } : {}), reason: x.reason });

// A run's slots for the branch role c.role.key, in dispatch order, named `{role}`, `{role}.2`, …; every dispatch of the
// role that fails a check goes through `exclude` as { run, agentId, tier (when known), reason }.
function selectBranchSlots(r, dispatches, c, deps, exclude) {
  if (c.role.key === 'task-vs-branch') return selectTaskVsBranch(r, dispatches, c, deps, exclude);
  const row = BRANCH_ROLES[c.role.key];
  if (!row) throw new Error(`--role ${c.role.key}: no branch slot selection`);
  const slots = [];
  for (const { item } of dispatches.filter((d) => row.isDispatch(d.item))) {
    const x = examineBranch(r, item, c, deps, row);
    if (!x.reason) {
      const s = x.candidate;
      s.name = slots.length === 0 ? c.role.key : `${c.role.key}.${slots.length + 1}`;
      if (leaks(s, r, c)) x.reason = 'unrewritten-path';
      else slots.push(s);
    }
    if (x.reason) exclude(excludeRow(r, item, x));
  }
  return slots;
}

// The base of a range from the whole-branch base `wbBase` to `head`: wbBase when it is an ancestor of head, else their
// merge base (a run that merged main in before its whole-branch review) -> { base, baseFrom }, or null when the two
// share no merge base (no-merge-base).
function rangeBase(wbBase, head, deps) {
  try {
    deps.git(['merge-base', '--is-ancestor', wbBase, head]);
    return { base: wbBase, baseFrom: 'whole-branch' };
  } catch {
    // Exit 1: not an ancestor.
  }
  try {
    const base = String(deps.git(['merge-base', wbBase, head])).trim();
    return base ? { base, baseFrom: 'merge-base' } : null;
  } catch {
    return null;
  }
}

// The run's whole-branch prompt for task-vs-branch: its first whole-branch dispatch, checked as --role whole-branch
// checks it bar its archived reply, else null (no-whole-branch-prompt) — a later whole-branch dispatch never stands in.
function wholeBranchOf(r, dispatches, c, deps) {
  const first = dispatches.find((d) => isWholeBranch(d.item));
  if (!first) return null;
  const x = examineBranch(r, first.item, c, deps, { readReply: null });
  if (x.reason) return null;
  x.candidate.name = c.role.key;
  return leaks(x.candidate, r, c) ? null : x.candidate;
}

// One task review for task-vs-branch -> { reason, tier? }, { notQualifying: true } (an Approved review, or a Needs
// fixes one with no Critical or Important item), or { pair }: the whole-branch prompt `wb` replayed at the head the
// task review reviewed and at wb's own head, each scored on the task review's Critical and Important items.
function examineTaskReview(r, item, c, deps, wb) {
  const tier = item.tier;
  if (typeof tier !== 'string' || !hasOwn(c.PROFILES, tier)) return { reason: 'no-archived-tier' };
  const got = promptFor(item, c, deps.fs);
  if (got.reason) return { tier, reason: got.reason };
  const raw = lastAssistantText(got.file, deps.fs);
  const reply = raw === null ? null : BRANCH_ROLES.task.readReply(strippedReply(raw, got.prompt, c.mainRoot));
  if (reply === null) return { tier, reason: 'report-unparsed' };
  if (reply.verdict !== 'needs-fixes') return { notQualifying: true };
  if (reply.itemsUnparsed) return { tier, reason: 'items-unparsed' };
  const items = reply.items.filter((i) => i.sev === 'critical' || i.sev === 'important');
  if (items.length === 0) return { notQualifying: true };
  // The prompt's own head is the task's commit before its fix round: the fix is re-reviewed under `re-review`.
  const shas = shaPairOf(got.prompt);
  if (shas === null) return { tier, reason: 'no-sha-range' };
  let taskHead;
  try {
    taskHead = String(deps.git(['rev-parse', '--verify', `${shas.head}^{commit}`])).trim();
  } catch {
    return { tier, reason: 'commit-not-in-clone' };
  }
  if (wb === null) return { tier, reason: 'no-whole-branch-prompt' };
  const pair = [];
  for (const [at, head] of [['task-head', taskHead], ['final-head', wb.promptHead]]) {
    const b = rangeBase(wb.promptBase, head, deps);
    if (b === null) return { tier, reason: 'no-merge-base' };
    pair.push({
      ...wb, archivedBase: b.base, archivedHead: head, baseFrom: b.baseFrom, at,
      verdict: reply.verdict, items, itemsUnparsed: false, taskTier: tier, taskAgentId: item.agentId,
    });
  }
  return { pair };
}

// A run's task-vs-branch slots: per qualifying task review, in dispatch order, `task-vs-branch[.k]` at the task-reviewed
// head and its control `task-vs-branch[.k]--final` at the whole-branch head. A review that does not qualify counts in
// c.notQualifying; one that fails a check goes through `exclude`.
function selectTaskVsBranch(r, dispatches, c, deps, exclude) {
  const wb = wholeBranchOf(r, dispatches, c, deps);
  const slots = [];
  for (const { item } of dispatches.filter((d) => BRANCH_ROLES.task.isDispatch(d.item))) {
    const x = examineTaskReview(r, item, c, deps, wb);
    if (x.notQualifying) {
      c.notQualifying += 1;
      continue;
    }
    if (x.reason) {
      exclude(excludeRow(r, item, x));
      continue;
    }
    // No barrier here: wholeBranchOf ran it on the same prompt and inputs, which differ only in names under --out.
    const k = slots.length / 2 + 1;
    const name = k === 1 ? c.role.key : `${c.role.key}.${k}`;
    [x.pair[0].name, x.pair[1].name] = [name, `${name}--final`];
    slots.push(...x.pair);
  }
  return slots;
}

module.exports = { selectBranchSlots, promptFor, BRANCH_ROLES };
