import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDateRange, resolveDateTimeRange, todayISO, addDays, isISODate } from "../src/config.js";

test("resolveDateRange defaults to the last 7 days ending today", () => {
  const today = todayISO("UTC");
  const r = resolveDateRange({}, "UTC");
  assert.equal(r.end_date, today);
  assert.equal(r.start_date, addDays(today, -6));
});

test("resolveDateRange honours days and partial bounds", () => {
  assert.deepEqual(resolveDateRange({ end_date: "2026-09-10", days: 3 }, "UTC"), {
    start_date: "2026-09-08",
    end_date: "2026-09-10",
  });
  assert.deepEqual(resolveDateRange({ start_date: "2026-01-01", days: 2 }, "UTC"), {
    start_date: "2026-01-01",
    end_date: "2026-01-02",
  });
  assert.deepEqual(resolveDateRange({ start_date: "2026-02-01", end_date: "2026-02-03", days: 30 }, "UTC"), {
    start_date: "2026-02-01",
    end_date: "2026-02-03",
  });
});

test("resolveDateRange rejects bad input", () => {
  assert.throws(() => resolveDateRange({ start_date: "2026-13-01" }, "UTC"), /YYYY-MM-DD/);
  assert.throws(() => resolveDateRange({ start_date: "2026-02-30" }, "UTC"), /YYYY-MM-DD/);
  assert.throws(() => resolveDateRange({ start_date: "2026-03-05", end_date: "2026-03-01" }, "UTC"), /after/);
  assert.equal(isISODate("2026-02-29"), false);
  assert.equal(isISODate("2024-02-29"), true);
});

test("resolveDateTimeRange defaults to the last 24 hours", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  assert.deepEqual(resolveDateTimeRange({}, now), {
    start_datetime: "2026-09-15T12:00:00Z",
    end_datetime: "2026-09-16T12:00:00Z",
  });
  assert.deepEqual(resolveDateTimeRange({ start_datetime: "2026-09-16T10:00:00Z", hours: 1 }, now), {
    start_datetime: "2026-09-16T10:00:00Z",
    end_datetime: "2026-09-16T11:00:00Z",
  });
  assert.throws(() => resolveDateTimeRange({ start_datetime: "nope" }, now), /ISO 8601/);
});
