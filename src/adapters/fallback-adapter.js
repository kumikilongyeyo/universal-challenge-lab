export const fallbackAdapter = {
  id: 'fixture-fallback-v1',
  detect(challenge) {
    return challenge?.type ? 0.16 : 0;
  },
  solve(challenge) {
    return { success: false, summary: `No generic solution for ${challenge.type}.` };
  },
  validate() {
    return false;
  },
};
