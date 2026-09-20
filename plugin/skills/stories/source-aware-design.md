# Source-Aware Story Design

Detailed procedures for source code extraction and how it shapes story design in `/claude-tweaks:stories`. This file is lazy-loaded — only read it when performing source analysis, URL-to-source mapping, or generating source-aware / diff-aware stories.

Covers four related concerns:

1. **Source Analysis** (Step 1.5) — identify component files and extract behavioral signals
2. **URL-to-Source-File Mapping** (Step 2) — map each discovered page URL to the source files that render it
3. **Source-Aware Story Design** (Step 3) — translate SourceContract signals into stories
4. **Diff-Aware Design** (Step 3, update mode) — detect stale stories via locator, source-file, and behavioral-contract checks

For framework-specific extraction patterns (Zod / yup / Joi schemas, JSX input props, `useState` heuristics, conditional rendering, and the full SourceContract schema), read `source-analysis.md` in this skill's directory.

## 1. Source Analysis (Step 1.5)

Identify and read component source files to extract behavioral contracts that are not visible from the rendered DOM alone — input constraints, validation schemas, state transitions, conditional rendering, error handling, and API patterns. This step produces a per-page SourceContract that feeds into story design (Step 3).

### Identify Component Files

Use the URL-to-Source-File Mapping procedure (below) to map each discovered page URL to its source files. If source files were already identified during a previous exploration pass (update mode), reuse the existing `SOURCE_FILES` data.

**Journey-seeded source files:** When a page URL appears in the JOURNEY_URL_INDEX (from Step 1.1), seed the SOURCE_FILES for that page with the journey's `files:` frontmatter array before running the URL-to-Source-File Mapping. The mapping procedure then extends (not replaces) this seed list with component-level files discovered from the route. De-duplicate the final list.

> **Parallel execution:** Use parallel tool calls aggressively — all Read operations across identified component files are independent and should run concurrently.

For each page with identified source files:

a. Read the page-level component file (the route entry point).

b. Extract `import` statements referencing local project files (paths starting with `./`, `../`, or `@/`). Resolve each import path relative to the current file.

c. Read imported files up to **3 levels of import depth** from the page file (level 0 = page file, level 1 = direct imports, level 2 = imports of imports, level 3 = maximum). When the depth limit is reached, log: "Source analysis: import depth limit (3) reached for {page_url} — using signals collected so far."

d. Skip non-behavioral files: `*.css`, `*.scss`, `*.module.css`, `*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`.

### Extract Behavioral Signals

From each read source file (React/TSX only in v1), extract input constraints, validation schemas, user-triggerable state variables, conditional rendering, error paths, API call patterns, and toast/notification triggers. For the framework-specific extraction patterns and the full SourceContract schema, read `source-analysis.md` in this skill's directory. React component-tree inspection was available under `agent-browser` and has no Playwright CLI equivalent as of this migration.

### Graceful Degradation

If the framework is not React/TSX, no source files were identified, or files cannot be read, return an empty SourceContract (all arrays empty) and continue. Source analysis enhances stories but is never a hard gate — story generation always works from DOM exploration alone.

## 2. URL-to-Source-File Mapping (Step 2)

> **Parallel execution:** Use parallel tool calls aggressively — all Glob and Read operations across discovered pages are independent and should run concurrently.

For each page visited during exploration, map its URL to the source files that render it:

a. **Extract the route path** from the URL — strip the origin to get the route (e.g., `http://localhost:3000/admin/settings` becomes `/admin/settings`).

b. **Detect the framework** by checking for directory markers:
   - `app/` directory exists → **Next.js App Router**: glob `**/app/**/page.{tsx,jsx,ts,js}` matching the route segments. Account for route groups — parenthesized segments like `(admin)` in the path won't appear in the URL, so glob with `**` wildcards between segments.
   - `pages/` directory exists → **Next.js Pages Router**: glob `**/pages/**/*.{tsx,jsx,ts,js}` matching the route, including `index.{tsx,jsx,ts,js}` for directory routes.
   - `src/routes/` directory exists → **SvelteKit/Remix**: glob `**/src/routes/**/+page.svelte` or `**/src/routes/**/*.{tsx,jsx,ts,js}` matching the route segments.
   - None of the above → **Generic fallback**: glob for files whose path contains the route segments (e.g., `**/*settings*.{tsx,jsx,ts,js}`).

c. **Discover local imports** (one level deep): Read the matched page file and extract `import` statements that reference local project files (paths starting with `./`, `../`, or `@/` — not `node_modules` packages). Resolve each import path relative to the page file. Add those resolved paths to the source files list for the page.

d. **Store the result** as `SOURCE_FILES` for that page URL — an array of relative paths (relative to project root, not absolute).

