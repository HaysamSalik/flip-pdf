import test from "node:test";
import assert from "node:assert/strict";
import { BookModel, spreadLabel } from "../src/book.js";

test("double mode pairs pages, with the cover alone on the right", () => {
  const book = new BookModel(12, { mode: "double" });
  assert.equal(book.spreadCount, 7);
  assert.deepEqual(book.spreadPages(0), [null, 0]);
  assert.deepEqual(book.spreadPages(1), [1, 2]);
  assert.deepEqual(book.spreadPages(6), [11, null]);
});

test("the last spread keeps a page that has no facing partner", () => {
  const odd = new BookModel(11, { mode: "double" });
  assert.equal(odd.spreadCount, 6);
  assert.deepEqual(odd.spreadPages(5), [9, 10]);
  const one = new BookModel(1, { mode: "double" });
  assert.equal(one.spreadCount, 1);
  assert.deepEqual(one.spreadPages(0), [null, 0]);
});

test("an empty document has no spreads", () => {
  const empty = new BookModel(0);
  assert.equal(empty.spreadCount, 0);
  assert.equal(empty.lastSpread, 0);
  assert.equal(empty.spreadPages(0), null);
});

test("single mode shows one page per spread", () => {
  const book = new BookModel(5, { mode: "single" });
  assert.equal(book.spreadCount, 5);
  assert.deepEqual(book.spreadPages(0), [null, 0]);
  assert.deepEqual(book.spreadPages(4), [null, 4]);
});

test("spreadOfPage is the inverse of spreadPages", () => {
  for (const mode of ["double", "single"]) {
    const book = new BookModel(12, { mode });
    for (let page = 0; page < book.pageCount; page++) {
      const spread = book.spreadOfPage(page);
      const pages = book.spreadPages(spread);
      assert.ok(pages.includes(page), `${mode}: page ${page} not on spread ${spread}`);
    }
  }
});

test("a forward turn lifts the sheet that owns the right page", () => {
  const book = new BookModel(12, { mode: "double" });
  const turn = book.turn(1, 1);
  assert.equal(turn.dir, 1);
  assert.equal(turn.from, 1);
  assert.equal(turn.to, 2);
  assert.deepEqual(turn.sheet, { front: 2, back: 3 });
  // The page that stays visible on the left is the current left page; the one
  // revealed on the right is the next spread's right page.
  assert.equal(turn.left, 1);
  assert.equal(turn.right, 4);
});

test("a backward turn uses the sheet one step earlier", () => {
  const book = new BookModel(12, { mode: "double" });
  const turn = book.turn(3, -1);
  assert.equal(turn.dir, -1);
  assert.equal(turn.to, 2);
  assert.deepEqual(turn.sheet, { front: 4, back: 5 });
  // Leaving the left page reveals nothing new there; the right page stays.
  assert.equal(turn.left, 3);
  assert.equal(turn.right, 6);
});

test("turning the cover reveals the first inside spread", () => {
  const book = new BookModel(4, { mode: "double" });
  const turn = book.turn(0, 1);
  assert.deepEqual(turn.sheet, { front: 0, back: 1 });
  assert.equal(turn.left, null);
  assert.equal(turn.right, 2);
});

test("turning beyond either end is refused", () => {
  const book = new BookModel(6, { mode: "double" });
  assert.equal(book.canGo(0, -1), false);
  assert.equal(book.lastSpread, 3);
  assert.equal(book.canGo(3, 1), false);
  assert.equal(book.turn(0, -1), null);
  assert.equal(book.turn(3, 1), null);
});

test("turns never reference a page outside the document", () => {
  for (const count of [1, 2, 3, 7, 8]) {
    for (const mode of ["double", "single"]) {
      const book = new BookModel(count, { mode });
      for (let s = 0; s < book.spreadCount; s++) {
        for (const dir of [1, -1]) {
          const turn = book.turn(s, dir);
          if (!turn) continue;
          for (const page of [turn.sheet.front, turn.sheet.back, turn.left, turn.right]) {
            assert.ok(page === null || (page >= 0 && page < count), `${count}/${mode} spread ${s} dir ${dir} -> ${page}`);
          }
        }
      }
    }
  }
});

test("spreadLabel prints the visible page numbers", () => {
  assert.equal(spreadLabel([1, 2]), "2-3");
  assert.equal(spreadLabel([null, 0]), "1");
  assert.equal(spreadLabel([11, null]), "12");
  assert.equal(spreadLabel([null, null]), "");
  assert.equal(spreadLabel(null), "");
});

test("a non-numeric page count is rejected", () => {
  assert.throws(() => new BookModel("twelve"), TypeError);
  assert.throws(() => new BookModel(-1), TypeError);
});
