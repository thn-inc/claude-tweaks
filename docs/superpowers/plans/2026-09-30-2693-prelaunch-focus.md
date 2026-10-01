# Pre-launch Checklist Focus (`focus=prelaunch`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/claude-tweaks:code-health focus=prelaunch` vertical. It reports pass / fail / needs-manual-check for every pre-launch item the record names: mechanically checked items get verified, and human-judgment items are listed as manual.

**Architecture:** This mirrors the `security-hardening` focus vertical (#2624): one generator module that registers into `FOCUS_GENERATORS`, a `criteria.js` entry, a `_shared/criteria-prelaunch.md` fragment, and `focus-mode.md`'s two per-vertical rows. The generator adds one field to the rich result shape: a `checklist` array with one row per item. `focus-mode.md` learns to render it on every firing, including zero-candidate ones, so the report always covers every item. Discovery reuses dead-code's `git ls-files` call, through a new extension-agnostic `listTrackedFiles` that `listTrackedSourceFiles` now delegates to.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-09-30T172437-spec-2669-2692-2704-2693-2685-2684-2706-2707-2709/spec-2693/work/2693-spec.md`

## Global Constraints

- The checklist is exactly these 17 items, in this order, with these ids, labels and groups.
  - Automated (9): `sitemap` "sitemap.xml", `robots` "robots.txt", `favicon` "Favicon", `custom-404` "Custom 404 page", `meta-title` "Meta title on every page", `meta-description` "Meta description on every page", `og-image` "Open Graph image", `alt-text` "Alt text on images", `image-size` "Compressed images".
  - Manual (8): `mobile-breakpoints` "Mobile breakpoints", `form-loading-states` "Form and loading states", `thank-you-page` "Thank-you / confirmation page", `privacy-policy` "Privacy policy", `terms` "Terms of service", `cookie-banner` "Cookie banner", `analytics` "Analytics", `contact-info` "Real contact info".
- **Ruling (count):** the record's AC says "all 20 items", but its body names these 17. No source for the other 3 is available, so none are invented. The fragment states the count honestly.
- Oversized-image threshold: `IMAGE_SIZE_LIMIT_BYTES = 500 * 1024`.
- Candidate `kind` values map one-to-one to automated item ids:
  - `missing-sitemap`→`sitemap`
  - `missing-robots`→`robots`
  - `missing-favicon`→`favicon`
  - `missing-custom-404`→`custom-404`
  - `missing-meta-title`→`meta-title`
  - `missing-meta-description`→`meta-description`
  - `missing-og-image`→`og-image`
  - `img-missing-alt`→`alt-text`
  - `oversized-image`→`image-size`
- The `criteria.js` entry is `{ id: 'prelaunch', appliesTo: ['frontend'], confidenceFloor: 'medium', fragment: 'criteria-prelaunch.md' }`.
- The generator's module header carries a Coverage block stating its reach honestly (IL-110): it checks presence of a file or tag, never quality.
- The Coverage section and the Criterion-pinning table row in `focus-mode.md` land in the same change as the registry key. A key with no pinning row is a fail-loud stop.
- Do not add a fleet routine. `security-hardening` set that precedent.

## Review Focus

- **A non-website repo** (no page files) must not produce 9 site-level "missing" candidates. The generator returns `notApplicable: true` with zero candidates. This is pinned by a test in Task 1.
- **A Next.js App Router page whose title lives in an ancestor `layout.*`** must pass `meta-title`, not fail. Pinned in Task 1.
- **A JSX `<Image>` or `<img>` carrying `alt={...}` (an expression, not a string)** counts as having alt. Pinned in Task 1.
- **`listTrackedSourceFiles`'s existing behavior must stay byte-identical** after the refactor. The existing dead-code suite covers it; Task 1 runs it.
- **A zero-candidate prelaunch firing** must still render the checklist (all automated items pass, manual items listed). This is `focus-mode.md` prose, pinned by Task 2's test.

---

### Task 1: The `prelaunch` generator

**Files:**
- Modify: `plugin/bin/lib/code-health/candidates-dead-code.js:416-435` (extract `listTrackedFiles`, export it)
- Create: `plugin/bin/lib/code-health/candidates-prelaunch.js`
- Modify: `plugin/bin/lib/code-health/focus-generators.js` (append `require('./candidates-prelaunch');`)
- Test: `tests/bin-lib/code-health/candidates-prelaunch.test.js`

**Interfaces:**
- Produces:
  - `scanPrelaunch(rootDir) → { candidates, scannedFiles, skippedFiles, discoveryFailed, discoveryReason?, notApplicable, notApplicableReason?, checklist }`. `checklist` is `[{ id, label, group: 'automated'|'manual', status: 'pass'|'fail'|'manual'|'n/a', evidence }]`, always all 17 rows in the Global Constraints order.
  - `candidatesPrelaunch(rootDir) → candidates[]`
  - `CHECKLIST_ITEMS`, `IMAGE_SIZE_LIMIT_BYTES`, `listPageFiles(files) → string[]`
  - Registry key `'prelaunch'`
  - `listTrackedFiles(rootDir) → { files, discoveryFailed, reason? }` exported from `candidates-dead-code.js`: every tracked and untracked-unignored file, sorted, with no extension filter.

**Detection rules (implement exactly):**

1. **Discovery.** Call `listTrackedFiles(root)`. On `discoveryFailed`, return the standard failure shape: every checklist row gets `status: 'n/a'`, evidence `discovery failed`, and `notApplicable: false`.
2. **Page files** (`listPageFiles`). A file is a page if any of these holds:
   - its extension is `.html` or `.htm`;
   - its basename matches `/^page\.(jsx|tsx|js|ts|mdx)$/` (Next App Router);
   - its extension is one of `.jsx .tsx .js .ts .vue .svelte .astro .mdx .md` and the path sits under a `pages/` directory segment. This excludes any path containing `/pages/api/` and basenames starting with `_`.
   - The `.md` form counts only for `.astro` sites. Simplest rule: include `.md`/`.mdx` only under `src/pages/`.
   - *(Task-review amendment.)* No file under a test/fixture/example/dependency/build-output directory segment is a page or a scanned image. Plain `.html`/`.htm` files count as pages only when an `index.html`/`index.htm` is among the pages. The literal rule above made this plugin repo, whose HTML is only test fixtures plus one template, read as a site missing 7 launch items.
   - *(Whole-branch-review amendments.)*
     - Layouts: Nuxt `layouts/*`/`app.vue` and Astro `src/layouts/*` wrap every page, and SvelteKit `+layout.svelte` wraps its subtree.
     - SvelteKit `+page.svelte` counts as a page.
     - Alt text is scanned in every shipped markup file, components included.
     - Site-level candidates name the site's entry file, not a directory, because anchors must be files.
     - Meta and alt regexes are tightened: string-valued `title:`/`description:`, component `title=` props, brace-aware tags, and whitespace-anchored `alt`.
     - The fragment tells the judge to reconcile checklist rows with its verdicts.
3. **Applicability.** When there are zero page files, return:
   - `notApplicable: true` with `notApplicableReason: 'no web pages detected'`;
   - zero candidates;
   - every checklist row `status: 'n/a'`, evidence `no web pages detected`.
4. **Text reads.** Read every page file plus every `layout.*`, `_app.*` and `_document.*` file in the file list, using the same unreadable / NUL-byte skip pattern as `candidates-security-hardening.js`. Skipped files go into `skippedFiles` as `{ file, reason }`.
5. **Web root.** `'public'` if any tracked file starts with `public/`, otherwise `'.'`. Site-level candidates use `file: webRoot`.
6. **Site-level presence**, using each tracked file's basename or relative path:
   - `sitemap`: a basename of `sitemap.xml`, or a path matching `/(^|\/)sitemap\.(ts|js|mjs)$/`, or a basename matching `/^next-sitemap\.config\.(js|cjs|mjs)$/`.
   - `robots`: a basename of `robots.txt`, or a path matching `/(^|\/)robots\.(ts|js|mjs)$/`.
   - `favicon`: a basename matching `/^(favicon\.(ico|svg|png)|icon\.(ico|svg|png)|apple-icon\.png)$/`, or any read page/layout text matching `/rel=["'](shortcut )?icon["']/i`.
   - `custom-404`: a basename matching `/^404\.(html|htm|jsx|tsx|js|ts|vue|svelte|astro|md|mdx)$/`, or `/^not-found\.(jsx|tsx|js|ts)$/`, or a path matching `/(^|\/)\+error\.svelte$/`.
   - `og-image`: a basename matching `/^opengraph-image\./`, or any read page/layout text matching `/og:image|openGraph\s*:/`.
   - Each absent item emits one candidate: `{ file: webRoot, kind: 'missing-<id>', evidence: '<label> not found (looked for: <short list>)' }`.
7. **Per-page meta.**
   - `TITLE_RE = /<title[\s>]|<Head[\s>]|<Helmet[\s>]|useHead\s*\(|useSeoMeta\s*\(|generateMetadata|\btitle\s*:/`
   - `DESC_RE = /name=["']description["']|\bdescription\s*:/`
   - A page passes a check if its own text matches, or if any ancestor-directory `layout.*`, `_app.*` or `_document.*` file does. An ancestor is any read layout file whose directory is a prefix of the page's directory, including the same directory.
   - Each failing page emits `{ file: page, kind: 'missing-meta-title' | 'missing-meta-description', evidence: '<page> has no title/description signal in itself or an ancestor layout' }`.
8. **Alt text.** In page files and any read `.jsx .tsx .vue .svelte .astro .html .htm` file, match `/<(img|Image)\b[^>]*>/g`.
   - A tag lacking `/\balt\s*=/` emits `{ file, kind: 'img-missing-alt', evidence: '<file>:<line> <tag> has no alt attribute' }`.
   - `alt=""` and `alt={x}` both count as present.
9. **Image size.** For tracked files with extension `.png .jpg .jpeg .gif .webp .bmp .tiff`, `fs.statSync` each. Any file over `IMAGE_SIZE_LIMIT_BYTES` emits `{ file, kind: 'oversized-image', evidence: '<file> is <KB> KB (limit 500 KB)' }`. A stat failure goes to `skippedFiles` with `reason: 'unreadable'`.
10. **Checklist.**
    - An automated row is `status: 'fail'` when any candidate maps to it, with evidence `'<n> candidate(s)'`. Otherwise it is `'pass'`, with evidence naming the found artifact for site-level items (e.g. `'public/sitemap.xml'`) or `'<n> page(s) checked'` for per-page and alt items.
    - A manual row is always `status: 'manual'`, with evidence `'needs manual check — see criteria-prelaunch.md'`.
11. **Sorting.** Sort candidates the same way as `candidates-security-hardening.js` (by file, then evidence).
12. **Registration.** Call `registerGenerator('prelaunch', scanPrelaunch)` at module end.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/code-health/candidates-prelaunch.test.js`.
  - Mirror `candidates-security-hardening.test.js`'s helpers (`tmpGitRepo`, `write`).
  - Tests (names read as specifications):
    1. **AC: a sample site reports a status for every checklist item.** Build a sample site in a git repo: `public/index.html` with `<title>` and a `description` meta, `public/about.html` with neither, `public/logo.png` of 600 KB (write a zero-filled Buffer), and one `<img src=x>` without alt in `index.html`. Assert:
       - `checklist.length === 17`, the ids equal `CHECKLIST_ITEMS.map(i => i.id)` in order, and every row's status is in `{pass, fail, manual}`;
       - `sitemap`, `robots`, `favicon`, `custom-404`, `og-image`, `meta-title`, `meta-description`, `alt-text` and `image-size` are all `'fail'`;
       - all 8 manual rows are `'manual'`.
    2. **A complete site passes every automated item.**
       - `public/index.html` carries `<title>`, `<meta name="description" ...>`, `<meta property="og:image" ...>`, `<link rel="icon" ...>`, and `<img src=a alt="x">`.
       - Also present: `public/404.html` (with title and description), `public/robots.txt`, and `public/sitemap.xml`.
       - Assert every automated row is `'pass'` and there are zero candidates.
    3. **A repo with no web pages is not applicable.** Only `lib/util.js` exists. Assert `notApplicable === true`, zero candidates, and every checklist row `'n/a'`.
    4. **An App Router page inherits title and description from an ancestor layout.** `app/layout.tsx` has `export const metadata = { title: 'X', description: 'Y' }`, and `app/blog/page.tsx` has none. Assert no `missing-meta-title` or `missing-meta-description` candidate for `app/blog/page.tsx`.
    5. **A JSX alt expression counts as alt.** `app/page.tsx` contains `<Image src={s} alt={caption} />`. Assert no `img-missing-alt` candidate.
    6. **An image under the size limit is not flagged.** A 100 KB png is not flagged; a 600 KB png is.
    7. **Registry:** `prelaunch` is registered in `FOCUS_GENERATORS` and is the same function as `scanPrelaunch`.
    8. **`listTrackedFiles` returns non-source files**, e.g. `robots.txt`, and `listTrackedSourceFiles` still excludes them.
    9. `scanPrelaunch` on a non-git tmp dir → `discoveryFailed: true`, zero candidates, every checklist row `n/a` (mirrors security-hardening's non-git-root test).
    10. `candidatesPrelaunch(root)` deep-equals `scanPrelaunch(root).candidates`.
- [ ] **Step 2: Run to verify it fails.** Run `node --test tests/bin-lib/code-health/candidates-prelaunch.test.js`. Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/code-health/candidates-prelaunch'`.
- [ ] **Step 3: Implement.**
  - Refactor `listTrackedSourceFiles` in `candidates-dead-code.js` so a new `listTrackedFiles(rootDir)` holds the unchanged `execFileSync` git call and error handling, with no extension filter. `listTrackedSourceFiles` becomes `listTrackedFiles` followed by the `SOURCE_EXTS` filter. Export `listTrackedFiles`.
  - Write `candidates-prelaunch.js` per the detection rules above. Give it a module header in the style of `candidates-security-hardening.js`: purpose, #2693, the scope boundary against #2624 (security-hardening), #2622 (pre-scale) and #2625 (GDPR), and a Coverage block covering:
    - page discovery is a path/extension heuristic;
    - meta detection is a regex text signal, not a render;
    - site-level items check presence, never content quality;
    - image size is file bytes, not visual compression quality;
    - manual items are never machine-judged.
  - Append `require('./candidates-prelaunch');` to `focus-generators.js`'s autoload list.
- [ ] **Step 4: Run to verify it passes.**
  - Run `node --test tests/bin-lib/code-health/candidates-prelaunch.test.js tests/bin-lib/code-health/candidates-dead-code.test.js tests/bin-lib/code-health/focus-generators.test.js`. Expected: PASS.
  - Real-input probe: run `node -e 'console.log(JSON.stringify(require("./plugin/bin/lib/code-health/candidates-prelaunch").scanPrelaunch(process.cwd()).checklist.map(r=>r.id+":"+r.status)))'` against this repo, which has no web pages. Expected: all `n/a`, since this plugin repo has no page files. Record the output in the report.
- [ ] **Step 5: Commit:** `git add` the four files, then `git commit -m "Add the prelaunch code-health focus generator (refs #2693)"`.

### Task 2: Criterion, fragment, and focus-mode wiring

**Files:**
- Modify: `plugin/bin/lib/code-health/criteria.js` (append the `prelaunch` entry after `security-hardening`, with a comment in the sibling style)
- Create: `plugin/skills/_shared/criteria-prelaunch.md`
- Modify: `plugin/skills/code-health/focus-mode.md`:
  - the Coverage paragraph gains a `prelaunch` sentence;
  - the Criterion-pinning table gains the row `| \`prelaunch\` | \`prelaunch\` | \`criteria-prelaunch.md\` |`;
  - F1's result-shape paragraph and F2 gain the checklist and not-applicable handling below.
- Test: `tests/bin-lib/code-health/candidates-prelaunch.test.js` (append), `tests/code-health-prelaunch-wiring.test.js` (create)

**Interfaces:**
- Consumes: Task 1's `CHECKLIST_ITEMS`, the `checklist` and `notApplicable` fields, and the kind list.
- Produces: `getCriterion('prelaunch')` and the fragment file.

**Fragment content** (`criteria-prelaunch.md`), modeled on `criteria-security-hardening.md`'s section shape:
- Title and purpose line: a criteria-only fragment for `focus=prelaunch` (#2693), with confidence floor `medium`.
- "What the generator hands you": candidates `{file, kind, evidence}` over the 9 kinds, plus the `checklist` array.
- "The checklist — every item, every firing": a table of all 17 items (id, label, group, and how it is checked). State that the record's source list was described as 20 items but its body names these 17, and that none were invented.
- "What to flag", one bullet per automated kind: what it means and what to confirm before filing (e.g. a `missing-sitemap` on a site that generates its sitemap at build time from a config the generator does not recognize is a false positive).
- "What NOT to flag": `img-missing-alt` on a decorative image already carrying `aria-hidden`/`role="presentation"`; `oversized-image` for a source asset that is not shipped (e.g. under `design/`); a `missing-meta-*` page that is a redirect-only stub.
- "Needs manual check": the 8 manual items, each with a one-line "how a human checks it". For example, privacy policy: a linked `/privacy` page that names the data collected; cookie banner: shown before any non-essential cookie is set.
- Severity calibration:
  - **high:** missing custom 404, missing meta title on a primary page, `oversized-image` over 2 MB;
  - **medium:** missing sitemap, missing robots, missing OG image, missing description, `img-missing-alt` on content images;
  - **low:** missing favicon, `oversized-image` between 500 KB and 2 MB.
- Scope boundary: #2624 (security-hardening), #2622 (pre-scale), and #2625 (GDPR) are out of scope.
- "Reporting": the summary renders every checklist row as `| Item | Group | Status | Evidence |`, always all rows, keeping "verified automatically" (pass/fail) separate from "a human should confirm" (manual).
- "What this vertical never does": propose records only, and never edit site files.

**`focus-mode.md` additions** (keep each short, and do not restate the fragment):
- Coverage paragraph: add one sentence, "For `prelaunch`, the Coverage block at the top of `bin/lib/code-health/candidates-prelaunch.js` (…one-line summary…)."
- F1, after the rich-shape sentence: "A generator MAY add a `checklist` array (`prelaunch` does — `[{ id, label, group, status, evidence }]`, every item on every firing) and `notApplicable`/`notApplicableReason`. When `checklist` is present, hand it to the judge in F4 and render it in SKILL.md Step 10's summary as one row per item."
- F2, next to the `noIdiomConfigured` carve-out: "`prelaunch` sets `notApplicable: true` when the repo has no web pages — report exactly `focus=prelaunch: not applicable — no web pages detected (scanned: <scannedFiles> files)` and stop. A zero-candidate `prelaunch` firing is otherwise still reported with its checklist (manual rows still need a human), never collapsed to the generic no-candidates line alone."

- [ ] **Step 1: Write the failing tests.**
  - Create `tests/code-health-prelaunch-wiring.test.js`, asserting:
    - `getCriterion('prelaunch')` deep-equals the Global Constraints entry;
    - `plugin/skills/_shared/criteria-prelaunch.md` exists and contains every one of the 17 item ids from `CHECKLIST_ITEMS`;
    - `focus-mode.md`'s Criterion-pinning table has a row starting `` | `prelaunch` | `` naming `criteria-prelaunch.md`;
    - `focus-mode.md` mentions `candidates-prelaunch.js` in its Coverage section (the text between `## Coverage` and `## Criterion pinning`);
    - `focus-mode.md` contains `notApplicable` and `checklist`;
    - every `FOCUS_GENERATORS` key has a pinning-table row. This is a registry-to-table pin, so a future key without a row goes red.
- [ ] **Step 2: Run to verify it fails.** Run `node --test tests/code-health-prelaunch-wiring.test.js`. Expected: FAIL — `getCriterion('prelaunch')` is undefined.
- [ ] **Step 3: Implement** the criteria entry, the fragment, and the `focus-mode.md` edits as specified.
- [ ] **Step 4: Run to verify it passes.**
  - Run `node --test tests/code-health-prelaunch-wiring.test.js tests/bin-lib/code-health/candidates-prelaunch.test.js`. Expected: PASS.
  - Also run every existing test that reads `focus-mode.md` or `criteria.js`: `node --test tests/bin-lib/code-health/*.test.js`. Expected: PASS.
  - Check `wc -c plugin/skills/code-health/focus-mode.md`. Expected: < 46080.
- [ ] **Step 5: Commit:** `git add` the changed files, then `git commit -m "Wire the prelaunch focus into criteria and focus-mode (refs #2693)"`.
