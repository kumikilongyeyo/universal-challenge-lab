export class AdapterRegistry {
  #adapters = new Map();

  register(adapter) {
    if (!adapter?.id || typeof adapter.detect !== 'function' || typeof adapter.solve !== 'function') {
      throw new TypeError('Adapter must expose id, detect(), and solve().');
    }
    if (this.#adapters.has(adapter.id)) {
      throw new Error(`Adapter already registered: ${adapter.id}`);
    }
    this.#adapters.set(adapter.id, adapter);
    return this;
  }

  list() {
    return [...this.#adapters.values()];
  }

  get(id) {
    return this.#adapters.get(id);
  }
}
