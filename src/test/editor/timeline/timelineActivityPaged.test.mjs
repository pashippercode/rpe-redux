/**
 * Timeline activity follows a paged document as individual lines materialize:
 * the overview duration comes from the index before any line is read, and a
 * loaded line replaces only its own entry.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import { ChartDocument } from "../../../core/global/chart/streaming/chartDocument.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { TimelineActivity } from "../../../core/edit/timeline/activity.ts";

/** A two-line chart whose lines occupy very different parts of the song. */
function pagedChart() {
  const chart = createChart();
  chart.judgeLineList = [];
  const early = createLine("Early");
  early.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 20)];
  early.notes = [createNote(1, 20, 0)];
  const late = createLine("Late");
  late.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 200)];
  late.notes = [createNote(1, 200, 0)];
  chart.judgeLineList.push(early, late);
  return chart;
}

/** Build a paged document over one serialized chart. */
function documentFromChart(chart) {
  const scan = scanChartJson(serializeChart(chart));
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const index = buildChartIndex(scan, tempo);
  const provider = {
    lineCount: scan.lineRanges.length,
    async readLine(lineIndex) {
      const range = scan.lineRanges[lineIndex];
      return range ? scan.text.slice(range.start, range.end) : undefined;
    },
  };
  return { document: new ChartDocument({ header, index, provider }), tempo };
}

test("timeline activity uses index bounds before pages materialize", () => {
  const { document, tempo } = documentFromChart(pagedChart());
  const activity = new TimelineActivity();

  activity.compile(document.chart, tempo);

  assert.equal(activity.lines.length, 2);
  assert.equal(activity.lines[0].activity.notes.length, 0);
  assert.equal(activity.lines[1].activity.notes.length, 0);
  assert.ok(activity.duration >= 100, "the unloaded tail still sets the duration");
});

test("loading one line patches only that activity entry", async () => {
  const { document, tempo } = documentFromChart(pagedChart());
  const activity = new TimelineActivity();
  activity.compile(document.chart, tempo);
  const unloadedTail = activity.lines[1];

  await document.ensureLine(0);
  activity.compile(document.chart, tempo);

  assert.equal(activity.lines[0].activity.notes.length, 1);
  assert.equal(activity.lines[1], unloadedTail, "the untouched entry keeps its identity");
  assert.equal(activity.lines[1].activity.notes.length, 0);

  await document.ensureLine(1);
  activity.compile(document.chart, tempo);

  assert.equal(activity.lines[1].activity.notes.length, 1);
  assert.ok(activity.duration >= 100);
});