**Gotchas:**
- **Route groups:** Next.js App Router uses `(group)` syntax — the URL `/admin/settings` may map to `app/(admin)/admin/settings/page.tsx`. Use wildcard globs between route segments to match through parenthesized directories.
- **Dynamic routes:** Segments like `[id]` or `[...slug]` won't match URL segments literally. Skip dynamic segments during matching and note uncertainty in the mapping.
- **Monorepo subdirectories:** The app may live in `apps/web/` or similar. Check for common monorepo markers (turborepo.json, nx.json, pnpm-workspace.yaml) and adjust the base path for globbing.
- **Mapping failures:** If no source files can be identified for a page, store an empty array `[]`. The `source_files` field must always be present.

## 3. Source-Aware Story Design (Step 3)

The design step receives both DOM exploration data (from Step 2) and source contracts (from Step 1.5). When a page has a non-empty SourceContract, use its signals to generate deeper stories:

- **Inputs with constraints:** For each input that has `min`, `max`, `minLength`, or `maxLength` values, generate boundary-value stories: enter the minimum value, the maximum value, one below minimum (min-1), one above maximum (max+1), and empty. For `pattern` constraints, generate a story with a matching value and a non-matching value.
- **State transitions:** For each state variable that affects UI (names matching `is*`, `has*`, `loading*`, `saving*`, `error*`, `show*`), generate stories that trigger the state change via user action and verify the intermediate UI — spinners, disabled buttons, skeleton loaders, success messages.
- **Error paths:** For each identified error path (try/catch handlers, API error states, validation failures), generate a story that triggers the error condition and verifies the expected behavior — error messages, toasts, form field highlights, rollback of optimistic updates.
- **Conditional rendering:** For each conditional where `userTriggerable` is true, generate stories that exercise both branches. For ternaries, verify both the true-branch element and the false-branch element. For logical AND expressions, verify the element appears when the condition is met and is absent otherwise.

When a page has an empty SourceContract (unsupported framework, no source files found), generate stories from DOM exploration data only — the same behavior as before source analysis was added.

## 4. Diff-Aware Design (Step 3, update mode)

When update mode is active, compare discovered pages against EXISTING_STORIES:

1. For each discovered page URL:
   - If a story with this URL already exists in EXISTING_STORIES → mark as **EXISTING**.
   - If no story exists for this URL → mark as **NEW**.
2. For each EXISTING story, check for staleness via three mechanisms:
   - **Locator staleness:** For each existing semantic locator (see types in `story-examples.md`), take a `playwright-cli -s=<name> snapshot` and search its output for an element matching the locator (Playwright CLI's `find` is read-only and text-only, so it cannot resolve role/testid/css locators — locator resolution goes through `snapshot` instead). Zero matches → mark as **STALE** and add to STALE_LOCATORS list. More than one match → mark as **STALE_AMBIGUOUS** (locator needs disambiguation) and add to STALE_LOCATORS as well — an ambiguous locator is unresolvable-as-written and needs regeneration exactly like a zero-match one.
   - **Source file staleness:** If the existing story has a non-empty `source_files` array, run `git diff --name-only` and check whether any of those files appear in the diff. If so → mark as **STALE** and add to STALE_SOURCE_FILES list, even if all locators still resolve.
   - **Behavioral contract staleness:** If the existing story has a non-empty `source_files` array and those files were not flagged by `git diff`, re-run source analysis (Step 1.5) on those files and compare the resulting SourceContract against the behavioral signals embedded in the existing story's steps. If a behavioral constraint has changed — for example, an input's `max` changed from 100 to 200, a validation rule was added or removed, a new error path was introduced, or a conditional rendering condition changed — mark as **STALE** even though the files did not appear in git diff (the diff may have been committed in a previous cycle). Add to STALE_SOURCE_FILES with reason: "behavioral contract changed: {description of change}."
3. **EXISTING** stories with no stale locators AND no stale source files AND no behavioral contract changes: **SKIP** — do not regenerate.
4. **STALE** stories (locators unresolvable or ambiguous OR source files modified OR behavioral contracts changed): **REGENERATE** with updated locators from the current snapshot, refreshed source_files from the URL-to-Source-File Mapping, and updated SourceContract data from Step 1.5.
5. **NEW** pages: generate stories as normal.

Log the diff summary:

- "Update mode: {N} existing stories unchanged, {M} stories regenerated (stale locators/source files), {K} new stories to generate."
- If STALE_LOCATORS is non-empty, emit a warning:
  ```
  WARNING: The following locators no longer resolve in the live snapshot:
    - Story '{storyId}', step '{stepDescription}': locator '{locator-spec}' — snapshot returned 0 matches
    - Story '{storyId}', step '{stepDescription}': locator '{locator-spec}' — snapshot returned {N} matches (ambiguous)
  ```
- If STALE_SOURCE_FILES is non-empty, emit a warning:
  ```
  WARNING: The following stories have modified source files or behavioral contracts (regenerated even though locators still resolved):
    - Story '{storyId}': {filePath} modified
    - Story '{storyId}': behavioral contract changed — {description of change}
  ```
