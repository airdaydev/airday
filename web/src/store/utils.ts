export class Debouncer {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private functions: Set<() => void> = new Set();
  debounceTime: number;

  constructor(debounceTime: number = 300) {
    this.debounceTime = debounceTime;
  }

  add(fn: () => void) {
    this.functions.add(fn);
    this.debounce();
    return fn;
  }

  remove(fn?: () => void): void {
    if (fn) this.functions.delete(fn);
  }

  private debounce(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }

    this.timerId = setTimeout(() => {
      this.functions.forEach((fn) => fn());
      this.functions.clear();
      this.timerId = null;
    }, this.debounceTime); // Adjust debounce delay as needed
  }
}
