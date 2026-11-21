/**
 * Publishes the status bar's chart information.
 *
 * The presenter fills rows from the session and shader events, while the expansion
 * flag is shared with the bar's toggle.
 */
import { flushSync } from "react-dom";
import { createValue } from "../../../core/state/values.ts";
import { shaderEvents } from "../../../core/global/chart/shader/shaderEvents.ts";
import type { Chart, JudgeLine } from "../../../core/global/chart/chart.ts";
import type { EditorSession } from "../../../core/edit/session/session.ts";
import { getLanguage, t } from "../../../i18n/index.ts";
import type { ChartInfoItem, ChartInfoRow } from "./ChartInfoView.tsx";

/** The fixed clock text emitted by `EditorEditClock.format()`. */
const EDIT_CLOCK_PATTERN = /^(\d+) h, (\d+) m, (\d+) s$/u;

/**
 * Render the editor clock in the interface language.
 *
 * The editor clock owns elapsed-time measurement and publishes one stable
 * hours/minutes/seconds string. Chinese reads it as a digital clock; English
 * keeps explicit unit letters. A string that does not match the clock shape is
 * shown unchanged so a future clock format cannot disappear from the bar.
 */
export function formatEditClock(value: string): string {
  const match = EDIT_CLOCK_PATTERN.exec(value);
  if (!match) {
    return value;
  }
  const [, hours, minutes, seconds] = match;
  return getLanguage() === "zh"
    ? `${hours}:${minutes}:${seconds}`
    : `${hours} h ${minutes} m ${seconds} s`;
}

/** Status-bar rows are published by this presenter and consumed by StatusBar. */
const rows = createValue<ChartInfoRow[]>({ initial: [] });
export const getChartInfoRows = rows.get;
export const subscribeChartInfoRows = rows.subscribe;
export const setChartInfoRows = rows.set;

/** The frame readout is part of the status bar and is always visible. */
const expanded = createValue<boolean>({ initial: true });
export const getChartInfoExpanded = expanded.get;
export const subscribeChartInfoExpanded = expanded.subscribe;
export const setChartInfoExpanded = expanded.set;

/** Aggregated chart counters for one session, published as status-bar rows. */
export class EditorChartInfoPresenter {
  private rows: ChartInfoRow[] = [];
  private chart: Chart | null = null;
  private contentRevision = -1;
  private lineEvents: number[] = [];
  private totalLines = 0;
  private totalNotes = 0;
  private totalEvents = 0;
  private items: ChartInfoItem[] = [];
  private lastValue = "";
  /** Ordinary event counts are stable per line object across immutable chart edits. */
  private readonly lineEventCounts = new WeakMap<JudgeLine, number>();

  /** Counts non-paint events for one line, caching the result per line object. */
  private baseEventCount(line: JudgeLine | undefined): number {
    if (!line) {
      return 0;
    }
    const cached = this.lineEventCounts.get(line);
    if (cached !== undefined) {
      return cached;
    }
    let count = 0;
    for (const layer of [...(line.eventLayers ?? []), line.extended ?? {}]) {
      for (const [type, events] of Object.entries(layer ?? {})) {
        if (type !== "paintEvents" && Array.isArray(events)) {
          count += events.length;
        }
      }
    }
    this.lineEventCounts.set(line, count);
    return count;
  }

  /**
   * Republishes the readout rows for the session and edit time, and returns the
   * chart's total line count.
   */
  render(session: EditorSession, editTime: string): number {
    // A selection-only publication keeps the same chart object. A paged
    // document also keeps that object across line materialization, so its
    // content revision is the signal for recounting the loaded snapshot.
    const revision = session.chartDocument ? session.contentRevision : -1;
    if (this.chart !== session.chart || this.contentRevision !== revision) {
      this.chart = session.chart;
      this.contentRevision = revision;
      const document = session.chartDocument;
      const summaries = document?.index?.lines;
      const lines = session.chart.judgeLineList ?? [];
      this.totalLines = document?.lineCount ?? lines.length;
      this.totalNotes = 0;
      this.totalEvents = 0;
      this.lineEvents = new Array<number>(this.totalLines).fill(0);
      if (summaries) {
        // The streamed index already walked every line. Keeping its totals
        // means placeholders never make the chart look shorter or emptier.
        for (const summary of summaries) {
          this.lineEvents[summary.index] = summary.eventCount;
          this.totalNotes += summary.noteCount;
          this.totalEvents += summary.eventCount;
        }
      } else {
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index];
          const events = this.baseEventCount(line) + shaderEvents(session.chart, index).length;
          this.lineEvents[index] = events;
          this.totalNotes += line.notes?.length ?? 0;
          this.totalEvents += events;
        }
      }
    }
    const currentEvents = this.lineEvents[session.lineIndex] ?? 0;
    const items: ChartInfoItem[] = [
      { key: "notes", text: t("chrome.statusBar.notes", { count: session.notes.length }) },
      { key: "events", text: t("chrome.statusBar.events", { count: currentEvents }) },
      { key: "lines", text: t("chrome.statusBar.lines", { count: this.totalLines }) },
      { key: "totalNotes", text: t("chrome.statusBar.totalNotes", { count: this.totalNotes }) },
      { key: "totalEvents", text: t("chrome.statusBar.totalEvents", { count: this.totalEvents }) },
      { key: "time", text: t("chrome.statusBar.time", { time: formatEditClock(editTime) }) },
    ];
    const value = JSON.stringify(items);
    if (value === this.lastValue) {
      return this.totalLines;
    }
    this.lastValue = value;
    this.items = items;
    this.rows = [{ items }];
    flushSync(() => setChartInfoRows(this.rows));
    return this.totalLines;
  }

  /** Updates only the clock cell, leaving the other readouts untouched. */
  updateClock(editTime: string): void {
    if (!this.items.length) {
      return;
    }
    const items = this.items.map((item) =>
      item.key === "time"
        ? { ...item, text: t("chrome.statusBar.time", { time: formatEditClock(editTime) }) }
        : item,
    );
    const value = JSON.stringify(items);
    if (value === this.lastValue) {
      return;
    }
    this.lastValue = value;
    this.items = items;
    this.rows = [{ items }];
    flushSync(() => setChartInfoRows(this.rows));
  }

  /** Clears the published rows when the owning session goes away. */
  dispose(): void {
    flushSync(() => setChartInfoRows([]));
  }
}
