// Fixed-capacity ring buffer: O(1) push via head/tail indices (no Array.shift reindexing).
export class CircularBuffer<T> {
  private readonly values: T[];
  private head = 0; // index of the oldest element
  private size = 0;

  constructor(private readonly capacity: number) {
    this.values = new Array<T>(Math.max(1, capacity));
  }

  public push(item: T): void {
    const tail = (this.head + this.size) % this.capacity;
    this.values[tail] = item;
    if (this.size < this.capacity) {
      this.size += 1;
    } else {
      // Full: overwrite oldest and advance head — no shift.
      this.head = (this.head + 1) % this.capacity;
    }
  }

  public snapshot(): T[] {
    const out: T[] = new Array<T>(this.size);
    for (let i = 0; i < this.size; i += 1) {
      out[i] = this.values[(this.head + i) % this.capacity]!;
    }
    return out;
  }

  public clear(): void {
    this.head = 0;
    this.size = 0;
  }
}
