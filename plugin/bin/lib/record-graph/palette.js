// bin/lib/record-graph/palette.js
// Single source of truth for the record-graph diagram's fixed visual
// vocabulary — stage-column order/labels and the six-axis literal color
// palette. Both render-d2.js (D2 source, literal hex) and render-svg.js
// (SVG core fragment, CSS custom properties built from these same hex
// values) import from here rather than each declaring their own copy.
'use strict';

const COLUMN_ORDER = ['backlog', 'parked', 'ready'];
const COLUMN_LABELS = { backlog: 'Backlog', parked: 'Parked', ready: 'Ready' };

const ORIGIN_COLORS = {
  'code-health': '#5b8def',
  'harness-health': '#9b59b6',
  'journey-health': '#16a085',
  'docs-health': '#e67e22',
  capture: '#34495e',
  dispatch: '#c0392b',
  human: '#7f8c8d',
};

// Keys are the bare bot-state names, except `bot-parked`: both renderers print
// these keys verbatim as legend labels, and a bare `parked` there would read as
// the `parked` stage COLUMN_ORDER already labels "Parked" — keep the prefix.
const BORDER_COLORS = {
  blocked: '#c0392b',
  'in-progress': '#2980b9',
  'bot-parked': '#f39c12',
  default: '#95a5a6',
};

module.exports = {
  COLUMN_ORDER, COLUMN_LABELS, ORIGIN_COLORS, BORDER_COLORS,
};
