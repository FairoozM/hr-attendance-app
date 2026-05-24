import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useUserPreferences } from "../../contexts/UserPreferencesContext";
import { useInfluencers } from "../../contexts/InfluencersContext";
import { resolveInfluencerProfileImageUrl } from "../../lib/influencerProfileImageUrl";
import type { Influencer } from "../../lib/influencers";
import { PREF_SALES_VS_EXPENSES } from "../../constants/userPreferenceKeys";
import "./SalesVsExpensesReportPage.css";

/* ── Types ── */
interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: string;
  /** Linked influencer for influencer expense rows (persisted in saved reports). */
  influencerId?: string;
}

interface ResolvedInfluencer {
  id?: string;
  name: string;
  imageUrl?: string;
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
  periodStart?: string;
  periodEnd?: string;
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

function emptyRow(): Transaction {
  return { id: uid(), date: "", description: "", amount: "" };
}

function influencerInitials(name: string) {
  return (
    String(name || "IN")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "IN"
  );
}

function isInfluencerExpenseRow(row: Transaction) {
  if (row.influencerId) return true;
  return /influencer/i.test(row.description || "");
}

function parseInfluencerNameFromDescription(description: string): string | null {
  const text = String(description || "").trim();
  if (!text) return null;
  const parenMatch = text.match(/influencer\s*exp\s*\(([^)]+)\)/i);
  if (parenMatch?.[1]) return parenMatch[1].trim();
  const trailingMatch = text.match(/influencer\s*exp\s*[-–—:]\s*(.+)$/i);
  if (trailingMatch?.[1]) return trailingMatch[1].trim();
  return null;
}

function buildInfluencerExpenseDescription(name: string) {
  return `Influencer Exp (${name})`;
}

function findInfluencerByName(influencers: Influencer[], name: string): Influencer | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = influencers.find((inf) => String(inf.name || "").trim().toLowerCase() === needle);
  if (exact) return exact;
  const handleMatch = influencers.find((inf) => {
    const handle = String(inf.instagram?.handle || "").replace(/^@/, "").trim().toLowerCase();
    return handle && handle === needle;
  });
  return handleMatch || null;
}

function resolveLinkedInfluencer(row: Transaction, influencers: Influencer[]): ResolvedInfluencer | null {
  if (row.influencerId) {
    const linked = influencers.find((inf) => String(inf.id) === String(row.influencerId));
    if (linked) {
      return {
        id: String(linked.id),
        name: linked.name,
        imageUrl: resolveInfluencerProfileImageUrl(linked),
      };
    }
  }

  if (!isInfluencerExpenseRow(row)) return null;

  const parsedName = parseInfluencerNameFromDescription(row.description);
  if (parsedName) {
    const matched = findInfluencerByName(influencers, parsedName);
    if (matched) {
      return {
        id: String(matched.id),
        name: matched.name,
        imageUrl: resolveInfluencerProfileImageUrl(matched),
      };
    }
    return { name: parsedName };
  }

  return null;
}

