/** Verify the shader composite forwards the frame's logical size to the pass. */
import assert from "node:assert/strict";
import test from "node:test";
import { ShaderCompositeRenderDevice } from "../../../frontend/screens/editor/workspace/preview/render/shaderCompositeRenderDevice.ts";

function recordingDevice() {
  const calls = [];
  const pipeline = {
    render(...args) {
      calls.push(args);
      return true;
    },
    dispose() {},
  };
  return { device: new ShaderCompositeRenderDevice(pipeline), calls };
}

const sourceCanvas = { width: 1288, height: 879 };
const targetCanvas = { width: 1030, height: 703 };
const passes = [{ shader: "bg", values: {}, global: true }];
const sourceFor = () => "void main() {}";

test("a composite packet hands the frame size to the pass", () => {
  const { device, calls } = recordingDevice();

  const rendered = device.render({
    sourceCanvas,
    targetCanvas,
    passes,
    seconds: 1.5,
    sourceFor,
    viewport: { left: 0, top: 0, width: 1030, height: 703, scale: 1 },
    sourceRevision: 7,
    overlayCanvas: null,
    inputLayer: null,
    frameSize: { width: 1030, height: 703 },
  });

  assert.equal(rendered, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][9], { width: 1030, height: 703 });
});

test("a composite packet without an input layer still forwards the frame size", () => {
  const { device, calls } = recordingDevice();

  device.render({
    sourceCanvas,
    targetCanvas,
    passes,
    seconds: 0,
    sourceFor,
    overlayCanvas: null,
    frameSize: { width: 1600, height: 900 },
  });

  assert.equal(calls[0][8], null, "the shared input layer slot stays empty");
  assert.deepEqual(calls[0][9], { width: 1600, height: 900 });
});

test("a packet without a frame size keeps the measuring fallback", () => {
  const { device, calls } = recordingDevice();

  device.render({ sourceCanvas, targetCanvas, passes, seconds: 0, sourceFor });

  assert.equal(calls[0][9], undefined);
});
