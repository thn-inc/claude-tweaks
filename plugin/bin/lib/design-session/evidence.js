// bin/lib/design-session/evidence.js — "done" check for a design session's
// evidence file: a Status line right after the H1, and every bullet naming
// a source.
'use strict';

// One source: an issue/PR ref, a commit sha, a path:line, or a run folder.
// The path of a path:line may contain spaces (a plugin root under "/Users/John
// Smith/..."), so it may not contain ", " — that is the list separator, which keeps
// every item boundary unambiguous — nor start or end with whitespace: it ends at
// the ".ext:line" that closes it.
const PATH = '[^\\s,](?:[^,]|,(?! ))*?\\.\\w+:\\d+';
const ONE = `(?:#\\d+|[0-9a-f]{7,40}|${PATH}|\\.claude-tweaks/pipelines/\\S+)`;
// A source list: one or more sources joined by ", ". Anchored.
const SOURCE_RE = new RegExp(`^${ONE}(?:, ${ONE})*$`);

const STATUS_RE = /^status:\s*(done|in-progress)\s*$/i;

// -> { done, unsourced: 1-based line numbers of bullets without a valid source,
//      unclosedFence: a ``` fence is still open at end of file }
function checkEvidence(text) {
  const lines = String(text).split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^# /.test(l));
  let status = null;
  for (let i = h1 + 1; h1 >= 0 && i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const m = STATUS_RE.exec(lines[i]);
    if (m) status = m[1].toLowerCase();
    break;
  }

  const unsourced = [];
  let claims = 0;
  let fenced = false;
  lines.forEach((line, idx) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (fenced || !/^\s*- /.test(line)) return;
    claims++;
    const at = line.lastIndexOf(' — source: ');
    const src = at === -1 ? null : line.slice(at + ' — source: '.length).trim();
    if (!src || !SOURCE_RE.test(src)) unsourced.push(idx + 1);
  });

  // An unclosed fence hides every bullet after it, so the file is not done.
  return {
    done: status === 'done' && !fenced && claims > 0 && unsourced.length === 0,
    unsourced,
    unclosedFence: fenced,
  };
}

module.exports = { checkEvidence, SOURCE_RE };
