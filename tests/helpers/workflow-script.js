'use strict';
// Loads a Claude Code workflow script (plugin/workflows/*.js, #5599) for a test with stubbed globals.
//
// A workflow script is `export const meta = { ... }` followed by a body the Workflow tool runs as an async
// function with the globals agent, parallel, phase, log and args. loadWorkflowScript reads the file, drops the
// leading `export` and runs the whole text as that function's body, so the script's own `return` is run()'s value.
// `meta` is the object literal itself, evaluated on its own.
//
// Assumption: no string inside the meta literal holds an unbalanced `{` or `}` — the literal's end is found by
// counting braces from its opening `{`.

const fs = require('node:fs');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const META_DECL = 'export const meta =';

function metaLiteral(text, file) {
  const decl = text.indexOf(META_DECL);
  const start = decl === -1 ? -1 : text.indexOf('{', decl);
  if (start === -1) throw new Error(`${file}: no \`${META_DECL} {\` declaration`);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`${file}: the meta literal never closes`);
}

function loadWorkflowScript(absPath) {
  const text = fs.readFileSync(absPath, 'utf8');
  const meta = new Function(`return (${metaLiteral(text, absPath)});`)();
  const body = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', text.replace(META_DECL, 'const meta ='));
  const run = ({ agent, parallel, phase, log, args }) => body(agent, parallel, phase, log, args);
  return { meta, run };
}

module.exports = { loadWorkflowScript };
