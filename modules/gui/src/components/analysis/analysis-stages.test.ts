/** Analysis stages: states, the stage of a node and the runs by month. */
import { describe, expect, it } from "bun:test";
import type { AnalysisNode, AnalysisRunListItem, AnalysisStep } from "portfolio-shared/api-types";
import { defaultStage, fmtStageTime, groupRunsByMonth, nodesByStage, stageDurations, stageStates } from "./analysis-stages";

const node = (id: string, kind: AnalysisNode["kind"], createdAt: string, status: AnalysisNode["status"] = "ready"): AnalysisNode => ({
  id,
  runId: "r",
  kind,
  title: id,
  facts: {},
  summary: "",
  createdBy: "test",
  depth: 1,
  relevance: 0.5,
  status,
  createdAt,
});

const step = (phase: AnalysisStep["phase"], createdAt: string, durationMs: number): AnalysisStep => ({
  id: `${phase}-${createdAt}`,
  runId: "r",
  stepIndex: 0,
  phase,
  durationMs,
  createdAt,
});

describe("stage times", () => {
  it("adds up the steps of each stage and skips the end marker", () => {
    const durations = stageDurations([step("survey", "2026-01-01T00:00:10Z", 4000), step("survey", "2026-01-01T00:00:20Z", 6000), step("done", "2026-01-01T00:00:30Z", 9000)]);
    expect(durations.get("survey")).toBe(10_000);
    expect(durations.has("expand")).toBe(false);
    expect([...durations.keys()]).toEqual(["survey"]);
  });

  it("reads in seconds, then minutes", () => {
    expect(fmtStageTime(200)).toBe("1 s");
    expect(fmtStageTime(59_000)).toBe("59 s");
    expect(fmtStageTime(112_000)).toBe("1 m 52 s");
  });
});

describe("stageStates", () => {
  it("marks the stages around a running one", () => {
    const states = stageStates("expand", "running");
    expect(states.survey).toBe("done");
    expect(states.expand).toBe("active");
    expect(states.synthesise).toBe("todo");
  });

  it("marks where a run stopped", () => {
    expect(stageStates("expand", "cancelled").expand).toBe("stopped");
  });

  it("marks every stage of a finished run done", () => {
    expect(Object.values(stageStates("done", "completed")).every((s) => s === "done")).toBe(true);
  });
});

describe("defaultStage", () => {
  it("opens a finished run on the report and any other on its phase", () => {
    expect(defaultStage("done", "completed")).toBe("report");
    expect(defaultStage("expand", "running")).toBe("expand");
    expect(defaultStage("suggest", "failed")).toBe("suggest");
  });
});

describe("nodesByStage", () => {
  const steps = [step("survey", "2026-11-04T10:00:10.000Z", 5_000), step("expand", "2026-11-04T10:00:20.000Z", 5_000), step("synthesise", "2026-11-04T10:00:40.000Z", 5_000)];

  it("uses the kind where one stage makes it and the time otherwise", () => {
    const stages = nodesByStage(
      [
        node("holding", "holding", "2026-11-04T10:00:01.000Z"),
        node("question", "question", "2026-11-04T10:00:11.000Z"),
        node("news", "news", "2026-11-04T10:00:18.000Z"),
        node("early", "finding", "2026-11-04T10:00:21.000Z"),
        node("late", "finding", "2026-11-04T10:00:41.000Z"),
      ],
      steps,
    );
    expect(stages.get("seed")!.map((n) => n.id)).toEqual(["holding"]);
    expect(stages.get("survey")!.map((n) => n.id)).toEqual(["question"]);
    expect(stages.get("expand")!.map((n) => n.id)).toEqual(["news", "early"]);
    expect(stages.get("synthesise")!.map((n) => n.id)).toEqual(["late"]);
  });

  it("leaves pruned nodes out", () => {
    const stages = nodesByStage([node("gone", "news", "2026-11-04T10:00:18.000Z", "pruned")], steps);
    expect(stages.get("expand")).toEqual([]);
  });
});

describe("groupRunsByMonth", () => {
  const run = (id: string, startedAt: string) => ({ id, startedAt }) as AnalysisRunListItem;

  it("keeps several runs of a month together, newest first", () => {
    const months = groupRunsByMonth([run("oct", "2026-10-15T12:00:00.000Z"), run("nov1", "2026-11-02T12:00:00.000Z"), run("nov2", "2026-11-04T12:00:00.000Z")], "en");
    expect(months.map((m) => m.label)).toEqual(["November 2026", "October 2026"]);
    expect(months[0]!.runs.map((r) => r.id)).toEqual(["nov2", "nov1"]);
  });
});
