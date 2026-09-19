import crypto from 'node:crypto';

export const powAdapter = {
  id: 'sha256-pow-v1',
  detect(challenge) {
    return challenge.features?.algorithm === 'sha256' ? 0.99 : 0.01;
  },
  solve(challenge) {
    const { prefix, leadingZeros } = challenge.payload;
    const target = '0'.repeat(leadingZeros);
    let nonce = 0;
    let digest = '';
    do {
      digest = crypto.createHash('sha256').update(`${prefix}:${nonce}`).digest('hex');
      nonce += 1;
    } while (!digest.startsWith(target) && nonce < 2_000_000);

    const solved = digest.startsWith(target);
    return {
      success: solved,
      answer: { nonce: nonce - 1, digest },
      summary: solved ? `Found nonce after ${nonce.toLocaleString()} hashes.` : 'Hash budget exhausted.',
    };
  },
  validate(challenge, result) {
    if (!result?.success) return false;
    const digest = crypto
      .createHash('sha256')
      .update(`${challenge.payload.prefix}:${result.answer.nonce}`)
      .digest('hex');
    return digest === result.answer.digest && digest.startsWith('0'.repeat(challenge.payload.leadingZeros));
  },
};
