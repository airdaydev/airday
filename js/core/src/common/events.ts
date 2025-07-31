// Claude one shot event emitter
// TODO: Review

export class EventEmitter<
  TEventMap extends Record<string, any> = Record<string, any>,
> {
  private events: Partial<{
    [K in keyof TEventMap]: ((data: TEventMap[K]) => void)[];
  }> = {};

  // Add event listener with full type safety
  on<T extends keyof TEventMap>(
    eventName: T,
    callback: (data: TEventMap[T]) => void,
  ): void {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    this.events[eventName]!.push(callback);
  }

  // Remove event listener
  off<T extends keyof TEventMap>(
    eventName: T,
    callback: (data: TEventMap[T]) => void,
  ): void {
    if (!this.events[eventName]) return;
    this.events[eventName] = this.events[eventName]!.filter(
      (cb) => cb !== callback,
    );
  }

  // Emit event with type-safe data
  emit<T extends keyof TEventMap>(eventName: T, data: TEventMap[T]): void {
    if (!this.events[eventName]) return;
    this.events[eventName]!.forEach((callback) => {
      callback(data);
    });
  }

  // One-time listener
  once<T extends keyof TEventMap>(
    eventName: T,
    callback: (data: TEventMap[T]) => void,
  ): void {
    const onceCallback = (data: TEventMap[T]) => {
      callback(data);
      this.off(eventName, onceCallback);
    };
    this.on(eventName, onceCallback);
  }

  // Remove all listeners for an event
  removeAllListeners<T extends keyof TEventMap>(eventName?: T): void {
    if (eventName) {
      delete this.events[eventName];
    } else {
      this.events = {};
    }
  }

  // Get listener count
  listenerCount<T extends keyof TEventMap>(eventName: T): number {
    return this.events[eventName]?.length ?? 0;
  }

  // List all event names that have listeners
  eventNames(): (keyof TEventMap)[] {
    return Object.keys(this.events) as (keyof TEventMap)[];
  }
}
