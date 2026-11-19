/** Verify the visual clock subtracts both stages of the output chain. */
import assert from "node:assert/strict";
import test from "node:test";
import { totalOutputLatency } from "../../core/media/outputLatency.ts";

test("output latency sums the graph and device stages", () => {
  // The reference device reports 10.0 ms in the graph plus 40.0 ms in the
  // device buffer. Only summing them matches the ~53 ms measured between the
  // processing clock and the audio the device had actually emitted.
  assert.ok(
    Math.abs(totalOutputLatency({ baseLatency: 0.01, outputLatency: 0.04 }) - 0.05) < 1e-12,
  );
});

test("output latency keeps whichever stage a host reports", () => {
  assert.equal(totalOutputLatency({ baseLatency: 0.02 }), 0.02);
  assert.equal(totalOutputLatency({ outputLatency: 0.03 }), 0.03);
  assert.equal(totalOutputLatency({}), 0);
});

test("output latency ignores unusable stages instead of yielding NaN", () => {
  assert.equal(totalOutputLatency({ baseLatency: Number.NaN, outputLatency: 0.04 }), 0.04);
  assert.equal(totalOutputLatency({ baseLatency: 0.01, outputLatency: Infinity }), 0.01);
  assert.equal(totalOutputLatency({ baseLatency: -0.5, outputLatency: 0.04 }), 0.04);
});

test("output latency stays inside the accepted range", () => {
  assert.equal(totalOutputLatency({ baseLatency: 5, outputLatency: 5 }), 0.5);
});
