import crypto from 'node:crypto';

const WORDS = ['ORBIT', 'EMBER', 'MANGO', 'RIVER', 'PIXEL', 'NOVA'];
const OBJECTS = ['cat', 'tree', 'car', 'lamp', 'book'];

function id() {
  return crypto.randomUUID();
}

export function generateChallenge(type = 'random', mutation = 0) {
  const chosen = type === 'random'
    ? ['text-transform', 'semantic-grid', 'slider-geometry', 'proof-of-work'][Math.floor(Math.random() * 4)]
    : type;

  switch (chosen) {
    case 'text-transform': {
      const word = WORDS[Math.floor(Math.random() * WORDS.length)];
      const shift = 1 + Math.min(8, Math.floor(mutation * 8));
      const encoded = [...word].map((ch) => String.fromCharCode(ch.charCodeAt(0) + shift)).join('');
      return {
        id: id(), type: chosen, difficulty: 0.2 + mutation * 0.6,
        features: { modality: 'text', transform: 'caesar', shift, noise: mutation },
        payload: { encoded, expected: word },
      };
    }
    case 'semantic-grid': {
      const target = OBJECTS[Math.floor(Math.random() * OBJECTS.length)];
      const tiles = Array.from({ length: mutation > 0.55 ? 16 : 9 }, (_, i) => ({
        id: i,
        label: Math.random() < 0.36 ? target : OBJECTS[Math.floor(Math.random() * OBJECTS.length)],
      }));
      const expected = tiles.filter((t) => t.label === target).map((t) => t.id);
      return {
        id: id(), type: chosen, difficulty: 0.25 + mutation * 0.5,
        features: { modality: 'grid', gridSize: tiles.length, semanticLabels: true, noise: mutation },
        payload: { target, tiles, expected },
      };
    }
    case 'slider-geometry': {
      const width = 280 + Math.floor(mutation * 220);
      const targetX = 40 + Math.floor(Math.random() * (width - 80));
      const jitter = Math.floor(mutation * 8);
      return {
        id: id(), type: chosen, difficulty: 0.3 + mutation * 0.5,
        features: { modality: 'geometry', width, jitter, noise: mutation },
        payload: { width, targetX, tolerance: Math.max(2, 6 - Math.floor(mutation * 3)) },
      };
    }
    case 'proof-of-work': {
      const zeros = mutation > 0.7 ? 4 : mutation > 0.3 ? 3 : 2;
      const prefix = crypto.randomBytes(5).toString('hex');
      return {
        id: id(), type: chosen, difficulty: zeros / 5,
        features: { modality: 'compute', algorithm: 'sha256', leadingZeros: zeros },
        payload: { prefix, leadingZeros: zeros },
      };
    }
    default:
      throw new Error(`Unknown challenge type: ${chosen}`);
  }
}
