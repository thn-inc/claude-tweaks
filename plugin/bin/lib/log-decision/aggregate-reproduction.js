// bin/lib/log-decision/aggregate-reproduction.js — refuse a STAGED reproduction line that names several
// findings (#4581). The Review Console settles a STAGED reproduction line only by its `{lens}|{path}:{line}`
// key (console/resolve.js's findingKey/lineKeys), so a line naming several findings can never be settled and
// stays as residue. Detection is by grammar — a plural `findings` subject (a count, a lens noun phrase, or the
// marker's own subject) or two `lens … finding` clauses — with the location shape shared with that reader
// (console/finding-path.js), and lineKeys's two-full-path coincidence line exempted. Pure, no I/O.
'use strict';

const { FINDING_PATH } = require('../console/finding-path');

const LENS = String.raw`lens(?:es)?\s+(?:"[^"]*"|\S+)`;
const WORD = String.raw`[\w/()-]+\s+`;
const COINCIDENCE_RE = new RegExp(String.raw`\blens\s+(?:"[^"]*"|[A-Za-z0-9_-]+)\s+findings\s+${FINDING_PATH}:\d+\s+\/\s+${FINDING_PATH}:\d+\s+share a location\b`);
const PATH_RE = new RegExp(String.raw`${FINDING_PATH}(?::\d+)?`, 'g');
const PLURAL_SUBJECT_RES = [
  new RegExp(String.raw`\b\d+\s+(?:${WORD}){0,3}findings\b`, 'i'),
  new RegExp(String.raw`\b${LENS}\s+(?:${WORD}){0,3}findings\b`, 'i'),
  new RegExp(String.raw`\breproduction:\s+(?:${WORD}){0,4}findings\b`, 'i'),
];
const LENS_FINDING_RE = new RegExp(String.raw`\b${LENS}\s+(?:[\w-]+\s+)?finding\b`, 'gi');

// null when the entry may be written; otherwise the refusal reason. The entry is checked as formatEntry
// writes it (`{step}: {text}`), so a marker split between --step and --text is still seen.
function aggregateReproductionProblem({ status, step, text }) {
  if (status !== 'STAGED') return null;
  const entry = step ? `${step}: ${String(text).trim()}` : String(text).trim();
  const at = entry.search(/\breproduction:\s/i);
  if (at < 0) return null;
  const tail = entry.slice(at);
  if (COINCIDENCE_RE.test(tail)) return null;
  // Neutralize paths so a path containing `findings` never counts as the plural subject.
  const bare = tail.replace(PATH_RE, 'PATH');
  const aggregate = PLURAL_SUBJECT_RES.some((re) => re.test(bare)) || (bare.match(LENS_FINDING_RE) || []).length >= 2;
  if (!aggregate) return null;
  return `names several findings in one reproduction line — log one line per finding, each with its lens and full {path}:{line} (--entries writes several in one call): "${entry}"`;
}

module.exports = { aggregateReproductionProblem };
