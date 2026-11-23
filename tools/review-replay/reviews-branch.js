'use strict';
// tools/review-replay/reviews-branch.js — the branch roles of extract-reviews: picks a run's archived task-review
// (`--role task`) or whole-branch-review (`--role whole-branch`) dispatches a replay can rerun. A slot's range is the
// prompt's own sha pair (the first sha the base, the second the head); its prompt is the transcript's first user
// message, or the file a one-line pointer prompt names, read as the reviewer saw it. Its archived findings are the
// verdict (task) and each Critical, Important and Minor item with its location, every path the prompt's worktrees or the
// main checkout prefix stripped first. `--role task-vs-branch` replays the run's first whole-branch prompt at the head
// each qualifying task review reviewed and, as its control, at the whole-branch prompt's own head, scored on that task
// review's Critical and Important items. Its totals count task reviews, not slots: `reviews` (task-head slots, also what
// --min-reviews and a shortfall's `available.reviews` count), `slots` (both kinds), `byTaskTier` and `notQualifying`
// (task reviews that are not a Needs fixes with a Critical or Important item). Rendering, the leak barrier and the writes are reviews-extract.js's, shared
// with the lens role.

const path = require('path');
const { lastAssistantText } = require('./counterfactual.js');
const { transcriptEffort } = require('./score.js');
const { shaPairOf, pointerPathOf, POINTER_AMBIGUOUS, runInputsOf, originRefsOf, unrewrittenPaths } = require('./reviews-rewrite.js');
const { parseBranchReply, readTaskReply } = require('./reviews-score.js');
const { isWholeBranch } = require('../pipeline-cost-report/guards.js');
// reviews-extract.js requires this module lazily, so this top-level require never sees a partial export.
const { renderSlot, transcriptPromptOf, strippedReply, readRunInput } = require('./reviews-extract.js');

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const transcriptFileOf = (item, c) => (item.agentId != null ? c.transcripts.get(item.agentId) : undefined);

