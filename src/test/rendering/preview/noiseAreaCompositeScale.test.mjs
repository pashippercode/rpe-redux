import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("?raw")) {
      return nextResolve(specifier.slice(0, -4), context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/noiseField/config.json")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`,
      };
    }
    if (url.endsWith(".glsl")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url), "utf8"))};`,
      };
    }
    if (url.endsWith(".png")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(url)};`,
      };
    }
    return nextLoad(url, context);
  },
});

const { TempoMap } = await import("../../../core/global/chart/timing/tempo.ts");
const { noiseSourceSlice } =
  await import("../../../frontend/screens/editor/workspace/preview/render/noiseGeometry.ts");
const { NoiseAreaRenderer } =
  await import("../../../frontend/screens/editor/workspace/preview/render/noiseAreaRenderer.ts");

function fakePath2D() {
  return class FakePath2D {
    moveTo() {}
    lineTo() {}
    closePath() {}
  };
}

function withGlobals(devicePixelRatio, run) {
  const previousDocument = globalThis.document;
  const previousRatio = globalThis.devicePixelRatio;
  const previousPath2D = globalThis.Path2D;
  const created = [];
  globalThis.devicePixelRatio = devicePixelRatio;
  globalThis.Path2D = fakePath2D();
  globalThis.document = {
    createElement() {
      const draws = [];
      const canvas = {
        width: 300,
        height: 150,
        draws,
        getContext() {
          return {
            canvas,
            globalCompositeOperation: "source-over",
            globalAlpha: 1,
            fillStyle: "#000",
            strokeStyle: "#000",
            lineWidth: 1,
            setTransform() {},
            clearRect() {},
            save() {},
            restore() {},
            clip() {},
            fill() {},
            stroke() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            drawImage(...args) {
              draws.push(args);
            },
          };
        },
      };
      created.push(canvas);
      return canvas;
    },
  };
  try {
    return run(created);
  } finally {
    globalThis.document = previousDocument;
    globalThis.devicePixelRatio = previousRatio;
    globalThis.Path2D = previousPath2D;
  }
}

function makeFrame(width, height, viewport) {
  const tempo = new TempoMap([{ startTime: [0, 0, 1], bpm: 120 }]);
  return {
    chart: {
      BPMList: [{ startTime: [0, 0, 1], bpm: 120 }],
      judgeLineList: [],
      blockAreaList: [
        {
          bottomLeft: { x: -200, y: -100 },
          topRight: { x: 200, y: 100 },
          appearTime: [0, 0, 1],
          disappearTime: [10, 0, 1],
          activeIntervals: [{ startTime: [0, 0, 1], endTime: [10, 0, 1] }],
          moveXEvents: [],
          moveYEvents: [],
          rotateEvents: [],
          scaleXEvents: [],
          scaleYEvents: [],
        },
      ],
    },
    tempo,
    seconds: 1,
    width,
    height,
    viewport,
    centerX: width / 2,
    centerY: height / 2,
    scaleX: viewport.width / 1350,
    scaleY: viewport.height / 900,
    states: [],
    scene: { lines: [] },
    context: {
      clearRect() {},
      drawImage() {},
    },
  };
}

test("noiseSourceSlice derives independent backing scales per canvas", () => {
  const frame = {
    width: 865,
    height: 610,
    viewport: { left: 25.83333333333337, top: 0, width: 813.3333333333333, height: 610 },
  };
  const dprSlice = noiseSourceSlice({ width: 1081, height: 763 }, frame, 1.25);
  const shaderSlice = noiseSourceSlice({ width: 865, height: 610 }, frame, 1.25);

  assert.ok(Math.abs(dprSlice.x - 25.83333333333337 * (1081 / 865)) < 1e-6);
  assert.ok(Math.abs(dprSlice.width - 813.3333333333333 * (1081 / 865)) < 1e-6);
  assert.equal(dprSlice.height, 763);
  assert.equal(shaderSlice.x, 25.83333333333337);
  assert.equal(shaderSlice.y, 0);
  assert.equal(shaderSlice.width, 813.3333333333333);
  assert.equal(shaderSlice.height, 610);
});

test("noise area compositing slices each source canvas at its own backing scale", () => {
  withGlobals(1.25, (created) => {
    const renderer = new NoiseAreaRenderer(() => {});
    const sceneCanvas = created[0];
    const frame = makeFrame(865, 610, {
      left: 25.83333333333337,
      top: 0,
      width: 813.3333333333333,
      height: 610,
    });
    const primary = { width: 1081, height: 763 };
    const sharedShaderNotes = { width: 865, height: 610 };

    const composited = renderer.draw(frame, primary, null, false, () => sharedShaderNotes);

    assert.equal(composited, true);
    const primaryDraw = sceneCanvas.draws.find((args) => args[0] === primary);
    const notesDraw = sceneCanvas.draws.find((args) => args[0] === sharedShaderNotes);
    assert.ok(primaryDraw);
    assert.ok(notesDraw);
    assert.ok(Math.abs(primaryDraw[1] - 25.83333333333337 * (1081 / 865)) < 1e-6);
    assert.ok(Math.abs(primaryDraw[3] - 813.3333333333333 * (1081 / 865)) < 1e-6);
    assert.ok(Math.abs(primaryDraw[4] - 763) < 1e-6);
    assert.ok(Math.abs(notesDraw[1] - 25.83333333333337) < 1e-6);
    assert.equal(notesDraw[2], 0);
    assert.ok(Math.abs(notesDraw[3] - 813.3333333333333) < 1e-6);
    assert.equal(notesDraw[4], 610);
    assert.equal(notesDraw[7], sceneCanvas.width);
    assert.equal(notesDraw[8], sceneCanvas.height);
  });
});

test("noise area compositing maps downsampled shader surfaces onto the full scene viewport", () => {
  withGlobals(1.5, (created) => {
    const renderer = new NoiseAreaRenderer(() => {});
    const sceneCanvas = created[0];
    const frame = makeFrame(2560, 1440, {
      left: 0,
      top: 0,
      width: 2560,
      height: 1440,
    });
    const primary = { width: 3840, height: 2160 };
    const downsampledNotes = { width: 1920, height: 1080 };

    const composited = renderer.draw(frame, primary, downsampledNotes, false);

    assert.equal(composited, true);
    const notesDraw = sceneCanvas.draws.find((args) => args[0] === downsampledNotes);
    assert.ok(notesDraw);
    assert.deepEqual(notesDraw.slice(1, 5), [0, 0, 1920, 1080]);
    assert.deepEqual(notesDraw.slice(5, 9), [0, 0, 3840, 2160]);
  });
});