function influencerSearchHaystack(inf: Influencer) {
  return [
    inf.name,
    inf.instagram?.handle,
    inf.email,
    inf.mobile,
    inf.niche,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

const SVE_BASE_PATH = "/reports/sales-vs-expenses";

function defaultPeriodStart() {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function defaultPeriodEnd() {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function inferPeriodBounds(period: string): { start?: string; end?: string } {
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

function cloneDemoRows(rows: Transaction[]) {
  return rows.map((t) => ({ ...t, id: uid() }));
}

function cloneSavedRows(rows: Transaction[]) {
  return rows.map((t) => ({ ...t, id: uid() }));
}

function normalizeSavedReport(record: SavedReport): SavedReport {
  const inferred = inferPeriodBounds(record.period);
  const periodStart = record.periodStart || inferred.start || defaultPeriodStart();
  const periodEnd = record.periodEnd || inferred.end || defaultPeriodEnd();
  return {
    ...record,
    id: record.id || uid(),
    periodStart,
    periodEnd,
    period: formatDateRangeLabel(periodStart, periodEnd),
    sales: Array.isArray(record.sales) ? record.sales : [],
    costs: Array.isArray(record.costs) ? record.costs : [],
    expenses: Array.isArray(record.expenses) ? record.expenses : [],
  };
}

function normalizeHistoryList(raw: unknown): SavedReport[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeSavedReport(item as SavedReport));
}

function historyNeedsMigration(raw: unknown, normalized: SavedReport[]): boolean {
  if (!Array.isArray(raw)) return normalized.length > 0;
  return raw.some((item, index) => {
    const src = item as SavedReport;
    const next = normalized[index];
    if (!src?.id || !src?.periodStart || !src?.periodEnd) return true;
    return src.id !== next?.id;
  });
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

function InfluencerAvatar({
  name,
  imageUrl,
  size = "md",
}: {
  name: string;
  imageUrl?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [imageUrl]);

  const showImage = Boolean(imageUrl) && !imgError;
  const cls =
    size === "lg"
      ? "sve-inf-avatar sve-inf-avatar--lg"
      : size === "sm"
        ? "sve-inf-avatar sve-inf-avatar--sm"
        : "sve-inf-avatar";

  return (
    <div className={cls} aria-hidden="true">
      {showImage ? (
        <img src={imageUrl} alt="" onError={() => setImgError(true)} />
      ) : (
        <span>{influencerInitials(name)}</span>
      )}
    </div>
  );
}

function InfluencerExpensePicker({
  row,
  influencers,
  onSelect,
}: {
  row: Transaction;
  influencers: Influencer[];
  onSelect: (influencerId: string | null, description: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const linked = useMemo(() => resolveLinkedInfluencer(row, influencers), [row, influencers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...influencers].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
    );
    if (!q) return sorted.slice(0, 12);
    return sorted.filter((inf) => influencerSearchHaystack(inf).includes(q)).slice(0, 12);
  }, [influencers, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handlePick = (inf: Influencer) => {
    onSelect(String(inf.id), buildInfluencerExpenseDescription(inf.name));
    setQuery("");
    setOpen(false);
  };

  const handleClear = () => {
    onSelect(null, row.description.replace(/influencer\s*exp\s*\([^)]*\)/i, "Influencer Exp").trim());
    setQuery("");
    setOpen(false);
  };

  if (!isInfluencerExpenseRow(row) && !linked) {
    return (
      <div className="sve-inf-picker sve-inf-picker--link-only">
        <button
          type="button"
          className="sve-inf-link-btn"
          onClick={() => onSelect(null, "Influencer Exp")}
        >
          Link influencer
        </button>
        <span className="sve-capture-text sve-capture-text--inf">—</span>
      </div>
    );
  }

  return (
    <div className="sve-inf-picker" ref={rootRef}>
      {linked ? (
        <div className="sve-inf-selected">
          <InfluencerAvatar name={linked.name} imageUrl={linked.imageUrl} size="sm" />
          <span className="sve-inf-selected__name">{linked.name}</span>
          <button type="button" className="sve-inf-clear-btn" onClick={handleClear} title="Clear influencer">
            ✕
          </button>
        </div>
      ) : null}

      <div className="sve-inf-picker-interactive">
        <input
          className="sve-input sve-inf-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={linked ? "Change influencer…" : "Search influencers…"}
          autoComplete="off"
        />
        {open && (
          <div className="sve-inf-dropdown" role="listbox">
            {filtered.length === 0 ? (
              <div className="sve-inf-dropdown__empty">No influencers found</div>
            ) : (
              filtered.map((inf) => (
                <button
                  key={inf.id}
                  type="button"
                  className="sve-inf-dropdown__option"
                  onClick={() => handlePick(inf)}
                >
                  <InfluencerAvatar name={inf.name} imageUrl={resolveInfluencerProfileImageUrl(inf)} size="sm" />
                  <span className="sve-inf-dropdown__meta">
                    <strong>{inf.name}</strong>
                    {inf.instagram?.handle ? (
                      <small>{inf.instagram.handle.startsWith("@") ? inf.instagram.handle : `@${inf.instagram.handle}`}</small>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <span className="sve-capture-text sve-capture-text--inf">
        {linked ? linked.name : "—"}
      </span>
    </div>
  );
}

function ReportInfluencerHeader({ influencers }: { influencers: ResolvedInfluencer[] }) {
  if (influencers.length === 0) return null;

  return (
    <div className="sve-header-influencers" aria-label="Linked influencers">
      {influencers.map((inf) => (
        <div key={inf.id || inf.name} className="sve-header-influencer">
          <InfluencerAvatar name={inf.name} imageUrl={inf.imageUrl} size="lg" />
          <span className="sve-header-influencer__name">{inf.name}</span>
        </div>
      ))}
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
  influencers?: Influencer[];
  enableInfluencerPicker?: boolean;
  onInfluencerSelect?: (id: string, influencerId: string | null, description: string) => void;
}

function TransactionTable({
  rows,
  color,
  label,
  categoryLabel,
  periodIso,
  onUpdate,
  onAdd,
  onRemove,
  influencers = [],
  enableInfluencerPicker = false,
  onInfluencerSelect,
}: TransactionTableProps) {
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
                      <span className="sve-date-weekday-text">{dateWd}</span>
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
                {enableInfluencerPicker && onInfluencerSelect ? (
                  <InfluencerExpensePicker
                    row={row}
                    influencers={influencers}
                    onSelect={(influencerId, description) =>
                      onInfluencerSelect(row.id, influencerId, description)
                    }
                  />
                ) : null}
                <span className="sve-capture-text">{row.description || "—"}</span>
              </td>
              <td className="sve-td-center">
                <span className={`sve-category sve-category--${color}`}>
                  <span className="sve-category-text">{categoryLabel}</span>
                </span>
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
        </tbody>
      </table>
      <div className={`sve-total-strip sve-total-strip--${color}`}>
        <span className="sve-total-strip__label">TOTAL {categoryLabel.toUpperCase()}</span>
        <strong className={`sve-amount sve-amount--${color}`}>{fmt(total)}</strong>
      </div>
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
  const navigate = useNavigate();
  const { reportId: urlReportId } = useParams<{ reportId?: string }>();
  const { ready, getPref, setPref, prefsVersion } = useUserPreferences();
  const { influencers } = useInfluencers();
  const skipHistorySave = useRef(false);
  const appliedReportIdRef = useRef<string | null>(null);
  const historyHydratedRef = useRef(false);

  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [sales, setSales] = useState<Transaction[]>(() => cloneDemoRows(DEMO_SALES));
  const [costs, setCosts] = useState<Transaction[]>(() => cloneDemoRows(DEMO_COSTS));
  const [expenses, setExpenses] = useState<Transaction[]>(() => cloneDemoRows(DEMO_EXPENSES));
  const [history, setHistory] = useState<SavedReport[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const applySavedReport = useCallback((record: SavedReport) => {
    const normalized = normalizeSavedReport(record);
    setPeriodStart(normalized.periodStart!);
    setPeriodEnd(normalized.periodEnd!);
    setSales(cloneSavedRows(normalized.sales));
    setCosts(cloneSavedRows(normalized.costs));
    setExpenses(cloneSavedRows(normalized.expenses));
    appliedReportIdRef.current = normalized.id;
  }, []);

  const resetToNewReport = useCallback(() => {
    setPeriodStart(defaultPeriodStart());
    setPeriodEnd(defaultPeriodEnd());
    setSales(cloneDemoRows(DEMO_SALES));
    setCosts(cloneDemoRows(DEMO_COSTS));
    setExpenses(cloneDemoRows(DEMO_EXPENSES));
    appliedReportIdRef.current = null;
  }, []);

  useEffect(() => {
    if (!ready) return;
    const raw = getPref(PREF_SALES_VS_EXPENSES, null);
    const normalized = normalizeHistoryList(raw);
    skipHistorySave.current = true;
    setHistory(normalized);
    historyHydratedRef.current = true;

    if (historyNeedsMigration(raw, normalized)) {
      window.setTimeout(() => {
        setPref(PREF_SALES_VS_EXPENSES, normalized);
      }, 0);
    }
  }, [ready, prefsVersion, getPref, setPref]);

  useEffect(() => {
    if (!ready || !historyHydratedRef.current) return;

    if (!urlReportId) {
      if (appliedReportIdRef.current !== null) {
        resetToNewReport();
      }
      return;
    }

    if (appliedReportIdRef.current === urlReportId) return;

    const record = history.find((r) => r.id === urlReportId);
    if (record) {
      applySavedReport(record);
      setHistoryOpen(false);
      return;
    }

    if (history.length > 0) {
      navigate(SVE_BASE_PATH, { replace: true });
      setSavedMsg("Saved report not found.");
      window.setTimeout(() => setSavedMsg(null), 3000);
    }
  }, [ready, urlReportId, history, applySavedReport, resetToNewReport, navigate]);

  useEffect(() => {
    if (!ready) return;
    if (skipHistorySave.current) {
      skipHistorySave.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      setPref(PREF_SALES_VS_EXPENSES, history);
    }, 400);
    return () => window.clearTimeout(t);
  }, [history, ready, setPref]);

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

  const headerInfluencers = useMemo(() => {
    const seen = new Set<string>();
    const result: ResolvedInfluencer[] = [];
    for (const row of expenses) {
      const resolved = resolveLinkedInfluencer(row, influencers);
      if (!resolved) continue;
      const key = resolved.id || resolved.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(resolved);
    }
    return result;
  }, [expenses, influencers]);

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

  const handleInfluencerSelect = useCallback((id: string, influencerId: string | null, description: string) => {
    setExpenses((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next: Transaction = { ...row, description };
        if (influencerId) {
          next.influencerId = influencerId;
        } else {
          delete next.influencerId;
        }
        return next;
      }),
    );
  }, []);

  /* Save */
  const handleSave = useCallback(() => {
    const targetId = urlReportId || appliedReportIdRef.current || uid();
    const existingIndex = history.findIndex((r) => r.id === targetId);
    const record: SavedReport = {
      id: targetId,
      period: periodLabel,
      periodStart,
      periodEnd,
      savedAt: new Date().toISOString(),
      sales: sales.map((t) => ({ ...t })),
      costs: costs.map((t) => ({ ...t })),
      expenses: expenses.map((t) => ({ ...t })),
      totals: { ...totals },
    };
    const next = existingIndex >= 0
      ? history.map((r, i) => (i === existingIndex ? record : r))
      : [record, ...history];
    setHistory(next);
    appliedReportIdRef.current = targetId;
    if (urlReportId !== targetId) {
      navigate(`${SVE_BASE_PATH}/${encodeURIComponent(targetId)}`, { replace: existingIndex >= 0 });
    }
    setSavedMsg(`Report for "${periodLabel}" ${existingIndex >= 0 ? "updated" : "saved"}.`);
    setTimeout(() => setSavedMsg(null), 3000);
  }, [periodLabel, periodStart, periodEnd, sales, costs, expenses, totals, history, urlReportId, navigate]);

  const deleteRecord = useCallback((id: string) => {
    if (!window.confirm("Delete this saved report?")) return;
    setHistory((prev) => prev.filter((r) => r.id !== id));
    if (urlReportId === id || appliedReportIdRef.current === id) {
      appliedReportIdRef.current = null;
      navigate(SVE_BASE_PATH, { replace: true });
    }
  }, [urlReportId, navigate]);

  const captureCanvas = useCallback(async () => {
    if (!reportRef.current) throw new Error("Report ref not ready");
    const target = reportRef.current;
    flushSync(() => setIsCapturing(true));
    // Let capture-only styles and webfonts settle before html2canvas snapshots.
    if ("fonts" in document) {
      await document.fonts.ready;
    }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    try {
      return await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        windowWidth: target.scrollWidth,
        windowHeight: target.scrollHeight,
      });
    } finally {
      flushSync(() => setIsCapturing(false));
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
    const normalized = normalizeSavedReport(record);
    navigate(`${SVE_BASE_PATH}/${encodeURIComponent(normalized.id)}`);
    setHistoryOpen(false);
    setSavedMsg(`Loaded report: "${normalized.period}"`);
    setTimeout(() => setSavedMsg(null), 3000);
  }, [navigate]);

  return (
    <div className="sve-page">
      <div className={`sve-report${isCapturing ? " is-capturing" : ""}`} ref={reportRef}>

        {/* ── Header ── */}
        <div className="sve-header">
          <div>
            <div className="sve-badge">
              <span className="sve-badge-text">Financial Overview</span>
            </div>
            <h1 className="sve-title">
              Sales <span className="sve-title-vs">vs</span> Expenses
            </h1>
            <div className="sve-subtitle">Track your financial performance and key metrics</div>
          </div>

          <div className="sve-header-right">
            <div className="sve-period-box">
              <div className="sve-period-icon"><span className="sve-icon-glyph">▣</span></div>
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
            <ReportInfluencerHeader influencers={headerInfluencers} />
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="sve-kpi-grid">
          <div className="sve-kpi sve-kpi--green">
            <div className="sve-kpi-content">
              <div className="sve-kpi-icon"><span className="sve-icon-glyph">↗</span></div>
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
              <div className="sve-kpi-icon"><span className="sve-icon-glyph">🏷️</span></div>
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
              <div className="sve-kpi-icon"><span className="sve-icon-glyph">▤</span></div>
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
              <div className="sve-kpi-icon"><span className="sve-icon-glyph">💰</span></div>
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
            influencers={influencers}
            enableInfluencerPicker
            onInfluencerSelect={handleInfluencerSelect}
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
