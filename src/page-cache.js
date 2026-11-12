/**
 * Rendered-page cache with a bounded size, in-flight de-duplication, and a
 * hook for the renderer to drop GPU textures when a page is evicted.
 *
 * Rendering is the slow part of a page turn (10-60 ms per page), so the cache
 * is what makes the motion feel instant: neighbours are rendered ahead of
 * time and a turn only waits when the reader outruns the prefetcher.
 */
export class PageCache {
  constructor(source, options = {}) {
    this.source = source;
    this.capacity = Math.max(2, options.capacity ?? 10);
    // Page bitmaps are the only thing here that grows without bound, and a page
    // on a large high-DPR screen can be over 20 MB. A count alone lets the cache
    // reach hundreds of megabytes, so size is capped as well.
    this.maxBytes = Math.max(8 * 1024 * 1024, options.maxBytes ?? 96 * 1024 * 1024);
    this.bytes = 0;
    this.maxWidth = options.maxWidth ?? 2048;
    this.minWidth = options.minWidth ?? 320;
    /** @type {Map<number, Entry>} insertion order doubles as LRU order */
    this.entries = new Map();
    this.inflight = new Map();
    this.listeners = new Set();
    this.onEvict = null;
    this._scaleKey = 0;
  }

  /** Bump when the viewer resizes enough that cached bitmaps are too small. */
  setTargetWidth(px) {
    const next = Math.round(Math.max(this.minWidth, Math.min(this.maxWidth, px)) / 128) * 128;
    if (next !== this._scaleKey) {
      this._scaleKey = next;
      // Everything already rasterised is at the old width; drop it lazily so
      // the pages on screen keep their textures until replaced.
      this.stale = new Set(this.entries.keys());
      this._prefetch = null;
    }
  }

  get targetWidth() {
    return this._scaleKey || this.minWidth;
  }

  /** Cached bitmap or null. Marks the entry as most recently used. */
  get(index) {
    const entry = this.entries.get(index);
    if (!entry) return null;
    this.entries.delete(index);
    this.entries.set(index, entry);
    return entry;
  }

  /** Cached bitmap that matches the current scale, or null. */
  getFresh(index) {
    const entry = this.get(index);
    if (!entry) return null;
    if (this.stale?.has(index)) return null;
    return entry;
  }

  has(index) {
    return this.entries.has(index);
  }

  /**
   * Render if needed. Resolves to the entry; resolves to an existing stale
   * entry rather than failing if a fresh render throws.
   */
  async ensure(index) {
    if (index < 0 || index >= this.source.numPages) return null;
    const fresh = this.getFresh(index);
    if (fresh) return fresh;

    const running = this.inflight.get(index);
    if (running) return running;

    const job = this._render(index).finally(() => {
      this.inflight.delete(index);
    });
    this.inflight.set(index, job);
    return job;
  }

  async _render(index) {
    const width = this.targetWidth;
    const tryRender = async () => {
      const rendered = await this.source.render(index, width, { maxPixels: this.maxWidth });
      const entry = {
        index,
        canvas: rendered.canvas,
        width: rendered.width,
        height: rendered.height,
        aspect: rendered.aspect,
        pageWidth: rendered.pageWidth,
        widthAtRender: width,
      };
      this._insert(entry);
      return entry;
    };

    try {
      return await tryRender();
    } catch (error) {
      // Keep whatever we had (a lower-resolution copy) so the turn still
      // works, and surface the failure for diagnostics.
      const previous = this.entries.get(index) ?? null;
      if (previous) {
        this.emit({ type: "error", index, error, recovered: true });
        return previous;
      }
      this.emit({ type: "error", index, error, recovered: false });
      throw error;
    }
  }

  _insert(entry) {
    const existing = this.entries.get(entry.index);
    if (existing && existing !== entry) this._evictEntry(existing);
    this.bytes += entry.canvas.width * entry.canvas.height * 4;
    this.stale?.delete(entry.index);
    this.entries.delete(entry.index);
    this.entries.set(entry.index, entry);
    this.emit({ type: "load", entry });
    this._trim();
  }

  _trim() {
    // Never evict the last entry: one oversized page must still be showable.
    while (this.entries.size > 1 && (this.entries.size > this.capacity || this.bytes > this.maxBytes)) {
      const oldestKey = this.entries.keys().next().value;
      const entry = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this._evictEntry(entry);
    }
  }

  _evictEntry(entry) {
    this.bytes = Math.max(0, this.bytes - entry.canvas.width * entry.canvas.height * 4);
    this.emit({ type: "evict", entry });
    this.onEvict?.(entry);
  }

  /** Render ahead, quietly, without blocking anything. */
  prefetch(indexes) {
    for (const index of indexes) {
      if (index < 0 || index >= this.source.numPages) continue;
      if (this.getFresh(index) || this.inflight.has(index)) continue;
      this.ensure(index).catch(() => {});
    }
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  clear() {
    for (const entry of this.entries.values()) this._evictEntry(entry);
    this.entries.clear();
    this.bytes = 0;
    this.stale?.clear();
  }
}
