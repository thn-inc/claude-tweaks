// plugin/bin/lib/qa-scrub/secrets.js — parses a story's `secrets:` block (#4477),
// handed over as JSON by /test qa's dispatcher (skills/test/qa-prompts.md).
// Each entry is exactly one of:
//   { pattern: "<JS regex source>" }   — compiled with the `g` flag
//   { locator: { role[, name] } | { label } | { placeholder } }
// A locator's value is resolved later from the story's aria snapshots
// (snapshot-locator.js). `testid` is refused because aria snapshots carry no
// test ids, and `text` because a text locator names the value itself — both
// are better written as a `pattern`. Error strings name the entry index and a
// code, never the pattern text: a careless pattern can be the secret.
'use strict';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v !== '';

function parseLocator(loc) {
  if (!isObject(loc)) return { code: 'locator-shape' };
  if (Object.hasOwn(loc, 'testid')) return { code: 'locator-testid-unsupported' };
  if (Object.hasOwn(loc, 'text')) return { code: 'locator-text-unsupported' };
  const keys = Object.keys(loc);
  if (keys.length === 0 || !keys.every((k) => ['role', 'name', 'label', 'placeholder'].includes(k))) {
    return { code: 'locator-shape' };
  }
  if (!keys.every((k) => nonEmptyString(loc[k]))) return { code: 'locator-shape' };
  if (Object.hasOwn(loc, 'role')) {
    if (keys.some((k) => k !== 'role' && k !== 'name')) return { code: 'locator-shape' };
    return { locator: loc.name === undefined ? { role: loc.role } : { role: loc.role, name: loc.name } };
  }
  if (keys.length !== 1 || keys[0] === 'name') return { code: 'locator-shape' };
  return { locator: { [keys[0]]: loc[keys[0]] } };
}

function parsePattern(src) {
  if (!nonEmptyString(src)) return { code: 'pattern-invalid' };
  let probe;
  try { probe = new RegExp(src); } catch { return { code: 'pattern-invalid' }; }
  if (probe.test('')) return { code: 'pattern-matches-empty' };
  return { regex: new RegExp(src, 'g') };
}

function parseSecrets(input) {
  if (!Array.isArray(input)) return { error: 'secrets-not-array' };
  if (input.length === 0) return { error: 'secrets-empty' };
  const secrets = [];
  for (let i = 0; i < input.length; i += 1) {
    const entry = input[i];
    const hasPattern = isObject(entry) && Object.hasOwn(entry, 'pattern');
    const hasLocator = isObject(entry) && Object.hasOwn(entry, 'locator');
    if (!isObject(entry) || hasPattern === hasLocator || Object.keys(entry).length !== 1) {
      return { error: `entry-shape: entry ${i}` };
    }
    if (hasPattern) {
      const p = parsePattern(entry.pattern);
      if (p.code) return { error: `${p.code}: entry ${i}` };
      secrets.push({ kind: 'pattern', regex: p.regex, source: entry.pattern });
    } else {
      const l = parseLocator(entry.locator);
      if (l.code) return { error: `${l.code}: entry ${i}` };
      secrets.push({ kind: 'locator', locator: l.locator });
    }
  }
  return { secrets };
}

module.exports = { parseSecrets };
