'use strict';
// Joins one entry of docs/plugin-structure.md with its own continuation lines, so a lookup that
// names an entry's phrases finds them when the doc wraps that entry across lines. Each continuation
// line starts at an entry name; these helpers never span two entries.

// A sub-file table row plus its `| | | ` continuation rows, as one string.
function rowWithContinuations(text, prefix) {
  const lines = text.split('\n');
  const i = lines.findIndex((line) => line.startsWith(prefix));
  if (i < 0) return '';
  let row = lines[i].replace(/ \|$/, '');
  for (let j = i + 1; j < lines.length && lines[j].startsWith('| | | '); j++) {
    row += ' ' + lines[j].slice(6).replace(/ \|$/, '');
  }
  return row + ' |';
}

// A Structure-tree entry plus its indented continuation lines, joined with single spaces.
function treeEntryWithContinuations(text, prefix) {
  const lines = text.split('\n');
  const i = lines.findIndex((line) => line.startsWith(prefix));
  if (i < 0) return '';
  let entry = lines[i];
  for (let j = i + 1; j < lines.length && /^ +\S/.test(lines[j]); j++) entry += ' ' + lines[j].trim();
  return entry;
}

// A Commands-block command plus its `{spaces}# ` continuation lines, joined with single spaces.
function commandWithContinuations(text, prefix) {
  const lines = text.split('\n');
  const i = lines.findIndex((line) => line.startsWith(prefix));
  if (i < 0) return '';
  let command = lines[i];
  for (let j = i + 1; j < lines.length && /^\s+# /.test(lines[j]); j++) {
    command += ' ' + lines[j].replace(/^\s+# /, '');
  }
  return command;
}

module.exports = { rowWithContinuations, treeEntryWithContinuations, commandWithContinuations };
