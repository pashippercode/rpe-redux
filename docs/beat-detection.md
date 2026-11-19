# Beat detection: current detector and the madmom option

- Status: evaluation record
- Scope: automatic fixed-BPM timing detection (`src/core/media/beatDetection.ts`)
- Related: [Architecture](./architecture.md), [Testing](./testing.md)

## 1. What the project uses today

`detectBeatGridFromSamples` is a pure DSP pipeline with no model and no runtime dependency:

1. Mix to mono, resample to 22 050 Hz.
2. Build a spectral-flux onset envelope split into low, mid, and high bands (`buildOnsetEnvelope`), with frame time measured at the window centre.
3. Find the dominant pulse with a harmonic autocorrelation over candidate tempos, then resolve half/double-time from the accent pattern.
4. Refit period and phase from low-band peaks, then from raw attacks across the whole track (`refineTimingFromAttacks`), and report `bpm` plus `offsetMs`.

Measured accuracy on a synthetic click track placed at known sample indices (`src/test/media/audio/beatOffsetAccuracy.test.mjs`): **offset error 0.48–0.50 ms** across three different phases. The detector math is not the source of an audible misalignment on material with clear transients.

## 2. What madmom is

[madmom](https://github.com/CPJKU/madmom) is a Python + Cython audio processing library. Its beat and downbeat tracking are RNN/CNN activation models followed by a dynamic Bayesian network (DBN) that decodes the most likely beat sequence.

It is stronger than the local detector on material with weak, syncopated, or expressive timing, because the model carries prior knowledge about how beats behave rather than fitting one grid to onset energy.

## 3. Why it is not embedded directly

| Constraint         | Effect                                                         |
| ------------------ | -------------------------------------------------------------- |
| Python + Cython    | Needs a Python runtime inside the desktop package              |
| TensorFlow / Keras | Hundreds of MB of native libraries per platform                |
| Model weights      | Separate licence and distribution obligation                   |
| Tauri + Go host    | Neither the frontend nor the Go service can call it in-process |

Packaging it would make the installer an order of magnitude larger and turn every platform build into a Python/TensorFlow build. Porting only the inference to TypeScript or Go is a rewrite of the model runner and its preprocessing, not an integration.

madmom is also a beat/downbeat tracker, not a waveform alignment tool, so it does not address audio-to-picture offset.

## 4. What is worth borrowing without the dependency

- **Multi-hypothesis decoding.** A DBN keeps several beat sequences alive and picks the most probable path, instead of committing to one autocorrelation peak. This is the part that helps weak or syncopated material.
- **Learned onset activation.** A small model over the existing envelope would improve onset saliency on percussive mixes, and could run in the existing Web Worker.
- **Tempo prior over the whole track.** The current detector fits one global grid; a prior that tolerates local tempo drift would help live recordings.

Each of these is a detector improvement inside `beatDetection.ts`, testable with the synthetic-click harness that already exists.

## 5. Decision

Do not add madmom. If detection quality on real music becomes the limiting factor, improve the existing detector along the three lines above, starting with multi-hypothesis decoding. Revisit a model-based approach only if a TypeScript-runnable or Go-runnable model becomes available, or if the product accepts a bundled Python runtime.
