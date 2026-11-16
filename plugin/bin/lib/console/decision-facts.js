'use strict';
// Decision facts (#4620): the packet entries a control-mode Review Console
// writes for items it could not resolve. Prose twin: the `## Decision facts`
// table in skills/_shared/acceptance-packet.md, which owns the schema.
//
// resolve.js requires this module, so resolve.js is required lazily inside the
// functions below (a top-level require would be a cycle). fingerprint,
// issues/record and finding-filing never reach resolve.js, so they load at the top.

const path = require('path');
const { fingerprintFromBasis } = require('../health-core/fingerprint');
const { capWords, oneLine } = require('./finding-filing');
const {
  specShapedBody, recordPayload, fencedBlock, defuse, LABELS,
} = require('../issues/record');

const DECISION_FACT_KIND = 'decision';
const DECISION_ORIGINS = Object.freeze(['console', 'review', 'upstream']);
const DECISION_FACT_FIELDS = Object.freeze(['id', 'kind', 'origin', 'summary', 'evidenceRef', 'suggestedResolution']);

const DECISION_SUGGESTIONS = Object.freeze({
  pending: 'review it, then apply or decline',
  'keep-staged': 'decide whether the finding holds; fix it or decline',
  refused: 'supply a Defer-reason, or decline',
});
const DEFAULT_SUGGESTION = 'decide, then apply or decline';

// The console section an item sits in decides who raised it.
function decisionOrigin(section) {
  const { SECTIONS } = require('./resolve');
  if (section === SECTIONS.LOW || section === SECTIONS.CONTESTED) return 'review';
  if (section === SECTIONS.UPSTREAM) return 'upstream';
  return 'console';
}

// item: { id, section, resolution, reason } as it stood before the carry.
function decisionFactFor(item, { runDir, staged }) {
  const { runIdOf } = require('./resolve');
  const origin = decisionOrigin(item.section);
  const base = path.posix.join('.claude-tweaks', 'pipelines', runIdOf(runDir));
  const evidenceRef = staged ? `${base}/staged/${item.id}` : `${base}/decisions.md`;
  const summary = `${item.section}: ${item.id} — ${item.reason}`.replace(/\s+/g, ' ').trim();
  return {
    id: `${DECISION_FACT_KIND}:${origin}:${item.id}`,
    kind: DECISION_FACT_KIND,
    origin,
    summary,
    evidenceRef,
    suggestedResolution: Object.hasOwn(DECISION_SUGGESTIONS, item.resolution) ? DECISION_SUGGESTIONS[item.resolution] : DEFAULT_SUGGESTION,
    text: summary,
  };
}

const DEFER_REASON = 'needs-human-decision';
const TITLE_PREFIX = 'Packet decision left open: ';
const TITLE_TEXT_MAX = 80;

const isText = (s) => typeof s === 'string' && s.trim() !== '';

// An approved packet files every decision it lists: nothing produces an answer today, so there is
// no answer predicate and nothing is silently ratified. Plans only — the caller writes the records,
// and a decision never gates a merge.
// packetFacts: a facts document { facts: [...] } or a bare array; anything else yields [].
// A decision with no string id is skipped (it has no stable fingerprint basis); a repeated id
// files once (first wins); the text falls back from `text` to `summary` to the id.
function settleOpenDecisions(packetFacts) {
  const list = Array.isArray(packetFacts) ? packetFacts : (packetFacts && packetFacts.facts);
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const decisions = list.filter((f) => {
    if (!f || f.kind !== DECISION_FACT_KIND || !isText(f.id) || seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
  return decisions.map((fact) => {
    const text = [fact.text, fact.summary].find(isText) || fact.id;
    const fingerprint = fingerprintFromBasis('packetdecision', [fact.id]);
    const title = `${TITLE_PREFIX}${capWords(oneLine(text), TITLE_TEXT_MAX)}`;
    const body = recordPayload({
      title,
      type: 'task',
      deferReason: DEFER_REASON,
      fingerprint,
      body: specShapedBody({
        provenance: { origin: `acceptance packet, decision fact ${oneLine(fact.id)}`, deferReason: DEFER_REASON },
        currentState: [
          'The acceptance packet listed this decision as open when it was approved. The decision follows.',
          fencedBlock(defuse(text)),
        ],
        deliverables: '- [ ] decide the open question, then record the outcome here or close this record',
        acceptanceCriteria: '- [ ] the decision is made and recorded, or this record is closed with the reason it no longer applies',
        releaseNote: 'No user-visible change.',
        filedBy: 'acceptance-packet',
        footer: '_Filed by `acceptance-packet` via specShapedBody._',
      }),
    }).body;
    return {
      factId: fact.id,
      fingerprint,
      title,
      proposal: `Title: ${title}\nType: task\nLabels: ${LABELS.NEEDS_DEFINITION}\nDefer-reason: ${DEFER_REASON}\n\n${body}`,
    };
  });
}

module.exports = { DECISION_FACT_KIND, DECISION_ORIGINS, DECISION_FACT_FIELDS, DECISION_SUGGESTIONS, decisionOrigin, decisionFactFor, settleOpenDecisions };
