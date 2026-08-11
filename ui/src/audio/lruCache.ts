/**
 * Byte-bounded LRU cache.
 *
 * Insertion order in `Map` is the LRU order (least-recently-used first).
 * Accessing a value promotes it to most-recently-used. When the total size
 * exceeds `maxBytes`, the oldest entries are evicted until it fits.
 *
 * Used to cap runtime PCM caches. Without a cap these maps grow monotonically
 * for the lifetime of the project (`spec-public/05` § "cache invalidation") and can
 * accumulate hundreds of MB of Float32 buffers across a long editing session.
 */
export interface ByteSizedLruEntry {
  readonly bytes: number;
}

export class ByteBoundedLru<V> {
  private readonly map = new Map<string, V>();
  private readonly sizeOf: (value: V) => number;
  private readonly maxBytes: number;
  private readonly retainOversizedEntry: boolean;
  private currentBytes = 0;

  constructor(options: {
    maxBytes: number;
    sizeOf: (value: V) => number;
    retainOversizedEntry?: boolean;
  }) {
    if (!(options.maxBytes > 0)) {
      throw new Error(`ByteBoundedLru: maxBytes must be positive, got ${options.maxBytes}`);
    }
    this.maxBytes = options.maxBytes;
    this.sizeOf = options.sizeOf;
    this.retainOversizedEntry = options.retainOversizedEntry ?? true;
  }

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.currentBytes;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Promote to most-recently-used: re-insert.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      const previous = this.map.get(key)!;
      this.currentBytes -= this.sizeOf(previous);
      this.map.delete(key);
    }
    const valueBytes = this.sizeOf(value);
    if (!this.retainOversizedEntry && valueBytes > this.maxBytes) {
      return;
    }
    this.map.set(key, value);
    this.currentBytes += valueBytes;
    // Preserve the just-inserted entry when evicting — a single oversized
    // buffer must still be readable to the caller that just wrote it.
    this.evictOldestUntilFits(key);
  }

  delete(key: string): boolean {
    const value = this.map.get(key);
    if (value === undefined) return false;
    this.currentBytes -= this.sizeOf(value);
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.currentBytes = 0;
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  private evictOldestUntilFits(protectedKey: string): void {
    if (this.currentBytes <= this.maxBytes) return;
    for (const oldestKey of Array.from(this.map.keys())) {
      if (this.currentBytes <= this.maxBytes) break;
      if (oldestKey === protectedKey) continue;
      const value = this.map.get(oldestKey);
      if (value === undefined) continue;
      this.currentBytes -= this.sizeOf(value);
      this.map.delete(oldestKey);
    }
  }
}
