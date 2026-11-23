/**
 * CPU-side grouping of sampled noise-area entries into render passes.
 *
 * The NoiseField GPU pipeline consumes stencil bits and stable theme draw
 * phases, while the Canvas fallback partitions entries into its two paint
 * groups. Both readers share the predicates here so the pass rules live in one
 * place and stay verifiable without a GPU or canvas.
 */

/** The state and winding inputs needed to classify one noise-area entry. */
export interface NoiseMaskClassification {
  readonly state: string;
  readonly invert: boolean;
}

/** Return the stencil passes that must receive one sampled noise-area entry. */
export function noiseMaskBitsForEntry(entry: NoiseMaskClassification): number {
  if (entry.state === "hidden") {
    return 0;
  }
  const invertBit = entry.invert ? 1 : 0;
  const stateBit = entry.state === "active" ? invertBit : 2 + invertBit;
  let bits = 1 << stateBit;
  if (entry.state === "ready") {
    bits |= 1 << (4 + invertBit);
  }
  return bits;
}

/** Return whether one entry belongs to a stable theme draw phase. */
export function noiseThemeEntryBelongsToPass(state: string, active: boolean): boolean {
  return state !== "hidden" && (state === "active") === active;
}

export interface NoiseSourceSlice {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function noiseSourceSlice(
  source: { readonly width: number; readonly height: number },
  frame: {
    readonly width: number;
    readonly height: number;
    readonly viewport: {
      readonly left: number;
      readonly top: number;
      readonly width: number;
      readonly height: number;
    };
  },
  fallbackRatio: number,
): NoiseSourceSlice {
  const ratioX = frame.width > 0 && source.width > 0 ? source.width / frame.width : fallbackRatio;
  const ratioY =
    frame.height > 0 && source.height > 0 ? source.height / frame.height : fallbackRatio;
  return {
    x: frame.viewport.left * ratioX,
    y: frame.viewport.top * ratioY,
    width: frame.viewport.width * ratioX,
    height: frame.viewport.height * ratioY,
  };
}

/** Partition visible mask entries once for the Canvas fallback's stable order. */
export function partitionNoiseMaskEntries(
  entries: readonly NoiseMaskClassification[],
  groups: [NoiseMaskClassification[], NoiseMaskClassification[]],
): void {
  groups[0].length = 0;
  groups[1].length = 0;
  for (const entry of entries) {
    groups[entry.state === "active" ? 1 : 0].push(entry);
  }
}
