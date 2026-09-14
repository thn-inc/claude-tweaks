'use strict';

// Cross-references a decomposition's own forward/backward sub-issue mentions
// into the mentioned sibling's Key Files list (record #490). The #473/#475
// incident: #473's Gotchas forward-referenced a facet rename ("soon
// facets.solutionUnjustified, per the companion rename sub-issue") that #475
// actually had to make, but neither sub-issue's own scope-only Key Files list
// named the file the facet lives in (bin/lib/issues/local-store.js) -- the gap
// was caught only by an independent repo-wide grep during #475's build.
//
// This module mechanizes the narrow, deterministic half of that gap: given a
// Gotchas/Prerequisites line that both names a sibling sub-issue (by title)
// and carries a backticked identifier-like token (a facet/property/function
// reference -- not a file path, which a human would already have caught),
// grep the repo for that identifier and add the resulting file(s) to the
// named sibling's own Key Files list. Deciding *whether* a given sentence is a
// genuine forward-reference (versus a casual mention) still needs the
// specify-time agent's own judgment -- this only resolves an identifier that
// prose already names into the file(s) it lives in, the exact mechanical step
// a human did by hand in the original incident.

const { extractKeyFilesSection } = require('./grouping');
const { escapeRegExp } = require('../shared-primitives');

const ANY_HEADING_RE = /^#{1,6}[ \t]/;
const BACKTICK_RE = /`([^`]+)`/g;
// A facet/property/function-style token -- dotted or bare identifier,
// optionally call-shaped (`deriveSlug()`) -- never a path (no `/`) and never
// a bare English word a Gotchas sentence would otherwise quote.
const IDENTIFIER_LIKE_RE = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*(\(\))?$/;
const TEST_PATH_RE = /(^|\/)tests?\//;
const TEST_FILE_RE = /\.test\.[jt]sx?$/;

function extractSection(body, headingText) {
  const lines = String(body || '').split('\n');
  const headingRe = new RegExp(`^#{2,4}[ \\t]+${headingText}[ \\t]*$`);
  const start = lines.findIndex((line) => headingRe.test(line));
  if (start === -1) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (ANY_HEADING_RE.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

/**
 * units: [{ title, body }] -- one per sub-issue in the same decomposition batch.
 * grep(identifier): string[] -- injectable, returns file paths mentioning
 *   that identifier (e.g. `git grep -l` over the repo); never throws -- a
 *   caller whose grep can fail should catch and return [] itself, since a
 *   failed lookup means "nothing found," not "stop the whole pass."
 *
 * Returns [{ title, addedFiles: [{ path, note }] }] -- one entry per unit
 * whose Key Files list gained at least one addition; units with no additions
 * are omitted entirely (the documented no-op case, not an error).
 */
function crossReferenceKeyFiles(units, grep) {
  const list = Array.isArray(units) ? units : [];
  const results = [];

  // Each `other`'s Gotchas+Prerequisites text doesn't depend on the outer
  // `unit`, so compute it once per `other` here rather than once per
  // unit x other pair inside the double loop below.
  const sectionTextByOther = new Map();
  for (const other of list) {
    if (!other) continue;
    sectionTextByOther.set(
      other,
      `${extractSection(other.body, 'Gotchas')}\n${extractSection(other.body, 'Prerequisites')}`,
    );
  }

  // Memoize grep results across the whole batch — the same identifier can be
  // named in multiple units' Gotchas/Prerequisites text, and re-spawning the
  // injected grep subprocess for each occurrence is avoidable cost.
  const grepCache = new Map();
  const memoizedGrep = (ident) => {
    if (grepCache.has(ident)) return grepCache.get(ident);
    let files = [];
    try {
      files = grep(ident) || [];
    } catch {
      files = [];
    }
    grepCache.set(ident, files);
    return files;
  };

  for (const unit of list) {
    const additions = new Map(); // path -> note

    for (const other of list) {
      if (other === unit || !other || !unit) continue;
      const title = String(unit.title || '');
      if (!title) continue;
      const text = sectionTextByOther.get(other) || '';
      const titleRe = new RegExp(`\\b${escapeRegExp(title)}\\b`, 'i');

      for (const line of text.split('\n')) {
        if (!titleRe.test(line)) continue;
        const idents = [...line.matchAll(BACKTICK_RE)]
          .map((m) => m[1])
          .filter((token) => IDENTIFIER_LIKE_RE.test(token));

        for (const ident of idents) {
          const files = memoizedGrep(ident);
          for (const file of files) {
            if (TEST_PATH_RE.test(file) || TEST_FILE_RE.test(file)) continue;
            if (!additions.has(file)) {
              additions.set(file, `cross-referenced from "${other.title}"'s Gotchas (names \`${ident}\`)`);
            }
          }
        }
      }
    }

    const existing = new Set(extractKeyFilesSection(unit.body));
    const toAdd = [...additions].filter(([path]) => !existing.has(path));
    if (toAdd.length) {
      results.push({
        title: unit.title,
        addedFiles: toAdd.map(([path, note]) => ({ path, note })),
      });
    }
  }

  return results;
}

module.exports = { crossReferenceKeyFiles };
