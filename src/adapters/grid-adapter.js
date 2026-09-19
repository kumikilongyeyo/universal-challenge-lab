export const gridAdapter = {
  id: 'semantic-grid-v1',
  detect(challenge) {
    if (challenge.features?.modality !== 'grid') return 0.02;
    const sizePenalty = challenge.features.gridSize > 9 ? 0.08 : 0;
    return 0.92 - sizePenalty - (challenge.features.noise ?? 0) * 0.12;
  },
  solve(challenge) {
    const selected = challenge.payload.tiles
      .filter((tile) => tile.label === challenge.payload.target)
      .map((tile) => tile.id);
    return { success: true, answer: selected, summary: `Selected ${selected.length} matching fixture tiles.` };
  },
  validate(challenge, result) {
    return JSON.stringify(result.answer) === JSON.stringify(challenge.payload.expected);
  },
};
