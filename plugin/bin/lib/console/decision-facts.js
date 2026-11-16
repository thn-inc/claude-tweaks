'use strict';
// Decision facts (#4620): the packet entries a control-mode Review Console
// writes for items it could not resolve. Prose twin: the `## Decision facts`
// table in skills/_shared/acceptance-packet.md, which owns the schema.
//
// A leaf module: resolve.js requires it, so resolve.js is required lazily
// inside the functions below (a top-level require would be a cycle).

const path = require('path');

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

module.exports = { DECISION_FACT_KIND, DECISION_ORIGINS, DECISION_FACT_FIELDS, DECISION_SUGGESTIONS, decisionOrigin, decisionFactFor };
