/**
 * Main-thread front end for the chart stream worker. The worker owns the source
 * text and index; this adapter exposes it as a `ChartLineProvider` and falls
 * back to in-process scanning when workers are unavailable.
 */
import { ChartDocument } from "../../../../../../core/global/chart/streaming/chartDocument.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../../../../core/global/chart/streaming/chartLineSummary.ts";
import { scanChartJson } from "../../../../../../core/global/chart/streaming/chartJsonScanner.ts";
import type {
  ChartWorkerRequest,
  ChartWorkerResponse,
} from "../../../../../../core/global/chart/streaming/chartStreamWorkerProtocol.ts";
import {
  PAGED_DOCUMENT_MAX_BYTES,
  PAGED_DOCUMENT_MAX_LINES,
  type ChartHeader,
  type ChartIndex,
  type ChartLineProvider,
  type ChartLineRead,
} from "../../../../../../core/global/chart/streaming/chartStreamTypes.ts";
import { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import { lineRevisionSeedFromJson } from "../../../../../../core/global/chart/chartContentHash.ts";
import { yieldToHost } from "../../../../../../core/utils/yieldToHost.ts";
import type { ChartLineRevisionSeed } from "../../../../../../core/global/chart/chartRevisionSeed.ts";
import type {
  ChartFingerprintWorkerRequest,
  ChartFingerprintWorkerResponse,
} from "../../../../../../core/global/chart/streaming/chartFingerprintWorkerProtocol.ts";

/** One idle-or-busy fingerprint worker and the line it is hashing. */
interface FingerprintPoolJob {
  readonly index: number;
  readonly raw: string;
  resolve(seed: ChartLineRevisionSeed): void;
  reject(error: unknown): void;
}

/** Worker count for hashing: leave the UI thread and stream worker a core. */
function fingerprintWorkerCount(): number {
  const cores =
    typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
  return Math.max(1, Math.min(4, cores - 1));
}

/**
 * A small pool that hashes raw lines away from both the stream worker and the
 * UI thread.
 *
 * The stream worker serves slices; this pool turns those slices into semantic
 * seeds. Hashing one 15k-event line costs about a hundred milliseconds, so the
 * pool keeps the line reader responsive instead of serializing the digest pass
 * behind it.
 */
class ChartFingerprintPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly active = new Map<Worker, FingerprintPoolJob>();
  private readonly queue: FingerprintPoolJob[] = [];
  private disposed = false;

  /** Start up to `count` workers; a failed construction leaves the rest usable. */
  constructor(count: number) {
    for (let index = 0; index < count; index += 1) {
      let worker: Worker;
      try {
        worker = new Worker(new URL("./chartFingerprintWorker.ts", import.meta.url), {
          type: "module",
        });
      } catch {
        break;
      }
      worker.onmessage = (event: MessageEvent<ChartFingerprintWorkerResponse>) => {
        const job = this.active.get(worker);
        this.active.delete(worker);
        this.idle.push(worker);
        job?.resolve(event.data.seed);
        this.dispatch();
      };
      worker.onerror = (event) => {
        const job = this.active.get(worker);
        this.active.delete(worker);
        const workerIndex = this.workers.indexOf(worker);
        if (workerIndex >= 0) {
          this.workers.splice(workerIndex, 1);
        }
        const idleIndex = this.idle.indexOf(worker);
        if (idleIndex >= 0) {
          this.idle.splice(idleIndex, 1);
        }
        worker.terminate();
        job?.reject(event.error instanceof Error ? event.error : new Error(String(event.message)));
        if (!this.workers.length) {
          // The remaining queued lines fall back to the UI thread instead of
          // waiting forever for a worker that no longer exists.
          for (const queued of this.queue.splice(0)) {
            queued.reject(new Error("No chart fingerprint workers remain"));
          }
        }
        this.dispatch();
      };
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  /** Hash one raw line, or fall back to the UI thread when no worker exists. */
  submit(index: number, raw: string): Promise<ChartLineRevisionSeed> {
    if (this.disposed) {
      return Promise.reject(new Error("Chart fingerprint pool is disposed"));
    }
    if (!this.workers.length) {
      return Promise.resolve(lineRevisionSeedFromJson(raw));
    }
    return new Promise<ChartLineRevisionSeed>((resolve, reject) => {
      this.queue.push({ index, raw, resolve, reject });
      this.dispatch();
    });
  }

  /** Terminate every worker and drop queued jobs. */
  dispose(): void {
    this.disposed = true;
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.length = 0;
    this.idle.length = 0;
    this.active.clear();
    this.queue.length = 0;
  }

  /** Feed idle workers until the queue drains. */
  private dispatch(): void {
    while (!this.disposed && this.idle.length && this.queue.length) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      if (!worker || !job) {
        return;
      }
      this.active.set(worker, job);
      const request: ChartFingerprintWorkerRequest = { index: job.index, raw: job.raw };
      worker.postMessage(request);
    }
  }
}

/** An opened stream document plus the worker lifetime it depends on. */
export interface OpenedChartStream {
  readonly document: ChartDocument;
  dispose(): void;
}

/** Open archive bytes as a paged chart document for the core import seam. */
export async function openChartDocumentFromBytes(
  bytes: Uint8Array,
  name: string,
  options: { transferBytes?: boolean } = {},
): Promise<{ chartDocument: ChartDocument; dispose(): void }> {
  const opened = await openChartStreamFromChunks(
    (async function* () {
      yield bytes;
    })(),
    name,
    options.transferBytes === true,
  );
  return { chartDocument: opened.document, dispose: opened.dispose };
}

/** A provider that asks the worker for one raw line at a time. */
class WorkerChartLineProvider implements ChartLineProvider {
  readonly lineCount: number;
  private readonly worker: Worker;
  private readonly sessionId: number;
  private readonly pending = new Map<
    number,
    {
      promise: Promise<string | ChartLineRead | undefined>;
      resolve(read: string | ChartLineRead | undefined): void;
      reject(error: unknown): void;
    }
  >();
  private closed = false;

  /** Bind the provider to one worker session. */
  constructor(worker: Worker, sessionId: number, lineCount: number) {
    this.worker = worker;
    this.sessionId = sessionId;
    this.lineCount = lineCount;
  }

  /** Read one raw line through the worker. */
  readLine(index: number, signal?: AbortSignal): Promise<string | ChartLineRead | undefined> {
    if (this.closed) {
      return Promise.reject(new Error("Chart stream is closed"));
    }
    const existing = this.pending.get(index);
    if (existing) {
      return existing.promise;
    }
    let resolveLine!: (read: string | ChartLineRead | undefined) => void;
    let rejectLine!: (error: unknown) => void;
    const promise = new Promise<string | ChartLineRead | undefined>((resolve, reject) => {
      resolveLine = resolve;
      rejectLine = reject;
    });
    this.pending.set(index, { promise, resolve: resolveLine, reject: rejectLine });
    if (signal?.aborted) {
      const pending = this.pending.get(index);
      this.pending.delete(index);
      pending?.reject(new DOMException("Chart stream aborted", "AbortError"));
      return promise;
    }
    const request: ChartWorkerRequest = { id: this.sessionId, kind: "line", index };
    this.worker.postMessage(request);
    return promise;
  }

  /** Resolve one worker line response. */
  accept(message: Extract<ChartWorkerResponse, { kind: "line" }>): void {
    const pending = this.pending.get(message.index);
    if (!pending) {
      return;
    }
    this.pending.delete(message.index);
    pending.resolve(
      message.raw === null ? undefined : { raw: message.raw, valueDigests: message.valueDigests },
    );
  }

  /** Reject every in-flight read and stop accepting new ones. */
  fail(error: unknown): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** Mark the provider closed without rejecting already-resolved reads. */
  close(): void {
    this.fail(new Error("Chart stream is closed"));
  }
}

/** Scan a source in the current thread when a worker cannot be created. */
function localDocument(bytes: ArrayBuffer): OpenedChartStream {
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(
    header.BPMList.length ? header.BPMList : [{ bpm: 120, startTime: [0, 0, 1] }],
  );
  const index = buildChartIndex(scan, tempo, { includeFingerprints: false });
  const provider: ChartLineProvider = {
    lineCount: scan.lineRanges.length,
    async readLine(lineIndex: number) {
      const range = scan.lineRanges[lineIndex];
      return range ? scan.text.slice(range.start, range.end) : undefined;
    },
  };
  const document = new ChartDocument({
    header,
    index,
    provider,
    maxCachedLines: PAGED_DOCUMENT_MAX_LINES,
    maxCachedBytes: PAGED_DOCUMENT_MAX_BYTES,
  });
  let hydrationStarted = false;
  document.startFingerprintHydration = () => {
    if (hydrationStarted) {
      return;
    }
    hydrationStarted = true;
    void hydrateLocalFingerprints(document, scan);
  };
  return {
    document,
    dispose() {},
  };
}

/** Compute fallback fingerprints in bounded slices so the main thread can paint between them. */
async function hydrateLocalFingerprints(
  document: ChartDocument,
  scan: ReturnType<typeof scanChartJson>,
): Promise<void> {
  for (let start = 0; start < scan.lineRanges.length; start += 4) {
    for (let index = start; index < Math.min(scan.lineRanges.length, start + 4); index += 1) {
      const range = scan.lineRanges[index];
      document.applyFingerprintSeed(
        index,
        lineRevisionSeedFromJson(scan.text.slice(range.start, range.end)),
      );
    }
    await yieldToHost();
  }
  document.completeFingerprintHydration();
}

/** Collect an async chunk source into one exact ArrayBuffer. */
async function collectChunks(chunks: AsyncIterable<Uint8Array>): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    parts.push(chunk);
    total += chunk.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes.buffer;
}

