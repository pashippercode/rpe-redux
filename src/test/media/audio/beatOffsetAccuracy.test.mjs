/** Measure the detector's offset error against clicks placed at known sample times. */
import assert from "node:assert/strict";
import test from "node:test";
import { detectBeatGridFromSamples } from "../../../core/media/beatDetection.ts";

const SAMPLE_RATE = 44100;
const BPM = 120;
const PERIOD = 60 / BPM;

/**
 * Build a click track whose attacks sit exactly at `firstBeat`.
 *
 * Each click is a short exponentially decaying burst of a low sine, which is
 * what the low-band onset detector is designed to follow. Because every attack
 * is placed by sample index, the true beat-zero time is known exactly and any
 * difference the detector reports is its own error.
 */
function clickTrack(firstBeat, beats, seconds) {
  const samples = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  const clickLength = Math.round(0.03 * SAMPLE_RATE);
  for (let beat = 0; beat < beats; beat++) {
    const start = Math.round((firstBeat + beat * PERIOD) * SAMPLE_RATE);
    for (let index = 0; index < clickLength; index++) {
      const at = start + index;
      if (at >= samples.length) {
        break;
      }
      const envelope = Math.exp((-index / SAMPLE_RATE) * 120);
      samples[at] += Math.sin((2 * Math.PI * 90 * index) / SAMPLE_RATE) * envelope * 0.9;
    }
  }
  return samples;
}

/** Detector error for one click track, in milliseconds. */
function offsetErrorMs(firstBeat) {
  const samples = clickTrack(firstBeat, 32, 20);
  const result = detectBeatGridFromSamples(samples, SAMPLE_RATE, 20);
  assert.ok(result, `the detector found a grid for a click track at ${firstBeat}s`);
  assert.ok(Math.abs(result.bpm - BPM) < 0.6, `expected about ${BPM} BPM, measured ${result.bpm}`);
  // The reported offset is beat zero; compare it with the true attack time.
  const measuredSeconds = result.offsetMs / 1000;
  const truePhase = measuredSeconds % PERIOD;
  const expectedPhase = firstBeat % PERIOD;
  let error = (truePhase - expectedPhase) % PERIOD;
  if (error > PERIOD / 2) {
    error -= PERIOD;
  }
  if (error < -PERIOD / 2) {
    error += PERIOD;
  }
  return error * 1000;
}

test("a click track at beat zero reports its offset", () => {
  const errorMs = offsetErrorMs(0);
  assert.ok(Math.abs(errorMs) < 10, `offset error ${errorMs.toFixed(2)} ms`);
});

test("a click track on an off-grid phase reports that phase", () => {
  // 0.137 s is deliberately not a multiple of the 0.5 s period.
  const errorMs = offsetErrorMs(0.137);
  assert.ok(Math.abs(errorMs) < 10, `offset error ${errorMs.toFixed(2)} ms`);
});

test("a click track late in the song keeps the same phase", () => {
  const errorMs = offsetErrorMs(0.283);
  assert.ok(Math.abs(errorMs) < 10, `offset error ${errorMs.toFixed(2)} ms`);
});
