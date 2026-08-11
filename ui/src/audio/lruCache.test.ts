import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ByteBoundedLru } from "./lruCache.ts";

interface Item {
  bytes: number;
  id: string;
}

const sizeOf = (v: Item) => v.bytes;

test("ByteBoundedLru evicts oldest entry when capacity is exceeded", () => {
  const cache = new ByteBoundedLru<Item>({ maxBytes: 100, sizeOf });
  cache.set("a", { bytes: 40, id: "a" });
  cache.set("b", { bytes: 40, id: "b" });
  cache.set("c", { bytes: 40, id: "c" }); // total 120 > 100 → evict "a"

  assert.equal(cache.has("a"), false);
  assert.equal(cache.has("b"), true);
  assert.equal(cache.has("c"), true);
  assert.equal(cache.bytes, 80);
});

test("get() promotes the entry to most-recently-used", () => {
  const cache = new ByteBoundedLru<Item>({ maxBytes: 100, sizeOf });
  cache.set("a", { bytes: 40, id: "a" });
  cache.set("b", { bytes: 40, id: "b" });
  cache.get("a"); // "a" promoted, "b" is now oldest
  cache.set("c", { bytes: 40, id: "c" }); // total 120 → evict "b"

  assert.equal(cache.has("a"), true);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.has("c"), true);
});

test("set() replacing an existing key adjusts byte accounting", () => {
  const cache = new ByteBoundedLru<Item>({ maxBytes: 100, sizeOf });
  cache.set("a", { bytes: 40, id: "a" });
  cache.set("a", { bytes: 80, id: "a" });
  assert.equal(cache.bytes, 80);
  assert.equal(cache.size, 1);
});

test("clear() resets bytes and size", () => {
  const cache = new ByteBoundedLru<Item>({ maxBytes: 100, sizeOf });
  cache.set("a", { bytes: 40, id: "a" });
  cache.set("b", { bytes: 40, id: "b" });
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
});

test("delete() removes and adjusts bytes", () => {
  const cache = new ByteBoundedLru<Item>({ maxBytes: 100, sizeOf });
  cache.set("a", { bytes: 40, id: "a" });
  assert.equal(cache.delete("a"), true);
  assert.equal(cache.bytes, 0);
  assert.equal(cache.delete("missing"), false);
});

test("single entry larger than maxBytes still fits (best effort)", () => {
  const cache = new ByteBoundedLru<Item>({ maxBytes: 100, sizeOf });
  cache.set("big", { bytes: 200, id: "big" });
  // Cache exceeds budget momentarily but keeps the only entry; caller must
  // still be able to read it back.
  assert.equal(cache.has("big"), true);
});

test("strict budget mode refuses to retain an oversized entry", () => {
  const cache = new ByteBoundedLru<Item>({
    maxBytes: 100,
    sizeOf,
    retainOversizedEntry: false,
  });
  cache.set("small", { bytes: 40, id: "small" });
  cache.set("big", { bytes: 200, id: "big" });

  assert.equal(cache.has("small"), true);
  assert.equal(cache.has("big"), false);
  assert.equal(cache.bytes, 40);
});

test("throws on non-positive maxBytes", () => {
  assert.throws(() => new ByteBoundedLru<Item>({ maxBytes: 0, sizeOf }));
  assert.throws(() => new ByteBoundedLru<Item>({ maxBytes: -1, sizeOf }));
});
