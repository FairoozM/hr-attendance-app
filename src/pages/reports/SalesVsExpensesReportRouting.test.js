import { describe, expect, it } from "vitest";

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateRangeLabel(start, end) {
  const fmtDate = (iso) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  return `${fmtDate(start)} - ${fmtDate(end)}`;
}

function inferPeriodBounds(period) {
  const parts = String(period || "")
    .split(" - ")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return {};
  const startMs = Date.parse(parts[0]);
  const endMs = Date.parse(parts[1]);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return {};
  return { start: isoDate(new Date(startMs)), end: isoDate(new Date(endMs)) };
}

function normalizeSavedReport(record) {
  const inferred = inferPeriodBounds(record.period);
  const periodStart = record.periodStart || inferred.start || "2026-05-01";
  const periodEnd = record.periodEnd || inferred.end || "2026-05-31";
  return {
    ...record,
    id: record.id || "generated-id",
    periodStart,
    periodEnd,
    period: formatDateRangeLabel(periodStart, periodEnd),
  };
}

describe("Sales vs Expenses report routing helpers", () => {
  it("migrates legacy saved report without id or iso dates", () => {
    const normalized = normalizeSavedReport({
      period: "May 01, 2026 - May 17, 2026",
      savedAt: "2026-05-18T10:00:00.000Z",
      sales: [],
      costs: [],
      expenses: [],
      totals: { sales: 0, costs: 0, expenses: 0, grossProfit: 0, netProfit: 0, margin: 0 },
    });

    expect(normalized.id).toBe("generated-id");
    expect(normalized.periodStart).toBe("2026-05-01");
    expect(normalized.periodEnd).toBe("2026-05-17");
    expect(normalized.period).toContain("May");
  });

  it("keeps explicit periodStart and periodEnd from saved record", () => {
    const normalized = normalizeSavedReport({
      id: "rep-1",
      period: "legacy label",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      savedAt: "2026-05-18T10:00:00.000Z",
      sales: [],
      costs: [],
      expenses: [],
      totals: { sales: 0, costs: 0, expenses: 0, grossProfit: 0, netProfit: 0, margin: 0 },
    });

    expect(normalized.periodStart).toBe("2026-03-01");
    expect(normalized.periodEnd).toBe("2026-03-31");
  });
});
