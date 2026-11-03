# Acceptance Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the acceptance packet's Recording section automatically from the pipeline's own happy-path step screenshots, and keep secret-shaped text out of it.

**Architecture:** `acceptance-packet.js snapshot` (wrap-up Phase 1, the last moment the QA screenshots are guaranteed on disk) plans and encodes a GIF into `{run}/packet-inputs/walkthrough.gif` and records the outcome in the manifest. `gather` turns the manifest's outcome into a `recording` fact. `renderRecordingSection` in `packet-render.js` is the one choke point that redacts every string the section shows. `decideExposure` is the one place the embed/link decision is made.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T223727-record-4612/work/4612-spec.md`

**Scope keywords:** recording url refused, renderRecordingSection, decideExposure, evidence-route, demo-evidence

**Plan Review Decisions (the spec's own section, which wins over its earlier text):** the exposure rules bind every Recording link, legacy image URLs are refused, the public evidence-commit route is retired, and no 40-hex exemption is added (Tasks 2, 3, 7, 8). The packet names a location that stays resolvable after archiving (Tasks 3, 4).

## Global Constraints

- Redaction placeholder: exactly `[redacted]`; the whole value goes, the key name stays (`api_key=[redacted]`, `sk_live_abc` becomes `[redacted]`). No prefix or length leaks.
- Exposure values: `local-only` (v1 default; any unreachable or unprobed store), `linked-private` (a remote store that passed the probe), `withheld` (a link refused by the credential rule).
- The packet never embeds the recording or any screenshot (no markdown image syntax, no `img` tag) in any repository visibility.
- Visibility read from `gh repo view --json isPrivate`; an unreadable or unexpected answer is **public**.
- A bearer-shaped path segment: 20 or more characters from `[A-Za-z0-9_-]` with at least one digit and one letter (positive `/a/Xk3j9f8s7d6f5g4h3j2k1/b`, negative `/docs/token-guide`).
- Not-recorded fact: `{ id, kind: 'recording', status: 'not-run', reason }`, `reason` one of `no-story`, `no-local-base-url`, `no-happy-path-screenshots`, `encoder-failed`; the last three also appear under Couldn't test; `no-story` renders plain `not recorded` only.
- Local hosts: `localhost`, `127.0.0.1`, `::1`.
- Withheld line, exact: `recording withheld: link contained a credential-shaped value`.
- Never modify `plugin/bin/lib/walkthrough/encode.js` or `plugin/bin/walkthrough-encode.js`; the standalone path applies no redaction.
- Shell: one plain command per Bash call; no `git stash`. Commit messages say `refs #4612`, never `closes`/`fixes`.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Characterization (project maturity `established` when resolved so): for a task modifying pre-existing behavior, cover its edge cases in the existing suite before changing it.

Governing project-skill rules, verbatim:

- `bin-source-scan-conformance`: "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text." "`assert.deepEqual(offenders, [])` over the walk also passes when the matcher matches nothing." "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15." "If the suite reads a source file as text, read it through `readText` from `tests/helpers/read-skill.js`, not a raw `fs.readFileSync`." Use the manual `withFileTypes` walk, never `{ recursive: true }`.
- `regex-scan-linearity`: "Wall-clock budgets live in `perf/{name}-linearity.test.js`, run by `npm run test:perf`, never by `npm test`." "Assert the verdict as well as the time". "a left-boundary lookbehind of the class" is the fix for "An unanchored global regex restarting inside every long token."
- `fact-validated-narration`: the Recording section renders facts directly and is never narrated; no rule beyond that applies here.
- `gh-api-module-pattern`: every `gh` spawn goes through the CLI's existing `deps.gh` (already `ghOptions`-wrapped); a new lib module takes an injected runner.
- `run-directory-fact-packs`, `review-console-section-addition`, `shared-contract-extraction`, `parse-signal-discipline`, `windows-checkout-test-parity`, `transcript-payload-verification`, `post-merge-workflow-live-probe`, `skill-prose-conformance-tests`: mention packet files without a rule binding this change, except `skill-prose-conformance-tests`: a prose pin must be able to go red.

Source-scan lint: under `plugin/bin/` use no bare `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`); every spawn passes `windowsHide`; list directories through `deps.listDir`.

Waived `plugin/bin/lib/wrap-up/engine-render.js`: the spec's Key File is stale; the packet renders in `packet-render.js`, which Task 3 modifies (logged as premise reversed). The "wrap-up engine" step is `snapshot`, Task 4.
Waived `plugin/bin/walkthrough-encode.js`: read-only; the spec says confirm it needs no change, and Task 1's AC3a.2 and AC6 test keep its suites untouched.
Waived `plugin/bin/lib/walkthrough/encode.js`: consumed through `encodeWalkthrough`; Task 1 pins `captionList` byte-identical.

