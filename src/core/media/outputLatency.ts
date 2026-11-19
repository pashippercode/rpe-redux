/**
 * Device-latency arithmetic for the visual playback clock.
 *
 * The picture and the sound leave the transport at different moments, so the
 * visual clock subtracts the whole output chain from the Web Audio processing
 * clock. That chain has two independent stages — the render graph and the
 * device buffer — and they add up. Keeping the sum here lets it be tested
 * without a running audio context.
 */

/** The latency stages a host reports for one audio context, in seconds. */
export interface LatencyStages {
  /** Render-quantum and graph delay before a sample leaves the renderer. */
  readonly baseLatency?: number;
  /** Device buffer delay after the renderer hands the sample over. */
  readonly outputLatency?: number;
}

/** Largest total latency accepted from a host, in seconds. */
const MAX_TOTAL_SECONDS = 0.5;

/**
 * Total delay between a sample entering the graph and the device emitting it.
 *
 * Both stages contribute, so they are summed. A host that omits one stage keeps
 * the other, and a missing or non-finite stage contributes zero rather than
 * poisoning the total with `NaN`.
 */
export function totalOutputLatency(stages: LatencyStages): number {
  const base = Number(stages.baseLatency ?? 0);
  const output = Number(stages.outputLatency ?? 0);
  const total =
    (Number.isFinite(base) ? Math.max(0, base) : 0) +
    (Number.isFinite(output) ? Math.max(0, output) : 0);
  return Math.min(total, MAX_TOTAL_SECONDS);
}
