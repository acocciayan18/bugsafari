export class CircularBuffer<T> {
  private readonly values: T[] = [];

  constructor(private readonly capacity: number) {}

  public push(item: T): void {
    this.values.push(item);
    if (this.values.length > this.capacity) {
      this.values.shift();
    }
  }

  public snapshot(): T[] {
    return [...this.values];
  }

  public clear(): void {
    this.values.length = 0;
  }
}
