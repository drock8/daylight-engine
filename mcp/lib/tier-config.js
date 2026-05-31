"use strict";

const TIER_LEVELS = Object.freeze({
  TIER_0: 0,
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
});

const TIER_LEVEL_VALUES = Object.freeze([0, 1, 2, 3]);

const TIER_PHASES = Object.freeze({
  0: ["RECON"],
  1: ["RECON", "HUNT", "VERIFY", "GRADE", "REPORT"],
  2: ["RECON", "AUTH", "HUNT", "CHAIN", "VERIFY", "GRADE", "REPORT"],
  3: ["RECON", "AUTH", "HUNT", "CHAIN", "VERIFY", "GRADE", "REPORT", "EXPLORE"],
});

const TIER_WAVE_LIMITS = Object.freeze({
  0: 0,
  1: 1,
  2: Infinity,
  3: Infinity,
});

const TIER_VERIFICATION_ROUNDS = Object.freeze({
  0: 0,
  1: 1,
  2: 1,
  3: 3,
});

function tierPhasesAvailable(tierLevel) {
  return TIER_PHASES[tierLevel] || TIER_PHASES[3];
}

function tierWaveLimit(tierLevel) {
  const limit = TIER_WAVE_LIMITS[tierLevel];
  return limit == null ? TIER_WAVE_LIMITS[3] : limit;
}

function tierVerificationRounds(tierLevel) {
  const rounds = TIER_VERIFICATION_ROUNDS[tierLevel];
  return rounds == null ? TIER_VERIFICATION_ROUNDS[3] : rounds;
}

function isPhaseAllowedForTier(phase, tierLevel) {
  return tierPhasesAvailable(tierLevel).includes(phase);
}

module.exports = {
  TIER_LEVELS,
  TIER_LEVEL_VALUES,
  TIER_PHASES,
  TIER_VERIFICATION_ROUNDS,
  TIER_WAVE_LIMITS,
  isPhaseAllowedForTier,
  tierPhasesAvailable,
  tierVerificationRounds,
  tierWaveLimit,
};
