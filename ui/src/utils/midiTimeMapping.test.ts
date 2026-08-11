import assert from "node:assert/strict";
import test from "node:test";
import {
  contentTickFromProjectTick,
  projectTickFromContentTick,
} from "./midiTimeMapping.ts";

test("project ticks map into content ticks using clip start and content_in", () => {
  assert.equal(
    contentTickFromProjectTick({
      projectTick: 1240,
      clipStart: 1000,
      contentIn: 480,
    }),
    720,
  );
});

test("content ticks map back into project ticks with the inverse transform", () => {
  assert.equal(
    projectTickFromContentTick({
      contentTick: 720,
      clipStart: 1000,
      contentIn: 480,
    }),
    1240,
  );
});
