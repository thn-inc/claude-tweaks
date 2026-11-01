// plugin/bin/lib/qa-scrub/snapshot-locator.js — resolves a `secrets:` locator to
// the value(s) it names inside one playwright-cli aria snapshot (#4477).
//
// Snapshot shape (playwright aria YAML, as `playwright-cli snapshot` writes it to
// .playwright-cli/page-*.yml): one node per `- ` line, children indented two
// spaces deeper.
//   - textbox "API key" [ref=e5]: FAKE-VALUE     role, quoted name, attrs, inline value
//   - code [ref=e4]: FAKE-VALUE                  role, no name
//   - text: some words                           a text node
//   - /placeholder: you@example.com              a property of the parent, never a value
//
// A matched node's values are its own inline value plus every descendant's inline
// and text values, property lines excluded. Pure: text in, strings out; the
// caller decides which values are long enough to scrub.
'use strict';

const ITEM_RE = /^(\s*)- (.*)$/;
const ROLE_RE = /^([A-Za-z][\w-]*)/;
const NAME_RE = /^ "((?:[^"\\]|\\.)*)"/;
const ATTR_RE = /^ \[[^\]]*\]/;

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  return t;
}

function parseContent(content) {
  if (content.startsWith('/')) {
    const at = content.indexOf(':');
    if (at < 0) return { kind: 'prop', key: content.slice(1), value: '' };
    return { kind: 'prop', key: content.slice(1, at), value: unquote(content.slice(at + 1)) };
  }
  if (content.startsWith('text:')) return { kind: 'text', value: unquote(content.slice(5)) };
  const role = ROLE_RE.exec(content);
  if (!role) return { kind: 'other' };
  let rest = content.slice(role[0].length);
  let name = null;
  const n = NAME_RE.exec(rest);
  if (n) {
    name = unquote(`"${n[1]}"`);
    rest = rest.slice(n[0].length);
  }
  for (let a = ATTR_RE.exec(rest); a; a = ATTR_RE.exec(rest)) rest = rest.slice(a[0].length);
  const value = rest.startsWith(':') ? unquote(rest.slice(1)) : '';
  return { kind: 'node', role: role[1], name, value };
}

function parseLines(yamlText) {
  const out = [];
  for (const line of String(yamlText).split(/\r?\n/)) {
    const m = ITEM_RE.exec(line);
    if (m) out.push({ indent: m[1].length, ...parseContent(m[2]) });
  }
  return out;
}

// Index range [i+1, end) of node i's descendants.
function subtreeEnd(lines, i) {
  let end = i + 1;
  while (end < lines.length && lines[end].indent > lines[i].indent) end += 1;
  return end;
}

function matches(lines, i, locator) {
  const node = lines[i];
  if (node.kind !== 'node') return false;
  if (locator.role !== undefined) {
    return node.role === locator.role && (locator.name === undefined || node.name === locator.name);
  }
  if (locator.label !== undefined) return node.name === locator.label;
  if (locator.placeholder !== undefined) {
    const end = subtreeEnd(lines, i);
    for (let j = i + 1; j < end; j += 1) {
      const c = lines[j];
      if (c.indent === node.indent + 2 && c.kind === 'prop' && c.key === 'placeholder' && c.value === locator.placeholder) {
        return true;
      }
    }
  }
  return false;
}

function resolveLocatorValues(yamlText, locator) {
  const lines = parseLines(yamlText);
  const values = [];
  const seen = new Set();
  const add = (v) => {
    if (v !== '' && !seen.has(v)) { seen.add(v); values.push(v); }
  };
  for (let i = 0; i < lines.length; i += 1) {
    if (!matches(lines, i, locator)) continue;
    add(lines[i].value);
    const end = subtreeEnd(lines, i);
    for (let j = i + 1; j < end; j += 1) {
      if (lines[j].kind === 'node' || lines[j].kind === 'text') add(lines[j].value);
    }
  }
  return values;
}

module.exports = { resolveLocatorValues };
