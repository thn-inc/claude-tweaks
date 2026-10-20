# Step 18 — Autonomy Level (detailed procedure)

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

Neither `autonomy` nor the now-retired `unattended-tier` has ever had an init-time question — both
default to their most conservative value on every project that never manually edits
`.claude-tweaks/policy.yml`. This step asks the degree-of-autonomy question directly.
`_shared/autonomy-ceiling.md` is the canonical contract for what each tier unlocks; this step only
writes the value.

**Call `AskUserQuestion`:**

- `question`: `"How much should claude-tweaks pipelines decide on their own — ledger bookkeeping, queue-write filing, ops-item acknowledgment — versus asking you every time?"`, `header`: `"Autonomy level"`, `multiSelect`: `false`
- Option 1 (Recommended) — `label`: `"Trusted"`, `description`: `"Skip asking about reversible ledger/queue-write bookkeeping once a record class has earned it; everything logged and reversible."`
- Option 2 — `label`: `"Supervised"`, `description`: `"Ask about every decision — today's default, unchanged."`
- Option 3 — `label`: `"Unattended"`, `description`: `"Also skip acknowledging post-merge infrastructure follow-ups."`

`Trusted` is the recommended answer, not the conservative `supervised` default: every capability it
unlocks (`ledgerNarrowing`, `queueWriteAutoFile` — see `_shared/autonomy-ceiling.md`) is already
floor-gated to four narrow, reversible blocker-reason categories before it can act, and every
auto-resolution is logged. Recommending `supervised` here would just reproduce the friction this
lever exists to reduce, on every newly-initialized project by default.

**Write the value.** On `Trusted` or `Unattended`, write `autonomy: {value}` to
`.claude-tweaks/policy.yml` (`trusted` or `unattended`) — no other keys touched by this step. On
`Supervised`, write nothing: `autonomy`'s own schema default is already `supervised`, and this
follows the same "omitting a lever means default" convention every other lever in `policy.yml`
follows (see Gotchas — do not write `autonomy: supervised` explicitly).

**Re-run behavior.** When `/init` is re-run on a project that already has an `autonomy` value set
in `.claude-tweaks/policy.yml`, this step is a no-op — the question is not re-asked. When
`/init --update` runs and finds a stray `unattended-tier` key instead, that is a different
procedure — see `update-mode.md`'s Config Home Drift section, which reads `auditPolicy()`'s
`renamedKeys` field and offers the migration separately from this step.

**Failure handling:** if writing `.claude-tweaks/policy.yml` fails, surface the failure and
continue `/init` — never abort the rest of bootstrap on this step.

## Gotchas

- Don't write `autonomy: supervised` explicitly when the user picks Supervised — that violates the
  "omitting a lever means default" convention every other lever in this file follows, and would
  make this project's `policy.yml` inconsistent with every other init-generated file.
- Step numbering is load-bearing: if another change has already claimed step 18 by the time this
  runs, re-verify the live `bootstrap-steps.md` table and use the next actually-free number instead
  of assuming 18.
