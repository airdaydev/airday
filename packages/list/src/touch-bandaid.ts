/**
 * A band-aid for a lack of a "touch-enter" event while needing
 * to respond to events from a Solid component context.
 * Node: Currently only support for one callback()
 */

class TouchBandaid {
  map = new Map<HTMLElement, () => void>();
  constructor() {}
  onTouchEnter(node: HTMLElement, func: () => void): () => void {
    const cb = this.map.get(node);
    if (cb) {
      console.warn('Attempted to overwrite TouchBandaid record');
      return () => null;
    }
    this.map.set(node, func);
    return () => this.map.delete(node);
  }
  call(node: HTMLElement) {
    const cb = this.map.get(node);
    if (cb) cb();
  }
}

export const touchBandaid = new TouchBandaid();
