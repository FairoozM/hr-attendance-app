import React, { useState, useCallback, useMemo, useRef } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import "./SalesVsExpensesReportPage.css";

/* ── Types ── */
interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: string;
}

interface ReportTotals {
  sales: number;
  costs: number;
  expenses: number;
  grossProfit: number;
  netProfit: number;
  margin: number;
}

interface SavedReport {
  id: string;
  period: string;
  savedAt: string;
  sales: Transaction[];
  costs: Transaction[];
  expenses: Transaction[];
  totals: ReportTotals;
}

/* ── Utilities ── */
function uid() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function toNum(v: string) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number) {
  const abs = Math.abs(n);
  const cents = Math.round((abs % 1) * 100);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: cents === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}${formatted}`;
}

/** periodIso = YYYY-MM; ddmm = DD/MM — uses the reporting-period year for calendar date */
function weekdayForDdMm(periodIso: string, ddmm: string): string | null {
  const year = parseInt(periodIso.slice(0, 4), 10);
  const m = ddmm.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m || !Number.isFinite(year)) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

function datePartsFromRowDate(value: string): [string, string] {
  const [rawStart = "", rawEnd = ""] = value.split(" - ");
  return [rawStart.trim(), rawEnd.trim()];
}

function completeDdMm(value: string) {
  return /^\d{1,2}\/\d{1,2}$/.test(value.trim()) ? value.trim() : "";
}

function weekdayLabelForDateValue(periodIso: string, value: string): string | null {
  const [rawStart, rawEnd] = datePartsFromRowDate(value);
  const start = completeDdMm(rawStart);
  const end = completeDdMm(rawEnd);
  const startDay = start ? weekdayForDdMm(periodIso, start) : null;
  if (!startDay) return null;
  const endDay = end ? weekdayForDdMm(periodIso, end) : null;
  return endDay ? `${startDay} - ${endDay}` : startDay;
}

function formatDdMmInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

function composeRowDate(start: string, end: string) {
  return end ? `${start} - ${end}` : start;
}

const STORAGE_KEY = "sve_report_history_v1";

function loadHistory(): SavedReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
function persistHistory(rows: SavedReport[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch { /* noop */ }
}

function emptyRow(): Transaction {
  return { id: uid(), date: "", description: "", amount: "" };
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateRangeLabel(start: string, end: string) {
  const fmtDate = (iso: string) => {
    if (!iso) return "—";
    try {
      return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };
  return `${fmtDate(start)} - ${fmtDate(end)}`;
}

const DEMO_SALES: Transaction[] = [
  { id: uid(), date: "01/05", description: "Product Sales", amount: "1250" },
  { id: uid(), date: "05/05", description: "Online Sales", amount: "2340.75" },
  { id: uid(), date: "10/05", description: "Wholesale Order", amount: "4800" },
  { id: uid(), date: "15/05", description: "Retail Sales", amount: "2150" },
  { id: uid(), date: "20/05", description: "Service Income", amount: "3200" },
  { id: uid(), date: "25/05", description: "Other Income", amount: "710" },
];
const DEMO_COSTS: Transaction[] = [
  { id: uid(), date: "02/05", description: "Product Purchase", amount: "1850" },
  { id: uid(), date: "08/05", description: "Raw Materials", amount: "1420.50" },
  { id: uid(), date: "15/05", description: "Packaging", amount: "950" },
  { id: uid(), date: "22/05", description: "Shipping & Freight", amount: "700" },
];
const DEMO_EXPENSES: Transaction[] = [
  { id: uid(), date: "03/05", description: "Office Rent", amount: "800" },
  { id: uid(), date: "07/05", description: "Utilities", amount: "320.25" },
  { id: uid(), date: "12/05", description: "Marketing", amount: "450" },
  { id: uid(), date: "18/05", description: "Salaries", amount: "500" },
  { id: uid(), date: "28/05", description: "Miscellaneous", amount: "280" },
];

/* ── Transaction table sub-component ── */
type Color = "green" | "orange" | "red";

interface TransactionTableProps {
  rows: Transaction[];
  color: Color;
  label: string;
  categoryLabel: string;
  periodIso: string;
  onUpdate: (id: string, field: keyof Transaction, value: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

function TransactionTable({ rows, color, label, categoryLabel, periodIso, onUpdate, onAdd, onRemove }: TransactionTableProps) {
  const total = rows.reduce((sum, t) => sum + toNum(t.amount), 0);
  return (
    <>
      <div className={`sve-section-title sve-section-title--${color}`}>
        <span className={`sve-dot sve-dot--${color}`} />
        {label}
      </div>
      <table className="sve-table">
        <thead>
          <tr>
            <th style={{ width: "5%" }}>#</th>
            <th style={{ width: "30%" }}>Date</th>
            <th>Description</th>
            <th style={{ width: "13%" }}>Category</th>
            <th style={{ width: "19%" }}>Amount (AED)</th>
            <th style={{ width: "5%" }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const dateWd = weekdayLabelForDateValue(periodIso, row.date);
            const [dateStart = "", dateEnd = ""] = datePartsFromRowDate(row.date);
            return (
            <tr key={row.id}>
              <td className="sve-td-center">{i + 1}</td>
              <td>
                <div className="sve-date-box">
                  <div className="sve-date-input-wrap">
                    <input
                      className="sve-input sve-input--date-part"
                      value={dateStart}
                      onChange={(e) => {
                        onUpdate(row.id, "date", composeRowDate(formatDdMmInput(e.target.value), dateEnd));
                      }}
                      placeholder="DD/MM"
                      maxLength={5}
                    />
                    <span className="sve-date-range-separator">-</span>
                    <input
                      className={`sve-input sve-input--date-part ${dateEnd ? "" : "sve-input--date-end-empty"}`}
                      value={dateEnd}
                      onChange={(e) => {
                        onUpdate(row.id, "date", composeRowDate(dateStart, formatDdMmInput(e.target.value)));
                      }}
                      placeholder="To"
                      maxLength={5}
                    />
                    <span className="sve-capture-text sve-capture-text--date">{row.date || "—"}</span>
                  </div>
                  {dateWd ? (
                    <span className="sve-date-weekday-pill" title={dateWd}>
                      {dateWd}
                    </span>
                  ) : null}
                </div>
              </td>
              <td>
                <input
                  className="sve-input"
                  value={row.description}
                  onChange={(e) => onUpdate(row.id, "description", e.target.value)}
                  placeholder="Description"
                />
                <span className="sve-capture-text">{row.description || "—"}</span>
              </td>
              <td className="sve-td-center">
                <span className={`sve-category sve-category--${color}`}>{categoryLabel}</span>
              </td>
              <td>
                <input
                  className={`sve-input sve-input--amount sve-input--${color}`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.amount}
                  onChange={(e) => onUpdate(row.id, "amount", e.target.value)}
                  placeholder="0.00"
                />
                <span className={`sve-capture-text sve-capture-text--amount sve-clr-${color}`}>
                  {row.amount ? fmt(toNum(row.amount)) : "—"}
                </span>
              </td>
              <td className="sve-td-center">
                <button
                  type="button"
                  className="sve-remove-btn"
                  onClick={() => onRemove(row.id)}
                  title="Remove row"
                >
                  ✕
                </button>
              </td>
            </tr>
            );
          })}
          <tr className={`sve-total-row sve-total-row--${color}`}>
            <td colSpan={3} style={{ fontWeight: 800, fontSize: "0.95rem" }}>
              TOTAL {categoryLabel.toUpperCase()}
            </td>
            <td />
            <td className={`sve-amount sve-amount--${color}`}>{fmt(total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <div className="sve-add-row-wrap">
        <button type="button" className={`sve-add-btn sve-add-btn--${color}`} onClick={onAdd}>
          + Add row
        </button>
      </div>
    </>
  );
}

function ProfitStrip({ label, value, tone }: { label: string; value: number; tone: "blue" | "teal" }) {
  return (
    <div className={`sve-profit-strip sve-profit-strip--${tone}`}>
      <span>{label}:</span>
      <strong>{fmt(value)}</strong>
    </div>
  );
}

/* ── Main page ── */
const SalesVsExpensesReportPage: React.FC = () => {
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [periodEnd, setPeriodEnd] = useState(() => {
    const d = new Date();
    return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  });
  const [sales, setSales] = useState<Transaction[]>(DEMO_SALES);
  const [costs, setCosts] = useState<Transaction[]>(DEMO_COSTS);
  const [expenses, setExpenses] = useState<Transaction[]>(DEMO_EXPENSES);
  const [history, setHistory] = useState<SavedReport[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  /* Derived totals */
  const totals = useMemo<ReportTotals>(() => {
    const s = sales.reduce((sum, t) => sum + toNum(t.amount), 0);
    const c = costs.reduce((sum, t) => sum + toNum(t.amount), 0);
    const e = expenses.reduce((sum, t) => sum + toNum(t.amount), 0);
    const gross = s - c;
    const net = s - c - e;
    const margin = s > 0 ? (net / s) * 100 : 0;
    return { sales: s, costs: c, expenses: e, grossProfit: gross, netProfit: net, margin };
  }, [sales, costs, expenses]);

  const periodLabel = useMemo(() => {
    return formatDateRangeLabel(periodStart, periodEnd);
  }, [periodStart, periodEnd]);

  const periodIso = useMemo(() => (periodStart ? periodStart.slice(0, 7) : ""), [periodStart]);

  /* Row handlers */
  const makeUpdater = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Transaction[]>>) =>
      (id: string, field: keyof Transaction, value: string) =>
        setter((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))),
    []
  );
  const makeAdder = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Transaction[]>>) => () =>
      setter((prev) => [...prev, emptyRow()]),
    []
  );
  const makeRemover = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Transaction[]>>) => (id: string) =>
      setter((prev) => prev.filter((r) => r.id !== id)),
    []
  );

  /* Save */
  const handleSave = useCallback(() => {
    const record: SavedReport = {
      id: uid(),
      period: periodLabel,
      savedAt: new Date().toISOString(),
      sales: sales.map((t) => ({ ...t })),
      costs: costs.map((t) => ({ ...t })),
      expenses: expenses.map((t) => ({ ...t })),
      totals: { ...totals },
    };
    const next = [record, ...history];
    setHistory(next);
    persistHistory(next);
    setSavedMsg(`Report for "${periodLabel}" saved.`);
    setTimeout(() => setSavedMsg(null), 3000);
  }, [periodLabel, sales, costs, expenses, totals, history]);

  const deleteRecord = useCallback((id: string) => {
    if (!window.confirm("Delete this saved report?")) return;
    setHistory((prev) => {
      const next = prev.filter((r) => r.id !== id);
      persistHistory(next);
      return next;
    });
  }, []);

  const captureCanvas = useCallback(async () => {
    if (!reportRef.current) throw new Error("Report ref not ready");
    const target = reportRef.current;
    target.classList.add("is-capturing");
    // give the browser a frame to apply the class before html2canvas snapshots
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    try {
      return await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });
    } finally {
      target.classList.remove("is-capturing");
    }
  }, []);

  const exportAsImage = useCallback(async () => {
    setExporting(true);
    try {
      const canvas = await captureCanvas();
      const link = document.createElement("a");
      link.download = `sales-vs-expenses-${periodLabel.replace(/\s/g, "-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setExporting(false);
    }
  }, [captureCanvas, periodLabel]);

  const exportAsPdf = useCallback(async () => {
    setExporting(true);
    try {
      const canvas = await captureCanvas();
      const imgData = canvas.toDataURL("image/png");
      const pxW = canvas.width / 2;
      const pxH = canvas.height / 2;
      const pdf = new jsPDF({ orientation: pxW > pxH ? "landscape" : "portrait", unit: "px", format: [pxW, pxH] });
      pdf.addImage(imgData, "PNG", 0, 0, pxW, pxH);
      pdf.save(`sales-vs-expenses-${periodLabel.replace(/\s/g, "-")}.pdf`);
    } finally {
      setExporting(false);
    }
  }, [captureCanvas, periodLabel]);

  const loadRecord = useCallback((record: SavedReport) => {
    setSales(record.sales.map((t) => ({ ...t, id: uid() })));
    setCosts(record.costs.map((t) => ({ ...t, id: uid() })));
    setExpenses(record.expenses.map((t) => ({ ...t, id: uid() })));
    setHistoryOpen(false);
    setSavedMsg(`Loaded report: "${record.period}"`);
    setTimeout(() => setSavedMsg(null), 3000);
  }, []);

  return (
    <div className="sve-page">
      <div className="sve-report" ref={reportRef}>

        {/* ── Header ── */}
        <div className="sve-header">
          <div>
            <div className="sve-badge">Financial Overview</div>
            <h1 className="sve-title">
              Sales <span className="sve-title-vs">vs</span> Expenses
            </h1>
            <div className="sve-subtitle">Track your financial performance and key metrics</div>
          </div>

          <div className="sve-period-box">
            <div className="sve-period-icon">▣</div>
            <div>
              <div className="sve-period-label">Reporting Period</div>
              <div className="sve-period-range">
                <label className="sve-period-range__field">
                  <span>From</span>
                  <input
                    type="date"
                    className="sve-period-input"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                </label>
                <label className="sve-period-range__field">
                  <span>To</span>
                  <input
                    type="date"
                    className="sve-period-input"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                </label>
              </div>
              <div className="sve-period-date">{periodLabel}</div>
            </div>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="sve-kpi-grid">
          <div className="sve-kpi sve-kpi--green">
            <div className="sve-kpi-content">
              <div className="sve-kpi-icon">↗</div>
              <div>
                <div className="sve-kpi-label">Total Sales</div>
                <div className="sve-kpi-value">{fmt(totals.sales)}</div>
              </div>
            </div>
            <div className="sve-kpi-line" />
            <div className="sve-kpi-change">Gross revenue</div>
          </div>

          <div className="sve-kpi sve-kpi--orange">
            <div className="sve-kpi-content">
              <div className="sve-kpi-icon">🏷️</div>
              <div>
                <div className="sve-kpi-label">Total Item Cost</div>
                <div className="sve-kpi-value">{fmt(totals.costs)}</div>
              </div>
            </div>
            <div className="sve-kpi-line" />
            <div className="sve-kpi-change">COGS</div>
          </div>

          <div className="sve-kpi sve-kpi--red">
            <div className="sve-kpi-content">
              <div className="sve-kpi-icon">▤</div>
              <div>
                <div className="sve-kpi-label">Total Expense</div>
                <div className="sve-kpi-value">{fmt(totals.expenses)}</div>
              </div>
            </div>
            <div className="sve-kpi-line" />
            <div className="sve-kpi-change">Operating expenses</div>
          </div>

          <div className="sve-kpi sve-kpi--blue">
            <div className="sve-kpi-content">
              <div className="sve-kpi-icon">💰</div>
              <div>
                <div className="sve-kpi-label">Net Profit</div>
                <div className="sve-kpi-value">{fmt(totals.netProfit)}</div>
              </div>
            </div>
            <div className="sve-kpi-line" />
            <div className="sve-kpi-change">
              Margin: <b>{totals.margin.toFixed(1)}%</b>
            </div>
          </div>
        </div>

        {/* ── Transaction Tables ── */}
        <div className="sve-transaction-card">
          <div className="sve-card-title">Transaction Details</div>
          <TransactionTable
            rows={sales}
            color="green"
            label="Sales Transactions"
            categoryLabel="Sales"
            periodIso={periodIso}
            onUpdate={makeUpdater(setSales)}
            onAdd={makeAdder(setSales)}
            onRemove={makeRemover(setSales)}
          />
          <TransactionTable
            rows={costs}
            color="orange"
            label="Item Cost Transactions"
            categoryLabel="Item Cost"
            periodIso={periodIso}
            onUpdate={makeUpdater(setCosts)}
            onAdd={makeAdder(setCosts)}
            onRemove={makeRemover(setCosts)}
          />
          <ProfitStrip label="Gross Profit" value={totals.grossProfit} tone="blue" />
          <TransactionTable
            rows={expenses}
            color="red"
            label="Expense Transactions"
            categoryLabel="Expense"
            periodIso={periodIso}
            onUpdate={makeUpdater(setExpenses)}
            onAdd={makeAdder(setExpenses)}
            onRemove={makeRemover(setExpenses)}
          />
          <ProfitStrip label="Net Profit" value={totals.netProfit} tone="teal" />
        </div>

        {/* ── Actions ── */}
        <div className="sve-actions">
          <button type="button" className="sve-btn sve-btn--primary" onClick={handleSave}>
            💾 Save Report
          </button>
          <button
            type="button"
            className="sve-btn sve-btn--outline"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            📋 History ({history.length})
          </button>
          <div className="sve-export-group">
            <button
              type="button"
              className="sve-btn sve-btn--export"
              onClick={exportAsPdf}
              disabled={exporting}
            >
              {exporting ? "Exporting…" : "⬇ Export PDF"}
            </button>
            <button
              type="button"
              className="sve-btn sve-btn--export"
              onClick={exportAsImage}
              disabled={exporting}
            >
              {exporting ? "Exporting…" : "🖼 Export Image"}
            </button>
          </div>
          {savedMsg && <span className="sve-save-msg">{savedMsg}</span>}
        </div>

        {/* ── History Panel ── */}
        {historyOpen && (
          <div className="sve-history">
            <div className="sve-history__title">Saved Reports</div>
            {history.length === 0 ? (
              <div className="sve-history__empty">No saved reports yet. Hit "Save Report" to record a snapshot.</div>
            ) : (
              history.map((r) => (
                <div key={r.id} className="sve-history__item">
                  <div
                    className="sve-history__item-header"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  >
                    <div className="sve-history__item-meta">
                      <strong>{r.period}</strong>
                      <span className="sve-history__item-date">
                        Saved{" "}
                        {new Date(r.savedAt).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <div className="sve-history__item-kpis">
                      <span className="sve-history__kpi sve-history__kpi--green">
                        Sales: {fmt(r.totals.sales)}
                      </span>
                      <span className="sve-history__kpi sve-history__kpi--blue">
                        Profit: {fmt(r.totals.netProfit)}
                      </span>
                    </div>
                    <div className="sve-history__item-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="sve-btn sve-btn--sm sve-btn--outline"
                        onClick={() => loadRecord(r)}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="sve-btn sve-btn--sm sve-btn--danger"
                        onClick={() => deleteRecord(r.id)}
                      >
                        Delete
                      </button>
                    </div>
                    <span className="sve-history__chevron">
                      {expandedId === r.id ? "▲" : "▼"}
                    </span>
                  </div>

                  {expandedId === r.id && (
                    <div className="sve-history__item-body">
                      <div className="sve-history__totals">
                        <div><span>Total Sales</span><b className="sve-clr-green">{fmt(r.totals.sales)}</b></div>
                        <div><span>Total Item Cost</span><b className="sve-clr-orange">{fmt(r.totals.costs)}</b></div>
                        <div><span>Total Expense</span><b className="sve-clr-red">{fmt(r.totals.expenses)}</b></div>
                        <div><span>Net Profit</span><b className="sve-clr-blue">{fmt(r.totals.netProfit)}</b></div>
                        <div><span>Profit Margin</span><b>{r.totals.margin.toFixed(1)}%</b></div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SalesVsExpensesReportPage;
