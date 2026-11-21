/**
 * Commit-time negative-beat validation walks only the lines an edit replaced.
 * The check must still reject a newly negative note or event on a changed line
 * while leaving untouched paged lines out of the commit cost.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { assertNoNewNegativeBeatRanges } from "../../../core/global/chart/chartValidation.ts";
import { ChartDocument } from "../../../core/global/chart/streaming/chartDocument.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";

/** Build a two-line chart whose first line fails if it is ever inspected. */
function pagedPair(changedNotes) {
  const chart = createChart();
  const untouched = createLine("Untouched");
  Object.defineProperty(untouched, "notes", {
    get() {
      throw new Error("untouched line was scanned");
    },
  });
  const changed = createLine("Changed");
  changed.notes = changedNotes;
  chart.judgeLineList = [untouched, changed];
  return chart;
}

test("a commit does not scan untouched lines", () => {
  const previous = pagedPair([]);
  const next = pagedPair([createNote(1, 2, 0)]);
  assert.doesNotThrow(() => assertNoNewNegativeBeatRanges(previous, next, [1]));
});

test("an unchanged negative beat on a changed line stays valid", () => {
  const negative = createNote(1, -2, 0);
  const previous = pagedPair([negative]);
  const next = pagedPair([negative, createNote(1, 2, 0)]);
  assert.doesNotThrow(() => assertNoNewNegativeBeatRanges(previous, next, [1]));
});

test("a new negative note on a changed line is rejected", () => {
  const previous = pagedPair([]);
  const next = pagedPair([createNote(1, -1, 0)]);
  assert.throws(() => assertNoNewNegativeBeatRanges(previous, next, [1]), /negative|负/i);
});

test("a new negative event on a changed line is rejected", () => {
  const previous = pagedPair([]);
  const negativeEvent = createEvent(0, 0, -1, -1);
  const next = pagedPair([]);
  next.judgeLineList[1].eventLayers[0].moveXEvents = [negativeEvent];
  assert.throws(() => assertNoNewNegativeBeatRanges(previous, next, [1]), /negative|负/i);
});

test("a paged CRUD commit does not touch an untouched line's notes", () => {
  const chart = createChart();
  const untouched = createLine("Untouched");
  untouched.notes = [createNote(1, 1, 0)];
  const changed = createLine("Changed");
  changed.notes = [createNote(1, 2, 0)];
  chart.judgeLineList = [untouched, changed];
  const document = ChartDocument.fromChart(chart, { maxCachedLines: 0 });
  const session = EditorSession.fromDocument(document);
  session.selectLine(1);

  Object.defineProperty(document.chart.judgeLineList[0], "notes", {
    get() {
      throw new Error("untouched notes were read during commit");
    },
  });

  const before = session.chart;
  const lines = [...before.judgeLineList];
  lines[1] = { ...lines[1], notes: [...lines[1].notes, createNote(1, 3, 0)] };
  assert.equal(
    session.commitChart("edit line 1", { ...before, judgeLineList: lines }, undefined, undefined, {
      normalized: true,
      changedLineIndexes: [1],
      placement: { notes: 1, events: 0 },
    }),
    true,
  );
  assert.equal(session.history.undoStack.length, 1);
});
