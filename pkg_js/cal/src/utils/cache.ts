export class CacheEntry<T> {
  data: T;
  fresh: boolean = true;
  pending = false;
  constructor(data: T) {
    this.data = data;
  }
  markStale() {
    this.fresh = false;
  }
  markPending() {
    this.pending = true;
  }
}
