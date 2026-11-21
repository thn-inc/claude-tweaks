# Agent launch `effort` probe

Record #5941 (a launched agent runs at the effort its work profile names) passes an `effort` on the Agent tool call. This file is the measured answer to "does the parameter set the effort the agent runs at, and what does a launch with none run at". The `launchEffort` prose and this repository's opt-in rest on the facts below.

- **Claude Code version:** 2.1.325
- **Date measured:** 2026-11-21
- **Launching session:** Opus 5.5 (`claude-opus-5-5`) at effort `high`
- **Surface:** the Agent tool from that session; every launch is a `general-purpose` agent unless named. The measurement was taken centrally by the build.
- **What "recorded" means:** the `"effort"` field on the agent's assistant turns in its subagent transcript (`grep -o '"effort":"[a-z]*"' <subagent transcript>.jsonl | sort -u`). Thinking text is not stored in the transcript, so the field is evidence of the effort only as far as the run tracks it: the output-token rise under Output size shows it does.

## Results

| Launch | Profile | `effort` passed | Recorded | Model recorded |
|---|---|---|---|---|
| Standard | standard | `high` | `high` | claude-sonnet-5-5 |
| Standard control | standard | none (prompt carried `[Effort: high ...]`) | `medium` | claude-sonnet-5-5 |
| Capable | capable | `medium` | `medium` | claude-opus-5-5 |
| Capable control | capable | none (prompt carried `[Effort: high ...]`) | `high` (the session's own effort: same model as the session) | claude-opus-5-5 |
| sonnet `low` | - | `low` | `low` | claude-sonnet-5-5 |
| sonnet / opus `xhigh` | - | `xhigh` | `xhigh` | sonnet / opus |
| sonnet / opus `max` | - | `max` | `max` | sonnet / opus |
| haiku `high` | fast-model | `high` | `high`, accepted, not rejected | claude-haiku-5-5 |
| `claude-tweaks:qa-agent` (frontmatter `effort: medium`) | - | `low` | `low`: a launch effort overrides the frontmatter | claude-sonnet-5-5 |

**Acceptance (AC10).** The Standard launch (`high`) and the Capable launch (`medium`) each recorded the effort passed. Each control, made with none, recorded something else: `medium` for Standard, `high` for Capable. The parameter changes what the agent runs at.

**Why the controls differ.** An agent on the session's own model inherits the session's effort: the Capable control ran on opus, the session model, and recorded the session's `high`. An agent on any other model runs at `medium`: the Standard control ran on sonnet and recorded `medium`. A prompt line saying `[Effort: high ...]` does not change this; only the `effort` parameter does. The re-run recipe depends on it: a control only differs from a passed effort when the passed effort is not the one the control would have inherited.

**The frontmatter exemption.** `claude-tweaks:qa-agent` declares `effort: medium` in its frontmatter. Launched with `effort: low`, it recorded `low`, so a launch effort overrides the frontmatter. One launch of an agent type with `effort:` frontmatter given an explicit `effort` therefore ran at the launch value; this is why the exemption exists: a dispatcher's launch effort would override an agent author's `effort:` frontmatter, so the dispatcher must not set one for such an agent.

**Output size.** The same hard prompt (count 8-digit strings, digit sum 30, no equal adjacent digits) on sonnet, one run each: `low` 30,484 output tokens in 96 s; `high` 39,872 output tokens in 114 s; `max` 229,930 output tokens in 665 s. `low` against `high` alone is a modest gap; the rise to `max` is the decisive part. Output tokens stand in for thinking tokens, which the transcript does not keep.

## Re-run

The parameter's behavior is version-sensitive: run `claude --version`, compare it with the 2.1.325 measured here, and record the version beside the results.

From a session on Opus at `high` (the 2026-11-21 setup), make five Agent tool launches and read each agent's transcript:

1. Standard: a sonnet `general-purpose` agent with `effort: high`.
2. Standard control: the same with no `effort`. It runs at `medium`, because sonnet differs from the session model.
3. Capable: an opus `general-purpose` agent with `effort: medium`.
4. Capable control: the same with no `effort`. It inherits the session's `high`, because opus is the session model.
5. Frontmatter: a `claude-tweaks:qa-agent` launch with `effort: low`. Expect `low` recorded, not the frontmatter's `medium`.

To check that the recorded field reflects real reasoning, give one model the same hard prompt at `low`, `high` and `max` and compare output tokens and time: they should rise, sharply at `max`.

From any other session, first run each control, then pass an effort that differs from that control, and record the session model and effort beside the results. For each launch run `grep -o '"effort":"[a-z]*"' <subagent transcript>.jsonl | sort -u` against the agent's transcript under the session's `subagents/` directory, and check the passed effort appears and the control's differs.
