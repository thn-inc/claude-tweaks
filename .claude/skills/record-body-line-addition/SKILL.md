---
name: record-body-line-addition
description: Use when adding a body-metadata line to the work-record format (a `Key: value` line in the record preamble, such as `Risk-flags:`, `Parent:`, `Premise-check:` or `Verified-as-of:`), or a new reader or writer of one — the one shared reader in `plugin/bin/lib/issues/`, absent versus none versus malformed, detection wider than the grammar, the preamble and fence scope, sanctioned writers, and every site the line must land in. Keywords - body metadata line, record preamble, parseRiskFlags, extractPremiseCheck, parseParent, spec-template, work-record.md, local-files body, single writer, malformed line.
---

# Record body-line addition

## Overview

A record carries some of its state as plain `Key: value` lines at the top of its body instead of labels or `facets`: `Surface:`, `Design-intent:`, `Parent:`, `Premise-check:`, `Verified-as-of:`, `Risk-flags:`. A body line is the one carrier both work backends share, so the GitHub and `local-files` drivers read it through one function. `Risk-flags:` (#4618) is the most complete instance: `plugin/bin/lib/issues/record-risk-flags.js` holds its one reader, `parseRiskFlags`, and its sanctioned writers.

## Key Patterns

### One reader, re-exported, for both backends

Put the reader in a `plugin/bin/lib/issues/record-*.js` module, re-export it from `record.js`, and have every consumer call it. `local-files` keeps the line in `body`, never as a `facets` key (`local-store.js`'s header says so), so one reader serves both drivers. A prose pre-filter that looks for the line uses the reader's own pattern: refine's Step 3.7 detects `Risk-flags-unconfirmed:` with `parseRiskFlags`'s `MARKER_LINE_RE`.

### Absent, none and unreadable are three answers

An absent line is a legacy record (`unclassified`). An explicit empty value (`Risk-flags: none`) is a classified record with nothing set. A line that is present but malformed is neither: read it in the direction that is safe for the line's consumers, and expose a status they can branch on (`parse-signal-discipline`). `parseRiskFlags` reads a malformed line or an unknown slug as all four built-in categories flagged, never as "no flags".

### Detect wider than the grammar

The test for "this is the line" must be wider than the exact grammar, or a variant spelling reads as absent. `FLAG_LINE_RE` accepts any case, a `-`, `_`, space or no separator, blockquote marks, one list marker and `*`/`_` emphasis, so `**Risk-flags:** auth` and `- risk_flags: auth` read malformed. The writers' repair rewrites such a line in the exact form.

### Preamble only, fences ignored

Read only the preamble (after an optional frontmatter block, before the first `## ` heading) and skip fenced lines, so a quoted example is never the record's own line. Use `plugin/bin/lib/markdown-blocks.js`'s fence helpers: `parseRiskFlags` uses `fencedLineMask`, and `extractPremiseCheck`, `extractVerifiedAsOf` and `extractTemplateStamp` in `record-payload.js` read through `unfencedText`.

### Sanctioned writers

When the line must not be hand-edited, put its writers in the reader's module and pin them with a writer scan over `plugin/bin` (`tests/risk-flags-writer-conformance.test.js`; `bin-source-scan-conformance` covers the scan's shape). Writers normalize `\r\n?` to `\n` on entry and put `\r\n` back when the body was uniformly CRLF. A writer that removes information requires an explicit human-decision argument (`humanConfirmed === true`) and refuses on an unreadable line.

## Registration sites

| Site | What it gets |
|---|---|
| `plugin/skills/specify/spec-template.md` | The line in the metadata block, and a paragraph stating its grammar, its writer, and what an absent line means |
| `plugin/skills/_shared/work-record.md` | A section naming the one reader and the writer path |
| `plugin/bin/lib/issues/record.js` | The re-export, and the module in the header's sub-module list |
| `plugin/bin/lib/issues/local-store.js` header | That the line rides in `body`, not `facets` |
| `docs/plugin-structure.md` | The `plugin/bin/lib/issues/` row |
| Every consumer that gates on the line | A call to the reader, never a regex of its own |

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| A consumer matching the line with its own regex | Its detection drifts from the reader's, so a variant the reader reads as malformed reads as absent there |
| Reading a malformed value or an unknown slug as empty | A misspelling silently drops what the line asserts; `parseRiskFlags` reads one as every built-in category flagged |
| Scanning the whole body for the line | A later mention in prose or a fenced example reads as the record's own; the line is a header line by contract (#4618 review accepted the preamble-only scan) |

## Reference

- `plugin/bin/lib/issues/record-risk-flags.js` (reader and writers), `plugin/bin/lib/issues/record-payload.js` (the extractors), `plugin/bin/lib/issues/record-dependencies.js` (`parseParent`), `plugin/bin/lib/markdown-blocks.js` (fence helpers)
- `tests/bin-lib/issues/record-risk-flags.test.js`, `tests/risk-flags-writer-conformance.test.js`
