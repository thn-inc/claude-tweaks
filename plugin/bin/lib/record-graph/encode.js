// bin/lib/record-graph/encode.js
// Pure: the six-axis visual-encoding contract from
// docs/superpowers/specs/2026-08-03-visualize-record-graph-design.md (deleted
// 70849915). One record in, one {fillKey, borderStyle, badges} out — every
// renderer (D2, SVG) reads exclusively from this shape, never from the raw
// record again.
'use strict';

const { TYPE_LABELS, normalizeLabelNames } = require('../issues/record');

const TITLE_MAX = 40;
// [type:* label, the bare type name it encodes] — 'type:bug' -> 'bug'. Both
// lookups in typeOf() read from this, so the prefix-stripping rule is stated once.
const TYPES_BY_LABEL = TYPE_LABELS.map(([label]) => [label, label.split(':')[1]]);
const RECOGNIZED_TYPES = TYPES_BY_LABEL.map(([, type]) => type);

function truncateTitle(title, max = TITLE_MAX) {
  const text = typeof title === 'string' ? title : '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Native Issue Type (facets don't carry this — see facet-shape.js's own note
// that Type has no shared-facet analog) takes precedence over a type:* label,
// since a project could carry a stale label after switching work-types: native.
function typeOf(record) {
  const native = record.issueType;
  if (native && typeof native === 'object' && typeof native.name === 'string') {
    const name = native.name.toLowerCase();
    return RECOGNIZED_TYPES.includes(name) ? name : null;
  }
  const names = normalizeLabelNames(record.labels);
  for (const [label, type] of TYPES_BY_LABEL) {
    if (names.includes(label)) return type;
  }
  return null;
}

function scoringBadge(facets) {
  if (facets.risk == null && facets.size == null) return null;
  return `R:${facets.risk || '?'} S:${facets.size || '?'}`;
}

function badgesFor(record) {
  const badges = [];
  const type = typeOf(record);
  if (type) badges.push(`[${type}]`);
  const scoring = scoringBadge(record.facets);
  if (scoring) badges.push(scoring);
  if (record.facets.grants.build) badges.push('AUTO-BUILD');
  if (record.facets.grants.merge) badges.push('AUTO-MERGE');
  if (record.facets.acceptance) badges.push(`demo:${record.facets.acceptance}`);
  return badges;
}

function borderStyleFor(bot) {
  if (bot.blocked) return 'blocked';
  if (bot.inProgress) return 'in-progress';
  if (bot.parked) return 'bot-parked';
  return 'default';
}

function encodeRecord(record) {
  return {
    number: record.number,
    // The node's first label line, NOT the raw title: the design doc's node spec is
    // `#{number} {title, truncated ~40 chars}`, and the `#N` prefix is what makes a
    // queue diagram with dependency edges legible at all (without it, no node says
    // which issue it is). Only the title portion is capped at TITLE_MAX; the prefix
    // adds a handful of characters on top of that.
    title: `#${record.number} ${truncateTitle(record.title)}`,
    fillKey: record.facets.origin || 'human',
    borderStyle: borderStyleFor(record.facets.bot),
    badges: badgesFor(record),
  };
}

module.exports = { encodeRecord };