/** Open one chart source through the worker, or in-process when unavailable. */
export async function openChartStreamOffThread(
  bytes: ArrayBuffer,
  name: string,
): Promise<OpenedChartStream> {
  return openChartStreamFromChunks(
    (async function* () {
      yield new Uint8Array(bytes);
    })(),
    name,
  );
}

/** Open a chart source from an arbitrary chunk stream. */
export async function openChartStreamFromChunks(
  chunks: AsyncIterable<Uint8Array>,
  name: string,
  transferFirstChunk = false,
): Promise<OpenedChartStream> {
  if (typeof Worker === "undefined") {
    return localDocument(await collectChunks(chunks));
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL("./chartStreamWorker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return localDocument(await collectChunks(chunks));
  }
  const sessionId = 0;
  let header: ChartHeader | null = null;
  let index: ChartIndex | null = null;
  let provider: WorkerChartLineProvider | null = null;
  let chartDocument: ChartDocument | null = null;
  let fingerprintsDone = false;
  let pendingFingerprintJobs = 0;
  let fingerprintBatchOpen = false;
  const fingerprintWorkers = fingerprintWorkerCount();
  const maxPendingFingerprintJobs = Math.max(4, fingerprintWorkers * 2);
  const pendingFingerprintSeeds: Array<{ index: number; seed: ChartLineRevisionSeed }> = [];
  const fingerprintPool = new ChartFingerprintPool(fingerprintWorkers);
  /** Apply one semantic seed now, or buffer it until the document exists. */
  const applySeed = (index: number, seed: ChartLineRevisionSeed): void => {
    if (chartDocument) {
      chartDocument.applyFingerprintSeed(index, seed);
    } else {
      pendingFingerprintSeeds.push({ index, seed });
    }
  };
  /** Install one already-computed seed batch. */
  const applySeedBatch = (start: number, seeds: readonly ChartLineRevisionSeed[]): void => {
    seeds.forEach((seed, offset) => applySeed(start + offset, seed));
  };
  /** Complete hydration only after every hash and the producer's end marker. */
  const settleFingerprintHydration = (): void => {
    if (!fingerprintsDone || pendingFingerprintJobs > 0 || !chartDocument) {
      return;
    }
    chartDocument.completeFingerprintHydration();
  };
  /**
   * Release the stream worker for the next batch while the pool still has room.
   *
   * Dense batches are one line each, so acknowledging only after every hash
   * would leave the pool nearly idle. The pending-job window keeps several
   * lines in flight without copying an unbounded source tail into memory.
   */
  const acknowledgeFingerprintBatch = (): void => {
    if (!fingerprintBatchOpen || pendingFingerprintJobs >= maxPendingFingerprintJobs) {
      return;
    }
    fingerprintBatchOpen = false;
    worker.postMessage({ id: sessionId, kind: "fingerprint-next" });
  };
  /** Hash one raw line off-thread and apply its seed when it returns. */
  const queueFingerprint = (index: number, raw: string): void => {
    pendingFingerprintJobs += 1;
    fingerprintPool
      .submit(index, raw)
      .then(
        (seed) => applySeed(index, seed),
        () => applySeed(index, lineRevisionSeedFromJson(raw)),
      )
      .finally(() => {
        pendingFingerprintJobs -= 1;
        settleFingerprintHydration();
        acknowledgeFingerprintBatch();
      });
  };
  let settleOpen: { resolve(): void; reject(error: unknown): void } | null = null;
  const opened = new Promise<void>((resolve, reject) => {
    settleOpen = { resolve, reject };
  });
  worker.onmessage = (event: MessageEvent<ChartWorkerResponse>) => {
    const message = event.data;
    if (message.kind === "header") {
      header = message.header;
      if (header && index) {
        provider = new WorkerChartLineProvider(worker, sessionId, index.lines.length);
        settleOpen?.resolve();
        settleOpen = null;
      }
      return;
    }
    if (message.kind === "index") {
      index = message.index;
      if (header && index) {
        provider = new WorkerChartLineProvider(worker, sessionId, index.lines.length);
        settleOpen?.resolve();
        settleOpen = null;
      }
      return;
    }
    if (message.kind === "fingerprints") {
      applySeedBatch(message.start, message.seeds);
      return;
    }
    if (message.kind === "fingerprint-lines") {
      fingerprintBatchOpen = true;
      message.raws.forEach((raw, offset) => {
        if (raw !== null) {
          queueFingerprint(message.start + offset, raw);
        }
      });
      acknowledgeFingerprintBatch();
      return;
    }
    if (message.kind === "fingerprints-done") {
      fingerprintsDone = true;
      settleFingerprintHydration();
      return;
    }
    if (message.kind === "line") {
      provider?.accept(message);
      return;
    }
    const error = new Error(message.message || `Chart stream failed for ${name}`);
    fingerprintPool.dispose();
    provider?.fail(error);
    settleOpen?.reject(error);
    settleOpen = null;
  };
  worker.onerror = (event) => {
    const error = event.error instanceof Error ? event.error : new Error(String(event.message));
    fingerprintPool.dispose();
    provider?.fail(error);
    settleOpen?.reject(error);
    settleOpen = null;
  };
  try {
    worker.postMessage({ id: sessionId, kind: "open" });
    let firstChunk = true;
    for await (const chunk of chunks) {
      const canTransfer =
        transferFirstChunk &&
        firstChunk &&
        chunk.byteOffset === 0 &&
        chunk.byteLength === chunk.buffer.byteLength;
      const copy = canTransfer ? chunk : chunk.slice();
      worker.postMessage({ id: sessionId, kind: "append", chunk: copy.buffer }, [copy.buffer]);
      firstChunk = false;
    }
    worker.postMessage({ id: sessionId, kind: "finish" });
    await opened;
  } catch (error) {
    fingerprintPool.dispose();
    worker.terminate();
    throw error;
  }
  if (!header || !index || !provider) {
    fingerprintPool.dispose();
    worker.terminate();
    throw new Error(`Chart stream did not produce a header for ${name}`);
  }
  const document = new ChartDocument({
    header,
    index,
    provider,
    maxCachedLines: PAGED_DOCUMENT_MAX_LINES,
    maxCachedBytes: PAGED_DOCUMENT_MAX_BYTES,
  });
  let fingerprintsRequested = false;
  // The opener starts the digest pool after the paged document is installed and
  // before textures and audio. The load still waits for it before the first
  // frame, so a partially hashed chart never opens read-only.
  document.startFingerprintHydration = () => {
    if (fingerprintsRequested) {
      return;
    }
    fingerprintsRequested = true;
    worker.postMessage({ id: sessionId, kind: "fingerprints" });
  };
  chartDocument = document;
  for (const pending of pendingFingerprintSeeds) {
    document.applyFingerprintSeed(pending.index, pending.seed);
  }
  pendingFingerprintSeeds.length = 0;
  settleFingerprintHydration();
  const dispose = () => {
    fingerprintPool.dispose();
    provider?.close();
    worker.postMessage({ id: sessionId, kind: "close" });
    worker.terminate();
  };
  document.dispose = dispose;
  return { document, dispose };
}
