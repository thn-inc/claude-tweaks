// plugin/bin/lib/verify/declaration.js — reads and validates the project's
// .claude-tweaks/verify-scope.json (#1922): the caller-named declaration that
// maps changed-path globs to test suites and static checks. Not a policy key
// (never read by resolve-policy.js); the runner receives its path as an
// explicit --scope input. A missing file is {ok: true, decl: null,
// missing: true} — mode full, today's behavior — never a throw; `missing`
// lets a caller tell "no declaration" (ENOENT) apart from a read that failed
// for another reason (EACCES, EISDIR, ...), which is ok: false instead so it
// is never silently treated as "not declared" (review finding, refs #1922).
// Every invalid field is reported, not just the first, so a project fixes
// its declaration in one pass. A declaration with no `checks.tests` declares
// zero suites — valid, its rules may only use `'*'` or `[]` (#1924).
'use strict';

const fs = require('fs');

const DEFAULT_MAX_RETRIES = 1;
const MAX_RETRIES_CEILING = 2;

function isPlainObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

function readDeclaration(filePath, fsImpl = fs) {
  let text;
  try {
    text = fsImpl.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, decl: null, missing: true };
    return { ok: false, errors: [`verify-scope.json: could not read ${filePath}: ${err.message}`] };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`verify-scope.json: could not parse JSON: ${err.message}`] };
  }
  const errors = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['verify-scope.json: top level must be an object'] };

  // checks
  const checks = raw.checks;
  let suites = [];
  let toolScoped = false;
  let tests = null;
  if (!isPlainObject(checks)) {
    errors.push('checks: must be an object with a `tests` entry');
  } else {
    for (const key of ['types', 'lint']) {
      if (checks[key] !== undefined && typeof checks[key] !== 'string') errors.push(`checks.${key}: must be a string when present`);
    }
    if (checks.tests === undefined) {
      // Valid — zero suites (#1924). tests/suites already default to
      // null/[] above, so there is nothing to assign here.
    } else if (typeof checks.tests === 'string' && checks.tests.trim() !== '') {
      tests = checks.tests;
      suites = ['tests'];
      toolScoped = checks.tests.includes('{base}');
    } else if (isPlainObject(checks.tests) && Object.keys(checks.tests).length > 0) {
      tests = {};
      for (const [name, cmd] of Object.entries(checks.tests)) {
        if (!/^[A-Za-z0-9_-]+$/.test(name)) errors.push(`checks.tests.${name}: suite name must match [A-Za-z0-9_-]+`);
        if (typeof cmd !== 'string' || cmd.trim() === '') errors.push(`checks.tests.${name}: command must be a non-empty string`);
        tests[name] = cmd;
      }
      suites = Object.keys(checks.tests);
    } else if (checks.tests !== undefined && typeof checks.tests !== 'string' && !isPlainObject(checks.tests)) {
      // A present but wrong-typed value (array, number, boolean, null, ...)
      // is a distinct mistake from leaving it out entirely — name the actual
      // type rather than reusing the "required" message (review finding,
      // refs #1922). Undefined is handled above (valid, zero suites); empty
      // string/object still fall through below, keeping the existing
      // "required" message.
      errors.push(`checks.tests: must be a command string or a map of suite name to command, got ${typeof checks.tests}`);
    } else {
      errors.push('checks.tests: required — a command string or a map of suite name to command');
    }
  }
  const declared = new Set(suites);

  // retry
  const retry = {};
  if (raw.retry !== undefined) {
    if (!isPlainObject(raw.retry)) {
      errors.push('retry: must be a map of suite name to a per-file command template');
    } else {
      for (const [name, tmpl] of Object.entries(raw.retry)) {
        if (!declared.has(name)) errors.push(`retry.${name}: unknown suite (declared: ${suites.join(', ') || 'none'})`);
        if (typeof tmpl !== 'string' || !tmpl.includes('{file}')) errors.push(`retry.${name}: template must be a string containing {file}`);
        retry[name] = tmpl;
      }
    }
  }

  // rules
  const rules = [];
  if (!Array.isArray(raw.rules)) {
    errors.push('rules: required — an array of {match, suites, static}');
  } else {
    raw.rules.forEach((rule, i) => {
      const where = `rules[${i}]`;
      if (!isPlainObject(rule)) { errors.push(`${where}: must be an object`); return; }
      if (typeof rule.match !== 'string' || rule.match === '') errors.push(`${where}.match: must be a non-empty glob string`);
      let ruleSuites;
      if (rule.suites === '*') {
        ruleSuites = '*';
      } else if (Array.isArray(rule.suites)) {
        ruleSuites = rule.suites;
        for (const s of rule.suites) {
          if (typeof s !== 'string') {
            // A non-string entry names its type, not a stringified rendering
            // of the value in an "unknown suite" message (review finding,
            // refs #1922).
            errors.push(`${where}.suites: entries must be strings, got ${typeof s}`);
          } else if (!declared.has(s)) {
            errors.push(`${where}.suites: unknown suite "${s}" (declared: ${suites.join(', ') || 'none'})`);
          }
        }
      } else {
        errors.push(`${where}.suites: must be "*" or an array of declared suite names`);
      }
      if (typeof rule.static !== 'boolean') errors.push(`${where}.static: must be a boolean`);
      rules.push({ match: rule.match, suites: ruleSuites, static: rule.static });
    });
  }

  // flaky
  let flaky = { files: [], maxRetries: DEFAULT_MAX_RETRIES };
  if (raw.flaky !== undefined) {
    if (!isPlainObject(raw.flaky)) {
      errors.push('flaky: must be an object');
    } else {
      const files = raw.flaky.files;
      if (files !== undefined && (!Array.isArray(files) || files.some((f) => typeof f !== 'string'))) errors.push('flaky.files: must be an array of path or glob strings');
      let maxRetries = DEFAULT_MAX_RETRIES;
      if (raw.flaky.maxRetries !== undefined) {
        const n = raw.flaky.maxRetries;
        if (!Number.isInteger(n) || n < 0 || n > MAX_RETRIES_CEILING) errors.push(`flaky.maxRetries: must be an integer from 0 to ${MAX_RETRIES_CEILING}`);
        else maxRetries = n;
      }
      flaky = { files: Array.isArray(files) ? files.filter((f) => typeof f === 'string') : [], maxRetries };
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    decl: {
      checks: { types: typeof checks.types === 'string' ? checks.types : null, lint: typeof checks.lint === 'string' ? checks.lint : null, tests },
      suites, toolScoped, retry, rules, flaky,
    },
  };
}

module.exports = { readDeclaration, DEFAULT_MAX_RETRIES, MAX_RETRIES_CEILING };
