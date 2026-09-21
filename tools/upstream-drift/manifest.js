'use strict';

// tools/upstream-drift/manifest.js — a hand-rolled parser and schema
// validator for tools/upstream-drift/manifest.yml. No YAML dependency: the
// plugin ships zero runtime npm deps (same posture as plugin/bin/lib/policy.js),
// so only the small YAML subset this manifest actually uses is supported.
//
// Anything outside that subset throws, naming the 1-based line number.
// Silence or a misparse is the exact failure mode this tool exists to
// prevent, so every ambiguous or unrecognized construct errs toward
// throwing rather than guessing.

const fs = require('fs');

// YAML indicator characters this subset does not implement (block scalars,
// anchors/aliases, tags, directives, explicit keys). A bare scalar starting
// with one of these would otherwise silently parse as a literal string
// containing that character, which is exactly the silent-misparse failure
// mode this module exists to avoid. '-' is deliberately excluded: it is a
// legitimate leading character of a negative integer bare scalar.
const RESERVED_BARE_LEADERS = new Set(['|', '>', '&', '*', '!', '%', '@', '`', '?']);

const BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

// ─── quote-aware scanning ───────────────────────────────────────────────

// Yields [index, char] for every character of `text` that sits OUTSIDE a
// quoted scalar; quoted runs are skipped whole, respecting \" and \\ inside
// double quotes and '' inside single quotes. Callers use this to find
// structural characters (':', '#', ',', brackets) without re-parsing quotes.
function* outsideQuotes(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === '"') {
      if (ch === '\\') i++;
      else if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") i++;
        else quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    yield [i, ch];
  }
}

// Finds the first ':' outside any quoted scalar that is immediately
// followed by a space or end-of-string — the key/value separator shape
// this subset requires ("key: value" or "key:" with nothing after).
// Returns {key, valueText} or null if no such colon exists.
function splitKeyValue(content) {
  for (const [i, ch] of outsideQuotes(content)) {
    if (ch !== ':') continue;
    const next = content[i + 1];
    if (next === undefined || next === ' ') {
      return { key: content.slice(0, i).trim(), valueText: content.slice(i + 1).trim() };
    }
  }
  return null;
}

// A '#' only opens a comment when it sits at the start of the (already
// indent-stripped) line or is preceded by whitespace — matching real YAML.
// A '#' glued to the preceding character (e.g. `3.5.0#build123`) is an
// ordinary character of the scalar, not a comment leader.
function stripCommentAndTrim(rest) {
  for (const [i, ch] of outsideQuotes(rest)) {
    if (ch === '#' && (i === 0 || /\s/.test(rest[i - 1]))) return rest.slice(0, i).trimEnd();
  }
  return rest.trimEnd();
}

// ─── scalars ─────────────────────────────────────────────────────────────

// `text` starts with its quote character. Returns the unescaped contents;
// throws if the scalar is unterminated or if anything follows the closer.
function parseQuoted(text, lineNo) {
  const quote = text[0];
  let out = '';
  let i = 1;
  let closed = false;

  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote === '"' && ch === '\\') {
      const next = text[i + 1];
      if (next !== '"' && next !== '\\') {
        throw new Error(`Unsupported YAML at line ${lineNo}: unsupported escape sequence '\\${next}' in double-quoted scalar (only \\" and \\\\ are supported)`);
      }
      out += next;
      i++;
      continue;
    }
    if (ch === quote) {
      // '' inside a single-quoted scalar is an escaped quote, not the closer.
      if (quote === "'" && text[i + 1] === "'") {
        out += "'";
        i++;
        continue;
      }
      closed = true;
      i++;
      break;
    }
    out += ch;
  }

  if (!closed) {
    throw new Error(`Unsupported YAML at line ${lineNo}: unterminated ${quote === '"' ? 'double' : 'single'}-quoted scalar`);
  }
  const trailing = text.slice(i).trim();
  if (trailing !== '') {
    throw new Error(`Unsupported YAML at line ${lineNo}: unexpected content after quoted scalar: '${trailing}'`);
  }
  return out;
}

// True when `text` (already known to be a BARE, unquoted scalar) contains a
// further outside-quote ': ' — the same shape splitKeyValue treats as a
// key/value separator. A bare scalar containing one (e.g. `npx thing: do
// stuff`) is exactly the case real YAML parsers raise a hard error on rather
// than silently swallowing the rest of the line into the value.
function hasAmbiguousColon(text) {
  for (const [i, ch] of outsideQuotes(text)) {
    if (ch !== ':') continue;
    const next = text[i + 1];
    if (next === undefined || next === ' ') return true;
  }
  return false;
}

