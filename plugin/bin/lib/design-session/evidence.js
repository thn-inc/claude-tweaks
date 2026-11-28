// bin/lib/design-session/evidence.js — "done" check for a design session's
// evidence file: a Status line right after the H1, and every bullet naming
// a source.
'use strict';

const { fencedLineMask, unclosedFenceLine } = require('../markdown-blocks');
const { leadingStatus, splitLines } = require('./notes');

// One source: an issue/PR ref, a commit sha, a path:line, or a run folder.
// The path of a path:line may contain spaces (a plugin root under "/Users/John
// Smith/..."), so it may not contain ", " — that is the list separator, which keeps
// every item boundary unambiguous — nor start or end with whitespace: it ends at
// the ".ext:line" that closes it.
const PATH = '[^\\s,](?:[^,]|,(?! ))*?\\.\\w+:\\d+';
const ONE = `(?:#\\d+|[0-9a-f]{7,40}|${PATH}|\\.claude-tweaks/pipelines/\\S+)`;
// A source list: one or more sources joined by ", ". Anchored.
const SOURCE_RE = new RegExp(`^${ONE}(?:, ${ONE})*$`);

// -> { done, unsourced: 1-based line numbers of bullets without a valid source,
//      unclosedFence: a fence is still open at end of file }
function checkEvidence(text) {
  const lines = splitLines(text);
  const status = leadingStatus(lines);

  const unsourced = [];
  let claims = 0;
  const fenced = fencedLineMask(lines);
  const unclosedFence = unclosedFenceLine(lines) !== -1;
  lines.forEach((line, idx) => {
    if (fenced[idx] || !/^\s*- /.test(line)) return;
    claims++;
    const at = line.lastIndexOf(' — source: ');
    const src = at === -1 ? null : line.slice(at + ' — source: '.length).trim();
    if (!src || !SOURCE_RE.test(src)) unsourced.push(idx + 1);
  });

  // An unclosed fence hides every bullet after it, so the file is not done.
  return {
    done: status === 'done' && !unclosedFence && claims > 0 && unsourced.length === 0,
    unsourced,
    unclosedFence,
  };
}

module.exports = { checkEvidence, SOURCE_RE };
