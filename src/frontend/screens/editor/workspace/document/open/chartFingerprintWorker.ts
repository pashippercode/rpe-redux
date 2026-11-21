/**
 * Fingerprint pool worker: hashes one raw judge line and returns its semantic
 * seed. It owns no chart state and exits with the document that created it.
 */
import { lineRevisionSeedFromJson } from "../../../../../../core/global/chart/chartContentHash.ts";
import type {
  ChartFingerprintWorkerRequest,
  ChartFingerprintWorkerResponse,
} from "../../../../../../core/global/chart/streaming/chartFingerprintWorkerProtocol.ts";

/** Worker scope typed for the fingerprint request/response pair. */
const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<ChartFingerprintWorkerRequest>) => void) | null;
  postMessage(message: ChartFingerprintWorkerResponse): void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  workerScope.postMessage({
    index: request.index,
    seed: lineRevisionSeedFromJson(request.raw),
  });
};
