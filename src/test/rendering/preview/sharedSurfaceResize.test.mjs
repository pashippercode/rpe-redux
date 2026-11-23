/** Verify a shared GL surface keeps its own size instead of being resized per user. */
import assert from "node:assert/strict";
import test from "node:test";
import { WebGlRenderBackend } from "../../../frontend/screens/editor/canvas/renderBackend.ts";

function fakeCanvas(width, height) {
  const assignments = [];
  const canvas = { width, height, clientWidth: width, clientHeight: height };
  for (const key of ["width", "height"]) {
    let value = canvas[key];
    Object.defineProperty(canvas, key, {
      get: () => value,
      set: (next) => {
        assignments.push([key, next]);
        value = next;
      },
    });
  }
  canvas.getContext = () => ({ isContextLost: () => false, viewport() {} });
  canvas.addEventListener = () => {};
  canvas.removeEventListener = () => {};
  return { canvas, assignments };
}

test("adopt records the existing backing store without resizing it", () => {
  const { canvas, assignments } = fakeCanvas(865, 610);
  const backend = new WebGlRenderBackend(canvas);

  const frame = backend.adopt({ width: 865, height: 610 });

  assert.deepEqual(assignments, [], "adopting must not assign width or height");
  assert.equal(frame.width, 865);
  assert.equal(frame.height, 610);
  assert.equal(frame.ratio, 1);
});

test("adopt keeps a device-ratio backing store and reports its real ratio", () => {
  const { canvas, assignments } = fakeCanvas(1081, 763);
  const backend = new WebGlRenderBackend(canvas);

  const frame = backend.adopt({ width: 865, height: 610 });

  assert.deepEqual(assignments, []);
  assert.equal(frame.width, 1081);
  assert.equal(frame.height, 763);
  assert.equal(frame.ratio, 1081 / 865);
});

test("adopt refuses a canvas that has no backing store yet", () => {
  const { canvas } = fakeCanvas(0, 0);
  const backend = new WebGlRenderBackend(canvas);

  assert.equal(backend.adopt({ width: 865, height: 610 }), null);
});
