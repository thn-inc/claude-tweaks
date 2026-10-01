# 0019. A vendored GIF codec, not a runtime dependency

- **Status:** accepted
- **Date:** 2026-09-22
- **Context:** #2758 (`/claude-tweaks:walkthrough` — a shareable animated GIF plus caption list from an executed story)

## Context

`/claude-tweaks:walkthrough` executes a schema-v2 story through Playwright CLI, captures one PNG screenshot per step, and has to turn that frame sequence into a single animated image a reader can drop into a PR body. Every general-purpose way to do that is a library call.

The payload cannot make one. Under ADR-0015 the plugin ships as the `plugin/` subtree, installed by a `git-subdir` marketplace source into a per-version cache. There is no `plugin/package.json`, there is no `plugin/node_modules`, and **nothing in the install path ever runs `npm install`** — the repo-root `package.json` is `"private": true` and describes itself as "test harness only; the plugin itself ships no runtime npm deps." An npm dependency is therefore not a costly option for this payload; it is an unavailable one. The runtime is Node's standard library: `zlib`, `fs`, `path`, `child_process`.

That constraint is the whole of the problem, and it is worth being precise about why it bites here specifically. The capability was adopted from the `djoef` plugin's `feature-demo` skill, whose implementation is explicitly *not* adoptable: it records video through the `playwright` npm library with four npm dependencies self-installed on first use. This plugin's relationship to browser automation is the opposite shape — an externally-installed CLI tool (Playwright CLI as of v6.128.0, #2645–#2649), capability-detected at the point of use, never a bundled dependency of the plugin itself.

So the real question was not "which GIF library" but "what does this payload do when it needs a binary format and cannot have a library." There was no prior art to follow: before this record, `plugin/bin/lib/` contained no vendored codec of any kind.

## Decision

**The payload owns the codec.** Four modules under `plugin/bin/lib/gif/` — `png-decode.js` (117 lines, PNG color types 0/2/6 via `zlib.inflateSync`), `palette.js` (116 lines, median-cut quantization to one global 256-entry palette), `lzw.js` (90 lines, GIF-variable-width LZW), and `encoder.js` (70 lines, GIF89a container with the NETSCAPE loop block) — 393 lines of production code, covered by 543 lines of `node --test` suites under `tests/bin-lib/gif/`.

The codec sits behind a single seam, `plugin/bin/lib/walkthrough/encode.js` (114 lines), which is the only caller. Captions ship as an ordered markdown list written beside the GIF, not rasterized into it.

## Alternatives considered

- **`gifenc`, or any npm dependency** — the obvious answer, and structurally unavailable rather than merely undesirable. With no `plugin/package.json` and no install step in the marketplace cache path, a `require` of a non-stdlib module resolves to nothing in an installed build. This is not a cost/benefit rejection; there is no price at which it becomes available while the install model stands.
- **Playwright's own video recording (the `djoef` route)** — would make a marketplace plugin install a browser engine, and reverses a deliberate removal already on record in this repo. Rejected on both counts.
- **Shell out to `ffmpeg` or ImageMagick** — the one genuinely available alternative, and the same shape as the plugin's existing optional-external-tool pattern (`gh`, Playwright CLI). Rejected because it makes the skill's entire output contingent on a heavyweight binary most users will not have, with no graceful degradation: a capability-detection miss here does not produce a lesser walkthrough, it produces none. This is the live reversal path, and the Consequences section below treats it as such rather than pretending the decision was forced.
- **APNG instead of GIF** — technically the cheapest option on the table, because `zlib` is already in the standard library: APNG needs no palette quantization and no LZW, which would have retired the two modules that went on to produce every defect listed below. Rejected on reach: GIF renders in PR bodies, chat clients, and docs tooling, while APNG support in chat clients is inconsistent, and a walkthrough that does not render where it is pasted has failed at its only job.
- **Burned-in captions** — rasterizing text into the frames needs either an image library (a native dependency, ruled out by the same constraint as above) or a vendored text rasterizer, which is more code than the encoder itself; injecting a caption banner into the page instead needs arbitrary JS evaluation, which Playwright CLI's documented operation set does not expose. Captions beside the GIF also degrade well when the GIF does not render at all.

## Consequences

**What it makes easy.** Zero install surface: the skill works on any platform Node runs on, with no capability probe, no second failure mode, and no version skew between what a user has installed and what the skill expects. The codec is testable and owned — when it is wrong, the fix is a commit in this repo rather than an upstream issue and a pin.

**What it cost, measured, in the first build.** This is the part of the trade-off that is not obvious in advance, and it is recorded here because the run that took the decision also paid it.

The LZW compressor's mid-stream table reset emitted its clear code at the **post-reset (narrow) width instead of the pre-reset (wide) width**, permanently desyncing the bitstream from that point on. Every real 1280x720 frame was undecodable partway through — the skill's headline output, corrupt in its normal case, not an edge case. The suite was green throughout. The test that claimed to cover the reset path peaked at table index **491 of the 4096 threshold**, so no reset ever occurred inside an assertion: the test pinned the existence of the branch without ever reaching the condition that activates it. It was caught only because a whole-branch reviewer hand-wrote a from-scratch GIF89a decoder and ran the build's own live output through it. Fixed at `41dc8424f` and independently re-verified against real screenshots: 4 mid-stream resets exercised across both frames, decoding bit-exact at 921,600/921,600 pixels with 0 mismatches, while the pre-fix output fails the same decoder with a bitstream underrun.

The median-cut quantizer is **distinct-color-count-bound, not pixel-bound**, which is the opposite of what its inputs suggest. On real UI screenshots it is fast — 58 ms at 1280x720. On an adversarial 8-frame 1280x720 gradient-plus-noise walkthrough with 259,895 distinct colors it took **482,135 ms and 1,336 MB RSS**. UI screenshots sit in the fast band at low thousands to tens of thousands of distinct colors; a walkthrough recorded over a photo-, map-, or video-heavy page lands on the cliff. The shipped perf regression test (400x300, 5000 ms budget, measuring 730 ms) does not bound this case, and closing it needs a color-count-based sampling or pre-bucketing strategy rather than a patch — deferred to the backlog rather than fixed in-run.

The generalizable lesson, and the reason both of these belong in the same record: owning a binary codec means owning correctness properties that small fixtures structurally cannot exercise. Both defects live past a threshold — a table index, a distinct-color count — that no hand-built test fixture naturally reaches.

**Reversibility.** Mechanically this is contained: the codec has exactly one caller, and `walkthrough-encode.js`'s flag surface, exit-code vocabulary and stdout shape would all survive a swap, so nothing outside the seam would notice. What is not reversible is the *direction*. The obvious retreat — take a dependency — is unavailable at any price while the install model stands, so a genuine reversal means requiring a new external binary of every walkthrough user: a user-visible capability requirement and a new way for the skill to produce nothing at all. Hard to reverse in the sense that matters here, which is that the reason for it does not expire on its own.

**Revisit if** the plugin ever gains a real install step (a `plugin/package.json` that something actually installs), which would make a dependency available for the first time and reopen the whole question; or if the quantizer's distinct-color cliff is hit by a real walkthrough rather than an adversarial fixture, which would turn a deferred backlog item into a correctness problem; or if GIF stops being the format with the widest render reach, at which point **APNG** becomes the better answer for the reason it was rejected on and would retire `palette.js` and `lzw.js` — the two modules that produced every defect in this record — in favor of `zlib`, which the payload already has.
