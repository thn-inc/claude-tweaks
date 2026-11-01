// bin/lib/log-decision/aggregate-reproduction.js — refuse a STAGED reproduction line that names several
// findings (#4581). The Review Console settles a STAGED reproduction line only by its `{lens}|{path}:{line}`
// key (console/resolve.js's findingKey/lineKeys), so a line naming several findings can never be settled and
// stays as residue. Detection is by grammar — a plural `findings` subject (a count, a lens noun phrase, or the
// marker's own subject) or two `lens … finding` clauses — with the location shape shared with that reader
// (console/finding-path.js), and lineKeys's two-full-path coincidence clause exempted. Pure, no I/O.
'use strict';

const { FINDING_PATH } = require('../console/finding-path');

const LENS = String.raw`lens(?:es)?\s+(?:"[^"]*"|\S+)`;
// A plural phrase with a zero quantifier (`no`, `zero`, `0`) anywhere before `findings` names no findings, not
// several: the count and every word the phrase spans must not be one (`Lens 3c: agents returned no findings`),
// including one written after `(`, which WORD admits (`Lens 3c (no findings)`).
const NOT_ZERO = String.raw`(?!\(?(?:no|zero|0)\s)`;
const WORD = String.raw`${NOT_ZERO}[\w/()-]+\s+`;
const COINCIDENCE_RE = new RegExp(String.raw`\blens\s+(?:"[^"]*"|[A-Za-z0-9_-]+)\s+findings\s+${FINDING_PATH}:\d+\s+\/\s+${FINDING_PATH}:\d+\s+share a location\b`, 'i');
const PATH_RE = new RegExp(String.raw`${FINDING_PATH}(?::\d+)?`, 'g');
const PLURAL_SUBJECT_RES = [
  new RegExp(String.raw`\b${NOT_ZERO}\d+\s+(?:${WORD}){0,3}findings\b`, 'i'),
  new RegExp(String.raw`\b${LENS}\s+(?:${WORD}){0,3}findings\b`, 'i'),
  new RegExp(String.raw`\breproduction:\s+(?:${WORD}){0,4}findings\b`, 'i'),
];
const LENS_FINDING_RE = new RegExp(String.raw`\b${LENS}\s+(?:[\w-]+\s+)?finding\b`, 'gi');

// null when the entry may be written; otherwise the refusal reason. The entry is checked as formatEntry
// writes it (`{step}: {text}`), so a marker split between --step and --text is still seen.
function aggregateReproductionProblem({ status, step, text }) {
  if (status !== 'STAGED') return null;
  const body = String(text).trim();
  const entry = step ? `${step}: ${body}` : body;
  // A quoted marker (`see "Reproduction: 3 findings" above`) is another line citing one, not a marker.
  const at = entry.search(/(?<!["'`])\breproduction:\s/i);
  if (at < 0) return null;
  // The coincidence clause is exempt, not the whole line: drop it and judge whatever else the line says.
  const marked = entry.slice(at);
  const coincidence = COINCIDENCE_RE.test(marked);
  const tail = marked.replace(COINCIDENCE_RE, ' ');
  // Neutralize paths so a path containing `findings` never counts as the plural subject.
  const bare = tail.replace(PATH_RE, 'PATH');
  // Two `lens … finding` clauses name several findings; after a coincidence clause (already two), one more does.
  const clauses = (bare.match(LENS_FINDING_RE) || []).length;
  const aggregate = PLURAL_SUBJECT_RES.some((re) => re.test(bare)) || clauses >= (coincidence ? 1 : 2);
  if (!aggregate) return null;
  return `names several findings in one reproduction line — log one line per finding, each with its lens and full {path}:{line} (--entries writes several in one call): "${entry}"`;
}

module.exports = { aggregateReproductionProblem };
