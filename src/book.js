/**
 * Book model: which pages sit on which spread, and which sheet moves when the
 * reader turns a page. Pure arithmetic, no DOM.
 *
 * Double mode follows a real book's binding:
 *   spread 0        [null, page 0]      (cover alone on the right)
 *   spread s >= 1   [page 2s-1, page 2s]
 *   sheet k         front page 2k, back page 2k+1
 *
 * Single mode shows one page at a time:
 *   spread s        [null, page s]
 *   sheet k         front page k, back page k+1
 */
export class BookModel {
  constructor(pageCount, options = {}) {
    if (!Number.isFinite(pageCount) || pageCount < 0) {
      throw new TypeError("pageCount must be a non-negative number");
    }
    this.pageCount = Math.floor(pageCount);
    this.mode = options.mode === "single" ? "single" : "double";
  }

  get isSingle() {
    return this.mode === "single";
  }

  /** Number of visible states the reader can be in. */
  get spreadCount() {
    if (this.pageCount === 0) return 0;
    if (this.isSingle) return this.pageCount;
    return Math.floor(this.pageCount / 2) + 1;
  }

  get lastSpread() {
    return Math.max(0, this.spreadCount - 1);
  }

  /** [leftPage, rightPage] page indexes, or null where the half is empty. */
  spreadPages(spread) {
    const s = clampSpread(spread, this.spreadCount);
    if (s === null) return null;
    if (this.isSingle) {
      return [null, s < this.pageCount ? s : null];
    }
    if (s === 0) return [null, this.pageCount > 0 ? 0 : null];
    const left = 2 * s - 1;
    const right = 2 * s;
    return [
      left < this.pageCount ? left : null,
      right < this.pageCount ? right : null,
    ];
  }

  /** Spread that shows a given page index. */
  spreadOfPage(page) {
    if (this.pageCount === 0) return 0;
    const p = Math.min(Math.max(0, page | 0), this.pageCount - 1);
    if (this.isSingle) return p;
    return p === 0 ? 0 : Math.floor((p + 1) / 2);
  }

  canGo(spread, direction) {
    const target = spread + direction;
    return target >= 0 && target <= this.lastSpread;
  }

  /**
   * Everything one turn needs: the moving sheet, plus the static pages that
   * stay visible underneath on each side. Page indexes or null.
   */
  turn(spread, direction) {
    const dir = direction < 0 ? -1 : 1;
    if (!this.canGo(spread, dir)) return null;

    let front;
    if (this.isSingle) {
      front = dir > 0 ? spread : spread - 1;
    } else {
      front = dir > 0 ? 2 * spread : 2 * (spread - 1);
    }
    const back = front + 1;
    const current = this.spreadPages(spread);
    const target = this.spreadPages(spread + dir);

    return {
      dir,
      from: spread,
      to: spread + dir,
      sheet: {
        front: front < this.pageCount ? front : null,
        back: back < this.pageCount ? back : null,
      },
      // The side we are leaving keeps its outside page; the side we are
      // arriving at already shows its outside page beneath the sheet.
      left: dir > 0 ? current[0] : target[0],
      right: dir > 0 ? target[1] : current[1],
    };
  }
}

function clampSpread(spread, count) {
  if (count <= 0) return null;
  const s = Math.min(Math.max(0, Math.trunc(spread) || 0), count - 1);
  return s;
}

/**
 * Human page label for the indicator, 1-based. "3" or "4-5" or "12".
 * Empty string when the spread is blank.
 */
export function spreadLabel(spreadPages) {
  if (!spreadPages) return "";
  const [l, r] = spreadPages;
  if (l === null && r === null) return "";
  if (l === null) return String(r + 1);
  if (r === null) return String(l + 1);
  return `${l + 1}-${r + 1}`;
}
