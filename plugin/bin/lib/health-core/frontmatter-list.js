'use strict';

// Shared YAML-style frontmatter bullet-list parser, extracted from three
// independently hand-written near-identical implementations:
// harness-health/scope.js's parseRulePaths (`paths:` key), journey-health/
// scope.js's parseJourneyFiles (`files:` key), and docs-health/freshness.js's
// parseFilesField (`files:` key) — all three parsed the identical shape,
// e.g.:
//   ---
//   files:
//     - src/checkout/Cart.tsx
//   ---
// Returns [] if there's no frontmatter, no `<fieldName>:` key, or no list
// items — an unparseable header means "no declared domain," not an error.
//
// The three prior implementations had already drifted on the per-item
// regex: docs-health's required at least one space after the dash
// (`/^\s*-\s+(.+?)\s*$/`), while harness-health's and journey-health's
// allowed zero or more (`/^\s*-\s*(.+?)\s*$/`). Every string the stricter
// `\s+` form matches is also matched by the more permissive `\s*` form (a
// space is itself whitespace), so using `\s*` here is a pure widening for
// docs-health's former callers, not a behavior break — verified against
// tests/bin-lib/docs-health/freshness.test.js's fixtures, which all use a
// real space after the dash.
// Splits raw file content at the YAML-style '---' fence boundaries into
// { frontmatter, afterLines }, or returns null when there's no frontmatter
// (the first line isn't '---', or the fence never closes) — the single
// canonical fence-boundary algorithm this module's own header describes
// consolidating three independent hand-rolled copies into. Exported so other
// modules that need "where does the frontmatter block start/end" (not just
// this file's own bullet-list extraction) can share it instead of hand-
// rolling a fourth copy — see bin/lib/issues/local-store.js's splitFrontmatter,
// which was exactly that fourth copy before being folded into this helper.
function splitFrontmatterFence(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const closeIdx = lines.indexOf('---', 1);
  if (closeIdx === -1) return null;
  return { frontmatter: lines.slice(1, closeIdx), afterLines: lines.slice(closeIdx + 1) };
}

function parseFrontmatterListField(content, fieldName) {
  const split = splitFrontmatterFence(content);
  if (!split) return [];
  const { frontmatter } = split;
  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fieldRe = new RegExp(`^${escapedFieldName}:\\s*$`);
  const fieldIdx = frontmatter.findIndex((l) => fieldRe.test(l));
  if (fieldIdx === -1) return [];
  const items = [];
  for (let i = fieldIdx + 1; i < frontmatter.length; i++) {
    const m = frontmatter[i].match(/^\s*-\s*(.+?)\s*$/);
    if (!m) break;
    items.push(m[1]);
  }
  return items;
}

module.exports = { parseFrontmatterListField, splitFrontmatterFence };