// Per branch role: which dispatches it selects and how it reads an archived reply -> { verdict, items, itemsUnparsed }
// or null when the reply does not parse (report-unparsed).
const BRANCH_ROLES = {
  task: {
    isDispatch: (item) => item.role === 'task review',
    // A Needs fixes reply with no severity heading keeps its slot: its verdict scores, its items cannot.
    readReply: readTaskReply,
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
// message, or, when that is a pointer prompt, the text of the file it names (any read failure is prompt-file-gone; a
// pointer-worded prompt with several lone path lines, whose file cannot be told, is pointer-ambiguous).
// A prompt that names a file but carries its own sha pair while the file's text has none is a full or hybrid prompt
// citing a template or rules file, not a pointer: the original prompt is kept.
function promptFor(item, c, fs) {
  const { file, transcript, prompt: first } = transcriptPromptOf(item, c, fs);
  if (first === null) return { reason: 'no-transcript' };
  const pointer = pointerPathOf(first);
  if (pointer === POINTER_AMBIGUOUS) return { reason: 'pointer-ambiguous' };
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

// An archived dispatch's tier, prompt and reply read through `readReply` -> { reason, tier? } (the first check it
// fails: no-archived-tier, no-transcript, pointer-ambiguous, prompt-file-gone, report-unparsed) or { tier, prompt, transcript, reply }.
// With no readReply (the whole-branch prompt task-vs-branch replays) the reply is not read: it has no findings of its own.
// With `qualifies`, the raw reply is read first, before the tier and the prompt: one that parses and does not qualify
// gives { notQualifying: true } whatever its tier or prompt (a verdict and item severities never depend on the paths
// strippedReply removes); the rest go on to the checks, their reply re-read stripped for its item paths.
function archivedReply(item, c, deps, readReply, qualifies = null) {
  let raw;
  if (qualifies) {
    const file = transcriptFileOf(item, c);
    raw = file === undefined ? null : lastAssistantText(file, deps.fs);
    const early = raw === null ? null : readReply(raw);
    if (early !== null && !qualifies(early)) return { notQualifying: true };
  }
  const tier = item.tier;
  if (typeof tier !== 'string' || !hasOwn(c.PROFILES, tier)) return { reason: 'no-archived-tier' };
  const got = promptFor(item, c, deps.fs);
  if (got.reason) return { tier, reason: got.reason };
  const { prompt, transcript, file } = got;
  if (!readReply) return { tier, prompt, transcript, reply: { verdict: null, items: [], itemsUnparsed: false } };
  if (raw === undefined) raw = lastAssistantText(file, deps.fs);
  const reply = raw === null ? null : readReply(strippedReply(raw, prompt, c.mainRoot));
  if (reply === null) return { tier, reason: 'report-unparsed' };
  return { tier, prompt, transcript, reply };
}

// One branch dispatch -> { reason, tier? } (the first check it fails) or { candidate }.
function examineBranch(r, item, c, deps, row) {
  const fs = deps.fs;
  const got = archivedReply(item, c, deps, row.readReply);
  if (got.reason) return got;
  const { tier, prompt, transcript, reply } = got;
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

const excludeRow = (r, item, x) => ({
  run: r.run, ...(item.agentId != null ? { agentId: item.agentId } : {}), ...(x.tier !== undefined ? { tier: x.tier } : {}), reason: x.reason,
  ...(x.cause !== undefined ? { cause: x.cause } : {}),
});

// A run's slots for the branch role c.role.key, in dispatch order, named `{role}`, `{role}.2`, …; every dispatch of the
// role that fails a check goes through `exclude` as { run, agentId, tier (when known), reason, cause (when it has one) }.
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
// share no merge base (no-merge-base). Only git's exit 1 means "not an ancestor" or "no merge base": any other failure
// is rethrown, so a broken clone fails the extract instead of passing for an answer.
function rangeBase(wbBase, head, deps) {
  try {
    deps.git(['merge-base', '--is-ancestor', wbBase, head]);
    return { base: wbBase, baseFrom: 'whole-branch' };
  } catch (e) {
    if (!(e && e.status === 1)) throw e;
  }
  try {
    return { base: String(deps.git(['merge-base', wbBase, head])).trim(), baseFrom: 'merge-base' };
  } catch (e) {
    if (!(e && e.status === 1)) throw e;
    return null;
  }
}

// The run's whole-branch prompt for task-vs-branch: its first whole-branch dispatch, checked as --role whole-branch
// checks it bar its archived reply -> { wb }, else { cause } — why there is none, which every task review's
// no-whole-branch-prompt row carries: `not-dispatched`, the dispatch's own exclusion reason, or `unrewritten-path`.
// A later whole-branch dispatch never stands in.
function wholeBranchOf(r, dispatches, c, deps) {
  const first = dispatches.find((d) => isWholeBranch(d.item));
  if (!first) return { cause: 'not-dispatched' };
  const x = examineBranch(r, first.item, c, deps, { readReply: null });
  if (x.reason) return { cause: x.reason };
  x.candidate.name = c.role.key;
  return leaks(x.candidate, r, c) ? { cause: 'unrewritten-path' } : { wb: x.candidate };
}

const isCriticalOrImportant = (i) => i.sev === 'critical' || i.sev === 'important';
// Whether a task review's reply qualifies it for task-vs-branch: Needs fixes with a Critical or Important item, or with
// items that do not parse (excluded later as items-unparsed, since they may hold one).
const qualifiesForTaskVsBranch = (reply) => reply.verdict === 'needs-fixes' && (reply.itemsUnparsed || reply.items.some(isCriticalOrImportant));

// One task review for task-vs-branch -> { reason, tier? }, { notQualifying: true } (an Approved review, or a Needs
// fixes one with no Critical or Important item, decided before its tier and prompt are read), or { pair }: the
// whole-branch prompt `whole.wb` replayed at the head the task review reviewed and at wb's own head, each scored on the
// task review's Critical and Important items. With no wb, the row's `cause` is wholeBranchOf's.
function examineTaskReview(r, item, c, deps, whole) {
  const got = archivedReply(item, c, deps, BRANCH_ROLES.task.readReply, qualifiesForTaskVsBranch);
  if (got.notQualifying || got.reason) return got;
  const { tier, prompt, reply } = got;
  if (!qualifiesForTaskVsBranch(reply)) return { notQualifying: true };
  if (reply.itemsUnparsed) return { tier, reason: 'items-unparsed' };
  const items = reply.items.filter(isCriticalOrImportant);
  // The prompt's own head is the task's commit before its fix round: the fix is re-reviewed under `re-review`.
  const shas = shaPairOf(prompt);
  if (shas === null) return { tier, reason: 'no-sha-range' };
  let taskHead;
  try {
    taskHead = String(deps.git(['rev-parse', '--verify', `${shas.head}^{commit}`])).trim();
  } catch {
    return { tier, reason: 'commit-not-in-clone' };
  }
  const { wb } = whole;
  if (!wb) return { tier, reason: 'no-whole-branch-prompt', cause: whole.cause };
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
  const whole = wholeBranchOf(r, dispatches, c, deps);
  const slots = [];
  for (const { item } of dispatches.filter((d) => BRANCH_ROLES.task.isDispatch(d.item))) {
    const x = examineTaskReview(r, item, c, deps, whole);
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
