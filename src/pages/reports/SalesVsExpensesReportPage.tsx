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

/** periodIso = YYYY-MM (month picker); ddmm = DD/MM — uses year from period for calendar date */
function weekdayLabelForDdMm(periodIso: string, ddmm: string): string | null {
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

/* ── Hidden export-only view (captured by html2canvas) ── */
interface ExportViewProps {
  innerRef: React.RefObject<HTMLDivElement>;
  periodLabel: string;
  periodIso: string;
  sales: Transaction[];
  costs: Transaction[];
  expenses: Transaction[];
  totals: ReportTotals;
}

function ExportSection({
  rows, color, label, categoryLabel, periodIso,
}: { rows: Transaction[]; color: string; label: string; categoryLabel: string; periodIso: string }) {
  const total = rows.reduce((s, t) => s + toNum(t.amount), 0);
  return (
    <>
      <div className={`sve-exp-section sve-exp-section--${color}`}>
        <span className={`sve-exp-dot sve-exp-dot--${color}`} />
        {label}
      </div>
      <table className="sve-exp-table">
        <thead>
          <tr>
            <th style={{ width: "5%" }}>#</th>
            <th style={{ width: "22%" }}>Date</th>
            <th>Description</th>
            <th style={{ width: "20%" }}>Category</th>
            <th style={{ width: "20%" }}>Amount (AED)</th>
          </tr>
        </thead>
        <tbody>
          {rows.filter(r => r.description || toNum(r.amount)).map((row, i) => {
            const wd = weekdayLabelForDdMm(periodIso, row.date);
            return (
            <tr key={row.id}>
              <td className="sve-exp-td-c">{i + 1}</td>
              <td className="sve-exp-td-c">
                <div className="sve-exp-date-box">
                  <span className="sve-exp-date-main">{row.date || "—"}</span>
                  {wd ? <span className="sve-exp-weekday-pill">{wd}</span> : null}
                </div>
              </td>
              <td>{row.description || "—"}</td>
              <td className="sve-exp-td-c">
                <span className={`sve-exp-cat sve-exp-cat--${color}`}>{categoryLabel}</span>
              </td>
              <td className={`sve-exp-amt sve-exp-amt--${color}`}>{fmt(toNum(row.amount))}</td>
            </tr>
            );
          })}
          <tr className={`sve-exp-total sve-exp-total--${color}`}>
            <td colSpan={3}>TOTAL {categoryLabel.toUpperCase()}</td>
            <td />
            <td className={`sve-exp-amt sve-exp-amt--${color}`}>{fmt(total)}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function ExportView({ innerRef, periodLabel, periodIso, sales, costs, expenses, totals }: ExportViewProps) {
  const kpis = [
    { color: "green",  icon: "↗",  label: "Total Sales",    value: fmt(totals.sales),     note: "Gross revenue" },
    { color: "orange", icon: "🏷️", label: "Total Item Cost", value: fmt(totals.costs),     note: "COGS" },
    { color: "red",    icon: "▤",  label: "Total Expense",  value: fmt(totals.expenses),  note: "Operating expenses" },
    { color: "blue",   icon: "💰", label: "Net Profit",     value: fmt(totals.netProfit), note: `Margin: ${totals.margin.toFixed(1)}%` },
  ];
  return (
    <div ref={innerRef} className="sve-export-wrap">
      <div className="sve-exp-report">
        {/* Header */}
        <div className="sve-exp-header">
          <div>
            <div className="sve-exp-badge">Financial Overview</div>
            <h1 className="sve-exp-title">Sales <span className="sve-exp-vs">vs</span> Expenses</h1>
            <div className="sve-exp-subtitle">Track your financial performance and key metrics</div>
          </div>
          <div className="sve-exp-period-box">
            <div className="sve-exp-period-icon">▣</div>
            <div>
              <div className="sve-exp-period-label">Reporting Period</div>
              <div className="sve-exp-period-date">{periodLabel}</div>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="sve-exp-kpi-grid">
          {kpis.map((k) => (
            <div key={k.label} className={`sve-exp-kpi sve-exp-kpi--${k.color}`}>
              <div className="sve-exp-kpi-inner">
                <div className={`sve-exp-kpi-icon sve-exp-kpi-icon--${k.color}`}>{k.icon}</div>
                <div>
                  <div className="sve-exp-kpi-label">{k.label}</div>
                  <div className={`sve-exp-kpi-value sve-exp-kpi-value--${k.color}`}>{k.value}</div>
                </div>
              </div>
              <div className="sve-exp-kpi-line" />
              <div className="sve-exp-kpi-note">{k.note}</div>
            </div>
          ))}
        </div>

        {/* Tables */}
        <div className="sve-exp-card">
          <div className="sve-exp-card-title">Transaction Details</div>
          <ExportSection rows={sales}    color="green"  label="Sales Transactions"   categoryLabel="Sales"    periodIso={periodIso} />
          <ExportSection rows={costs}    color="orange" label="Item Cost Transactions" categoryLabel="Item Cost" periodIso={periodIso} />
          <ExportSection rows={expenses} color="red"    label="Expense Transactions" categoryLabel="Expense" periodIso={periodIso} />
        </div>
      </div>
    </div>
  );
}

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
            <th style={{ width: "22%" }}>Date</th>
            <th>Description</th>
            <th style={{ width: "20%" }}>Category</th>
            <th style={{ width: "20%" }}>Amount (AED)</th>
            <th style={{ width: "5%" }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const dateWd = weekdayLabelForDdMm(periodIso, row.date);
            return (
            <tr key={row.id}>
              <td className="sve-td-center">{i + 1}</td>
              <td>
                <div className="sve-date-box">
                  <div className="sve-date-input-wrap">
                    <input
                      className="sve-input sve-input--date-inline"
                      value={row.date}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                        const formatted = digits.length > 2
                          ? `${digits.slice(0, 2)}/${digits.slice(2)}`
                          : digits;
                        onUpdate(row.id, "date", formatted);
                      }}
                      placeholder="DD/MM"
                      maxLength={5}
                    />
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

/* ── Main page ── */
const SalesVsExpensesReportPage: React.FC = () => {
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [sales, setSales] = useState<Transaction[]>(DEMO_SALES);
  const [costs, setCosts] = useState<Transaction[]>(DEMO_COSTS);
  const [expenses, setExpenses] = useState<Transaction[]>(DEMO_EXPENSES);
  const [history, setHistory] = useState<SavedReport[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  /* Derived totals */
  const totals = useMemo<ReportTotals>(() => {
    const s = sales.reduce((sum, t) => sum + toNum(t.amount), 0);
    const c = costs.reduce((sum, t) => sum + toNum(t.amount), 0);
    const e = expenses.reduce((sum, t) => sum + toNum(t.amount), 0);
    const net = s - c - e;
    const margin = s > 0 ? (net / s) * 100 : 0;
    return { sales: s, costs: c, expenses: e, netProfit: net, margin };
  }, [sales, costs, expenses]);

  const periodLabel = useMemo(() => {
    if (!period) return "—";
    try {
      return new Date(`${period}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    } catch { return period; }
  }, [period]);

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
    if (!exportRef.current) throw new Error("Export ref not ready");
    return html2canvas(exportRef.current, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#f5f7fb",
      logging: false,
    });
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
      <div className="sve-report">

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
              <input
                type="month"
                className="sve-period-input"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
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
            periodIso={period}
            onUpdate={makeUpdater(setSales)}
            onAdd={makeAdder(setSales)}
            onRemove={makeRemover(setSales)}
          />
          <TransactionTable
            rows={costs}
            color="orange"
            label="Item Cost Transactions"
            categoryLabel="Item Cost"
            periodIso={period}
            onUpdate={makeUpdater(setCosts)}
            onAdd={makeAdder(setCosts)}
            onRemove={makeRemover(setCosts)}
          />
          <TransactionTable
            rows={expenses}
            color="red"
            label="Expense Transactions"
            categoryLabel="Expense"
            periodIso={period}
            onUpdate={makeUpdater(setExpenses)}
            onAdd={makeAdder(setExpenses)}
            onRemove={makeRemover(setExpenses)}
          />
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

      {/* Hidden export-only render (off-screen, captured by html2canvas) */}
      <ExportView
        innerRef={exportRef}
        periodLabel={periodLabel}
        periodIso={period}
        sales={sales}
        costs={costs}
        expenses={expenses}
        totals={totals}
      />
    </div>
  );
};

export default SalesVsExpensesReportPage;
