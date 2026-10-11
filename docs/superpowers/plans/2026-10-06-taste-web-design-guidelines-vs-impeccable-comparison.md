# Taste / Web Design Guidelines vs. Impeccable comparison note (#2694) — Implementation Plan

**Goal:** Check a short comparison note (overlap/gaps vs. Impeccable) for the two third-party
skills named in the record — Taste (anti-slop styling dials) and Web Design Guidelines (Vercel
accessibility/UX audit) — into `design-wrapper`'s docs, deciding whether either complements or
duplicates Impeccable's finish-reviewer/asset-producer/CLI-detector roles.

**Constraints:** Neither skill is installed, registered, or enabled for this session — verified
live (`SearchSkills` empty for both; Skill-tool invocation returns `Unknown skill` for both;
`SearchPlugins` finds no plugin for Taste at all, and surfaces Web Design Guidelines only inside
an uninstalled `audit-suite` bundle). The hands-on trial the record's first Deliverable asks for
is not run; the note says so plainly, the same posture #2695's Hallmark note already established
for this file.

**File placement decision:** this record's issue was filed before #2695 (Hallmark), and #2695's
own Gotchas explicitly anticipated it — the consolidated file `third-party-design-skill-comparisons.md`
already has a header note naming #2694 as the next section to land there, not a new sibling file.
Add one `##` section to that existing file; no new sub-file to register in `SKILL.md`'s Reference
list or `docs/plugin-structure.md`'s per-skill sub-file table (both already list this filename).

## Task 1: Research both skills from published source

- [x] Taste: read `Leonxlnx/taste-skill`'s README (sub-skill roster, the three dials, install
      method, license, star/fork/commit counts, tags/releases).
- [x] Web Design Guidelines: read its `SKILL.md` (via `vercel-labs/agent-skills`), its live
      rule-fetch mechanism and source URL, category coverage, install method, license.
- [x] Confirm neither is installed/registered in this session (`SearchSkills`, Skill-tool probe,
      `SearchPlugins`) — the same live-verification rigor #2690's native-`/design` note used.

## Task 2: Compare against Impeccable's existing coverage

- [x] Read `impeccable-cli.md` (pinned 4.1.0 `detect` anti-pattern categories, incl.
      `ai-color-palette`) and `critics.md` (the craft-critic roster) for what Impeccable already
      checks.
- [x] Grep `design-wrapper` and `_shared` for any existing accessibility coverage
      (`prefers-reduced-motion` in `command-map.md`'s Frequency Gate; the unrelated
      `_shared/criteria-prelaunch.md` alt-text/mobile-breakpoints checks that belong to
      `/code-health`, not `design-wrapper`) to ground the gap analysis in what is actually there.
- [x] Write the capability table, the "why not adopted" reasoning, decision, availability, and
      revisit-when sections, following #2695's section as the structural template.

**Files:**
- Modify: `plugin/skills/design-wrapper/third-party-design-skill-comparisons.md` (add
  `## Taste / Web Design Guidelines (#2694)` section)

## Verification

Run: `npm test`
Expected: zero failures (prose conformance suites pin sub-file listings and size ceilings; this
section adds no new sub-file and stays well under any size ceiling).
