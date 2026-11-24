'use strict';
// checkEvidence (#5933): the evidence a filed-record deferral cites, as `test:{path}` or `ref:{id}`.
//
// The check is form-only. It is a speed bump that cannot detect a fabricated citation: whether a `ref`
// exists or is relevant is out of scope, and a `test` path is only checked to be a real file in the tree.
//
// The path is resolved with `path.resolve`, not `join`, so an absolute path inside the tree would resolve
// to itself and stay valid; the `absolute` guard is what rejects that case, and it runs first.
//
// There is no existence probe here: every path step goes through path-guard (resolveLeaf,
// canonicalRealpath, isAncestorOrSelf, lstatType).
const path = require('path');
const { resolveLeaf, canonicalRealpath, isAncestorOrSelf, lstatType } = require('../path-guard');

const EVIDENCE_KINDS = Object.freeze(['test', 'ref']);
const REF_ID_RE = /^(?:#\d+|IL-\d+)$/;
const EVIDENCE_PROBLEMS = Object.freeze([
  'empty', 'form', 'kind', 'empty-ref', 'ref-id', 'absolute', 'scheme', 'percent',
  'trailing-slash', 'no-top-level', 'missing', 'outside', 'not-a-file',
]);

const ABSOLUTE_RE = /^(?:[\\/]|[A-Za-z]:[\\/])/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const TRAILING_SEP_RE = /[\\/]$/;

const invalid = (problem) => ({ valid: false, problem });

function checkEvidence(text, { topLevel = null, fsImpl, realpath } = {}) {
  if (typeof text !== 'string' || text === '') return invalid('empty');
  const colon = text.indexOf(':');
  if (colon === -1) return invalid('form');
  const kind = text.slice(0, colon);
  if (!EVIDENCE_KINDS.includes(kind)) return invalid('kind');
  const ref = text.slice(colon + 1);
  if (ref === '') return invalid('empty-ref');
  if (kind === 'ref') return REF_ID_RE.test(ref) ? { valid: true, kind, ref } : invalid('ref-id');

  if (ABSOLUTE_RE.test(ref)) return invalid('absolute');
  if (SCHEME_RE.test(ref)) return invalid('scheme');
  if (ref.includes('%')) return invalid('percent');
  if (TRAILING_SEP_RE.test(ref)) return invalid('trailing-slash');

  const opts = { fsImpl, realpath };
  const realTop = typeof topLevel === 'string' ? canonicalRealpath(topLevel, opts) : null;
  if (realTop === null) return invalid('no-top-level');
  const leaf = resolveLeaf(path.resolve(topLevel, ref), opts);
  if (leaf.state !== 'resolved') return invalid('missing');
  if (!isAncestorOrSelf(realTop, leaf.path)) return invalid('outside');
  if (lstatType(leaf.path, { fsImpl }).type !== 'file') return invalid('not-a-file');
  return { valid: true, kind, ref };
}

module.exports = { checkEvidence, EVIDENCE_KINDS, EVIDENCE_PROBLEMS, REF_ID_RE };
