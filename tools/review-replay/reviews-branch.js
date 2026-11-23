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
const { renderSlot, promptOf, strippedReply } = require('./reviews-extract.js');

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
  try {
    return { prompt: fs.readFileSync(pointer, 'utf8'), transcript, file };
  } catch {
    return { reason: 'prompt-file-gone' };
  }
}

// One branch dispatch -> { reason, tier? } (the first check it fails) or { candidate }.
function examineBranch(r, item, c, deps, row) {
  const fs = deps.fs;
  const tier = item.tier;
  if (typeof tier !== 'string' || !hasOwn(c.PROFILES, tier)) return { reason: 'no-archived-tier' };
  const got = promptFor(item, c, fs);
  if (got.reason) return { tier, reason: got.reason };
  const { prompt, transcript, file } = got;
  const raw = lastAssistantText(file, fs);
  const reply = raw === null ? null : row.readReply(strippedReply(raw, prompt, c.mainRoot));
  if (reply === null) return { tier, reason: 'report-unparsed' };
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
      i.source = fs.readFileSync(path.join(r.dir, i.member || '', i.rel), 'utf8');
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

// A run's slots for the branch role c.role.key, in dispatch order, named `{role}`, `{role}.2`, …; every dispatch of the
// role that fails a check goes through `exclude` as { run, agentId, tier (when known), reason }.
function selectBranchSlots(r, dispatches, c, deps, exclude) {
  const row = BRANCH_ROLES[c.role.key];
  if (!row) throw new Error(`--role ${c.role.key}: no branch slot selection`);
  const slots = [];
  for (const { item } of dispatches.filter((d) => row.isDispatch(d.item))) {
    const x = examineBranch(r, item, c, deps, row);
    let reason = x.reason;
    if (!reason) {
      const s = x.candidate;
      s.name = slots.length === 0 ? c.role.key : `${c.role.key}.${slots.length + 1}`;
      // The rendered-text barrier on the texts as they will be written, but for the archived shas.
      const texts = renderSlot(s, { mainRoot: c.mainRoot, out: c.out, repoDir: path.join(c.out, 'repos', `${r.run}--r0`), shaMap: {}, arms: c.arms });
      const all = [...texts.copies, ...texts.prompts];
      if (all.some((t) => unrewrittenPaths(t.text, { mainRoot: c.mainRoot, runName: r.run, outDir: c.out, exists: c.exists }).length > 0)) reason = 'unrewritten-path';
      else slots.push(s);
    }
    if (reason) {
      exclude({ run: r.run, ...(item.agentId != null ? { agentId: item.agentId } : {}), ...(x.tier !== undefined ? { tier: x.tier } : {}), reason });
    }
  }
  return slots;
}

module.exports = { selectBranchSlots, promptFor, BRANCH_ROLES };
