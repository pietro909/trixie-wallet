// Tests the new `lastFailureDetails` field and string-capping logic added to
// `recordBgTaskRun`. AsyncStorage is replaced with the package's in-memory
// jest mock so tests are hermetic and have no native deps.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearBgTaskMetrics,
  readBgTaskMetrics,
  recordBgTaskRun,
} from "../bg-task-metrics";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const TASK = "test-task";

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ── lastFailureDetails: absent / present ──────────────────────────────────────

it("lastFailureDetails is null when no errorDetails provided", async () => {
  await recordBgTaskRun(TASK, { status: "failed", errorMessage: "boom" });
  const m = await readBgTaskMetrics(TASK);
  expect(m.lastFailureDetails).toBeNull();
});

it("lastFailureDetails stores scalar values by type", async () => {
  await recordBgTaskRun(TASK, {
    status: "failed",
    errorDetails: {
      code: 42,
      flag: true,
      label: "foo",
      empty: null,
    },
  });
  const m = await readBgTaskMetrics(TASK);
  expect(m.lastFailureDetails).toEqual({
    code: 42,
    flag: true,
    label: "foo",
    empty: null,
  });
});

// ── string capping ────────────────────────────────────────────────────────────

it("string values in errorDetails are capped at 240 chars", async () => {
  const long = "x".repeat(300);
  await recordBgTaskRun(TASK, {
    status: "failed",
    errorDetails: { stack: long },
  });
  const m = await readBgTaskMetrics(TASK);
  expect(m.lastFailureDetails?.stack).toHaveLength(240);
});

it("string values under 240 chars are stored in full", async () => {
  const short = "x".repeat(100);
  await recordBgTaskRun(TASK, {
    status: "failed",
    errorDetails: { msg: short },
  });
  const m = await readBgTaskMetrics(TASK);
  expect(m.lastFailureDetails?.msg).toHaveLength(100);
});

// ── undefined filtering ───────────────────────────────────────────────────────

it("undefined values in errorDetails are dropped", async () => {
  await recordBgTaskRun(TASK, {
    status: "failed",
    errorDetails: { present: "yes", absent: undefined },
  });
  const m = await readBgTaskMetrics(TASK);
  expect(m.lastFailureDetails).toEqual({ present: "yes" });
  expect(m.lastFailureDetails).not.toHaveProperty("absent");
});

it("all-undefined errorDetails produces null lastFailureDetails", async () => {
  await recordBgTaskRun(TASK, {
    status: "failed",
    errorDetails: { a: undefined, b: undefined },
  });
  const m = await readBgTaskMetrics(TASK);
  expect(m.lastFailureDetails).toBeNull();
});

// ── details are sticky (last-failure semantics) ───────────────────────────────

it("lastFailureDetails persists across subsequent success runs", async () => {
  // Failure details record the *last* failure, not the current state, so a
  // later success run should not wipe them — the UI shows both lastSuccessAt
  // and lastFailureAt so the user can see both data points.
  await recordBgTaskRun(TASK, {
    status: "failed",
    errorDetails: { code: 1 },
  });
  await recordBgTaskRun(TASK, { status: "success" });
  const m = await readBgTaskMetrics(TASK);
  expect(m.lastFailureDetails).toEqual({ code: 1 });
  expect(m.lastSuccessAt).not.toBeNull();
});

// ── counters are unaffected ───────────────────────────────────────────────────

it("counters accumulate independently of details", async () => {
  await recordBgTaskRun(TASK, {
    status: "failed",
    errorDetails: { code: 1 },
  });
  await recordBgTaskRun(TASK, {
    status: "failed",
    errorDetails: { code: 2 },
  });
  await recordBgTaskRun(TASK, { status: "success" });

  const m = await readBgTaskMetrics(TASK);
  expect(m.totalRuns).toBe(3);
  expect(m.totalFailures).toBe(2);
  expect(m.totalSuccesses).toBe(1);
});

// ── round-trip through AsyncStorage ──────────────────────────────────────────

it("lastFailureDetails survives JSON serialization round-trip", async () => {
  const details = { code: 7, ok: false, msg: "oops", nothing: null };
  await recordBgTaskRun(TASK, { status: "failed", errorDetails: details });
  const m = await readBgTaskMetrics(TASK);
  expect(m.lastFailureDetails).toEqual(details);
});

it("clearBgTaskMetrics removes stored metrics", async () => {
  await recordBgTaskRun(TASK, { status: "success" });
  await clearBgTaskMetrics(TASK);
  const m = await readBgTaskMetrics(TASK);
  expect(m.totalRuns).toBe(0);
  expect(m.lastFailureDetails).toBeNull();
});

// ── backward-compat: stored data missing lastFailureDetails ──────────────────

it("reads legacy stored data missing lastFailureDetails as null", async () => {
  const legacy = JSON.stringify({
    taskName: TASK,
    totalRuns: 5,
    totalSuccesses: 4,
    totalFailures: 1,
    lastSuccessAt: 1000,
    lastSuccessDurationMs: null,
    lastSuccessSummary: null,
    lastFailureAt: 900,
    lastFailureMessage: "old error",
    // lastFailureDetails absent
  });
  await AsyncStorage.setItem(`trixie:bg-task:metrics:${TASK}`, legacy);
  const m = await readBgTaskMetrics(TASK);
  expect(m.lastFailureDetails).toBeNull();
  expect(m.lastFailureMessage).toBe("old error");
  expect(m.totalRuns).toBe(5);
});
