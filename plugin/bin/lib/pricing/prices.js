'use strict';
// plugin/bin/lib/pricing/prices.js — the list-price table and the per-request pricer (moved from
// the maintainer-side cost report's spend module, #5914; #6009).
//
// Prices are dollars per million tokens, dated PRICES.date. Each family lists
// [input, output, cache read, 5-minute cache write, 1-hour cache write]. An unrecognised model id is `unpriced`:
// returned with zero cost, never priced.
//
// priceRequest prices one model request (Haiku requests over HAIKU_LONG_PROMPT prompt tokens cost
// HAIKU_LONG_MULTIPLIER times the base rates). priceAggregate prices a whole-session aggregate at the base
// rates with no long-prompt multiplier: the per-request threshold means nothing for summed usage.

const PRICES = {
  date: '2026-11-03',
  families: {
    fable: [8, 40, 0.2, 10, 16],
    opus: [4, 20, 0.2, 5, 8],
    sonnet: [2, 10, 0.1, 2.5, 4],
    haiku: [0.1, 0.5, 0.01, 0.125, 0.2],
  },
};

const HAIKU_LONG_PROMPT = 100000;
const HAIKU_LONG_MULTIPLIER = 5;

function familyOf(modelId) {
  const id = typeof modelId === 'string' ? modelId : '';
  for (const family of Object.keys(PRICES.families)) if (id.includes(family)) return family;
  return 'unpriced';
}

// u: { model, input, output, cacheRead, cacheWrite5m, cacheWrite1h } -> { usd, cacheWriteUsd, prompt, family }
// `multiplier(family, prompt)` gives the factor applied to every rate.
function price(u, multiplier) {
  const family = familyOf(u.model);
  const prompt = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
  if (family === 'unpriced') return { usd: 0, cacheWriteUsd: 0, prompt, family };
  const [pIn, pOut, pRead, pW5, pW1] = PRICES.families[family];
  const k = multiplier(family, prompt);
  const cacheWriteUsd = ((u.cacheWrite5m * pW5 + u.cacheWrite1h * pW1) * k) / 1e6;
  const usd = ((u.input * pIn + u.output * pOut + u.cacheRead * pRead) * k) / 1e6 + cacheWriteUsd;
  return { usd, cacheWriteUsd, prompt, family };
}

function priceRequest(u) {
  return price(u, (family, prompt) => (family === 'haiku' && prompt > HAIKU_LONG_PROMPT ? HAIKU_LONG_MULTIPLIER : 1));
}

function priceAggregate(u) {
  return price(u, () => 1);
}

module.exports = { PRICES, HAIKU_LONG_PROMPT, HAIKU_LONG_MULTIPLIER, familyOf, priceRequest, priceAggregate };
