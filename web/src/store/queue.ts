export class Queue<T> {
  private items: T[] = [];
  private observers: ((item: T) => void)[] = [];

  enqueue(item: T): void {
    this.items.push(item);
    this.notifyObservers(item);
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  subscribe(observer: (item: T) => void): void {
    this.observers.push(observer);
  }

  unsubscribe(observer: (item: T) => void): void {
    const index = this.observers.indexOf(observer);
    if (index !== -1) {
      this.observers.splice(index, 1);
    }
  }

  private notifyObservers(item: T): void {
    for (const observer of this.observers) {
      observer(item);
    }
  }
}
