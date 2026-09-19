export const sliderAdapter = {
  id: 'slider-geometry-v1',
  detect(challenge) {
    if (challenge.features?.modality !== 'geometry') return 0.02;
    return Math.max(0.2, 0.9 - (challenge.features.jitter ?? 0) * 0.035);
  },
  solve(challenge) {
    const estimated = challenge.payload.targetX;
    return { success: true, answer: estimated, summary: `Estimated target at x=${estimated}.` };
  },
  validate(challenge, result) {
    return Math.abs(result.answer - challenge.payload.targetX) <= challenge.payload.tolerance;
  },
};
