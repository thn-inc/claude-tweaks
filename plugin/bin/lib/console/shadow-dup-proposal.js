// bin/lib/console/shadow-dup-proposal.js — compose the fileable Queue-writes
// proposal for a divergent or collision `.shadow-dup` staged copy (#3946).
//
// A sweep-shadow copy that is NOT byte-identical to its anchor may hold a real
// proposal, so the Review Console routes it to Queue writes (console/resolve.js's
// SHADOW_DUP_OUTCOMES). The Queue-writes step files a staged `Title:`/`Type:`/
// `Labels:`/`Defer-reason:` header + body; a raw copy carries none of that, so
// this module builds it: a needs:definition task whose spec-shaped body quotes
// the copy verbatim — and, for a divergent copy, its anchor too, so the record
// stays readable after the run dir is archived (fencedBlock widens its fence past
// any backtick run inside the text, so a quote can never be closed early; a
// fingerprint-marker spelling inside it is defused, the one change to "verbatim"). The
// header shape is the one wrap-up/leftover-routing.md step 3 writes. A
// byte-identical duplicate is refused, never composed — the console dismisses it.
'use strict';

const {
  specShapedBody, recordPayload, fencedBlock, defuse, LABELS,
} = require('../issues/record');
const { classifyStagedItem, SHADOW_DUP_RE } = require('./resolve');

const DEFER_REASON = 'needs-human-decision';

// { name, text, anchorText, runId } ->
//   { ok: true, outcome, anchor, title, proposal } | { ok: false, reason }
// `text` is the copy's content (null/undefined when unreadable), `anchorText`
// the anchor's (null/undefined when missing or unreadable). reason is one of
// 'not-a-shadow-dup', 'shadow-dup-duplicate', 'copy-unreadable'.
function composeShadowDupProposal({
  name, text, anchorText, runId,
} = {}) {
  const match = typeof name === 'string' ? SHADOW_DUP_RE.exec(name) : null;
  if (!match) return { ok: false, reason: 'not-a-shadow-dup' };
  if (typeof text !== 'string') return { ok: false, reason: 'copy-unreadable' };
  const anchor = match[1];
  const { outcome } = classifyStagedItem(name, text, anchorText);
  if (outcome === 'shadow-dup-duplicate') return { ok: false, reason: 'shadow-dup-duplicate' };

  // The copy, the anchor and the run id are producer-supplied text quoted ahead of recordPayload's
  // trailing marker, and this record carries no fingerprint of its own — so each is defused
  // (record.js) before it is interpolated, or a quoted marker would read back as its fingerprint.
  const safeName = defuse(name);
  const safeAnchor = defuse(anchor);
  const title = `Reconcile staged copy ${safeName}`;
  const divergent = outcome === 'shadow-dup-divergent';
  const body = recordPayload({
    title,
    type: 'task',
    deferReason: DEFER_REASON,
    body: specShapedBody({
      provenance: { origin: `wrap-up Review Console, run ${defuse(runId)}: ${outcome} copy staged/${safeName}`, deferReason: DEFER_REASON },
      currentState: divergent
        ? [
          `\`staged/${safeName}\` is a ${outcome} copy of its anchor \`staged/${safeAnchor}\` — the two differ, and the copy's full content follows verbatim.`,
          fencedBlock(defuse(text)),
          `\`staged/${safeAnchor}\` stops resolving once the run dir is archived, so the anchor's full content follows verbatim too.`,
          fencedBlock(defuse(anchorText)),
        ]
        : [
          `\`staged/${safeName}\` is a ${outcome} copy: its anchor \`staged/${safeAnchor}\` was missing or unreadable, so nothing could be compared, and the copy's full content follows verbatim.`,
          fencedBlock(defuse(text)),
        ],
      deliverables: '- [ ] compare with the anchor; apply the copy through its own kind\'s consumer, or close this record when the anchor covers it',
      openQuestion: divergent
        ? `Does the copy carry a proposal that its anchor \`staged/${safeAnchor}\` does not?`
        : `The anchor \`staged/${safeAnchor}\` was missing or unreadable, so is the copy's proposal still wanted?`,
      releaseNote: 'No user-visible change.',
      filedBy: 'wrap-up Review Console',
      footer: '_Filed by `wrap-up Review Console` via specShapedBody._',
    }),
  }).body;

  return {
    ok: true,
    outcome,
    anchor,
    title,
    proposal: `Title: ${title}\nType: task\nLabels: ${LABELS.NEEDS_DEFINITION}\nDefer-reason: ${DEFER_REASON}\n\n${body}`,
  };
}

module.exports = { composeShadowDupProposal };
