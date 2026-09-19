export const textAdapter = {
  id: 'text-transform-v1',
  detect(challenge) {
    if (challenge.features?.modality !== 'text') return 0.03;
    const noisePenalty = (challenge.features.noise ?? 0) * 0.25;
    return Math.max(0.1, 0.94 - noisePenalty);
  },
  solve(challenge) {
    const { encoded } = challenge.payload;
    const shift = challenge.features.shift;
    const decoded = [...encoded].map((ch) => String.fromCharCode(ch.charCodeAt(0) - shift)).join('');
    return { success: true, answer: decoded, summary: `Decoded ${encoded.length} transformed characters.` };
  },
  validate(challenge, result) {
    return result.answer === challenge.payload.expected;
  },
};
