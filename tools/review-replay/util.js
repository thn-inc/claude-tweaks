'use strict';
// tools/review-replay/util.js — the two small helpers more than one module of the replay tool needs.

// Text -> lines, for LF and CRLF files alike.
const split = (text) => String(text).split(/\r?\n/);

// map[key] += by.
const bump = (map, key, by = 1) => {
  map[key] = (map[key] || 0) + by;
};

module.exports = { split, bump };
