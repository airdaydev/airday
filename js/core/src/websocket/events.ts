// Claude one shot event emitter
// TODO: Review

type EventName = keyof EventMap;
type EventData<T extends EventName> = EventMap[T];
type EventCallback<T extends EventName> = (data: EventData<T>) => void;

export class EventEmitter<TEventMap extends Record<string, any> = EventMap> {
  private events: Partial<{
    [K in keyof TEventMap]: EventCallback<K & EventName>[];
  }> = {};

  // Add event listener with full type safety
  on<T extends keyof TEventMap>(
    eventName: T,
    callback: EventCallback<T & EventName>,
  ): void {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    this.events[eventName]!.push(callback);
  }

  // Remove event listener
  off<T extends keyof TEventMap>(
    eventName: T,
    callback: EventCallback<T & EventName>,
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
    callback: EventCallback<T & EventName>,
  ): void {
    const onceCallback = (data: TEventMap[T]) => {
      callback(data);
      this.off(eventName, onceCallback as EventCallback<T & EventName>);
    };
    this.on(eventName, onceCallback as EventCallback<T & EventName>);
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
