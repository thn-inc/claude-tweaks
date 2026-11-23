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

Read only the preamble (after an optional frontmatter block, before the first `## ` heading) and skip fenced lines, so a quoted example is never the record's own line. Use `plugin/bin/lib/markdown-blocks.js`'s fence helpers: `parseRiskFlags` uses `fencedLineMask`, and `extractPremiseCheck`, `extractVerifiedAsOf` and `extractTemplateStamp` in `record-payload.js` read through `unfencedText`. The one deliberate whole-body exception is `ownOriginLine` in `record-payload.js`: it scans the whole body, skipping fenced lines and lines under a `## Absorbed: …` section, and a line under `## Original request` still counts, since for 170 records it is the only `Origin:` line (#4502).

### Sanctioned writers

When the line must not be hand-edited, put its writers in the reader's module and pin them with a writer scan over `plugin/bin` (`tests/risk-flags-writer-conformance.test.js`; `bin-source-scan-conformance` covers the scan's shape). Writers normalize `\r\n?` to `\n` on entry and put `\r\n` back when the body was uniformly CRLF. A writer that removes information requires an explicit human-decision argument (`humanConfirmed === true`) and refuses on an unreadable line.

### A companion line that annotates another line

A line that records something about another line's values (`Risk-flags-added-by-tripwire:` names which `Risk-flags:` slugs the diff tripwire added, #4619) lives in the same module with its own reader (`parseTripwireFlags`) and its own wide detection regex (`TRIPWIRE_LINE_RE`), and the main line's reader ignores it. Three rules keep the two lines consistent:

- **It names only values the main line carries.** One shared helper (`writeTripwireLine`) rewrites it, and every writer that narrows the main line calls it: `removeRiskFlag` drops the slug from both lines, and an empty set deletes the companion line.
- **Every path that composes a fresh body carries it forward.** A writer-only line is never in a composed body, so a re-shape loses it silently unless the compose path copies it over from the prior body. `bin/risk-flags.js`'s `settle` passes `priorBody` to `carryTripwireFlags`, which keeps only the slugs still kept. Pin the carry at the CLI as well as in the module (`tests/risk-flags-cli.test.js`, "a re-shape carries the prior body's tripwire line forward, minus a slug answered remove").
- **Its key joins the writer scan, and its writers join every scan that names writers.** Widen the sanctioned-writer scan's line-key regex to the companion key (`RISK_LINE` in `tests/risk-flags-writer-conformance.test.js`) and plant a literal of it, flagged outside the writer module and allowed inside. Add the companion's writer functions to any scan that forbids a module from writing the record (`WRITER_REF` in `tests/accept-monotonic-conformance.test.js`).

### The new line leaves every existing parser's verdict unchanged

Other readers scan the same preamble (`liftMetadata`, `parseRiskFlags`, `parseAcceptanceTarget`, `parseDependencies`, the Key Files and plan-audit extractors, the `validateShaped` shape gate), so a new line there can shift one of their answers without anyone noticing. Pin it with one table-driven test: build a full shaped body, insert the line, and assert `deepEqual(fn(withLine), fn(body))` for each parser. Add a control case in which a real metadata change does move a parser's answer, so the comparison is shown to detect a difference. `tests/bin-lib/issues/plan-line-body-parsers.test.js` (#6056, for `Plan:`) is the instance. A parser that gives the same answer for any whole body, such as `parsePlanLine`, which reads one line and rejects a body either way, passes the loop without proving anything; #6056's review marked that row can't-tell.

## Registration sites

| Site | What it gets |
|---|---|
| `plugin/skills/specify/spec-template.md` | The line in the metadata block, and a paragraph stating its grammar, its writer, and what an absent line means |
| `plugin/skills/_shared/work-record.md` | A section naming the one reader and the writer path |
| `plugin/bin/lib/issues/record.js` | The re-export, and the module in the header's sub-module list |
| `plugin/bin/lib/issues/local-store.js` header | That the line rides in `body`, not `facets` |
| `docs/plugin-structure.md` | The `plugin/bin/lib/issues/` row |
| `plugin/bin/lib/issues/plan-line.js`'s `SPEC_HASH_EXCLUDED_PREFIXES` | A decision, not always an entry: a line that can sit inside the spec-hash range (`## Overview` through `## Planning Decisions`) and that a pipeline step rewrites without changing what the spec builds joins the list by its exact prefix, only when the spec says so, or every rewrite marks the record's stored plan stale; any other line stays hashed, since an excluded prefix can hide a real content edit. Export the line's keys from the reader's module and spread them in, as `RISK_FLAG_LINE_KEYS` is, rather than retyping them |
| Every consumer that gates on the line | A call to the reader, never a regex of its own |

### A line no code reads

A provenance line written for the person reading the record, and for skill prose that finds it by key, can have no reader in `plugin/bin` at all. #5933's `Evidence:` (`specShapedBody`'s `provenance.evidence`) is one: nothing parses it back out of a record body. The table's reader rows (the `record-*.js` reader, the re-export from `record.js`, each consumer's call) then have nothing to register, and `spec-template.md` applies only to a line a spec author writes by hand. The line still owes four things. The writer validates it, because no reader will: `specShapedBody` throws on a multi-line value or a kind outside `EVIDENCE_KINDS`, which it imports from `plugin/bin/lib/deferral-route/evidence.js` (the module that judges the value) rather than retyping, and leaves the rest of the grammar to that module. The writer's header comment names the line and its place in the provenance order. The contract that gives the line its meaning names it (`_shared/deferral-gate.md`'s Evidence bullet). And the composer's tests pin its placement, the absent case and each refusal (`tests/bin-lib/issues/record.test.js`'s `#5933` cases). The first code reader that gates on the line brings the whole table back.

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| A consumer matching the line with its own regex | Its detection drifts from the reader's, so a variant the reader reads as malformed reads as absent there |
| Reading a malformed value or an unknown slug as empty | A misspelling silently drops what the line asserts; `parseRiskFlags` reads one as every built-in category flagged |
| Scanning the whole body for the line | A later mention in prose or a fenced example reads as the record's own; the line is a header line by contract (#4618 review accepted the preamble-only scan); the one whole-body exception is `ownOriginLine` (see Preamble only, fences ignored) |

## Reference

- `plugin/bin/lib/issues/record-risk-flags.js` (reader and writers), `plugin/bin/lib/issues/record-payload.js` (the extractors), `plugin/bin/lib/issues/record-dependencies.js` (`parseParent`), `plugin/bin/lib/markdown-blocks.js` (fence helpers)
- `tests/bin-lib/issues/record-risk-flags.test.js`, `tests/risk-flags-writer-conformance.test.js`
