export class Store {
  constructor(initialState) {
    this.state = initialState;
    this.listeners = new Set();
    this.dirty = false;
    this.projectDir = null;
  }

  getState() {
    return this.state;
  }

  replaceState(newState, { markDirty = false } = {}) {
    this.state = newState;
    this.dirty = markDirty;
    this.emit({ type: 'replace' });
  }

  markDirty() {
    this.dirty = true;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(patch) {
    for (const fn of this.listeners) {
      try {
        fn(patch, this.state);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    }
  }
}