// text is already trimmed. Quoted values are ALWAYS strings; bare
// null/Null/NULL/~ are JavaScript null (matching real YAML — a quoted
// "null" stays the string "null"); bare true/false are booleans; bare
// integers are numbers; everything else bare is a string.
function parseScalar(text, lineNo) {
  if (text[0] === '"' || text[0] === "'") return parseQuoted(text, lineNo);
  if (RESERVED_BARE_LEADERS.has(text[0])) {
    throw new Error(`Unsupported YAML at line ${lineNo}: unsupported construct starting with '${text[0]}' (not in the supported subset)`);
  }
  if (hasAmbiguousColon(text)) {
    throw new Error(`Unsupported YAML at line ${lineNo}: unquoted value '${text}' contains ': ' outside any quotes — quote the value to disambiguate it from a key/value separator`);
  }
  if (text === 'null' || text === 'Null' || text === 'NULL' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  return text;
}

// ─── flow collections ───────────────────────────────────────────────────

// Splits the flow collection opening at text[0] ('{' or '[') into its
// top-level comma-separated parts (trimmed), skipping nested collections and
// quoted scalars, and reports the index of its closing bracket. An empty
// collection yields no parts.
function splitFlowCollection(text, lineNo) {
  const closers = [];
  const parts = [];
  let start = 1;
  let end = -1;

  for (const [i, ch] of outsideQuotes(text)) {
    if (ch === '{' || ch === '[') {
      closers.push(ch === '{' ? '}' : ']');
    } else if (ch === '}' || ch === ']') {
      if (closers.pop() !== ch) {
        throw new Error(`Unsupported YAML at line ${lineNo}: mismatched '${ch}' in flow collection`);
      }
      if (closers.length === 0) {
        end = i;
        break;
      }
    } else if (ch === ',' && closers.length === 1) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  if (end === -1) {
    throw new Error(`Unsupported YAML at line ${lineNo}: unterminated flow collection (missing closing '${text[0] === '{' ? '}' : ']'}')`);
  }
  if (text.slice(1, end).trim() === '') return { parts: [], end };
  parts.push(text.slice(start, end));
  return { parts: parts.map((p) => p.trim()), end };
}

// text is trimmed and starts with '{' or '['.
function parseFlowCollection(text, lineNo) {
  const { parts, end } = splitFlowCollection(text, lineNo);
  const trailing = text.slice(end + 1).trim();
  if (trailing !== '') {
    throw new Error(`Unsupported YAML at line ${lineNo}: unexpected content after flow collection: '${trailing}'`);
  }

  if (text[0] === '[') {
    return parts.map((part) => {
      if (part === '') {
        throw new Error(`Unsupported YAML at line ${lineNo}: empty element in flow sequence`);
      }
      return parseInlineValue(part, lineNo);
    });
  }

  const obj = {};
  for (const part of parts) {
    if (part === '') {
      throw new Error(`Unsupported YAML at line ${lineNo}: empty entry in flow map`);
    }
    const split = splitKeyValue(part);
    if (!split || !BARE_KEY_PATTERN.test(split.key)) {
      throw new Error(`Unsupported YAML at line ${lineNo}: expected 'key: value' in flow map entry '${part}'`);
    }
    if (split.valueText === '') {
      throw new Error(`Unsupported YAML at line ${lineNo}: flow map key '${split.key}' has no value`);
    }
    obj[split.key] = parseInlineValue(split.valueText, lineNo);
  }
  return obj;
}

// A value that fits entirely on one line: a flow collection or a scalar.
function parseInlineValue(text, lineNo) {
  if (text[0] === '{' || text[0] === '[') return parseFlowCollection(text, lineNo);
  return parseScalar(text, lineNo);
}

// ─── line preprocessing ─────────────────────────────────────────────────

// Returns {lineNo, indent, content} for a physical line, or null if the
// line is blank or a full-line comment (both are skipped anywhere). Throws
// if the line's indentation uses a tab.
function processLine(rawLine, lineNo) {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
  if (line.trim() === '') return null;
  const leading = line.match(/^[ \t]*/)[0];
  if (leading.includes('\t')) {
    throw new Error(`Unsupported YAML at line ${lineNo}: tab character used for indentation`);
  }
  const indent = leading.length;
  const content = stripCommentAndTrim(line.slice(indent));
  if (content === '') return null;
  return { lineNo, indent, content };
}

// ─── block parsing (recursive descent over a shared cursor) ────────────

function isSequenceItem(content) {
  return content[0] === '-' && (content.length === 1 || content[1] === ' ');
}

// Dispatches a required value: '' (nothing after the key/dash on its own
// line) means either a nested block on more-indented following lines, or —
// when no such block follows — an explicit null, matching real YAML's
// treatment of `key:` with nothing after it. parentIndent is the indent
// level a nested block must exceed.
function parseValue(valueText, lineNo, parentIndent, lines, pos) {
  if (valueText !== '') return parseInlineValue(valueText, lineNo);
  if (pos.i < lines.length && lines[pos.i].indent > parentIndent) {
    return parseBlock(lines, pos, lines[pos.i].indent);
  }
  return null;
}

function parseMapBody(lines, pos, indent) {
  const result = {};
  while (pos.i < lines.length && lines[pos.i].indent === indent) {
    const line = lines[pos.i];
    if (isSequenceItem(line.content)) break;
    const split = splitKeyValue(line.content);
    if (!split) {
      throw new Error(`Unsupported YAML at line ${line.lineNo}: expected 'key: value'`);
    }
    if (!BARE_KEY_PATTERN.test(split.key)) {
      throw new Error(`Unsupported YAML at line ${line.lineNo}: invalid key '${split.key}'`);
    }
    pos.i++;
    result[split.key] = parseValue(split.valueText, line.lineNo, indent, lines, pos);
  }
  return result;
}

function parseSequence(lines, pos, indent) {
  const result = [];
  while (pos.i < lines.length && lines[pos.i].indent === indent) {
    const line = lines[pos.i];
    if (!isSequenceItem(line.content)) break;

    // Skip the dash and its padding; whatever follows is the item itself.
    let k = 1;
    while (k < line.content.length && line.content[k] === ' ') k++;
    const itemRest = line.content.slice(k);
    const keyIndent = indent + k;
    pos.i++;

    // "- key: value" opens a map whose remaining keys align with that key's
    // own column. Anything else — including a quoted or flow-bracketed item,
    // neither of which yields a bare key — is a plain value.
    const split = splitKeyValue(itemRest);
    if (split && BARE_KEY_PATTERN.test(split.key)) {
      const item = { [split.key]: parseValue(split.valueText, line.lineNo, keyIndent, lines, pos) };
      Object.assign(item, parseMapBody(lines, pos, keyIndent));
      result.push(item);
    } else {
      result.push(parseValue(itemRest, line.lineNo, indent, lines, pos));
    }
  }
  return result;
}

function parseBlock(lines, pos, indent) {
  const line = lines[pos.i];
  if (isSequenceItem(line.content)) {
    return parseSequence(lines, pos, indent);
  }
  if (!splitKeyValue(line.content)) {
    throw new Error(`Unsupported YAML at line ${line.lineNo}: expected a block sequence ('- item') or a mapping key ('key: value')`);
  }
  return parseMapBody(lines, pos, indent);
}

// ─── public API ──────────────────────────────────────────────────────────

function parseManifest(text) {
  const lines = text
    .split('\n')
    .map((rawLine, idx) => processLine(rawLine, idx + 1))
    .filter(Boolean);
  if (lines.length === 0) return {};

  const pos = { i: 0 };
  const value = parseBlock(lines, pos, lines[0].indent);
  if (pos.i !== lines.length) {
    throw new Error(`Unsupported YAML at line ${lines[pos.i].lineNo}: unexpected indentation or structure`);
  }
  return value;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// Returns dep[key] when it is present and a list, else null after recording
// why. An empty list is a valid, distinct value — never conflated with
// missing — so callers must test for null, not falsiness.
function requireList(dep, key, label, errors) {
  if (!hasKey(dep, key)) {
    errors.push(`Dependency ${label}: missing required key '${key}'`);
    return null;
  }
  if (!Array.isArray(dep[key])) {
    errors.push(`Dependency ${label}: '${key}' must be a list`);
    return null;
  }
  return dep[key];
}

function validateManifest(obj) {
  const errors = [];

  if (!isPlainObject(obj)) {
    errors.push("Manifest root must be a map with a 'dependencies' key");
    return errors;
  }
  if (!hasKey(obj, 'dependencies')) {
    errors.push("Missing required top-level key 'dependencies'");
    return errors;
  }
  if (!Array.isArray(obj.dependencies)) {
    errors.push("'dependencies' must be a list");
    return errors;
  }
  if (obj.dependencies.length === 0) {
    errors.push("'dependencies' must be a non-empty list");
    return errors;
  }

  const seenNames = new Set();

  obj.dependencies.forEach((dep, idx) => {
    if (!isPlainObject(dep)) {
      errors.push(`Dependency dependencies[${idx}]: entry must be a map`);
      return;
    }
    const label = isNonEmptyString(dep.name) ? dep.name : `dependencies[${idx}]`;

    if (!isNonEmptyString(dep.name)) {
      errors.push(`Dependency ${label}: missing or empty required key 'name'`);
    } else if (seenNames.has(dep.name)) {
      errors.push(`Dependency ${label}: duplicate 'name' value '${dep.name}'`);
    } else {
      seenNames.add(dep.name);
    }

    if (!isNonEmptyString(dep.kind)) {
      errors.push(`Dependency ${label}: missing or empty required key 'kind'`);
    }

    // ─── content-pinned entry class (`versioning: none`) ─────────────────
    // Detected by pin.versioning === 'none'. This class pins a tagless
    // upstream by commit SHA plus per-file sha256 digests compared against
    // committed fixtures (checks.js's checkContentPins). Nothing is
    // installed, so the probe-machinery keys are not merely optional here —
    // their presence is an error, because nothing would ever read them
    // (checkVersion/checkAssertions/replayFixtures never run for the class,
    // and silently-dead config is the misparse-adjacent failure mode this
    // module errs loudly on).
    if (isPlainObject(dep.pin) && dep.pin.versioning === 'none') {
      if (!isNonEmptyString(dep.pin.commit) || !/^[0-9a-f]{40}$/.test(dep.pin.commit)) {
        errors.push(`Dependency ${label}: 'pin.commit' must be a 40-char lowercase hex commit SHA for 'versioning: none' entries`);
      }
      if (!isPlainObject(dep.upstream) || !isNonEmptyString(dep.upstream.repo)) {
        errors.push(`Dependency ${label}: 'upstream.repo' is required`);
      }
      const consumed = requireList(dep, 'consumed', label, errors);
      if (consumed !== null) {
        if (consumed.length === 0) {
          errors.push(`Dependency ${label}: 'consumed' must be a non-empty list for 'versioning: none' entries`);
        }
        consumed.forEach((c, i) => {
          if (!isPlainObject(c)) {
            errors.push(`Dependency ${label}: 'consumed[${i}]' must be a map`);
            return;
          }
          if (!isNonEmptyString(c.path)) {
            errors.push(`Dependency ${label}: 'consumed[${i}].path' is required`);
          }
          if (!isNonEmptyString(c.sha256) || !/^[0-9a-f]{64}$/.test(c.sha256)) {
            errors.push(`Dependency ${label}: 'consumed[${i}].sha256' must be a 64-char lowercase hex digest`);
          }
        });
      }
      for (const key of ['installed-probe', 'pinned', 'version-mode', 'contract-paths', 'assertions', 'fixtures']) {
        if (hasKey(dep, key)) {
          errors.push(`Dependency ${label}: '${key}' is not part of the 'versioning: none' entry class — nothing would ever read it`);
        }
      }
      return;
    }

    // The reciprocal guard: content-class keys on a probe-class entry are
    // equally dead config (nothing reads `pin`/`consumed` outside the
    // `versioning: none` path) — and a `pin` whose `versioning` value is
    // anything but the literal 'none' lands here too, surfacing the typo
    // instead of silently validating as a probe entry.
    for (const key of ['pin', 'consumed']) {
      if (hasKey(dep, key)) {
        errors.push(`Dependency ${label}: '${key}' is only valid on a 'versioning: none' entry (pin.versioning === 'none') — on this entry nothing would ever read it`);
      }
    }

    if (!isPlainObject(dep['installed-probe'])) {
      errors.push(`Dependency ${label}: missing or invalid required key 'installed-probe' (must be a map)`);
    } else {
      const probe = dep['installed-probe'];
      if (!isNonEmptyString(probe.type)) {
        errors.push(`Dependency ${label}: 'installed-probe.type' is required`);
      } else if (probe.type === 'command') {
        if (!isNonEmptyString(probe.run)) {
          errors.push(`Dependency ${label}: 'installed-probe.run' is required when type is 'command'`);
        }
      } else if (probe.type === 'plugin-cache-glob') {
        if (!isNonEmptyString(probe.glob)) {
          errors.push(`Dependency ${label}: 'installed-probe.glob' is required when type is 'plugin-cache-glob'`);
        }
      } else {
        errors.push(`Dependency ${label}: 'installed-probe.type' must be 'command' or 'plugin-cache-glob' (got '${probe.type}')`);
      }
    }

    if (!isNonEmptyString(dep.pinned)) {
      errors.push(`Dependency ${label}: missing or empty required key 'pinned'`);
    }

    // Optional — defaults to 'exact' (checks.js's checkVersion) when absent.
    // 'floor' accepts any installed version >= 'pinned' instead of requiring
    // an exact match; see the impeccable-cli entry for why that exists.
    if (hasKey(dep, 'version-mode') && dep['version-mode'] !== 'exact' && dep['version-mode'] !== 'floor') {
      errors.push(`Dependency ${label}: 'version-mode' must be 'exact' or 'floor' (got '${dep['version-mode']}')`);
    }

    if (!isPlainObject(dep.upstream)) {
      errors.push(`Dependency ${label}: missing or invalid required key 'upstream' (must be a map)`);
    } else {
      if (!isNonEmptyString(dep.upstream.repo)) {
        errors.push(`Dependency ${label}: 'upstream.repo' is required`);
      }
      if (!isNonEmptyString(dep.upstream['tag-prefix'])) {
        errors.push(`Dependency ${label}: 'upstream.tag-prefix' is required`);
      }
    }

    const contractPaths = requireList(dep, 'contract-paths', label, errors);
    if (contractPaths !== null) {
      contractPaths.forEach((p, i) => {
        if (typeof p !== 'string') {
          errors.push(`Dependency ${label}: 'contract-paths[${i}]' must be a string`);
        }
      });
    }

    const assertions = requireList(dep, 'assertions', label, errors);
    if (assertions !== null) {
      assertions.forEach((a, i) => {
        if (!isPlainObject(a)) {
          errors.push(`Dependency ${label}: 'assertions[${i}]' must be a map`);
          return;
        }
        ['file', 'claims', 'upstream-path', 'must-match'].forEach((key) => {
          if (!isNonEmptyString(a[key])) {
            errors.push(`Dependency ${label}: 'assertions[${i}].${key}' is required`);
          }
        });
      });
    }

    const fixtures = requireList(dep, 'fixtures', label, errors);
    if (fixtures !== null) {
      fixtures.forEach((f, i) => {
        if (!isPlainObject(f)) {
          errors.push(`Dependency ${label}: 'fixtures[${i}]' must be a map`);
          return;
        }
        if (!isNonEmptyString(f.run)) {
          errors.push(`Dependency ${label}: 'fixtures[${i}].run' is required`);
        }
        if (!isPlainObject(f.expect)) {
          errors.push(`Dependency ${label}: 'fixtures[${i}].expect' is required and must be a map`);
          return;
        }
        if (typeof f.expect.exit !== 'number') {
          errors.push(`Dependency ${label}: 'fixtures[${i}].expect.exit' must be a number`);
        }
        if (f.expect.stream !== 'stdout' && f.expect.stream !== 'stderr') {
          errors.push(`Dependency ${label}: 'fixtures[${i}].expect.stream' must be exactly 'stdout' or 'stderr'`);
        }
        if (!hasKey(f.expect, 'keys')) {
          errors.push(`Dependency ${label}: 'fixtures[${i}].expect.keys' is required`);
        } else if (!Array.isArray(f.expect.keys)) {
          errors.push(`Dependency ${label}: 'fixtures[${i}].expect.keys' must be a list`);
        } else {
          f.expect.keys.forEach((k, ki) => {
            if (typeof k !== 'string') {
              errors.push(`Dependency ${label}: 'fixtures[${i}].expect.keys[${ki}]' must be a string`);
            }
          });
        }
      });
    }
  });

  return errors;
}

function loadManifest(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const obj = parseManifest(text);
  const errors = validateManifest(obj);
  if (errors.length > 0) {
    throw new Error(`Invalid manifest at ${filePath}:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  return obj;
}

module.exports = { parseManifest, validateManifest, loadManifest };
