/**
 * Message contract for the chart fingerprint pool. One dense line may cost a
 * hundred milliseconds to hash, so the stream worker hands the raw source to a
 * pool of workers instead of blocking line reads behind the digest pass.
 */
import type { ChartLineRevisionSeed } from "../chartRevisionSeed.ts";

/** One raw line sent to a fingerprint worker. */
export interface ChartFingerprintWorkerRequest {
  readonly index: number;
  readonly raw: string;
}

/** The semantic seed computed for one line. */
export interface ChartFingerprintWorkerResponse {
  readonly index: number;
  readonly seed: ChartLineRevisionSeed;
}
