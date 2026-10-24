# browse: replace the retired backend's `set viewport`/`set device` vocabulary with playwright-cli forms (#3980) Implementation Plan

**Goal:** `plugin/skills/browse/SKILL.md` and `plugin/skills/help/reference-card.md` still advertise the retired backend's `set viewport <wxh>` / `set device "<name>"` vocabulary — restate it in the forms the installed `playwright-cli` (0.1.21) supports, and document the device mapping in `plugin/skills/browse/playwright-cli-reference.md`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T073917-record-3980/work/3980-spec.md` (materialized from GitHub issue #3980)

**Verified facts (probed in this worktree, 2026-10-24):**
- `playwright-cli --help` lists `resize <w> <h>` (Core) and no `set device` / `set viewport` verb; its Emulation group is `set-color-scheme`/`set-reduced-motion`/`set-forced-colors`/`set-contrast`/`set-media` only.
- `playwright-cli --help open` lists `--device` ("emulate a specific device, for example \"iphone 15\"") and `--mobile` — device emulation is an `open`-time flag, with no mid-session verb. The bundled self-docs (`playwright-core/lib/tools/skills/playwright-cli/SKILL.md`, "Open parameters") show `playwright-cli open --device="iPhone 15"`.
- So `set device "<name>"` HAS an equivalent (`open --device="<name>"`), which this plan documents in the reference file rather than dropping the pattern.

---

### Task 1: Restate the viewport/device vocabulary in playwright-cli forms

**Files:**
- Modify: `plugin/skills/browse/SKILL.md` (line 4 `argument-hint`, lines 43-44 `## Input` pattern rows, line 145 anti-pattern row)
- Modify: `plugin/skills/help/reference-card.md` (line 46 `/claude-tweaks:browse` row's `Takes` cell)
- Modify: `plugin/skills/browse/playwright-cli-reference.md` (Operation vocabulary table — add a device-emulation row after the line-75 "Resize the viewport" row)

New canonical hint (frontmatter, single-quoted because it contains `"`):
`'[<url>|<task description>] [--session <name> ...] [resize <w> <h>|--device "<name>"] [backend=chrome ...] [--quick]'`

- [ ] **Step 1: Failing check** — the record's acceptance greps are the test (no new committed test; `tests/argument-hint-mirrors.test.js` and `tests/argument-hint-input.test.js` already pin hint↔mirror↔`## Input` agreement).
  Run: `grep -rn 'set viewport' plugin/skills/browse/SKILL.md plugin/skills/help/reference-card.md`
  Expected: FAIL (hits on SKILL.md lines 4, 43, 145 and reference-card.md line 46)
- [ ] **Step 2: Implement**
  1. `SKILL.md` line 4: replace the `[set viewport <wxh>|set device "<name>"]` group with `[resize <w> <h>|--device "<name>"]`; everything else in the hint byte-identical.
  2. `SKILL.md` lines 43-44: replace the two rows with
     - `` | `resize <w> <h>` | `resize 1280 800` | Resize the active session's viewport (`playwright-cli -s=<name> resize <w> <h>`) | ``
     - `` | `--device "<name>"` | `https://example.com --device "iPhone 15"` | Emulate a device profile. Applied when the session opens (`playwright-cli -s=<name> open <url> --device="<name>"`) — there is no mid-session device switch, so close and re-open the session to change it | ``
  3. `SKILL.md` line 145: restate the anti-pattern row as `` | Skipping `resize`/`--device` and relying on env vars | Env-var workarounds are unsupported — use the CLI's own `resize <w> <h>` command and `open --device` flag | ``
  4. `reference-card.md` line 46: replace `[set viewport <wxh>\|set device "<name>"]` with `[resize <w> <h>\|--device "<name>"]` in the `Takes` cell — must equal the new hint byte-for-byte once the `\|` escapes are removed.
  5. `playwright-cli-reference.md`: insert after the "Resize the viewport" row a row
     `` | Emulate a device profile | `set device "<name>"` | `open <url> --device="<name>"` — an `open`-time flag, not a mid-session verb: close and re-open the session to change device (confirmed present in the installed CLI's `--help open`, 0.1.21, and the bundled self-docs' "Open parameters"; not spike-tested). `open --mobile` emulates a generic mobile device instead | ``
- [ ] **Step 3: Run**
  - `grep -rn 'set viewport' plugin/skills/browse/SKILL.md plugin/skills/help/reference-card.md` — expected: no output
  - `grep -n 'set device' plugin/skills/browse/SKILL.md` — expected: no output
  - `node --test tests/argument-hint-mirrors.test.js tests/argument-hint-input.test.js tests/agent-browser-retirement-conformance.test.js` — expected: all pass
- [ ] **Step 4: Commit** — one commit, `Restate browse viewport/device vocabulary in playwright-cli forms — resize and open --device`, body `refs #3980`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (decide `set device` equivalent; document or drop) → Step 2.5 documents `open --device`. Deliverable 2 (SKILL.md lines 4, 43-44, 145) → Step 2.1-2.3. Deliverable 3 (reference-card.md:46) → Step 2.4. AC1/AC2 greps → Step 3. AC3 (`npm test` passes; pinned strings updated) → Step 3's targeted suites here, full `npm test` at Common Step 5.
- **Placeholders:** none.
