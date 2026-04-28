/**
 * A band-aid for a lack of a "touch-enter" event while needing
 * to respond to events from a Solid component context.
 * Node: Currently only support for one callback()
 */

class TouchBandaid {
  map = new Map<Element, () => void>();
  constructor() {}
  onTouchEnter(node: Element, func: () => void): () => void {
    const cb = this.map.get(node);
    if (cb) {
      console.warn("Attempted to overwrite TouchBandaid record");
      return () => this.map.delete(node);
    }
    this.map.set(node, func);
    return () => {
      this.map.delete(node);
    };
  }
  call(node: Element) {
    const cb = this.map.get(node);
    if (cb) cb();
  }
}

export const touchBandaid = new TouchBandaid();
