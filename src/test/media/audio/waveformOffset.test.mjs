/** The timeline waveform reads the chart offset at paint time, never from a caller argument. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAudioBuffer } from "../../../core/media/audioAnalysis.ts";
import { AudioAnalysis } from "../../../frontend/screens/editor/workspace/timeline/audioAnalysis/audioAnalysis.ts";

const SAMPLE_COUNT = 256;
const PEAK_SAMPLE = 128;
const PIXELS_PER_SECOND = 100;
const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 100;

/** A one-second mono buffer with a single full-scale spike at sample 128. */
function spikeBuffer() {
  const samples = new Float32Array(SAMPLE_COUNT);
  samples[PEAK_SAMPLE] = 1;
  return {
    length: SAMPLE_COUNT,
    numberOfChannels: 1,
    duration: 1,
    sampleRate: 44100,
    getChannelData: () => samples,
  };
}

/** Minimal layout element with a fixed CSS rectangle. */
function layoutElement(width = VIEW_WIDTH, height = VIEW_HEIGHT) {
  return {
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
    }),
  };
}

/** Recording 2D context: path verbs capture the geometry the waveform paints. */
function recordingContext(points) {
  return {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    rect() {},
    clip() {},
    fill() {},
    stroke() {},
    drawImage() {},
    moveTo(x, y) {
      points.push([x, y]);
    },
    lineTo(x, y) {
      points.push([x, y]);
    },
  };
}

/** Canvas stub whose context records every path point into `points`. */
function recordingCanvas(points) {
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: VIEW_WIDTH,
    clientHeight: VIEW_HEIGHT,
    parentElement: layoutElement(),
    getContext: () => recordingContext(points),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: VIEW_WIDTH,
      bottom: VIEW_HEIGHT,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
    }),
  };
  return canvas;
}

/** Amplitude-weighted canvas row of the painted envelope. */
function envelopeCentroid(points, centerX) {
  let weight = 0;
  let weightedRow = 0;
  for (const [x, y] of points) {
    const amplitude = Math.abs(x - centerX);
    weight += amplitude;
    weightedRow += amplitude * y;
  }
  assert.ok(weight > 0, "the waveform painted at least one non-zero sample");
  return weightedRow / weight;
}

/** Install the DOM seams the analysis overlay reads while painting. */
function withDom(run) {
  const previous = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
  };
  const points = [];
  const created = [];
  globalThis.document = {
    documentElement: {},
    createElement: () => {
      const canvas = recordingCanvas(points);
      created.push(canvas);
      return canvas;
    },
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#336699" });
  try {
    return run(points, created);
  } finally {
    globalThis.document = previous.document;
    globalThis.getComputedStyle = previous.getComputedStyle;
  }
}

/** Build an enabled analysis overlay whose offset comes from a mutable source. */
function analysisWithOffset(points, readOffset) {
  const canvas = recordingCanvas(points);
  const notesCanvas = layoutElement();
  const timeline = {
    notesCanvas,
    getSession: () => ({ notesMode: "single" }),
    viewport: { timeAt: (vertical) => vertical / PIXELS_PER_SECOND },
  };
  const analysis = new AudioAnalysis(
    canvas,
    () => timeline,
    () => ({ decodeForAnalysis: async () => spikeBuffer() }),
    readOffset,
    { set() {} },
  );
  analysis.enabled = true;
  analysis.data = analyzeAudioBuffer(spikeBuffer(), {
    waveformSize: SAMPLE_COUNT,
    bands: 16,
    spectrumFrames: 256,
  });
  assert.ok(analysis.data, "the analysis produced waveform data");
  return analysis;
}

test("an async analysis paints at the current chart offset instead of zero", () => {
  withDom((points) => {
    let offsetSeconds = 0.25;
    const analysis = analysisWithOffset(points, () => offsetSeconds);

    analysis.draw();
    const shifted = envelopeCentroid(points, VIEW_WIDTH / 2);

    points.length = 0;
    offsetSeconds = 0;
    analysis.draw();
    const unshifted = envelopeCentroid(points, VIEW_WIDTH / 2);

    // The spike sits at audio 0.5 s. A larger chart offset means the same audio
    // sample belongs to an earlier chart time, so the painted row moves up by 25 px.
    assert.ok(
      Math.abs(unshifted - shifted - 0.25 * PIXELS_PER_SECOND) <= 2,
      `expected a 25 px upward shift, painted ${unshifted} -> ${shifted}`,
    );
  });
});

test("a late analysis completion repaints at the offset current when it lands", () => {
  withDom((points) => {
    let offsetSeconds = 0;
    const analysis = analysisWithOffset(points, () => offsetSeconds);

    analysis.draw();
    const before = envelopeCentroid(points, VIEW_WIDTH / 2);

    // The waveform becomes available only after the offset is known, which is
    // the ordering that used to paint one frame at zero offset.
    offsetSeconds = 0.2;
    points.length = 0;
    analysis.draw();
    const after = envelopeCentroid(points, VIEW_WIDTH / 2);

    assert.ok(
      Math.abs(before - after - 0.2 * PIXELS_PER_SECOND) <= 2,
      `expected the later paint to follow the offset, ${before} -> ${after}`,
    );
  });
});

test("the analysis draw entry point takes no caller-supplied offset", () => {
  assert.equal(AudioAnalysis.prototype.draw.length, 0);
});