**Known spec interactions the tasks resolve:**
- `--recordings` stays on the CLI (AC4's link rule needs a `url` input path), and no skill passes it once Task 7 retires the route. Its facts carry no `exposure`, and a remote link renders live only on a fact whose `exposure` is `linked-private`, which only `decideExposure` gives after a passed anonymous-fetch probe. So in v1 every `--recordings` entry renders the withheld line (credential) or `(recording url refused)` (everything else). A future store's caller sets the exposure; this record adds none.
- The two committed `docs/demo-evidence/1336/*.jpg` files stay: the decision retires the route, not history. Task 8 logs them as an observation in `decisions.md`.
- AC5's "`not recorded` with the reason" vs the contract decision's `no-story` plain line: the contract decision is the specific rule and wins.
- `inline()` escapes both brackets. The section post-processes `\[redacted\]` to `\[redacted]`: it renders `[redacted]`, the raw comment still contains the fixed token, and the escaped opener means a `[redacted]: x` line can never become a link reference definition.
- The local path renders relative to the checkout root, so a public comment leaks no home directory. It always names both locations, live and `archive/`, so it never goes stale however the run dir moves.

## Review Focus

1. A report whose `stories_dir` will not read: a tag-only negative story cannot be told apart, so nothing is recorded (`no-happy-path-screenshots`), never a GIF with an error screen. Pinned in Task 4.
2. A secret shape the redactor misses but the screen catches (`tok%65n=abc`): the text is withheld whole, never rendered. Pinned in Task 3.
3. `snapshot` re-run from the main checkout after the merge: the earlier GIF and manifest stay. Pinned in Task 4.
4. A GIF write or encode failure never fails `snapshot`: it becomes `encoder-failed`, exit 0. Pinned in Task 4.
5. A long unterminated token through the redactor stays linear. Pinned in Task 1's perf file.
6. A multi-spec run's GIF (`{run-id}/spec-{N}/packet-inputs/`), gathered live or after archiving, names the same two locations. Pinned in Task 4.
7. A legacy image link with a query string or an uppercase extension (`https://h/r.PNG?x=1`) is still refused. Pinned in Task 2.

---

### Task 1: Redaction module

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/walkthrough/redact.js`
- Create: `perf/recording-redact-linearity.test.js`
- Test: `tests/bin-lib/walkthrough/redact.test.js`
- Modify: `tests/bin-lib/walkthrough/encode.test.js` (one pin test)

**Interfaces:**
- Produces: `redactText(raw: string) -> { text: string, count: number, residual: string }`; `REDACTED = '[redacted]'`. `residual` is the input with every whole match (key, separator and value) removed; the caller screens it.
- Consumes: `findCredentialInText` from `../wrap-up/packet-links`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/walkthrough/redact.test.js`:

```js
const CASES = [
  ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc', 'Authorization: [redacted]'],
  ['api_key=sk_live_123abc', 'api_key=[redacted]'],
  ['sk_live_abc', '[redacted]'],
  ['ghp_abc123def', '[redacted]'],
  ['gho_abc123def', '[redacted]'],
  ['bearer abc.def', '[redacted]'],
  ['eyJhbGciOiJIUzI1NiJ9.e30.abc', '[redacted]'],
  ['password=hunter2 next', 'password=[redacted] next'],
  ['"token": "abc"', '"token": [redacted]'],
  ['GITHUB_TOKEN=abc', 'GITHUB_TOKEN=[redacted]'],
  ['--api-key abc', '--api-key [redacted]'],
  ['--client-secret=abc', '--client-secret=[redacted]'],
  ['https://user:pass@example.com/x', 'https://[redacted]@example.com/x'],
  ['mail bob.smith+a@example.co.uk now', 'mail [redacted] now'],
];
```
`test('redacts each shape, whole value, key kept', ...)` loops: `text` equals the expected, `count === 1`, `findCredentialInText(residual) === null`, and no fragment of the value survives. `test('benign text is untouched')`: `monkey=1`, `/docs/token-guide`, `acceptance-packet.js --help`, `keyboard: x`, each returns `text === raw`, `count === 0`. `test('a percent-encoded key is left for the screen')`: `tok%65n=abc` → `findCredentialInText(residual)` is non-null. `test('counts each replacement')`: `a=1 token=x password=y` → `count === 2`. In `encode.test.js`, `test('AC3a.1: captionList output is byte-identical', ...)` asserts `captionList([{ caption: 'api_key=sk_live_1' }, { action: 'click', locator: { role: 'button', name: 'Go' } }]) === '1. api_key=sk_live_1\n2. click role=button "Go"\n'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/walkthrough/redact.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `redactText` in `plugin/bin/lib/walkthrough/redact.js`**

A rule list, applied in this order, run twice over the input: once with a replacement that keeps key and separator plus `REDACTED` (giving `text`, counting replacements), once replacing the whole match with one space (giving `residual`). Rules: (1) `Authorization` header with optional `bearer|basic|token` scheme; (2) URL userinfo `://x@` → `://[redacted]@`; (3) `--flag` then `=` or whitespace then a value, kept only when `findCredentialInText(flag)` is non-null; (4) a name token, optional closing quote, `\s*[=:]\s*`, then a quoted or bare value (`[^\s,;&"'`)]+`), kept only when `findCredentialInText(`${name}=`)` is non-null; (5) JWT `eyJ…\.…(\.…)?`; (6) `bearer\s+\S+`; (7) `sk[-_]`, `ghp_`, `gho_` prefixes; (8) e-mail with a `{1,64}` local part. Every token-class rule starts with a left-boundary lookbehind of its own class. Header comment: best-effort text defense, never scans pixels; its reader is `renderRecordingSection`.

- [ ] **Step 4: Add `perf/recording-redact-linearity.test.js`** (header per `regex-scan-linearity`): `'a'.repeat(200000)`, `'a-'.repeat(100000)`, `` `a${' '.repeat(200000)}b` ``, `'a=' .repeat(50000)`, `'--a '.repeat(50000)`, each under a 1000 ms budget, each asserting the verdict (`count`).

- [ ] **Step 5: Run to verify**

Run: `node --test tests/bin-lib/walkthrough/redact.test.js tests/bin-lib/walkthrough/encode.test.js tests/bin-lib/walkthrough/encode-cli.test.js perf/recording-redact-linearity.test.js`
Expected: PASS, `fail 0`.

- [ ] **Step 6: Commit** `Add walkthrough text redaction — refs #4612`, staging the four files by path.

### Task 2: Link rule and `decideExposure`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/packet-links.js` (`checkLink`, one new export)
- Modify: `plugin/bin/lib/wrap-up/packet-contract.js` (`EXPOSURES`)
- Create: `plugin/bin/lib/walkthrough/exposure.js`
- Test: `tests/bin-lib/wrap-up/packet-links.test.js`, `tests/bin-lib/walkthrough/exposure.test.js`

**Interfaces:**
- Produces: `isCredentialRefusal(reason: string) -> boolean` (true for `checkLink` reasons starting `credential`); `isImageUrl(url: string) -> boolean` (`packet-links.js`: the parsed pathname, case-insensitive, ends in an image extension; an unparseable url is `false`, since `checkLink` already refuses it); `checkLink` reason `credential in path segment`; `EXPOSURES = ['local-only', 'linked-private', 'withheld']`; `decideExposure({ repoVisibility, storeProbe }) -> exposure`; `readRepoVisibility(gh) -> 'public' | 'private'`.
- `storeProbe` shape: `null` or `{ anonymousFetch: 'refused' | 'allowed' | 'unreachable', url: string, store?: string }`.

- [ ] **Step 1: Write the failing tests.** In `packet-links.test.js`, with `const ok = (url) => checkLink(url, { allowedHosts: ['host', 'raw.githubusercontent.com'] })`:

```js
test('AC4.2: credential query shapes are refused after normalizing', () => {
  for (const url of ['https://host/?TOKEN=abc', 'https://host/?tok%65n=abc', 'https://host/?%74oken=abc', 'https://host/#token=abc',
    'https://user:pass@host/', 'HTTPS://host/?token=abc', 'https://host/x/?token=abc', 'https://host/a/../b?token=abc',
    'https://host/?access_token=a', 'https://host/?password=a', 'https://host/?session=a']) {
    const r = ok(url); assert.equal(r.ok, false, url); assert.ok(isCredentialRefusal(r.reason), url);
  }
});
test('AC4.3: a benign path naming the word is not withheld', () => assert.equal(ok('https://host/docs/token-guide').ok, true));
test('a bearer-shaped path segment is refused', () => assert.equal(ok('https://host/a/Xk3j9f8s7d6f5g4h3j2k1/b').reason, 'credential in path segment'));
test('a 20-character segment with no digit, or no letter, is not bearer-shaped', ...); // 'abcdefghijklmnopqrst', '12345678901234567890'
test('a 19-character segment is not bearer-shaped', ...);
test('no exemption: a 40-hex commit sha segment on a raw host is refused', () => assert.equal(ok(`https://raw.githubusercontent.com/o/r/${'a1'.repeat(20)}/docs/x.png`).reason, 'credential in path segment'));
test('isImageUrl reads the pathname only', ...); // true: 'https://h/r.gif', 'https://h/r.PNG?x=1', 'https://h/a/r.webp#f'; false: 'https://h/r.gif/landing', 'https://h/landing?f=r.png', 'not a url'
```
In `exposure.test.js`, one test per branch of the list in Step 3, plus `AC2.3`: `for v of ['public','private','unknown', undefined, null]: decideExposure({ repoVisibility: v, storeProbe: null }) === 'local-only'`. `readRepoVisibility`: `{"isPrivate":true}` → private; `{"isPrivate":false}`, `{}`, `{"isPrivate":"yes"}`, `not json`, a throwing runner → public; the runner receives `['repo','view','--json','isPrivate']`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/walkthrough/exposure.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement.** `checkLink`: after the userinfo check, split `parsed.pathname` on `/`, `decodeText` each segment, refuse a bearer-shaped one, with no exemption. `isImageUrl` tests the extensions `.gif|.png|.jpg|.jpeg|.webp|.svg|.avif|.bmp`. `decideExposure`, in order: no probe, or `anonymousFetch !== 'refused'` → `local-only`; url refused with `isCredentialRefusal` (checked with its own hostname allowed) → `withheld`; a url that fails any other way → `local-only`; `isImageUrl(url)` (non-image landing page rule) → `local-only`; `store === 'secret-gist'` → `local-only`; `store === 'actions-artifact'` with visibility not exactly `private` → `local-only`; otherwise `linked-private`. Fail closed: any visibility other than `private` counts as public.

- [ ] **Step 4: Run** `node --test tests/bin-lib/walkthrough/exposure.test.js tests/bin-lib/wrap-up/packet-links.test.js tests/bin-lib/wrap-up/packet-render.test.js tests/acceptance-packet-contract-conformance.test.js`. Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit** `Refuse bearer-shaped link segments and add decideExposure — refs #4612`.

### Task 3: Recording fact shape and `renderRecordingSection`

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/packet-validate.js` (`checkFact`)
- Modify: `plugin/bin/lib/wrap-up/packet-render.js`
- Modify: `plugin/skills/_shared/acceptance-packet.md`
- Create: `tests/bin-lib/wrap-up/packet-recording.test.js` (the new render tests)
- Test: `tests/bin-lib/wrap-up/packet-render.test.js` (two re-pointed pins), `tests/bin-lib/wrap-up/packet-validate.test.js`, `tests/acceptance-packet-contract-conformance.test.js`

**Interfaces:**
- Consumes: `redactText`, `isCredentialRefusal`, `isImageUrl`, `EXPOSURES`.
- Produces: exported `renderRecordingSection(recordingFacts: Fact[]) -> Array<{ text, droppable }>`. Passed fact: `{ id, kind: 'recording', status: 'passed', source, text, url_or_path, archive_path, captions: string[], label?, redactions: int, exposure }`, where `url_or_path` is the live location and `archive_path` the archived one. Not-recorded fact: `{ id, kind: 'recording', status: 'not-run', source, reason, failure? }`. `--recordings` facts keep `{ text, url }`, and an image url among them is refused.

- [ ] **Step 1: Write the failing tests** in the new `packet-recording.test.js`, with `fact`, `render` and `sectionLines` helpers shaped like `packet-render.test.js`'s:

```js
const REC = 'recording:walkthrough';
const passed = (extra) => fact(REC, 'passed', { text: 'Walkthrough of Sign in', url_or_path: '.claude-tweaks/pipelines/r/packet-inputs/walkthrough.gif', archive_path: '.claude-tweaks/pipelines/archive/r/packet-inputs/walkthrough.gif', captions: ['sign-in'], exposure: 'local-only', redactions: 0, ...extra });
test('AC1.1: a recording links the encoded path, never an image, and names where it moves', ...);
// lines: ['- Walkthrough of Sign in: `.claude-tweaks/pipelines/r/packet-inputs/walkthrough.gif` (local-only)', '  once archived: `.claude-tweaks/pipelines/archive/r/packet-inputs/walkthrough.gif`', '  1. sign-in']
test('AC2.1: no image syntax for any exposure', ...); // for each of local-only/linked-private/withheld plus a .png url: markdown has no `![` and no `<img`
test('Reading B: an image url on a recording fact is refused', ...); // 'https://cdn.example/r.gif', 'https://raw.githubusercontent.com/o/r/abc/docs/demo-evidence/1/01-a.png', 'https://h/r.PNG?x=1' -> '- Rec: (recording url refused)'; a live '<' link to the url absent
test('Reading B: a remote link renders live only on a linked-private fact', ...);
// 'https://store.example/rec/1' with exposure 'linked-private' -> '- Rec: <https://store.example/rec/1>'; the same url with no exposure, and with 'local-only' -> '- Rec: (recording url refused)'
test('Reading B: a linked-private url_or_path meets the same rules', ...); // url_or_path 'https://store.example/rec/1' -> a live link; 'https://store.example/r.png' -> refused; 'https://store.example/?token=a' -> the withheld line
test('Reading B: a commit sha in a recording url is a credential-shaped segment', ...); // raw url with a 40-hex segment and a non-image tail -> the withheld line
test('a label is the link text on a linked-private fact', ...); // label 'Sign in tour' -> '- Sign in tour: <https://store.example/rec/1>'; no label -> `text`
test('an encoder failure renders on its own line', ...); // not-run, reason 'encoder-failed', failure 'boom' -> ['not recorded: encoder-failed', '  failure: boom'], and Couldn't test holds the reason row only
test('AC3.1: every secret shape is replaced in all four channels', ...);
// SHAPES = the six from Task 1 incl. the e-mail; channels: text, captions[0], label on a linked-private fact, failure on a not-run fact.
// For each: the value is absent from the whole section, section contains '[redacted]'.
test('AC3.2: key names are kept', ...); // includes 'api_key=\\[redacted]'
test('a shape the redactor misses is withheld whole', ...); // text 'tok%65n=abc' -> WITHHELD_TEXT, 'abc' absent
test('a non-zero redaction count is reported and does not change exposure', ...); // line 'redacted values: 1', '(local-only)' stays
test('AC4.1: a credential recording link states why', ...); // five urls from the old test -> '- Rec: recording withheld: link contained a credential-shaped value'
test('a non-credential refusal keeps its own line', ...); // keeps the existing '(recording url refused)' rows
test('exposure withheld renders the withheld line', ...);
test('AC5.1: no-story reads plain not recorded', ...); // ['not recorded'], and Couldn't test holds no recording row
test('AC5.2: each impossible recording states its reason twice', ...);
// for each of the three: Recording ['not recorded: {reason}'], Couldn't test includes '- `recording:walkthrough` — not run: {reason}'
test('a legacy recording beside no-story drops the placeholder', ...);
```
Re-point the five existing `packet-render.test.js` pins that expect a live `cdn.example` recording link, located by that literal: the screening test keeps decision/deploy/refused/partial screening, and its recording row becomes `- the password=\\[redacted]: (recording url refused)`; the credential test now expects the withheld line and still asserts `cdn.example` absent; the three that assert fallback text, inert rendering and no host rule (`<https://cdn.example/b.gif>`, `<https://cdn.example/a.gif>`, `<https://cdn.example/a.gif?t=1#start>`) move to a non-image url with `exposure: 'linked-private'`, so each keeps testing what it tested. Re-point `tests/acceptance-packet-contract-conformance.test.js`'s `an evidence screenshot renders as a plain link` to `a recording link is a plain link to a non-image page`, with a non-image url and `exposure: 'linked-private'`. In `packet-validate.test.js`: a `recording` fact with `exposure: 'bogus'`, `redactions: -1`, `redactions: 1.5`, `captions: 'x'`, `captions: [1]`, `url_or_path: 3`, `archive_path: 3`, `failure: 3` each fails `validateFactsShape`. In the contract conformance test add pins: the contract names `renderRecordingSection`, the four reasons, the three exposure values read from `EXPOSURES`, and `recording withheld: link contained a credential-shaped value`, each proven red by a `body.replace` control that calls the same assertion function.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/packet-recording.test.js`
Expected: FAIL (`renderRecordingSection` is not exported, and the rows differ).

- [ ] **Step 3: Implement.** In `checkFact`, add `url_or_path`, `archive_path` and `failure` to `OPTIONAL_TEXT_FIELDS` and the three checks above, with `exposure` against `EXPOSURES`. In `packet-render.js`: `recordingText(raw)` = `redactText`, then `findCredentialInText(residual) ? WITHHELD_TEXT : inline(text)` with `\[redacted\]` → `\[redacted]`; the empty case keeps `factText`'s `idSpan` fallback. `recordingHref(url, exposure)`, in order: the withheld line when `isCredentialRefusal(checkLink(...).reason)`; today's refused text when `checkLink` refuses otherwise, `isImageUrl(url)`, or `exposure !== 'linked-private'`; else the live link. The link is `fact.url`, or `fact.url_or_path` on a `linked-private` fact; any other passed fact renders `url_or_path` as the local code-span path. The head line's text is `recordingText(fact.label ?? fact.text)` on a live link and `recordingText(fact.text)` otherwise. `renderRecordingSection` makes one droppable item per fact (a multi-line text: head line, a `  once archived: {archive_path code span}` line when the fact has one, numbered caption lines at two spaces, a `  failure: {recordingText(failure)}` line on a not-run fact carrying one, a `  redacted values: {n}` line when the count it computed is above 0). A `no-story` fact renders nothing; no items at all gives `note('not recorded')`. Replace `SECTION_BODIES.recording` with a call to it and `rowPlace`'s caller so a `recording` fact with `status: 'not-run'` and `reason !== 'no-story'` joins `rowsIn('couldnt-test')`: keep `ROW_KINDS` for check/story and add the recording rows explicitly to the `couldnt-test` body. The path line screens `findCredentialInText(url_or_path)` and `findCredentialInText(archive_path)` to the withheld line. Export `renderRecordingSection`.

Contract edits in `acceptance-packet.md`: section 2's line; fact render-field list adds `url_or_path`, `archive_path`, `captions`, `failure`, `redactions`, `exposure`; `## Reader rules` gains: a Recording path is local to the machine that ran the pipeline, the reader checks the live location first and then the `once archived:` one, and a file in neither is gone, never a failed packet; `## Untrusted content`'s "An evidence screenshot is therefore a plain link and not an embedded image" sentence becomes "A recording is therefore a path, or on a `linked-private` fact a plain link to a non-image page, and never an embedded image"; `## Links and credentials`' Host rule states that a `recording` link gets the credential screen and the non-image rule with no host rule, and renders live only when `decideExposure` returned `linked-private`; `## Pipeline` says `snapshot` also encodes the recording; a new `## Recording` section states source of frames, local base URL, storage and exposure, redaction (including that it cannot scan pixels, the stored GIF is unredacted and local-only, and stories must run against seed data and throwaway credentials), the not-recorded fact, and the link rule; `**In text.**`'s list drops "recording" ("decision and deploy text"), with a sentence that the Recording section redacts instead; `## Links and credentials`'s refused-recording sentence gains the withheld line and the bearer-segment rule; Row placement notes the recording row. Measure `wc -c` first: rail is 52,500 B.

- [ ] **Step 4: Run** `node --test tests/bin-lib/wrap-up/packet-recording.test.js tests/bin-lib/wrap-up/packet-render.test.js tests/bin-lib/wrap-up/packet-validate.test.js tests/acceptance-packet-contract-conformance.test.js`. Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit** `Render the Recording section through one redacting choke point — refs #4612`.

### Task 4: Encode at snapshot, read at gather

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/walkthrough/record.js`
- Modify: `plugin/bin/acceptance-packet.js` (`realDeps`, `runSnapshot`, `readSnapshot`, `gatherToFile`)
- Modify: `plugin/bin/lib/wrap-up/packet-gather.js` (`gatherPacketFacts`)
- Modify: `plugin/bin/lib/qa-report/compose.js` (`base_url`)
- Modify: `plugin/skills/test/qa-reporting.md` (both payload samples and the metadata sentence)
- Test: `tests/bin-lib/walkthrough/record.test.js`, `tests/acceptance-packet-cli.test.js`, `tests/bin-lib/wrap-up/packet-gather.test.js`, `tests/bin-lib/qa-report/compose.test.js`

**Interfaces:**
- Consumes: `encodeWalkthrough`, `planFrames` (`encode.js`); `decideExposure`, `readRepoVisibility` (Task 2); `redactText` (Task 1).
- Produces: `planRecording({ report, qaExpected, storyIndexLost, storyIndex, listFrames }) -> { status:'not-run', reason } | { status:'ready', text, frames: string[], captions: string[] }`; `scrubPaths(message: string) -> string` (`record.js`, pure and linear: every absolute POSIX or Windows path token becomes its basename); `isLocalBaseUrl(url) -> boolean`; `recordingLocations(relPath: string) -> { live: string, archived: string }` (`record.js`, pure, forward slashes: inserts or removes the `archive/` segment directly after `.claude-tweaks/pipelines/`); manifest key `recording: { status:'passed', file:'walkthrough.gif', text, captions, exposure, frames } | { status:'not-run', reason, failure? }`; gather input `recording` + `recordingPath`; fact id `recording:walkthrough`.

- [ ] **Step 1: Write the failing tests** in `record.test.js` (pure, fake `listFrames`):

```js
const report = (stories, base_url = 'http://localhost:3000') => ({ base_url, stories });
const happy = { id: 'sign-in', name: 'Sign in', status: 'PASS', screenshot_dir: '/q/sign-in' };
const neg = { id: 'neg-bad', name: 'Bad', status: 'PASS', screenshot_dir: '/q/neg-bad' };
const tagged = { id: 'tagged', name: 'T', status: 'PASS', screenshot_dir: '/q/tagged' };
const listFrames = (dir) => ({ '/q/sign-in': ['00_open.png', '01_submit.png', '01_submit-raw.png', 'notes.txt'], '/q/neg-bad': ['00_err.png'], '/q/tagged': ['00_err.png'] })[dir];
test('AC2a.1: frames come from happy-path stories only', ...); // frames ['/q/sign-in/00_open.png','/q/sign-in/01_submit.png'], captions ['open','submit']; raw and non-png excluded
test('AC2a.2: a tag-only negative story is excluded', ...); // storyIndex [{id:'tagged',negative:true}]
test('no report with no QA expected, or only negative stories, is no-story', ...);
test('AC5: a report expected but not read is no-happy-path-screenshots', ...); // report null, qaExpected true
test('a story missing from a readable index fails closed', ...); // happy plus { id:'unlisted', status:'PASS', screenshot_dir:'/q/tagged' }, storyIndex lists only sign-in -> no-happy-path-screenshots, even with sign-in's frames present
test('a neg- id needs no index entry', ...); // neg-bad absent from the index -> still excluded, recording ready from sign-in
test('scrubPaths keeps basenames only', ...); // 'failed at /Users/me/q/00_a.png' -> 'failed at 00_a.png'; "EACCES: open '/r/w.gif'" -> "EACCES: open 'w.gif'"; 'C:\\Users\\me\\x.gif gone' -> 'x.gif gone'; 'no path here' unchanged; a 200k-char token stays linear
test('a failed or skipped happy story contributes no frames', ...); // only one and FAIL -> no-happy-path-screenshots
test('no-local-base-url', ...); // for 'https://dev.example', undefined, 'not a url'
test('local hosts', ...); // localhost, 127.0.0.1, [::1] with ports
test('a lost story index records nothing', ...); // storyIndexLost: true -> no-happy-path-screenshots
test('a missing screenshot dir is no-happy-path-screenshots', ...); // listFrames throws
test('recordingLocations gives the same pair from either location', ...);
// '.claude-tweaks/pipelines/r/packet-inputs/w.gif' and '.claude-tweaks/pipelines/archive/r/packet-inputs/w.gif' both ->
// { live: '.claude-tweaks/pipelines/r/packet-inputs/w.gif', archived: '.claude-tweaks/pipelines/archive/r/packet-inputs/w.gif' }
test('recordingLocations keeps a multi-spec segment', ...); // '.claude-tweaks/pipelines/r/spec-7/packet-inputs/w.gif' -> archived '.claude-tweaks/pipelines/archive/r/spec-7/packet-inputs/w.gif'
test('recordingLocations leaves a run id holding the word archive alone', ...); // '.claude-tweaks/pipelines/archive-run/packet-inputs/w.gif' -> live unchanged, archived '.claude-tweaks/pipelines/archive/archive-run/packet-inputs/w.gif'
```
In `tests/acceptance-packet-cli.test.js`, extending its existing `snapshot` fixture with `deps.encodeWalkthrough` stub returning `{ buffer: Buffer.from('GIF') }`, `deps.gh` and a QA report with `base_url`/`screenshot_dir`: `AC1.2: snapshot encodes and gather links the path` (the stub's `framePaths` count equals the happy steps; `packet-inputs/walkthrough.gif` holds its bytes; the gather facts hold `recording:walkthrough` with `url_or_path` and `archive_path` relative to the checkout root, each ending `packet-inputs/walkthrough.gif`, `exposure: 'local-only'`, integer `redactions`; `render` shows it); `AC2.2: public, private and failed visibility` (`deps.gh` answering each of the three; rendered Recording section holds no `![`, no `<img`, manifest `exposure` is `local-only` in all three); `the stub throwing gives encoder-failed and exit 0` (fact status `not-run`, `failure` is the message); `a failed GIF write gives encoder-failed and exit 0`; `no QA report gives no-story`; `AC5: an unreadable QA report gives no-happy-path-screenshots`; `AC5: decisions.md selecting stories with no report gives no-happy-path-screenshots`; `a missing stories directory with a report listing stories gives no-happy-path-screenshots`; `the encoder's absolute frame path never reaches the fact` (a stub throwing `failed at /abs/q/00_a.png`: `failure` is `failed at 00_a.png`); `re-run from the main checkout keeps the GIF` (existing skip path, bytes unchanged); `a manifest with no recording key adds no fact` (an older run dir); `Decision 2: a gather live and a gather after archiving name the same two locations` (gather once with `--run` on the live dir, move the dir under `archive/{id}` with the real `fs.renameSync`, gather again with `--run` on the `archive/{id}` dir, then `assert.deepEqual` the two `recording:walkthrough` facts, and assert the GIF reads at `archive_path` afterwards). In `packet-gather.test.js`: `redactions` counts text, captions and failure. In `compose.test.js`: `base_url` passes through, and absent is `null`. One repo-only test, `the GIF path is gitignored live and archived`: `git check-ignore --no-index -q` exits 0 on both `.claude-tweaks/pipelines/x/packet-inputs/walkthrough.gif` and `.claude-tweaks/pipelines/archive/x/packet-inputs/walkthrough.gif`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/walkthrough/record.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement.** `record.js`: reason order is no report and `qaExpected` → `no-happy-path-screenshots`; no happy-path story (no report, or none non-negative) → `no-story`; base url not local → `no-local-base-url`; lost index, a non-`neg-` story id absent from the index (fail closed, since it could be a tag-only negative), or no frames from `PASS`/`PASS_WITH_CAVEATS` stories → `no-happy-path-screenshots`. A story is negative when the index says so or its id starts `neg-`. Frame names match `/^\d+_(.+)\.png$/`, excluding `-raw.png`, sorted; the caption is the name part; `text` is `Walkthrough of {names joined ', '}`. Use `FRAME_WIDTH = 960` and `BUDGET_BYTES = 8 * 1024 * 1024`. `runSnapshot`, after the two skip branches and after `qaReport` is read: resolves `report.stories_dir` (else `stories`) against `deps.cwd()` through `readStoryIndex` with `listsStories: true` and a local notes array (non-empty means `storyIndexLost`), and `screenshot_dir` the same way; computes `qaExpected` as `qaReport.status === 'unreadable'`, `qaStamp.status === 'copied'`, or `qaSelectionFromDecisions` above 0 on the run's `decisions.md`; never starts a server or a browser. It encodes through `deps.encodeWalkthrough`, whose real value reads frames with `fs.readFileSync` (a Buffer: `deps.readFile` is utf8), writes with `deps.writeAtomic`, calls `decideExposure({ repoVisibility: readRepoVisibility(deps.gh), storeProbe: null })` only once a GIF exists, and turns any encoder or write throw into `{ status:'not-run', reason:'encoder-failed', failure: scrubPaths(messageOf(err)) }`. The manifest gains `recording`. `readSnapshot` returns `recording`. `gatherToFile` passes `recording` and `recordingLocations(path.relative(findGitRoot(runDir).dir, path.join(runDir, PACKET_INPUTS, file)))` with forward slashes. `gatherPacketFacts` builds the fact with `source: 'walkthrough'`, `url_or_path: live`, `archive_path: archived` and `redactions` summed through `redactText` over `text`, `captions`, `failure`; `recording` absent adds no fact. `compose.js` adds `base_url: orNull(input.base_url)`. `qa-reporting.md`: payload and report samples gain `"base_url": "{APP_URL}"`, and the metadata sentence names it.

- [ ] **Step 4: Run** `node --test tests/bin-lib/walkthrough/record.test.js tests/acceptance-packet-cli.test.js tests/bin-lib/wrap-up/packet-gather.test.js tests/bin-lib/qa-report/compose.test.js`, plus each file `git grep -l composeQaReport tests` names. Expected: PASS, `fail 0`.

- [ ] **Step 5: Real-input probe.** Build a temp dir with two real 1×1 PNGs (write via the tests' PNG helper in `tests/bin-lib/walkthrough/encode.test.js`) and a report.json, run the real CLI `snapshot` then `gather` from a scratch repo with no stubs, and record the printed manifest in the task report: the `.gif` starts with `GIF89a`, frame count 2 (independent count: `node -e` over the file's graphic control extension bytes).

- [ ] **Step 6: Commit** `Encode the walkthrough at snapshot and gather it as a fact — refs #4612`.

### Task 5: No-embed conformance scan

**Role:** integration

**Files:**
- Create: `tests/recording-no-embed-conformance.test.js`
- Modify: `tests/helpers/strip-comments.js` (header list), `.claude/skills/parse-signal-discipline/SKILL.md` (item 15 list)

**Interfaces:**
- Consumes: `stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES`; `readText`.

- [ ] **Step 1: Write the test.** Exports nothing; `offendersIn(source) -> [{ line, what }]` matches `/!\[[^\]\n]*\]\(/` and `/<img\b/i` on `stripComments(source)` (literals kept, so a string that would emit it counts) and pushes the verdict message when `stripperVerdict(raw, stripped) !== 'ok'`. Tests: `AC2.4: no module under wrap-up or walkthrough emits an image` walks both directories with `withFileTypes`, `assert.deepEqual(offenders, [])`, floor `files >= 10` with a message saying a low count means the walk went blind; `AC2.5: a planted emission goes red`: `const s = '![a](b)';` on line 1 and `` `<img src="x">` `` on line 2 flag exact line numbers `[1, 2]`; a comment holding each flags nothing; a planted line after `'/*'` is still flagged; a planted mis-parse (`if (b) /'/.test(b); const c = 'x';`) is reported as an offender. Header states the limit: an emission assembled from fragments is invisible, and the render test in Task 3 covers the output.

- [ ] **Step 2: Run** `node --test tests/recording-no-embed-conformance.test.js tests/strip-comments-callers-twin.test.js`. Expected: PASS, `fail 0`. The planted self-tests are the go-red proof; never mutate a tracked plugin file for it.

- [ ] **Step 3: Commit** `Add the recording no-embed conformance scan — refs #4612`.

### Task 6: Skill prose and docs

**Role:** integration

**Files:**
- Modify: `plugin/skills/walkthrough/SKILL.md`, `plugin/skills/wrap-up/verification-brief.md`, `plugin/skills/wrap-up/SKILL.md`, `docs/plugin-structure.md`
- Test: `tests/walkthrough-conformance.test.js`, `tests/acceptance-packet-wrap-up-conformance.test.js`

**Interfaces:**
- Consumes: the contract's `## Recording` section from Task 3.

- [ ] **Step 1: Write failing pins.** `walkthrough-conformance.test.js`: `the skill names the automatic path and leaves standalone unredacted`: contains `_shared/acceptance-packet.md`, `## Recording`-citing sentence, "applies no redaction", "never uploaded". `acceptance-packet-wrap-up-conformance.test.js`: `snapshot encodes the recording`: the Phase 1 paragraph names the recording; `gather reads the recording from the snapshot`: the gather list says the automatic recording arrives through the snapshot with no flag (Task 7 removes the `--recordings` bullet, so this pin reads the `--run` bullet).

- [ ] **Step 2: Run** `node --test tests/walkthrough-conformance.test.js tests/acceptance-packet-wrap-up-conformance.test.js`. Expected: FAIL on the new tests.

- [ ] **Step 3: Edit the prose.** `walkthrough/SKILL.md`, after the When to Use section: a short `## Automatic path` paragraph (wrap-up's `snapshot` builds a GIF from the pipeline's own happy-path screenshots through `encodeWalkthrough`, never this skill and never a browser run; exposure and redaction rules live in `_shared/acceptance-packet.md`'s `## Recording`; this standalone path applies no redaction, and the human choosing the destination owns what it shows). The Component-Skill Contract stays: no lifecycle skill invokes this skill. `verification-brief.md`'s `--run` bullet gains: the automatic recording arrives through the snapshot with no flag. `wrap-up/SKILL.md`'s snapshot paragraph gains one clause: it also encodes the recording while the QA screenshots are on disk. `docs/plugin-structure.md`'s CLI row: `snapshot` also encodes the recording. Then `docs/skill-graph.md` only if `tests` require an edge (no skill edge changes).

- [ ] **Step 4: Run** the Step 2 command plus `node --test tests/try-it-contract-conformance.test.js tests/verification-brief-evidence-routing.test.js`. Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit** `Document the automatic recording path — refs #4612`.

### Task 7: Retire the evidence route from the procedure

**Role:** judgment

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief.md`, `plugin/skills/wrap-up/verification-brief-parent-gate.md`, `plugin/skills/wrap-up/summary-template.md`, `plugin/skills/dispatch/settle-and-merge.md`
- Delete: `tests/verification-brief-evidence-routing.test.js`
- Test: `tests/acceptance-packet-wrap-up-conformance.test.js`, `tests/log-decision-text-file-sites-conformance.test.js`

**Interfaces:**
- Consumes: the contract's `## Recording` section from Task 3.
- Produces: a Step 4 with no commit, no route and no `--recordings`; Task 8 relies on nothing in `plugin/skills/` citing `bin/evidence-route.js`.

- [ ] **Step 1: Write the failing pin** in `tests/acceptance-packet-wrap-up-conformance.test.js`, replacing `--recordings follows the route, not the commit` and `evidence screenshots are links, with no image fence left to match`:

```js
test('Decision 1: the procedure commits no evidence and passes no recording link', () => {
  const doc = brief();
  for (const gone of ['docs/demo-evidence', 'evidence-route.js', 'evidence-pr', '--recordings', '{RECORDINGS}', 'raw.githubusercontent.com']) {
    assert.ok(!doc.includes(gone), `still names ${gone}`);
  }
});
```
Also: take `--recordings` out of `gather call names every flag`'s list and out of `Step 3 feeds gather from the same evidence sources`'s; `a claim citing the Entry point link names its group` drops its `'the evidence PR note'` assertion; `gather inputs resolve after cleanup` drops the now-stale comment about screenshot routing.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/acceptance-packet-wrap-up-conformance.test.js`
Expected: FAIL on `Decision 1`.

- [ ] **Step 3: Edit the prose.** `verification-brief.md`:
  - Step 3's walk branch keeps item 1 (the headline as a `test-guide` claim). Item 2 becomes: the walk's screenshots stay in the run's local artifacts and are never committed or linked, since the packet's media is the automatic recording (`_shared/acceptance-packet.md`'s `## Recording`).
  - Step 4 loses its opening "embed" sentence fragment (`an "embed" is a --recordings entry`), everything from `**Screenshot commit**` through the `work-backend: local-files` screenshot paragraph (route, CLI call, log line, evidence-PR note, commit fence, raw URL, `{RECORDINGS}` entry shape), the `RECORDINGS=` pair in the temp-path resolve, `--recordings` in the gather fence, and the `--recordings` bullet. It keeps `**Branch**` and everything after it.
  - The grammar sentence stays: it never named these.
  Measure `wc -c`: the file is 42,496 B against the 52,500 B rail, and this only shrinks it.

  `verification-brief-parent-gate.md`: delete line 559's template slot `{screenshot embeds from above, 1-3}` and its blank line. Nothing else in that template changes. `summary-template.md`: delete the `Opened evidence PR` row and the `the acceptance packet's evidence PR (when Step 4 opened one)` clause, and re-read the surrounding sentence so it still parses. `settle-and-merge.md` line 25: drop `its evidence-pr `gh pr create` is the PR create exception (#929), and`, keeping `and its Step 1 runs`. `tests/log-decision-text-file-sites-conformance.test.js`: delete row `V1` and fix any count the file derives from its rows.

  Delete `tests/verification-brief-evidence-routing.test.js`: every test in it pins the retired route or the deleted summary row.

- [ ] **Step 4: Run** `node --test tests/acceptance-packet-wrap-up-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js tests/try-it-contract-conformance.test.js tests/ceremony-profile-roster.test.js`. Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit** `Retire the public demo-evidence route from wrap-up — refs #4612`.

### Task 8: Delete the route's CLI and sweep its citations

**Role:** integration

**Files:**
- Delete: `plugin/bin/evidence-route.js`, `plugin/bin/lib/wrap-up/evidence-route.js`, `tests/bin-lib/wrap-up/evidence-route.test.js`, `docs/journeys/land-demo-evidence-after-the-pr-merged-4039.md`
- Modify: `docs/journeys/close-out-a-parked-pr-whose-labeling-never-landed-3783.md`, `docs/REGISTRY.md`, `docs/plugin-structure.md`, `docs/skill-graph.md`, `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, `.claude/skills/merge-shape-landed-proof/SKILL.md`

**Interfaces:**
- Consumes: Task 7's clean `plugin/skills/`.

- [ ] **Step 1: Delete the four files** with `git rm`, one per Bash call.

- [ ] **Step 2: Sweep each hit.** `close-out-a-parked-pr-…-3783.md` line 51: the bullet goes, since a close-out labeling run commits no screenshots. `docs/REGISTRY.md` line 33: delete the `docs/demo-evidence/{record}/*` row. `docs/plugin-structure.md`: in line 24, remove family (6) and make the count "Six module families", renumbering (7) to (6); delete the line 212 CLI row. `docs/skill-graph.md` line 735: delete the row, and read line 736's row in case it leans on it. `cli-wrapper-contract.md` line 54: keep the rule and restate its instance in the past tense (#4125's CLI, retired by #4612); `merge-shape-landed-proof/SKILL.md` lines 232-233: the same treatment, keeping the rule the instance teaches. Do not edit `docs/incident-log.md` or `CHANGELOG.md`: append-only history.

- [ ] **Step 3: Verify the sweep**, each its own call. Every command below must print nothing except the named history:

Run: `git grep -n -i -e "evidence-route" -e "decideEvidenceRoute" -e "branchReadState" -e "evidence-pr" -e "evidence PR" -e "evidence-only" -e "demo-evidence" -- . ":!.claude-tweaks/pipelines" ":!docs/superpowers/plans" ":!docs/plans" ":!CHANGELOG.md" ":!docs/incident-log.md"`
Expected: only `cli-wrapper-contract.md`'s and `merge-shape-landed-proof/SKILL.md`'s past-tense instances, and the Task 3 test's sample `demo-evidence` url.

The control, per the absence-grep check: the same `git grep` at the merge base (`git grep -n -i -e "evidence-route" {merge-base} -- plugin/bin`) matches, so the search can find its target.

- [ ] **Step 4: Run** the suites naming journeys and the bin tree: `node --test tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/skill-catalog-completeness.test.js`, plus any suite `git grep -l "land-demo-evidence" tests` names. Expected: PASS, `fail 0`.

- [ ] **Step 5: Log the retained history**: `log-decision.js --status AUTO` with the text `Decision 1 retired the evidence route; docs/demo-evidence/1336/*.jpg stay as committed history` and `--reversibility high`.

- [ ] **Step 6: Commit** `Delete the evidence route CLI and its citations — refs #4612`.

## Spec coverage map

| Clause | Test |
|---|---|
| AC1.1 | Task 3 `AC1.1` |
| AC1.2 | Task 4 `AC1.2` |
| AC2.1-AC2.3 | Task 3 `AC2.1`, Task 4 `AC2.2`, Task 2 `AC2.3` |
| AC2.4, AC2.5 | Task 5 |
| AC2a | Task 4 `AC2a.1`, `AC2a.2` |
| AC3 | Task 3 `AC3.1`, `AC3.2`, over Task 1's shapes |
| AC3.3 (the spec's 3a) | Task 1 `AC3a.1`; `tests/bin-lib/walkthrough/encode-cli.test.js` untouched |
| AC4 | Task 2 `AC4.2`, `AC4.3`; Task 3 `AC4.1` |
| AC5 | Task 3 `AC5.1`, `AC5.2`; Task 4 `no QA report gives no-story` |
| AC6.1 | `tests/bin-lib/walkthrough/encode-cli.test.js` passes untouched |
| AC7.1 | Common Step 5's full run |
| Decision 1 (exposure rules and `--recordings`) | Task 2 `no exemption`, Task 3 `Reading B`, Task 7 `Decision 1`, Task 8's sweep |
| Decision 2 (link after archiving) | Task 3 `AC1.1`, Task 4 `recordingLocations` and `Decision 2` |
