'use strict';
// tools/guard-refusals/fences.js — #4028: the fenced-block extractor and the
// markdown walker the guard-shape scan runs over plugin/skills/**.
//
// A fence opens on a line of 3+ backticks or tildes, after any indentation and
// any blockquote markers (`> `). It closes on a line of the same character, at
// least as long, inside the same blockquote depth. A fence whose blockquote ends
// first, or that reaches the end of the text, is unterminated: malformedFences()
// reports it rather than letting the scan pass it silently.

const fs = require('node:fs');
const path = require('node:path');

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);
const OPEN = /^((?:[ \t]*>)*)([ \t]*)(`{3,}|~{3,})(.*)$/;

function quoteDepth(prefix) {
  return (prefix.match(/>/g) || []).length;
}

// Remove `depth` blockquote markers (each with one optional following space).
function unquote(line, depth) {
  let rest = line;
  for (let i = 0; i < depth; i++) rest = rest.replace(/^[ \t]*> ?/, '');
  return rest;
}

function scanFences(text) {
  const lines = text.split(/\r?\n/);
  const fences = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!open) {
      const m = OPEN.exec(line);
      if (!m) continue;
      const info = m[4].trim();
      if (m[3][0] === '`' && info.includes('`')) continue; // an inline code span, not a fence
      open = {
        line: i + 1,
        depth: quoteDepth(m[1]),
        char: m[3][0],
        len: m[3].length,
        indent: m[2].length,
        lang: (info.split(/\s+/)[0] || '').toLowerCase(),
        body: [],
      };
      continue;
    }
    if (open.depth > 0 && quoteDepth(/^((?:[ \t]*>)*)/.exec(line)[1]) < open.depth) {
      // The blockquote ended before the closer: unterminated. Re-scan this line.
      fences.push({ ...open, closed: false });
      open = null;
      i--;
      continue;
    }
    const rest = unquote(line, open.depth);
    const closer = new RegExp(`^[ \\t]*\\${open.char}{${open.len},}[ \\t]*$`);
    if (closer.test(rest)) {
      fences.push({ ...open, closed: true });
      open = null;
      continue;
    }
    open.body.push(rest.replace(new RegExp(`^ {0,${open.indent}}`), ''));
  }
  if (open) fences.push({ ...open, closed: false });
  return fences;
}

function shellFences(text) {
  return scanFences(text)
    .filter((f) => SHELL_LANGS.has(f.lang))
    .map((f) => ({ line: f.line, lang: f.lang, body: f.body.join('\n') }));
}

function malformedFences(text) {
  return scanFences(text).filter((f) => !f.closed).map((f) => f.line);
}

// Sorted absolute *.md paths under root. An entry that vanishes between the
// directory listing and its stat (ENOENT) is skipped; any other error, and any
// error reading root itself, throws: a walk that silently comes back short
// would certify files it never read.
function walkMarkdown(root, { readdirSync = fs.readdirSync, statSync = fs.statSync } = {}) {
  const out = [];
  const visit = (dir, isRoot) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch (err) {
      if (!isRoot && err.code === 'ENOENT') return;
      throw err;
    }
    for (const name of names) {
      const p = path.join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }
      if (st.isDirectory()) visit(p, false);
      else if (st.isFile() && name.endsWith('.md')) out.push(p);
    }
  };
  visit(path.resolve(root), true);
  return out.sort();
}

module.exports = { scanFences, shellFences, malformedFences, walkMarkdown };
