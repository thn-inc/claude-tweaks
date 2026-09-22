// plugin/bin/lib/walkthrough/encode.js — frame delay planning, decode/downscale/quantize/encode
// pipeline, budget enforcement, and caption rendering for /claude-tweaks:walkthrough (#2758).
'use strict';

const fs = require('fs');
const { decodePng } = require('../gif/png-decode');
const { quantize } = require('../gif/palette');
const { encodeGif } = require('../gif/encoder');

class FrameMismatchError extends Error {
  constructor(message) { super(message); this.name = 'FrameMismatchError'; }
}
class BudgetExceededError extends Error {
  constructor(bytes, budgetBytes, levers) {
    super(`encoded GIF is ${bytes} bytes, over the ${budgetBytes}-byte budget`);
    this.name = 'BudgetExceededError';
    this.bytes = bytes; this.budgetBytes = budgetBytes; this.levers = levers;
  }
}

// stepCount -> one delay entry per step, centiseconds (GIF's native delay unit). The last step
// — including the only step when stepCount === 1 — holds longer so the loop doesn't snap away.
function planFrames(stepCount, { delayMs = 2000, lastHoldMs = 4000 } = {}) {
  const plan = [];
  for (let i = 0; i < stepCount; i++) {
    const isLast = i === stepCount - 1;
    plan.push({ delayCs: Math.round((isLast ? lastHoldMs : delayMs) / 10) });
  }
  return plan;
}

// Nearest-neighbor downscale of an RGBA buffer to targetWidth x targetHeight.
function downscaleNearest(rgba, srcW, srcH, targetW, targetH) {
  const out = new Uint8Array(targetW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / targetH));
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / targetW));
      const si = (sy * srcW + sx) * 4, di = (y * targetW + x) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

function encodeWalkthrough({ framePaths, delays, width, budgetBytes }, deps = {}) {
  const readFile = deps.readFile || fs.readFileSync;
  const decoded = framePaths.map((p) => ({ path: p, ...decodePng(readFile(p)) }));

  const first = decoded[0];
  for (let i = 1; i < decoded.length; i++) {
    const f = decoded[i];
    if (f.width !== first.width || f.height !== first.height) {
      throw new FrameMismatchError(
        `frame dimension mismatch: ${first.path} is ${first.width}x${first.height}, ${f.path} is ${f.width}x${f.height}`,
      );
    }
  }

  let targetW = first.width, targetH = first.height, downscaled = false;
  if (width && width < first.width) {
    targetW = width;
    targetH = Math.round((first.height * width) / first.width);
    downscaled = true;
  }

  const frameRgbas = decoded.map((f) => (
    downscaled ? downscaleNearest(f.rgba, f.width, f.height, targetW, targetH) : f.rgba
  ));

  const { palette, index } = quantize(frameRgbas, 256);
  const gifFrames = frameRgbas.map((rgba, i) => ({ indexes: index(rgba), delayCs: delays[i] }));
  const buffer = encodeGif({ width: targetW, height: targetH, frames: gifFrames, palette, loop: 0 });

  if (buffer.length > budgetBytes) {
    const levers = ['fewer steps', `lower --width (current ${targetW}px)`];
    throw new BudgetExceededError(buffer.length, budgetBytes, levers);
  }

  return { buffer, bytes: buffer.length, width: targetW, height: targetH, downscaled };
}

// A story-step locator -> its display form for the fallback caption line when a locator exists
// but the step carries no `caption` field. 'locator=?' is reserved for a genuinely unparseable
// locator object (present but naming none of the five known keys) — never a stand-in for "this
// action has no locator at all" (see stepDisplay below, which handles that case correctly).
function locatorDisplay(locator) {
  if (locator.role) return locator.name ? `role=${locator.role} "${locator.name}"` : `role=${locator.role}`;
  if (locator.testid) return `testid="${locator.testid}"`;
  if (locator.text) return `text="${locator.text}"`;
  if (locator.label) return `label="${locator.label}"`;
  if (locator.placeholder) return `placeholder="${locator.placeholder}"`;
  return 'locator=?';
}

// A story step -> its caption-line display text when the step carries no `caption` field.
// `navigate` and `press` steps never carry a `locator` (per qa-agent.md Section 4's own
// mapping) — falling through to locatorDisplay({}) for them would always render the
// unparseable-locator sentinel for an action that simply has a different kind of target, which
// is the wrong signal. Prefer, in order: a real locator (the common case — click/fill/etc.);
// else a navigate step's `target` URL; else a press step's `value` (the key/combo); else the
// bare action name.
function stepDisplay(step) {
  if (step.locator) return `${step.action} ${locatorDisplay(step.locator)}`;
  if (step.target !== undefined) return `${step.action} ${step.target}`;
  if (step.value !== undefined) return `${step.action} "${step.value}"`;
  return step.action;
}

function captionList(steps) {
  const lines = steps.map((step, i) => {
    const text = step.caption ? step.caption : stepDisplay(step);
    return `${i + 1}. ${text}`;
  });
  return lines.join('\n') + '\n';
}

module.exports = { planFrames, encodeWalkthrough, captionList, FrameMismatchError, BudgetExceededError };
