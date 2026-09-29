import React, { useState, useEffect, useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, LabelList,
} from "recharts";
import {
  Plus, Trash2, X, Pencil, Users, MapPin, Filter, RotateCcw,
  LayoutList, CalendarDays, Calendar, Gauge, PieChart as PieIcon, Settings2, Wrench, Info, ChevronDown,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Theme — cool ops-desk palette, single teal accent + load semantics */
/* ------------------------------------------------------------------ */
const T = {
  bg: "#eef1f4",
  panel: "#ffffff",
  panel2: "#f7f9fb",
  ink: "#16202c",
  sub: "#5b6b7b",
  faint: "#8b99a7",
  line: "#dbe2e9",
  lineSoft: "#e9eef3",
  accent: "#0d7d8c",     // teal-cyan
  accentSoft: "#e2f1f3",
  ok: "#2f8f4e",
  okSoft: "#e5f3e9",
  warn: "#c07d18",
  warnSoft: "#f8efdd",
  over: "#c0392b",
  overSoft: "#f8e4e1",
};
const FREQ_COLORS = {
  Unassigned: "#c0433a", // red — deliberately distinct, flags work with nobody attached
  Onsite: "#0d7d8c",   // kept for the register's Onsite Roster section / calendar chips — no longer a real frequency
  Daily: "#3f6fb0",
  Weekly: "#5aa9a0",
  Fortnightly: "#8e7cc3",
  Monthly: "#c98a3c",
  Quarterly: "#7f9a55",
  "Semi-Annually": "#9c6b4f",
  Annually: "#6b7a8c",
};
const FREQUENCIES = [
  "Daily", "Weekly", "Fortnightly",
  "Monthly", "Quarterly", "Semi-Annually", "Annually",
];
// Weekday chips only make sense for frequencies with a weekly rhythm; Advanced Schedule
// (day-of-month / ordinal / annual) only makes sense for frequencies without one. Keeping
// these two lists separate is what lets the editor show the right schedule picker for
// whichever Frequency is selected, instead of letting the two contradict each other.
const WEEKLY_FREQUENCIES = ["Daily", "Weekly", "Fortnightly"];
const MONTHLY_FREQUENCIES = ["Monthly", "Quarterly", "Semi-Annually", "Annually"];
const SECTION_ORDER = FREQUENCIES;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const ORDINALS = ["First", "Second", "Third", "Fourth", "Last"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// True if a task has ANY schedule set — weekday(s), a day-of-month (or range), an
// ordinal-weekday pattern (or range), or an annual date (or range). Single source of
// truth used by the Register, Roster, and Calendar "missing schedule" checks.
function hasSchedule(t) {
  if (t.frequency === "Fortnightly") return t.days.length > 0 && !!t.fortnightAnchor;
  return t.days.length > 0 || !!(t.ordinalWeek && t.ordinalDay) || (t.exactDates && t.exactDates.length > 0);
}
// Splits a total evenly across n days, in quarter-hour steps, distributing any
// remainder across the earliest days so the parts always sum back to the total.
function evenSplit(total, n) {
  if (n <= 0) return [];
  const base = Math.floor((total / n) * 4) / 4;
  const arr = Array(n).fill(base);
  let remainder = Math.round((total - base * n) * 100) / 100;
  let i = 0;
  while (remainder > 0.001 && i < n) {
    const add = Math.min(0.25, remainder);
    arr[i] = Math.round((arr[i] + add) * 100) / 100;
    remainder = Math.round((remainder - add) * 100) / 100;
    i++;
  }
  return arr;
}
// Resolves which "offset" (0-indexed day within a range) a given day-of-month falls at,
// for whichever range type a task uses — ordinal-weekday, or a fixed list of exact
// calendar dates. Returns null if the task isn't range-based, or this date isn't in its
// range for the given displayed year/month. Shared by the editor (building split boxes)
// and the calendar (looking up per-day split hours).
function getRangeOffset(t, year, month, dom) {
  if (t.ordinalWeek && t.ordinalDay) {
    const anchor = nthWeekdayOfMonth(year, month, t.ordinalDay, t.ordinalWeek);
    if (anchor == null) return null;
    const offsets = [0, ...(t.ordinalOffsets || [])];
    const sorted = [...offsets].sort((a, b) => a - b);
    const idx = sorted.indexOf(dom - anchor);
    return idx === -1 ? null : idx;
  }
  if (t.exactDates && t.exactDates.length > 0) {
    const sorted = [...t.exactDates].sort();
    const target = `${year}-${String(month + 1).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;
    const idx = sorted.indexOf(target);
    return idx === -1 ? null : idx;
  }
  return null;
}
// Human-readable schedule summary — days, ordinal-weekday (or range), and/or a fixed
// list of exact calendar dates. Used anywhere the register/roster shows "what this
// task's schedule is."
function scheduleLabel(t) {
  const parts = [];
  if (t.days.length) {
    if (t.frequency === "Fortnightly") {
      parts.push(t.days.join(" · ") + (t.fortnightAnchor
        ? ` (from ${parseLocalDate(t.fortnightAnchor).toLocaleDateString("en-AU", { day: "numeric", month: "short" })})`
        : " — missing anchor week"));
    } else {
      parts.push(t.days.join(" · "));
    }
  }
  if (t.ordinalWeek && t.ordinalDay) {
    const start = `${t.ordinalWeek} ${WEEKDAY_FULL[t.ordinalDay]}`;
    const offsets = (t.ordinalOffsets && t.ordinalOffsets.length) ? [...t.ordinalOffsets].sort((a, b) => a - b) : [];
    parts.push(offsets.length > 1 ? `${start} + days ${offsets.map((o) => o + 1).join(", ")}${t.splitHours ? " (split)" : ""}` : start);
  }
  if (t.exactDates && t.exactDates.length > 0) {
    const sorted = [...t.exactDates].sort();
    const labels = sorted.map((d) => parseLocalDate(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }));
    parts.push(`${labels.join(", ")}${t.splitHours ? " (split)" : ""}`);
  }
  return parts.join(" · ");
}
const USES_DAYS = WEEKLY_FREQUENCIES;
const BENCHMARK = 38;

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
const sans = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/* ------------------------------------------------------------------ */
/*  Hours maths — days drive occurrences where scheduling is weekday   */
/* ------------------------------------------------------------------ */
const nDays = (t) => (t.days && t.days.length ? t.days.length : 0);
function weeklyEquiv(t) {
  const h = Number(t.hoursPerOccur) || 0;
  const d = nDays(t);
  switch (t.frequency) {
    case "Daily": return h * d;
    case "Weekly": return h * d;
    case "Fortnightly": return h * d * 0.5;
    case "Monthly": return h / 4.33;
    case "Quarterly": return h / 13;
    case "Semi-Annually": return h / 26;
    case "Annually": return h / 52;
    default: return 0;
  }
}
function monthlyEquiv(t) {
  const h = Number(t.hoursPerOccur) || 0;
  const d = nDays(t);
  switch (t.frequency) {
    case "Daily": return h * d * 4.33;
    case "Weekly": return h * d * 4.33;
    case "Fortnightly": return h * d * 2.17;
    case "Monthly": return h;
    case "Quarterly": return h / 3;
    case "Semi-Annually": return h / 6;
    case "Annually": return h / 12;
    default: return 0;
  }
}
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);
// The fraction of a task's hours a given assigned person is responsible for. Without
// the (optional) split turned on, every assigned person is credited the full amount —
// unchanged default behaviour. With it on, each person's own entered share is used
// instead, expressed as a fraction of "Hours per occurrence".
function userHourFraction(t, u) {
  if (t.splitUserHours && t.userHours && t.userHours[u] != null && Number(t.hoursPerOccur)) {
    return Number(t.userHours[u]) / Number(t.hoursPerOccur);
  }
  return 1;
}
// The multiplier for "this task's total across everyone assigned" — Math.max(n,1) when
// everyone's credited the full amount (so 2 people = 2x the task's hours), or 1 when
// split (since the entered shares already sum to the task's total by definition).
function teamShareMultiplier(t) {
  return t.splitUserHours ? 1 : Math.max(t.assignedUsers.length, 1);
}
const uid = () => Math.random().toString(36).slice(2, 9);
// Word-boundary truncation (not an acronym) — keeps chips skimmable in a small
// calendar cell while staying recognisable; full text still lives in the title attr.
function abbreviateTask(text, maxLen = 16) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  const words = text.split(/\s+/);
  let out = "";
  for (const w of words) {
    const next = (out ? out + " " : "") + w;
    if (next.length > maxLen) break;
    out = next;
  }
  if (!out) out = text.slice(0, Math.max(1, maxLen - 1));
  return out + "…";
}
// Resolves e.g. ("Second","Tue") for a given year/month to the date-of-month it falls on.
// Parses a plain "YYYY-MM-DD" string as a local-midnight Date, avoiding the UTC-parse
// ambiguity of `new Date("YYYY-MM-DD")` (which can land on the wrong day depending on
// timezone). Used anywhere fortnightAnchor is read back.
function parseLocalDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nthWeekdayOfMonth(year, month, weekdayShort, ordinal) {
  const targetDow = DAYS.indexOf(weekdayShort);
  if (targetDow < 0) return null;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const firstMatch = 1 + ((targetDow - firstDow + 7) % 7);
  if (ordinal === "Last") {
    let d = firstMatch;
    while (d + 7 <= daysInMonth) d += 7;
    return d;
  }
  const idx = { First: 0, Second: 1, Third: 2, Fourth: 3 }[ordinal] ?? 0;
  const date = firstMatch + idx * 7;
  return date <= daysInMonth ? date : null;
}

/* ------------------------------------------------------------------ */
/*  Seed data — from the workbook, with the cleanups you asked for      */
/* ------------------------------------------------------------------ */
const SEED_USERS = ["James", "Hunter", "Dimitrious", "Julian", "Hamed", "Luke", "Patrick", "Monit"];
const SEED_CLIENTS = [
  { name: "Avant", locations: [] },
  { name: "PICAC", locations: ["Brunswick", "Glenwood", "Narre Warren"] },
  { name: "IAPMO", locations: ["Narre Warren"] },
  { name: "Ports Victoria", locations: ["Geelong", "Station Pier & POCC"] },
  { name: "Cornwalls", locations: [] },
  { name: "SecurITon", locations: [] },
];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const mk = (o) => ({
  id: uid(), client: "", location: "", days: [], fortnightAnchor: null,
  ordinalWeek: "", ordinalDay: "", ordinalOffsets: [], exactDates: [], skipDates: [],
  splitHours: false, dailyHours: {},
  splitUserHours: false, userHours: {},
  notes: "", assignedUsers: [], onsite: false, patching: false, completed: false, ...o,
});
// Combined "Client — Location" key used for matching/filtering/roster rows. Clients with no
// locations (single-site clients) just use the client name on its own.
const siteKeyOf = (t) => (t.location ? `${t.client} — ${t.location}` : (t.client || ""));
const SEED_TASKS = [
  // Onsite — now flagged via `onsite: true` rather than a dedicated frequency;
  // frequency drives the hours maths as normal (Weekly = h × days/wk).
  mk({ name: "Onsite Support", client: "Avant", frequency: "Weekly", onsite: true, assignedUsers: ["Patrick"], hoursPerOccur: 7.5, days: [...WD] }),
  mk({ name: "Onsite Support", client: "PICAC", location: "Narre Warren", frequency: "Weekly", onsite: true, assignedUsers: ["Monit"], hoursPerOccur: 7.5, days: ["Mon"] }),
  mk({ name: "Onsite Support", client: "PICAC", location: "Brunswick", frequency: "Weekly", onsite: true, assignedUsers: ["Luke"], hoursPerOccur: 7.5, days: ["Tue", "Thu"] }),
  mk({ name: "Onsite Support", client: "PICAC", location: "Glenwood", frequency: "Weekly", onsite: true, assignedUsers: ["Dimitrious"], hoursPerOccur: 7.5, days: ["Tue", "Wed"] }),
  mk({ name: "Onsite Support", client: "Ports Victoria", location: "Geelong", frequency: "Weekly", onsite: true, assignedUsers: ["James"], hoursPerOccur: 7.5, days: ["Mon"] }),
  mk({ name: "Onsite Support", client: "Ports Victoria", location: "Station Pier & POCC", frequency: "Weekly", onsite: true, assignedUsers: ["Hamed"], hoursPerOccur: 7.5, days: ["Tue", "Wed", "Thu"] }),
  // Daily
  mk({ name: "Cloud Backup Verification & Issue Remediation", frequency: "Daily", assignedUsers: ["Julian"], hoursPerOccur: 0.5, days: [...WD], notes: "Check backups and resolve daily backup issues" }),
  mk({ name: "Contact Centre (CC4) Ticket Triage & Follow-up", frequency: "Daily", assignedUsers: ["Julian"], hoursPerOccur: 1, days: [...WD] }),
  mk({ name: "Avant CC4/Teams Operations & Configuration", frequency: "Daily", assignedUsers: ["Julian"], hoursPerOccur: 2.5, days: [...WD] }),
  mk({ name: "Client Backup Verification Checklist", frequency: "Daily", assignedUsers: ["Monit"], hoursPerOccur: 1.5, days: [...WD] }),
  mk({ name: "CNW Vulnerability Assessment & Patch Review", frequency: "Daily", assignedUsers: ["Monit"], hoursPerOccur: 1.5, days: [...WD] }),
  mk({ name: "Trend Micro Deployment Health & Agent Check", frequency: "Daily", assignedUsers: ["Dimitrious"], hoursPerOccur: 1, days: [...WD] }),
  mk({ name: "SolarWinds Service Status & Web Console Check", frequency: "Daily", assignedUsers: ["Dimitrious"], hoursPerOccur: 1, days: [...WD] }),
  mk({ name: "PICAC Security Vulnerability Monitoring", frequency: "Daily", assignedUsers: ["Luke"], hoursPerOccur: 0.3, days: [...WD] }),
  mk({ name: "Endpoint Vulnerability Remediation & Quality Updates", frequency: "Daily", assignedUsers: ["Patrick"], hoursPerOccur: 2, days: [...WD] }),
  mk({ name: "Avant Teams Telephony & CC4 Queue Management", frequency: "Daily", assignedUsers: ["Patrick"], hoursPerOccur: 2, days: [...WD] }),
  mk({ name: "Avant ASYDVEM01 Server Synthetic & Tape Health Check", frequency: "Daily", assignedUsers: ["Patrick"], hoursPerOccur: 0.25, days: [...WD] }),
  mk({ name: "Daily Incident Triage & Helpdesk Queue Support", frequency: "Daily", assignedUsers: ["Hunter"], hoursPerOccur: 1.5, days: [...WD] }),
  // Weekly (incl. the former Sporadic-Weekly task, merged in here)
  mk({ name: "Helpdesk Ticket Triage & Resolution", frequency: "Weekly", assignedUsers: ["Julian"], hoursPerOccur: 2, days: ["Fri"] }),
  mk({ name: "Contact Centre (CC4) Operations Sync", frequency: "Weekly", assignedUsers: ["Julian"], hoursPerOccur: 1, days: ["Fri"] }),
  mk({ name: "System Checklist, Backups & Email Quarantine Review", frequency: "Weekly", assignedUsers: ["Patrick"], hoursPerOccur: 2.5, days: ["Tue", "Thu"] }),
  mk({ name: "VMware Snapshot Review & Cleanup", frequency: "Weekly", assignedUsers: ["Patrick"], hoursPerOccur: 1, days: ["Thu"] }),
  mk({ name: "RV Tools C: Drive Storage Analysis & Client Remediation", frequency: "Weekly", assignedUsers: ["Patrick"], hoursPerOccur: 1.5, days: ["Thu"] }),
  mk({ name: "Multi-Client Backup Checklist Verification", frequency: "Weekly", assignedUsers: ["Luke"], hoursPerOccur: 3, days: ["Mon", "Wed", "Fri"], notes: "3x weekly backup checklist verification" }),
  // Fortnightly
  mk({ name: "Tape Backup Rotation, Job Monitoring & Offsite Transfer", frequency: "Fortnightly", assignedUsers: ["Luke"], hoursPerOccur: 4, days: ["Wed"] }),
  // Monthly
  mk({ name: "Monthly Executive & Operational Reporting", frequency: "Monthly", assignedUsers: ["James"], hoursPerOccur: 6, ordinalWeek: "First", ordinalDay: "Mon" }),
  mk({ name: "Cloud IRAP Compliance & Assessment Tasks", frequency: "Monthly", assignedUsers: ["Julian"], hoursPerOccur: 2, ordinalWeek: "Third", ordinalDay: "Wed", notes: "Runs mid-month" }),
  mk({ name: "Monthly OS Patching & Infrastructure Troubleshooting", frequency: "Monthly", assignedUsers: ["Hamed"], hoursPerOccur: 30, ordinalWeek: "Second", ordinalDay: "Tue", ordinalOffsets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], notes: "Spans weeks 2 & 3 of the month" }),
  mk({ name: "Monthly Application Patching & Maintenance", frequency: "Monthly", assignedUsers: ["Hamed"], hoursPerOccur: 16, ordinalWeek: "Second", ordinalDay: "Tue", ordinalOffsets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], notes: "Spans weeks 2 & 3 of the month" }),
  mk({ name: "Vulnerability Mitigation & Security Patch Fixes", frequency: "Monthly", assignedUsers: ["Hamed"], hoursPerOccur: 6, ordinalWeek: "Second", ordinalDay: "Tue", ordinalOffsets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], notes: "Spans weeks 2 & 3 of the month" }),
  mk({ name: "Web Server Patching & Snapshot Maintenance", frequency: "Monthly", assignedUsers: ["Luke"], hoursPerOccur: 3, ordinalWeek: "Second", ordinalDay: "Tue", notes: "Evening patch window — Patch Tuesday" }),
  mk({ name: "PV UAT Patching & Collaborative Testing", frequency: "Monthly", assignedUsers: ["Luke"], hoursPerOccur: 4, ordinalWeek: "Second", ordinalDay: "Wed" }),
  // Quarterly
  mk({ name: "IT Hardware Register & IRAP Compliance Audit", frequency: "Quarterly", assignedUsers: ["Dimitrious"], hoursPerOccur: 5, ordinalWeek: "Last", ordinalDay: "Fri", notes: "Runs at end of quarter" }),
  mk({ name: "Quarterly Backup Restore & Disaster Recovery Test", frequency: "Quarterly", assignedUsers: ["Luke"], hoursPerOccur: 4, ordinalWeek: "Last", ordinalDay: "Fri", notes: "Runs at end of quarter" }),
];

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */
const STORE_KEY = "securiton-resource-tracker-v1";
async function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* first run or unavailable */ }
  return null;
}
async function saveState(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/*  Small UI atoms                                                     */
/* ------------------------------------------------------------------ */
function Chip({ label, on, onClick, color }) {
  return (
    <button onClick={onClick}
      style={{
        fontFamily: sans, fontSize: 12, fontWeight: 600, padding: "4px 9px",
        borderRadius: 999, cursor: "pointer", userSelect: "none",
        border: `1px solid ${on ? (color || T.accent) : T.line}`,
        background: on ? (color ? color : T.accent) : T.panel,
        color: on ? "#fff" : T.sub, transition: "all .12s",
      }}>{label}</button>
  );
}
function ConfirmModal({ title, message, onConfirm, onCancel, confirmLabel = "Yes, delete" }) {
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(16,24,32,.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.panel, borderRadius: 14, width: "100%", maxWidth: 380, boxShadow: "0 24px 60px rgba(16,24,32,.28)", padding: 22 }}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 16, color: T.ink, marginBottom: 8 }}>{title}</div>
        <div style={{ fontFamily: sans, fontSize: 13.5, color: T.sub, marginBottom: 20 }}>{message}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel}
            style={{ fontFamily: sans, fontSize: 14, fontWeight: 700, padding: "8px 18px", borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, color: T.ink, cursor: "pointer" }}>
            No
          </button>
          <button onClick={onConfirm}
            style={{ fontFamily: sans, fontSize: 14, fontWeight: 700, padding: "8px 18px", borderRadius: 8, border: "none", background: "#c0433a", color: "#fff", cursor: "pointer" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
function utilColor(pct) {
  if (pct > 1.02) return { c: T.over, s: T.overSoft, label: "Over" };
  if (pct >= 0.85) return { c: T.warn, s: T.warnSoft, label: "Near" };
  return { c: T.ok, s: T.okSoft, label: "OK" };
}
function LoadBar({ hours, benchmark = BENCHMARK, height = 10 }) {
  const pct = benchmark ? hours / benchmark : 0;
  const { c, s } = utilColor(pct);
  const w = Math.min(pct, 1.35) / 1.35 * 100;
  const markerAt = (1 / 1.35) * 100;
  return (
    <div style={{ position: "relative", background: s, borderRadius: 6, height, width: "100%", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${w}%`, background: c, borderRadius: 6 }} />
      <div style={{ position: "absolute", left: `${markerAt}%`, top: -2, bottom: -2, width: 2, background: T.ink, opacity: 0.35 }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Task editor modal                                                  */
/* ------------------------------------------------------------------ */
function TaskEditor({ initial, users, clients, onSave, onCancel }) {
  const isNew = !initial.id;
  const [t, setT] = useState({
    name: "", client: "", location: "", frequency: "Daily", assignedUsers: [],
    hoursPerOccur: 1, days: [], fortnightAnchor: null,
      ordinalWeek: "", ordinalDay: "", ordinalOffsets: [], exactDates: [],
      splitHours: false, dailyHours: {},
      splitUserHours: false, userHours: {},
    notes: "", onsite: false, patching: false, completed: false, ...initial,
  });
  const set = (k, v) => setT((p) => ({ ...p, [k]: v }));
  const toggleUser = (u) => setT((p) => ({
    ...p,
    assignedUsers: p.assignedUsers.includes(u) ? p.assignedUsers.filter((x) => x !== u) : [...p.assignedUsers, u],
    splitUserHours: false, userHours: {},
  }));
  const toggleDay = (d) => set("days", t.days.includes(d) ? t.days.filter((x) => x !== d) : DAYS.filter((x) => t.days.includes(x) || x === d));
  const usesDays = WEEKLY_FREQUENCIES.includes(t.frequency);
  const usesAdvanced = MONTHLY_FREQUENCIES.includes(t.frequency);
  const isOnsite = !!t.onsite;
  const todayRef = useMemo(() => new Date(), []);
  const [pinMode, setPinMode] = useState(
    (initial.exactDates && initial.exactDates.length) ? "exact" : "ordinal"
  );
  const [newExactDate, setNewExactDate] = useState("");
  // A handful of upcoming weeks to pick as the fortnight anchor — click, no typing.
  // Any week within a parity class produces the same alternating pattern, so this only
  // needs to offer a few real, recognisable weeks rather than an open-ended date picker.
  const anchorWeeks = useMemo(() => {
    const start = mondayOf(todayRef);
    return Array.from({ length: 6 }, (_, i) => {
      const monday = new Date(start);
      monday.setDate(monday.getDate() + i * 7);
      const friday = new Date(monday);
      friday.setDate(monday.getDate() + 4);
      return {
        iso: toLocalISO(monday),
        label: i === 0 ? "This week" : i === 1 ? "Next week" : `${monday.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${friday.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`,
      };
    });
  }, [todayRef]);
  // Builds the "split hours across days" UI for whichever range is active. labels are
  // display-only; dailyHours is always keyed by 0-indexed offset within the range, so
  // the same stored data applies consistently even though ordinal ranges resolve to
  // different actual dates each month.
  const renderSplitBlock = (labels, note) => {
    const target = Number(t.hoursPerOccur) || 0;
    const sum = Math.round(labels.reduce((a, _, i) => a + (Number(t.dailyHours[i]) || 0), 0) * 100) / 100;
    const mismatch = Math.abs(sum - target) > 0.05;
    return (
      <div style={{ marginLeft: 23 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={!!t.splitHours} onChange={(e) => {
            if (e.target.checked) {
              const split = evenSplit(target, labels.length);
              const map = {}; labels.forEach((_, i) => { map[i] = split[i]; });
              setT((p) => ({ ...p, splitHours: true, dailyHours: map }));
            } else {
              setT((p) => ({ ...p, splitHours: false, dailyHours: {} }));
            }
          }} style={{ width: 14, height: 14, accentColor: T.accent, cursor: "pointer", marginTop: 2, flexShrink: 0 }} />
          <div>
            <div style={{ fontFamily: sans, fontSize: 12.5, color: T.ink, fontWeight: 600 }}>
              This is one task spread across the {labels.length} days — not {fmt(target)}h happening on <i>each</i> day
            </div>
            <div style={{ fontFamily: sans, fontSize: 11.5, color: T.faint, marginTop: 2 }}>
              Leave unchecked if it genuinely repeats in full every day.
            </div>
          </div>
        </label>
        {t.splitHours && (
          <div style={{ marginTop: 8, padding: 10, background: T.panel, borderRadius: 8, border: `1px solid ${T.line}` }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {labels.map((lbl, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <span style={{ fontFamily: sans, fontSize: 10.5, color: T.faint, fontWeight: 700 }}>{lbl}</span>
                  <input type="number" min="0" step="0.25" style={{ ...field, width: 56, textAlign: "center", padding: "6px" }}
                    value={t.dailyHours[i] ?? 0}
                    onChange={(e) => set("dailyHours", { ...t.dailyHours, [i]: Number(e.target.value) || 0 })} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontFamily: sans, fontSize: 12, fontWeight: 600, color: mismatch ? "#c0433a" : T.sub }}>
              Total: {fmt(sum)}h{mismatch ? ` — doesn't match ${fmt(target)}h from "Hours per occurrence" above` : " ✓ matches Hours per occurrence"}
            </div>
            {note && <div style={{ marginTop: 6, fontFamily: sans, fontSize: 11, color: T.faint }}>{note}</div>}
          </div>
        )}
      </div>
    );
  };
  const selectedClient = clients.find((c) => c.name === t.client);
  const hasLocations = !!(selectedClient && selectedClient.locations.length > 0);
  const toggleOnsite = (checked) => setT((p) => ({
    ...p, onsite: checked,
    patching: checked ? false : p.patching,
    name: checked && !p.name.trim() ? "Onsite" : p.name,
    // nudge to a days-based frequency so it can actually land on the roster/calendar
    frequency: checked && !USES_DAYS.includes(p.frequency) ? "Weekly" : p.frequency,
  }));
  const togglePatching = (checked) => setT((p) => ({ ...p, patching: checked, onsite: checked ? false : p.onsite }));

  const label = { fontFamily: sans, fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, marginBottom: 6, display: "block" };
  const field = { fontFamily: sans, fontSize: 14, color: T.ink, padding: "9px 11px", border: `1px solid ${T.line}`, borderRadius: 8, background: T.panel, width: "100%", boxSizing: "border-box" };

  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(16,24,32,.42)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", zIndex: 50, overflow: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.panel, borderRadius: 14, width: "100%", maxWidth: 620, boxShadow: "0 24px 60px rgba(16,24,32,.28)", overflow: "hidden" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.lineSoft}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 17, color: T.ink }}>{isNew ? "New task" : "Edit task"}</div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: T.faint }}><X size={20} /></button>
        </div>
        <div style={{ padding: 22, display: "grid", gap: 16 }}>
          <div>
            <label style={label}>Task name</label>
            <input style={field} value={t.name} placeholder="e.g. Cloud Backup Verification" onChange={(e) => set("name", e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: hasLocations ? "1fr 1fr 1fr" : "1fr 1fr", gap: 14 }}>
            <div>
              <label style={label}>Frequency</label>
              <select style={field} value={t.frequency} onChange={(e) => {
                const nf = e.target.value;
                const wasWeekly = WEEKLY_FREQUENCIES.includes(t.frequency);
                const nowWeekly = WEEKLY_FREQUENCIES.includes(nf);
                const anchorPatch = nf === "Fortnightly" ? {} : { fortnightAnchor: null };
                if (wasWeekly === nowWeekly) { setT((p) => ({ ...p, frequency: nf, ...anchorPatch })); return; }
                // Crossing groups — clear whichever schedule type no longer applies.
                setT((p) => (nowWeekly
                  ? { ...p, frequency: nf, ordinalWeek: "", ordinalDay: "", ordinalOffsets: [], exactDates: [], splitHours: false, dailyHours: {}, ...anchorPatch }
                  : { ...p, frequency: nf, days: [], ...anchorPatch }
                ));
              }}>
                {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Client {isOnsite ? "(required for roster)" : "(optional)"}</label>
              <select style={field} value={t.client} onChange={(e) => { set("client", e.target.value); set("location", ""); }}>
                <option value="">— none —</option>
                {clients.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            {hasLocations && (
              <div>
                <label style={label}>Location {isOnsite ? "(required for roster)" : "(optional)"}</label>
                <select style={field} value={t.location} onChange={(e) => {
                  const loc = e.target.value;
                  set("location", loc);
                  if (loc && !t.onsite) toggleOnsite(true);
                }}>
                  <option value="">— general —</option>
                  {selectedClient.locations.map((loc) => <option key={loc}>{loc}</option>)}
                </select>
              </div>
            )}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: t.patching ? "not-allowed" : "pointer", padding: "2px 2px", opacity: t.patching ? 0.5 : 1 }}>
            <input type="checkbox" checked={isOnsite} disabled={t.patching} onChange={(e) => toggleOnsite(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: T.accent, cursor: t.patching ? "not-allowed" : "pointer" }} />
            <span style={{ fontFamily: sans, fontSize: 13.5, color: T.ink, fontWeight: 600 }}>
              <MapPin size={12} style={{ verticalAlign: -1, marginRight: 5, color: T.accent }} />
              Onsite — shows in the Onsite Schedule and Calendar Summary
            </span>
          </label>
          {isOnsite && !t.client && (
            <div style={{ fontFamily: sans, fontSize: 12, color: T.warn, marginTop: -8 }}>Pick a client above so this shows up on the roster.</div>
          )}
          {isOnsite && t.client && hasLocations && !t.location && (
            <div style={{ fontFamily: sans, fontSize: 12, color: T.warn, marginTop: -8 }}>{t.client} has multiple locations — pick one so this lands in the right roster row.</div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: isOnsite ? "not-allowed" : "pointer", padding: "2px 2px", opacity: isOnsite ? 0.5 : 1 }}>
            <input type="checkbox" checked={!!t.patching} disabled={isOnsite} onChange={(e) => togglePatching(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: T.accent, cursor: isOnsite ? "not-allowed" : "pointer" }} />
            <span style={{ fontFamily: sans, fontSize: 13.5, color: T.ink, fontWeight: 600 }}>
              <Wrench size={12} style={{ verticalAlign: -1, marginRight: 5, color: T.accent }} />
              Patching — shows in the Patching Schedule
            </span>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={label}>Hours per occurrence</label>
              <input style={field} type="number" min="0" step="0.25" value={t.hoursPerOccur} onChange={(e) => set("hoursPerOccur", e.target.value)} />
            </div>
            <div>
              <label style={label}>Weekly hours (auto)</label>
              <div style={{ ...field, background: T.panel2, color: T.accent, fontFamily: mono, fontWeight: 700 }}>{fmt(weeklyEquiv(t))} h</div>
            </div>
          </div>
          <div>
            <label style={label}><Users size={11} style={{ verticalAlign: -1 }} /> Assigned users — pick any number</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {users.map((u) => <Chip key={u} label={u} on={t.assignedUsers.includes(u)} onClick={() => toggleUser(u)} />)}
            </div>
            {t.assignedUsers.length > 1 && (() => {
              const target = Number(t.hoursPerOccur) || 0;
              const sum = Math.round(t.assignedUsers.reduce((a, u) => a + (Number(t.userHours[u]) || 0), 0) * 100) / 100;
              const mismatch = Math.abs(sum - target) > 0.05;
              return (
                <div style={{ marginTop: 10 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!t.splitUserHours} onChange={(e) => {
                      if (e.target.checked) {
                        const split = evenSplit(target, t.assignedUsers.length);
                        const map = {}; t.assignedUsers.forEach((u, i) => { map[u] = split[i]; });
                        setT((p) => ({ ...p, splitUserHours: true, userHours: map }));
                      } else {
                        setT((p) => ({ ...p, splitUserHours: false, userHours: {} }));
                      }
                    }} style={{ width: 14, height: 14, accentColor: T.accent, cursor: "pointer", marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontFamily: sans, fontSize: 12.5, color: T.ink, fontWeight: 600 }}>
                        Split the {fmt(target)}h between these {t.assignedUsers.length} people — not {fmt(target)}h <i>each</i>
                      </div>
                      <div style={{ fontFamily: sans, fontSize: 11.5, color: T.faint, marginTop: 2 }}>
                        Leave unchecked if everyone's genuinely doing the full amount (e.g. two people each fully covering it in parallel).
                      </div>
                    </div>
                  </label>
                  {t.splitUserHours && (
                    <div style={{ marginTop: 8, marginLeft: 22, padding: 10, background: T.panel2, borderRadius: 8, border: `1px solid ${T.line}` }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {t.assignedUsers.map((u) => (
                          <div key={u} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                            <span style={{ fontFamily: sans, fontSize: 10.5, color: T.faint, fontWeight: 700 }}>{u}</span>
                            <input type="number" min="0" step="0.25" style={{ ...field, width: 66, textAlign: "center", padding: "6px" }}
                              value={t.userHours[u] ?? 0}
                              onChange={(e) => set("userHours", { ...t.userHours, [u]: Number(e.target.value) || 0 })} />
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 8, fontFamily: sans, fontSize: 12, fontWeight: 600, color: mismatch ? "#c0433a" : T.sub }}>
                        Total: {fmt(sum)}h{mismatch ? ` — doesn't match ${fmt(target)}h from "Hours per occurrence" above` : " ✓ matches Hours per occurrence"}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {usesDays ? (
            <div>
              {t.frequency === "Fortnightly" && (
                <div style={{ marginBottom: 14 }}>
                  <label style={label}>Which week does this start on? <span style={{ color: "#c0433a" }}>*required</span></label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {anchorWeeks.map((w) => (
                      <Chip key={w.iso} label={w.label}
                        on={t.fortnightAnchor === w.iso}
                        onClick={() => set("fortnightAnchor", w.iso)} color={T.accent} />
                    ))}
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 11.5, color: T.faint, marginTop: 6 }}>
                    Pick the week this first runs — that week, and every second week after (and before) it, is an "on" week. Every other week is skipped. The actual weekday(s) it falls on are set below, same as any other task.
                  </div>
                  {!t.fortnightAnchor && (
                    <div style={{ fontFamily: sans, fontSize: 12, fontWeight: 600, color: "#c0433a", marginTop: 6 }}>
                      Required — without this, a Fortnightly task can't be placed on the calendar even with days picked below.
                    </div>
                  )}
                </div>
              )}
              <label style={label}><CalendarDays size={11} style={{ verticalAlign: -1 }} /> Days — any combination</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {DAYS.map((d) => <Chip key={d} label={d} on={t.days.includes(d)} onClick={() => toggleDay(d)} color={T.accent} />)}
              </div>
              <div style={{ fontFamily: sans, fontSize: 11.5, color: T.faint, marginTop: 6 }}>
                {t.frequency} tasks are scheduled by weekday. Switch Frequency to Monthly, Quarterly, Semi-Annually, or Annually for a day-of-month or ordinal pattern instead.
              </div>
            </div>
          ) : usesAdvanced ? (
            <div>
              <div style={{ marginTop: 0 }}>
                <label style={label}>Advanced schedule</label>
                <div style={{
                  border: `1px solid ${T.line}`, borderRadius: 8, padding: 12, display: "grid", gap: 12, background: T.panel2,
                }}>
                  {/* Ordinal weekday anchor, plus optional extra days relative to it (gaps allowed).
                      Picking an actual weekday means this can never land on a weekend by accident. */}
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", cursor: "pointer" }}>
                      <input type="radio" checked={pinMode === "ordinal"} onChange={() => { setPinMode("ordinal"); set("exactDates", []); set("splitHours", false); set("dailyHours", {}); }}
                        style={{ width: 14, height: 14, accentColor: T.accent, cursor: "pointer" }} />
                      <span style={{ fontFamily: sans, fontSize: 13, color: T.ink, fontWeight: 600 }}>The</span>
                      <select disabled={pinMode !== "ordinal"} style={{ ...field, opacity: pinMode !== "ordinal" ? 0.5 : 1 }}
                        value={t.ordinalWeek} onChange={(e) => setT((p) => ({ ...p, ordinalWeek: e.target.value, splitHours: false, dailyHours: {} }))}>
                        <option value="">—</option>
                        {ORDINALS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                      <select disabled={pinMode !== "ordinal"} style={{ ...field, opacity: pinMode !== "ordinal" ? 0.5 : 1 }}
                        value={t.ordinalDay} onChange={(e) => setT((p) => ({ ...p, ordinalDay: e.target.value, splitHours: false, dailyHours: {} }))}>
                        <option value="">—</option>
                        {DAYS.map((d) => <option key={d} value={d}>{WEEKDAY_FULL[d]}</option>)}
                      </select>
                    </label>
                    {pinMode === "ordinal" && t.ordinalWeek && t.ordinalDay && (
                      <div style={{ marginTop: 8, marginLeft: 23 }}>
                        <div style={{ fontFamily: sans, fontSize: 12, color: T.sub }}>
                          Plus these days relative to that anchor (gaps allowed — e.g. 3 days on, a break, then resume):
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                          {Array.from({ length: 14 }, (_, i) => i).map((off) => {
                            const on = off === 0 || t.ordinalOffsets.includes(off);
                            return (
                              <button key={off} type="button" disabled={off === 0} onClick={() => {
                                const next = (t.ordinalOffsets.includes(off) ? t.ordinalOffsets.filter((x) => x !== off) : [...t.ordinalOffsets, off]).sort((a, b) => a - b);
                                setT((p) => ({ ...p, ordinalOffsets: next, splitHours: false, dailyHours: {} }));
                              }} style={{
                                width: 30, height: 26, fontFamily: mono, fontSize: 10.5, fontWeight: 700, borderRadius: 6,
                                cursor: off === 0 ? "default" : "pointer",
                                border: `1px solid ${on ? T.accent : T.line}`, background: on ? T.accent : T.panel, color: on ? "#fff" : T.sub,
                                opacity: off === 0 ? 0.9 : 1,
                              }} title={off === 0 ? "Anchor day — always on" : `${off + 1} days after the anchor`}>{off + 1}</button>
                            );
                          })}
                        </div>
                        <div style={{ fontFamily: sans, fontSize: 11, color: T.faint, marginTop: 5 }}>
                          Day 1 is the anchor itself and is always included. Numbers count actual calendar days forward from it, whatever weekday that lands on.
                        </div>
                      </div>
                    )}
                  </div>

                  {pinMode === "ordinal" && t.ordinalWeek && t.ordinalDay && t.ordinalOffsets.length > 0 && (() => {
                    const y = todayRef.getFullYear(), m = todayRef.getMonth();
                    const anchor = nthWeekdayOfMonth(y, m, t.ordinalDay, t.ordinalWeek);
                    if (anchor == null) return null;
                    const sorted = [0, ...t.ordinalOffsets].sort((a, b) => a - b);
                    const labels = sorted.map((off) => `Day ${off + 1}`);
                    return renderSplitBlock(labels, `Based on this month's dates (anchor ≈ the ${anchor}${anchor === 1 ? "st" : anchor === 2 ? "nd" : anchor === 3 ? "rd" : "th"}) — the exact day numbers shift slightly month to month, but the day-by-day split still applies the same way.`);
                  })()}

                  {/* Exact calendar dates — one-off or a handful of specific real dates,
                      not a recurring pattern. */}
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", cursor: "pointer" }}>
                      <input type="radio" checked={pinMode === "exact"} onChange={() => { setPinMode("exact"); set("ordinalWeek", ""); set("ordinalDay", ""); set("ordinalOffsets", []); set("splitHours", false); set("dailyHours", {}); }}
                        style={{ width: 14, height: 14, accentColor: T.accent, cursor: "pointer" }} />
                      <span style={{ fontFamily: sans, fontSize: 13, color: T.ink, fontWeight: 600 }}>Exact date(s)</span>
                      <input type="date" disabled={pinMode !== "exact"} value={newExactDate} onChange={(e) => setNewExactDate(e.target.value)}
                        style={{ ...field, width: 150, opacity: pinMode !== "exact" ? 0.5 : 1 }} />
                      <button type="button" disabled={pinMode !== "exact" || !newExactDate} onClick={() => {
                        if (!newExactDate || t.exactDates.includes(newExactDate)) return;
                        setT((p) => ({ ...p, exactDates: [...p.exactDates, newExactDate].sort(), splitHours: false, dailyHours: {} }));
                        setNewExactDate("");
                      }} style={{
                        fontFamily: sans, fontSize: 12.5, fontWeight: 700, padding: "8px 13px", borderRadius: 7, border: "none",
                        background: (pinMode !== "exact" || !newExactDate) ? T.line : T.accent, color: "#fff",
                        cursor: (pinMode !== "exact" || !newExactDate) ? "default" : "pointer",
                      }}>
                        Add
                      </button>
                    </label>
                    {pinMode === "exact" && t.exactDates.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, marginLeft: 23 }}>
                        {[...t.exactDates].sort().map((d) => (
                          <span key={d} style={{
                            display: "flex", alignItems: "center", gap: 6, fontFamily: sans, fontSize: 12, fontWeight: 600, color: T.ink,
                            background: T.panel, border: `1px solid ${T.line}`, padding: "4px 6px 4px 10px", borderRadius: 999,
                          }}>
                            {parseLocalDate(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                            <button type="button" onClick={() => setT((p) => ({ ...p, exactDates: p.exactDates.filter((x) => x !== d), splitHours: false, dailyHours: {} }))}
                              style={{ background: "none", border: "none", cursor: "pointer", color: T.faint, display: "flex", padding: 0 }}>
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {pinMode === "exact" && t.exactDates.length > 1 &&
                    renderSplitBlock([...t.exactDates].sort().map((d) => parseLocalDate(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" })), null)}
                </div>
                <div style={{ fontFamily: sans, fontSize: 11.5, color: T.faint, marginTop: 6 }}>
                  For things that don't map to a fixed weekday — an ordinal pattern like "the second Tuesday" (optionally with extra days relative to it, gaps allowed), or one or more exact calendar dates for a one-off or irregular schedule. Most commonly used for organising patching schedules. {t.frequency} tasks use this instead of weekday chips — switch Frequency to Daily, Weekly, or Fortnightly for weekday scheduling instead. Leave this blank and it'll appear under "Unscheduled" on the calendar instead.
                </div>
              </div>
            </div>
          ) : null}
          <div>
            <label style={label}>Notes</label>
            <input style={field} value={t.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <div style={{ padding: "16px 22px", borderTop: `1px solid ${T.lineSoft}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, padding: "9px 16px", borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, color: T.sub, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => { if (!t.name.trim()) return; onSave({ ...t, id: t.id || uid(), hoursPerOccur: Number(t.hoursPerOccur) || 0 }); }}
            style={{ fontFamily: sans, fontSize: 14, fontWeight: 700, padding: "9px 18px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", cursor: "pointer" }}>
            {isNew ? "Add task" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter bar (connected across Register / Headcount / Analytics)      */
/* ------------------------------------------------------------------ */
function FilterBar({ filters, setFilters, users, clients }) {
  const sel = { fontFamily: sans, fontSize: 13, color: T.ink, padding: "7px 9px", border: `1px solid ${T.line}`, borderRadius: 8, background: T.panel };
  const active = filters.user || filters.site || filters.frequency || filters.search;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", padding: "12px 16px", background: T.panel, borderRadius: 12, border: `1px solid ${T.line}` }}>
      <Filter size={15} color={T.faint} />
      <input placeholder="Search tasks…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} style={{ ...sel, minWidth: 150 }} />
      <select style={sel} value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })}>
        <option value="">All users</option>{users.map((u) => <option key={u}>{u}</option>)}
      </select>
      <select style={sel} value={filters.site} onChange={(e) => setFilters({ ...filters, site: e.target.value })}>
        <option value="">All clients</option>
        {clients.map((c) => (
          <React.Fragment key={c.name}>
            <option value={c.name}>{c.locations.length ? `${c.name} — All locations` : c.name}</option>
            {c.locations.map((loc) => <option key={loc} value={`${c.name} — ${loc}`}>{"\u00A0\u00A0\u00A0"}{loc}</option>)}
          </React.Fragment>
        ))}
      </select>
      <select style={sel} value={filters.frequency} onChange={(e) => setFilters({ ...filters, frequency: e.target.value })}>
        <option value="">All frequencies</option>{FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
      </select>
      {active && (
        <button onClick={() => setFilters({ user: "", site: "", frequency: "", search: "" })}
          style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: sans, fontSize: 13, fontWeight: 600, color: T.accent, background: "none", border: "none", cursor: "pointer" }}>
          <RotateCcw size={13} /> Clear
        </button>
      )}
    </div>
  );
}

function matchTask(t, f) {
  if (f.user && !t.assignedUsers.includes(f.user)) return false;
  if (f.site) {
    // f.site is either a bare client name (matches every location under it) or an
    // exact "Client — Location" key (matches that location only).
    const matches = f.site.includes(" — ") ? siteKeyOf(t) === f.site : t.client === f.site;
    if (!matches) return false;
  }
  if (f.frequency && t.frequency !== f.frequency) return false;
  if (f.search && !(`${t.name} ${t.client} ${t.location} ${t.notes}`.toLowerCase().includes(f.search.toLowerCase()))) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Register tab                                                       */
/* ------------------------------------------------------------------ */
function Register({ tasks, filtered, onEdit, onDelete, onToggleComplete, onBulkDelete }) {
  const [selected, setSelected] = useState(new Set());
  const [collapsed, setCollapsed] = useState({});
  const toggleCollapsed = (id) => setCollapsed((p) => ({ ...p, [id]: !p[id] }));
  const toggleSelect = (id) => setSelected((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allVisibleIds = filtered.map((t) => t.id);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
  const selectAllVisible = () => setSelected(new Set(allVisibleIds));
  const clearSelection = () => setSelected(new Set());
  const selectCell = (t) => (
    <td style={{ padding: "11px 6px 11px 16px", width: 30 }}>
      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} title="Select for bulk actions"
        style={{ width: 14, height: 14, accentColor: T.accent, cursor: "pointer" }} />
    </td>
  );
  // A bit more air between the coloured section bar and the column labels underneath it.
  const th = { fontFamily: sans, fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, textAlign: "left", padding: "12px 12px 8px" };
  const onsiteRows = filtered.filter((t) => t.onsite);
  const allUnassigned = filtered.filter((t) => t.assignedUsers.length === 0 || !hasSchedule(t));
  const grouped = SECTION_ORDER
    .map((f) => ({ f, rows: filtered.filter((t) => t.frequency === f && !t.onsite) }))
    .filter((g) => g.rows.length);
  const sectionHead = (id, label, color, rows, badge) => (
    <div onClick={() => toggleCollapsed(id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 16px", borderBottom: collapsed[id] ? "none" : `1px solid ${T.lineSoft}`, background: badge ? T.accentSoft : T.panel2, cursor: "pointer", userSelect: "none" }}>
      <ChevronDown size={15} color={T.faint} style={{ transform: collapsed[id] ? "rotate(-90deg)" : "none", transition: "transform .12s", flexShrink: 0 }} />
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
      <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 14, color: T.ink }}>{label}</span>
      {badge && <span style={{ fontFamily: sans, fontSize: 11, fontWeight: 600, color: T.accent, background: T.panel, padding: "2px 8px", borderRadius: 999, border: `1px solid ${T.accent}` }}>{badge}</span>}
      <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 12, color: T.sub }}>
        {rows.length} · {fmt(rows.reduce((a, t) => a + weeklyEquiv(t) * teamShareMultiplier(t), 0))} person-h/wk
      </span>
    </div>
  );
  const assignedCell = (t) => (
    <td style={{ padding: "11px 12px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {t.assignedUsers.length ? t.assignedUsers.map((u) => (
          <span key={u} style={{ fontFamily: sans, fontSize: 11.5, fontWeight: 600, color: T.ink, background: T.panel2, border: `1px solid ${T.line}`, padding: "2px 7px", borderRadius: 999 }}>{u}</span>
        )) : <span style={{ fontFamily: sans, fontSize: 12, fontWeight: 700, color: "#c0433a" }}>no user</span>}
      </div>
    </td>
  );
  const actionCell = (t) => (
    <td style={{ padding: "11px 16px 11px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
      <button onClick={() => onEdit(t)} style={{ background: "none", border: "none", cursor: "pointer", color: T.faint, padding: 4 }}><Pencil size={15} /></button>
      <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.faint, padding: 4 }}><Trash2 size={15} /></button>
    </td>
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {onsiteRows.length === 0 && grouped.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", fontFamily: sans, color: T.sub, background: T.panel, borderRadius: 12, border: `1px dashed ${T.line}` }}>
          No tasks match these filters. Adjust the filters above, or add a task.
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", background: selected.size ? T.accentSoft : T.panel, border: `1px solid ${selected.size ? T.accent : T.line}`, borderRadius: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={allSelected} onChange={() => (allSelected ? clearSelection() : selectAllVisible())}
              style={{ width: 14, height: 14, accentColor: T.accent, cursor: "pointer" }} />
            <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: T.ink }}>
              {selected.size > 0 ? `${selected.size} selected` : "Select all"}
            </span>
          </label>
          {selected.size > 0 && (
            <>
              <button onClick={clearSelection}
                style={{ fontFamily: sans, fontSize: 12.5, fontWeight: 600, color: T.sub, background: "none", border: "none", cursor: "pointer" }}>
                Clear
              </button>
              <button onClick={() => { onBulkDelete([...selected]); clearSelection(); }}
                style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontFamily: sans, fontSize: 12.5, fontWeight: 700, color: "#fff", background: "#c0433a", border: "none", borderRadius: 8, padding: "7px 13px", cursor: "pointer" }}>
                <Trash2 size={13} /> Delete {selected.size} task{selected.size === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      )}

      {allUnassigned.length > 0 && (
        <div style={{ background: T.panel, border: `1px dashed #c0433a66`, borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 13.5, color: "#c0433a" }}>Unassigned User & Schedule Summary</div>
          <div style={{ fontFamily: sans, fontSize: 12, color: T.sub, margin: "4px 0 12px" }}>
            Every task missing a person, a schedule, or both, in one place — still listed in its own section below as normal. Onsite ones also won't appear on the Onsite Schedule tab, and unscheduled ones won't appear on the calendars, until fixed.
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {allUnassigned.map((t) => {
              const noUser = t.assignedUsers.length === 0;
              const noSchedule = !hasSchedule(t);
              const missing = [noUser ? "no user" : null, noSchedule ? "no schedule" : null].filter(Boolean).join(" · ");
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: T.panel2, borderRadius: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: T.ink }}>
                      {t.name}
                      {t.onsite && <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: T.accent, background: T.accentSoft, padding: "1px 6px", borderRadius: 999, marginLeft: 7 }}>Onsite</span>}
                    </div>
                    <div style={{ fontFamily: sans, fontSize: 11.5, color: T.sub }}>
                      {t.frequency}{t.client ? ` · ${siteKeyOf(t)}` : ""}{t.days.length ? ` · ${t.days.join(" · ")}` : ""}
                      {" · "}<span style={{ color: "#c0433a", fontWeight: 600 }}>{missing}</span>
                    </div>
                  </div>
                  <button onClick={() => onEdit(t)} style={{ background: "none", border: "none", cursor: "pointer", color: T.faint, padding: 4 }}><Pencil size={15} /></button>
                  <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.faint, padding: 4 }}><Trash2 size={15} /></button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {onsiteRows.length > 0 && (
        <section style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.line}`, overflow: "hidden" }}>
          {sectionHead("onsite", "Onsite Roster", FREQ_COLORS.Onsite, onsiteRows, "drives the roster")}
          {!collapsed.onsite && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr>
                <th style={{ ...th, width: 30 }}></th>
                <th style={{ ...th, paddingLeft: 6 }}>Task</th>
                <th style={th}>Customer</th>
                <th style={th}>Assigned</th>
                <th style={th}>Days</th>
                <th style={{ ...th, textAlign: "right" }}>Hrs/occ</th>
                <th style={{ ...th, textAlign: "right" }}>Wk hrs</th>
                <th style={{ ...th, textAlign: "right", paddingRight: 16 }}></th>
              </tr></thead>
              <tbody>
                {onsiteRows.map((t) => (
                  <tr key={t.id} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    {selectCell(t)}
                    <td style={{ padding: "11px 12px 11px 6px", fontFamily: sans, fontSize: 13.5, color: T.ink, fontWeight: 500 }}>
                      {t.name}
                      {t.notes ? <div style={{ fontSize: 11.5, color: T.faint, marginTop: 2 }}>{t.notes}</div> : null}
                    </td>
                    <td style={{ padding: "11px 12px", fontFamily: sans, fontSize: 12.5, color: t.client ? T.sub : T.faint }}>{siteKeyOf(t) || "—"}</td>
                    {assignedCell(t)}
                    <td style={{ padding: "11px 12px", fontFamily: mono, fontSize: 12, color: T.sub }}>
                      {hasSchedule(t) ? scheduleLabel(t) : <span style={{ fontFamily: sans, fontWeight: 700, color: "#c0433a" }}>no schedule</span>}
                    </td>
                    <td style={{ padding: "11px 12px", textAlign: "right", fontFamily: mono, fontSize: 12.5, color: T.ink }}>{fmt(t.hoursPerOccur)}</td>
                    <td style={{ padding: "11px 12px", textAlign: "right", fontFamily: mono, fontSize: 12.5, fontWeight: 700, color: T.accent }}>{fmt(weeklyEquiv(t))}</td>
                    {actionCell(t)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </section>
      )}

      {grouped.map(({ f, rows }) => (
        <section key={f} style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.line}`, overflow: "hidden" }}>
          {sectionHead(f, `${f} tasks`, FREQ_COLORS[f], rows)}
          {!collapsed[f] && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr>
                <th style={{ ...th, width: 30 }}></th>
                <th style={{ ...th, paddingLeft: 6 }}>Task</th>
                <th style={th}>Customer</th>
                <th style={th}>Assigned</th>
                <th style={th}>Schedule</th>
                <th style={{ ...th, textAlign: "right" }}>Hrs/occ</th>
                <th style={{ ...th, textAlign: "right" }}>Wk hrs</th>
                <th style={{ ...th, textAlign: "right", paddingRight: 16 }}></th>
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    {selectCell(t)}
                    <td style={{ padding: "11px 12px 11px 6px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <input type="checkbox" checked={!!t.completed} onChange={() => onToggleComplete(t.id)} title="Mark complete"
                          style={{ marginTop: 3, width: 14, height: 14, accentColor: T.accent, cursor: "pointer", flexShrink: 0 }} />
                        <div>
                          <div style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 500, color: t.completed ? T.faint : T.ink, textDecoration: t.completed ? "line-through" : "none" }}>{t.name}</div>
                          {t.notes ? <div style={{ fontSize: 11.5, color: T.faint, marginTop: 2 }}>{t.notes}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "11px 12px", fontFamily: sans, fontSize: 12.5, color: t.client ? T.sub : T.faint }}>{siteKeyOf(t) || "—"}</td>
                    {assignedCell(t)}
                    <td style={{ padding: "11px 12px", fontFamily: mono, fontSize: 12, color: T.sub }}>
                      {hasSchedule(t) ? scheduleLabel(t) : <span style={{ fontFamily: sans, fontWeight: 700, color: "#c0433a" }}>no schedule</span>}
                    </td>
                    <td style={{ padding: "11px 12px", textAlign: "right", fontFamily: mono, fontSize: 12.5, color: T.ink }}>{fmt(t.hoursPerOccur)}</td>
                    <td style={{ padding: "11px 12px", textAlign: "right", fontFamily: mono, fontSize: 12.5, fontWeight: 700, color: T.accent }}>{fmt(weeklyEquiv(t))}</td>
                    {actionCell(t)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Onsite roster tab (editable both ways, multi-user)                  */
/* ------------------------------------------------------------------ */
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
// True if `date` falls in an "on" fortnight relative to the anchor date (the week
// containing the anchor itself, and every second week after/before it). No anchor
// means the task can never be placed — Fortnightly requires one.
function isFortnightOnWeek(anchor, date) {
  if (!anchor) return false;
  const anchorMonday = mondayOf(anchor);
  const dateMonday = mondayOf(date);
  const weeksDiff = Math.round((dateMonday - anchorMonday) / (7 * 86400000));
  return ((weeksDiff % 2) + 2) % 2 === 0;
}
// For an onsite task, what fraction of its total weekly hours each person is actually
// responsible for THIS real week — checking any per-week roster swap for each of its
// days, falling back to the regular assignedUsers on days with no swap. Redistributes
// the task's existing weeklyEquiv() total across whoever's covering it this week,
// rather than changing that total — a swap moves hours between people, it doesn't
// create or remove work. With no active swap, every fraction is exactly 1, so this
// reduces to ordinary full-credit-per-person, unchanged from before.
// An onsite task's real hours for one specific week — handles both a recurring
// weekday pattern (days, honouring skipDates and Fortnightly on/off) and a one-off
// task pinned to an exact date (exactDates, which is what a "Just this week" swap
// creates) — a swap-in task has no `days` at all, so it needs its own check here
// rather than falling through the weekday-based logic and silently coming back zero.
function onsiteRealWeekHours(t, refDate) {
  if (!t.onsite || !t.client) return 0;
  const monday = mondayOf(refDate);
  const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
  if (t.exactDates && t.exactDates.length > 0) {
    const hits = t.exactDates.filter((d) => {
      const dd = parseLocalDate(d);
      return dd && dd >= monday && dd <= friday;
    });
    return hits.length * (Number(t.hoursPerOccur) || 0);
  }
  if (!t.days.length) return 0;
  if (t.frequency === "Fortnightly" && !isFortnightOnWeek(parseLocalDate(t.fortnightAnchor), refDate)) return 0;
  let covered = 0;
  t.days.forEach((day) => {
    const dayIdx = DAYS.indexOf(day);
    const date = new Date(monday); date.setDate(monday.getDate() + dayIdx);
    if (!(t.skipDates || []).includes(toLocalISO(date))) covered++;
  });
  return covered * (Number(t.hoursPerOccur) || 0);
}
function firstMondayOfMonth(year, month) {
  const first = new Date(year, month, 1);
  const dow = (first.getDay() + 6) % 7; // Monday = 0
  const offset = dow === 0 ? 0 : 7 - dow;
  return new Date(year, month, 1 + offset);
}
// Every week from the current month's first Monday through the end of next month —
// a genuine two-month schedule, calendar-aligned rather than "4 weeks from today."
// Grouped by month so the roster can show each month as its own labelled section.
function buildScheduleWeeks() {
  const today = new Date();
  const start = firstMondayOfMonth(today.getFullYear(), today.getMonth());
  const end = new Date(today.getFullYear(), today.getMonth() + 2, 0); // last day of next month
  const weeks = [];
  let monday = new Date(start);
  while (monday <= end) {
    const days = DAYS.map((_, idx) => { const d = new Date(monday); d.setDate(monday.getDate() + idx); return d; });
    weeks.push({ monday: new Date(monday), days });
    monday = new Date(monday); monday.setDate(monday.getDate() + 7);
  }
  // Group into month sections for the week-picker UI, each with its own local index.
  const months = [];
  weeks.forEach((w, i) => {
    const label = w.monday.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
    let m = months.find((x) => x.label === label);
    if (!m) { m = { label, weeks: [] }; months.push(m); }
    m.weeks.push({ ...w, globalIndex: i });
  });
  return { weeks, months };
}
const fmtShortDate = (d) => d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });

function Roster({ tasks, users, clients, filters, updateTasks }) {
  const [cell, setCell] = useState(null); // {key, clientName, location, day, date}
  const [assignTask, setAssignTask] = useState(null); // task id
  const { weeks, months } = useMemo(() => buildScheduleWeeks(), []);
  const [weekIdx, setWeekIdx] = useState(() => {
    const today = new Date();
    const idx = weeks.findIndex((w) => w.days.some((d) => d.toDateString() === today.toDateString()));
    return idx === -1 ? 0 : idx;
  });
  const week = weeks[weekIdx];
  const daysShown = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const onsiteTasks = tasks.filter((t) => t.onsite && t.client);
  const unassignedOnsite = onsiteTasks.filter((t) => (t.assignedUsers.length === 0 || !hasSchedule(t)) && (!filters.site || t.client === filters.site || siteKeyOf(t) === filters.site));
  const toggleTaskUser = (taskId, u) => updateTasks(tasks.map((t) => t.id === taskId
    ? { ...t, assignedUsers: t.assignedUsers.includes(u) ? t.assignedUsers.filter((x) => x !== u) : [...t.assignedUsers, u] }
    : t));
  const dateFor = (day, weekObj = week) => weekObj.days[daysShown.indexOf(day)];
  // A cell's regular ("usual") coverage — the recurring weekday/fortnight pattern for
  // this specific real week, honouring any date it's been paused via skipDates.
  const defaultCellUsers = (rowKey, day, weekObj = week) => {
    const set = new Set();
    const date = dateFor(day, weekObj);
    const iso = toLocalISO(date);
    onsiteTasks
      .filter((t) => siteKeyOf(t) === rowKey && t.days.includes(day) && !(t.skipDates || []).includes(iso))
      .filter((t) => t.frequency !== "Fortnightly" || isFortnightOnWeek(parseLocalDate(t.fortnightAnchor), date))
      .forEach((t) => t.assignedUsers.forEach((u) => set.add(u)));
    return [...set];
  };
  // Any swap-in task(s) covering this exact site+date — a real, separate, visible task
  // created specifically for this one occurrence (shows in the Task Register like
  // anything else).
  const swapInTasksFor = (rowKey, day, weekObj = week) => {
    const iso = toLocalISO(dateFor(day, weekObj));
    return onsiteTasks.filter((t) => siteKeyOf(t) === rowKey && t.exactDates && t.exactDates.length === 1 && t.exactDates[0] === iso);
  };
  // Whether this cell has been swapped away from its usual pattern this week.
  const hasSwap = (rowKey, day, weekObj = week) => {
    const iso = toLocalISO(dateFor(day, weekObj));
    const pausedBaseline = onsiteTasks.some((t) => siteKeyOf(t) === rowKey && t.days.includes(day) && (t.skipDates || []).includes(iso));
    return pausedBaseline || swapInTasksFor(rowKey, day, weekObj).length > 0;
  };
  // What actually shows in the grid this week — the usual pattern (minus anyone
  // paused) plus anyone covering via a swap-in task for this exact date.
  const cellUsers = (rowKey, day, weekObj = week) => {
    const set = new Set(defaultCellUsers(rowKey, day, weekObj));
    swapInTasksFor(rowKey, day, weekObj).forEach((t) => t.assignedUsers.forEach((u) => set.add(u)));
    return [...set];
  };
  // Modern, muted per-client palette — scoped to this tab only, so a client's colour
  // stays consistent for its row label, cell background tint, and assigned-person chips.
  const CLIENT_PALETTE = ["#2f6690", "#7c5cbf", "#3d8f7a", "#c9634c", "#b0559c", "#8a8f5c", "#4d6a8a", "#a86b3c"];
  const clientColor = (name) => {
    const idx = clients.findIndex((c) => c.name === name);
    return idx === -1 ? T.accent : CLIENT_PALETTE[idx % CLIENT_PALETTE.length];
  };

  // Client → Locations, filtered and grouped: a client with locations gets a group header
  // row followed by one sub-row per (matching) location; a client with none gets one row.
  const rosterRows = [];
  clients.forEach((c) => {
    const hasLocs = c.locations && c.locations.length > 0;
    if (!hasLocs) {
      if (!filters.site || filters.site === c.name) rosterRows.push({ key: c.name, clientName: c.name, location: "", label: c.name, isGroup: false, isSub: false });
      return;
    }
    const matchingLocs = c.locations.filter((loc) => !filters.site || filters.site === c.name || filters.site === `${c.name} — ${loc}`);
    if (!matchingLocs.length) return;
    rosterRows.push({ key: `__group__${c.name}`, clientName: c.name, label: c.name, isGroup: true });
    matchingLocs.forEach((loc) => rosterRows.push({ key: `${c.name} — ${loc}`, clientName: c.name, location: loc, label: loc, isGroup: false, isSub: true }));
  });

  function parseRowKey(key) {
    const idx = key.indexOf(" — ");
    return idx === -1 ? { clientName: key, location: "" } : { clientName: key.slice(0, idx), location: key.slice(idx + 3) };
  }

  function setDefaultCellUsers(rowKey, day, nextUsers) {
    const { clientName, location } = parseRowKey(rowKey);
    const prev = defaultCellUsers(rowKey, day);
    let next = [...tasks];
    // remove — drop the departing user from this specific day. If their task also
    // covers other days, split them onto their own task for those days, so removing
    // them from just this one day doesn't remove their coverage on the others too.
    prev.filter((u) => !nextUsers.includes(u)).forEach((u) => {
      const affected = next.filter((t) => t.onsite && siteKeyOf(t) === rowKey && t.days.includes(day) && t.assignedUsers.includes(u));
      affected.forEach((t) => {
        next = next.map((x) => x === t ? { ...x, assignedUsers: x.assignedUsers.filter((y) => y !== u) } : x);
        const otherDays = t.days.filter((d) => d !== day);
        if (otherDays.length > 0) {
          next = [...next, mk({ name: t.name, client: t.client, location: t.location, frequency: t.frequency, onsite: true, assignedUsers: [u], hoursPerOccur: t.hoursPerOccur, days: otherDays })];
        }
      });
    });
    // add — merge onto a task that already covers this exact site+day, so two people
    // onsite together land on one shared task instead of two separate ones. Otherwise,
    // if this same person already has their own onsite task at this site, extend its
    // days instead of fragmenting their schedule into a new task per day.
    nextUsers.filter((u) => !prev.includes(u)).forEach((u) => {
      const sharedTask = next.find((t) => t.onsite && siteKeyOf(t) === rowKey && t.days.includes(day));
      if (sharedTask) {
        next = next.map((t) => t === sharedTask ? { ...t, assignedUsers: [...t.assignedUsers, u] } : t);
      } else {
        const ownTask = next.find((t) => t.onsite && siteKeyOf(t) === rowKey && t.assignedUsers.length === 1 && t.assignedUsers[0] === u);
        if (ownTask) {
          next = next.map((t) => t === ownTask ? { ...t, days: DAYS.filter((d) => t.days.includes(d) || d === day) } : t);
        } else {
          next = [...next, mk({ name: "Onsite Support", client: clientName, location, frequency: "Weekly", onsite: true, assignedUsers: [u], hoursPerOccur: 7.5, days: [day] })];
        }
      }
    });
    updateTasks(next);
  }
  // Swap coverage for just this one week — pauses the usual person's task on this one
  // date (splitting them onto their own task first if they share it with others, so
  // the pause only affects them) and creates a real, visible task for whoever's
  // covering instead. Every other week — and the usual pattern itself — is untouched.
  function swapForWeek(rowKey, day, nextUsers) {
    const { clientName, location } = parseRowKey(rowKey);
    const date = dateFor(day);
    const iso = toLocalISO(date);
    const prev = cellUsers(rowKey, day);
    let next = [...tasks];

    prev.filter((u) => !nextUsers.includes(u)).forEach((u) => {
      const baselineMatches = next.filter((t) => t.onsite && siteKeyOf(t) === rowKey && t.days.includes(day) && t.assignedUsers.includes(u) && !(t.exactDates && t.exactDates.length));
      baselineMatches.forEach((t) => {
        if (t.assignedUsers.length === 1) {
          next = next.map((x) => x === t ? { ...x, skipDates: [...new Set([...(x.skipDates || []), iso])] } : x);
        } else {
          next = next.map((x) => x === t ? { ...x, assignedUsers: x.assignedUsers.filter((y) => y !== u) } : x);
          next = [...next, mk({ name: t.name, client: t.client, location: t.location, frequency: t.frequency, onsite: true, assignedUsers: [u], hoursPerOccur: t.hoursPerOccur, days: t.days, skipDates: [iso] })];
        }
      });
      // Also drop them from any swap-in task covering this exact date, undoing a
      // previous swap rather than stacking on top of it.
      next = next
        .map((t) => (t.onsite && siteKeyOf(t) === rowKey && t.exactDates && t.exactDates[0] === iso && t.assignedUsers.includes(u))
          ? { ...t, assignedUsers: t.assignedUsers.filter((y) => y !== u) } : t)
        .filter((t) => !(t.onsite && siteKeyOf(t) === rowKey && t.exactDates && t.exactDates[0] === iso && t.assignedUsers.length === 0));
    });

    nextUsers.filter((u) => !prev.includes(u)).forEach((u) => {
      const existingSwap = next.find((t) => t.onsite && siteKeyOf(t) === rowKey && t.exactDates && t.exactDates.length === 1 && t.exactDates[0] === iso);
      if (existingSwap) {
        next = next.map((t) => t === existingSwap ? { ...t, assignedUsers: [...t.assignedUsers, u] } : t);
      } else {
        const baselineHours = (onsiteTasks.find((t) => siteKeyOf(t) === rowKey && t.days.includes(day)) || {}).hoursPerOccur || 7.5;
        next = [...next, mk({
          name: "Onsite Support (one-off swap)", client: clientName, location, frequency: "Monthly",
          onsite: true, assignedUsers: [u], hoursPerOccur: baselineHours, exactDates: [iso],
          notes: `Covering ${fmtShortDate(date)} only, from a "Just this week" roster swap.`,
        })];
      }
    });

    updateTasks(next);
  }
  // Undo a swap for this one date — un-pauses whoever's usual task was skipped, and
  // removes whatever one-off task was covering it instead.
  const resetWeekToUsual = (rowKey, day) => {
    const iso = toLocalISO(dateFor(day));
    const next = tasks
      .map((t) => (t.onsite && siteKeyOf(t) === rowKey && (t.skipDates || []).includes(iso))
        ? { ...t, skipDates: t.skipDates.filter((d) => d !== iso) }
        : t)
      .filter((t) => !(t.onsite && siteKeyOf(t) === rowKey && t.exactDates && t.exactDates.length === 1 && t.exactDates[0] === iso));
    updateTasks(next);
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ fontFamily: sans, fontSize: 13, color: T.sub, background: T.accentSoft, border: `1px solid ${T.accent}33`, borderRadius: 10, padding: "10px 14px" }}>
        Only tasks flagged <b>Onsite</b> with a client set appear here. Tap any cell to add or remove people — <b>"Just this week"</b> (the default) creates a real task for just this one date, while <b>"Every week"</b> changes the regular pattern itself. Both always show up in the Task Register and count toward hours — a small orange dot marks a cell that's been swapped away from its usual pattern. Hours reflect a swap once its week is the actual current week — a swap set for a future week won't move the numbers until that week arrives.
        Weekly tasks repeat identically every week. Fortnightly tasks alternate based on their anchor week, so switching weeks above will show them appear and disappear on schedule — set the anchor week from the task editor (Onsite tasks show a Frequency field there too).
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {months.map((m) => (
          <div key={m.label}>
            <div style={{ fontFamily: sans, fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: T.faint, marginBottom: 6 }}>{m.label}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {m.weeks.map((w, localIdx) => (
                <button key={w.globalIndex} onClick={() => setWeekIdx(w.globalIndex)}
                  style={{
                    fontFamily: sans, fontSize: 12.5, fontWeight: 700, padding: "7px 13px", borderRadius: 999, cursor: "pointer",
                    border: `1px solid ${w.globalIndex === weekIdx ? T.accent : T.line}`, background: w.globalIndex === weekIdx ? T.accent : T.panel, color: w.globalIndex === weekIdx ? "#fff" : T.sub,
                  }}>
                  Week {localIdx + 1} <span style={{ fontWeight: 500, opacity: .85 }}>· {fmtShortDate(w.days[0])} – {fmtShortDate(w.days[4])}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.line}`, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead><tr>
            <th style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: T.faint, textAlign: "left", padding: "14px 16px", position: "sticky", left: 0, background: T.panel }}>Client</th>
            {daysShown.map((d, i) => (
              <th key={d} style={{ fontFamily: sans, fontSize: 12, fontWeight: 700, color: T.sub, padding: "14px 10px", textAlign: "center", minWidth: 120 }}>
                {d}<div style={{ fontFamily: mono, fontSize: 10.5, fontWeight: 600, color: T.faint, marginTop: 2 }}>{fmtShortDate(week.days[i])}</div>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {rosterRows.map((r) => r.isGroup ? (
              <tr key={r.key} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                <td colSpan={1 + daysShown.length} style={{ fontFamily: sans, fontSize: 12, fontWeight: 700, color: T.ink, padding: "8px 16px", background: T.panel2, position: "sticky", left: 0, borderLeft: `4px solid ${clientColor(r.clientName)}` }}>
                  <MapPin size={12} style={{ verticalAlign: -1, marginRight: 5, color: clientColor(r.clientName) }} />{r.label}
                </td>
              </tr>
            ) : (
              <tr key={r.key} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                <td style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: T.ink, padding: r.isSub ? "10px 16px 10px 34px" : "12px 16px", position: "sticky", left: 0, background: T.panel, borderRight: `1px solid ${T.lineSoft}`, borderLeft: r.isSub ? "none" : `4px solid ${clientColor(r.clientName)}` }}>
                  {r.isSub
                    ? <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 3, background: clientColor(r.clientName), marginRight: 8, verticalAlign: 1 }} />
                    : <MapPin size={12} style={{ verticalAlign: -1, marginRight: 5, color: clientColor(r.clientName) }} />}
                  {r.label}
                </td>
                {daysShown.map((d) => {
                  const cu = cellUsers(r.key, d).filter((u) => !filters.user || u === filters.user);
                  const has = cu.length > 0;
                  const swapped = hasSwap(r.key, d);
                  const color = clientColor(r.clientName);
                  return (
                    <td key={d} onClick={() => setCell({ key: r.key, label: r.isSub ? `${r.clientName} — ${r.label}` : r.label, day: d, date: week.days[daysShown.indexOf(d)] })}
                      style={{ padding: 7, textAlign: "center", cursor: "pointer", verticalAlign: "middle", background: has ? `${color}1c` : "transparent", position: "relative" }}>
                      {swapped && (
                        <span title="Swapped just for this week" style={{ position: "absolute", top: 3, right: 3, width: 7, height: 7, borderRadius: 999, background: T.warn }} />
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", minHeight: 24, alignItems: "center" }}>
                        {has ? cu.map((u) => (
                          <span key={u} style={{ fontFamily: sans, fontSize: 11.5, fontWeight: 700, color: "#fff", background: color, padding: "3px 8px", borderRadius: 999 }}>{u}</span>
                        )) : <span style={{ color: T.line, fontSize: 16 }}>+</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unassignedOnsite.length > 0 && (
        <div style={{ background: T.panel, border: `1px dashed ${T.line}`, borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 13.5, color: T.ink }}>Unassigned onsite tasks</div>
          <div style={{ fontFamily: sans, fontSize: 12, color: T.sub, margin: "4px 0 12px" }}>
            Flagged Onsite with a client set, but missing a person, a day, or both — so they can't appear in the grid above. Tap one to fix it.
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {unassignedOnsite.map((t) => {
              const noUser = t.assignedUsers.length === 0;
              const noSchedule = !hasSchedule(t);
              const missing = [noUser ? "no user" : null, noSchedule ? "no schedule" : null].filter(Boolean).join(" · ");
              return (
                <div key={t.id} onClick={() => setAssignTask(t.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: T.panel2, borderRadius: 8, cursor: "pointer" }}>
                  <MapPin size={13} color={T.accent} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: T.ink }}>{t.name}</div>
                    <div style={{ fontFamily: sans, fontSize: 11.5, color: T.sub }}>
                      {siteKeyOf(t)}{t.days.length ? ` · ${t.days.join(" · ")}` : ""}
                      {" · "}<span style={{ color: "#c0433a", fontWeight: 600 }}>{missing}</span>
                    </div>
                  </div>
                  <span style={{ fontFamily: sans, fontSize: 12, fontWeight: 700, color: T.accent }}>Fix →</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {assignTask && (() => {
        const task = tasks.find((x) => x.id === assignTask);
        if (!task) return null;
        const toggleTaskDay = (d) => updateTasks(tasks.map((x) => x.id === task.id
          ? { ...x, days: x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d] }
          : x));
        return (
          <div onClick={() => setAssignTask(null)} style={{ position: "fixed", inset: 0, background: "rgba(16,24,32,.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: T.panel, borderRadius: 14, width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(16,24,32,.28)" }}>
              <div style={{ padding: "18px 20px", borderBottom: `1px solid ${T.lineSoft}` }}>
                <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, color: T.ink }}>{task.name}</div>
                <div style={{ fontFamily: sans, fontSize: 13, color: T.sub }}>{siteKeyOf(task)}</div>
              </div>
              {!hasSchedule(task) && (
                <div style={{ padding: "16px 20px 4px" }}>
                  <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, marginBottom: 8 }}>Days</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {DAYS.map((d) => <Chip key={d} label={d} on={task.days.includes(d)} onClick={() => toggleTaskDay(d)} />)}
                  </div>
                </div>
              )}
              <div style={{ padding: 20 }}>
                <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, marginBottom: 8 }}>Who's covering it?</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {users.map((u) => <Chip key={u} label={u} on={task.assignedUsers.includes(u)} onClick={() => toggleTaskUser(task.id, u)} />)}
                </div>
              </div>
              <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.lineSoft}`, display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setAssignTask(null)} style={{ fontFamily: sans, fontSize: 14, fontWeight: 700, padding: "8px 18px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", cursor: "pointer" }}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}

      {cell && (() => {
        const isSwapped = hasSwap(cell.key, cell.day);
        // Always defaults to "this week only" now — since a swap creates a real,
        // visible task either way, there's no longer a reason to default to changing
        // the permanent pattern just because a cell happens to be empty.
        const scope = cell.scope || "week";
        const setScope = (s) => setCell((p) => ({ ...p, scope: s }));
        const current = scope === "week" ? cellUsers(cell.key, cell.day) : defaultCellUsers(cell.key, cell.day);
        return (
          <div onClick={() => setCell(null)} style={{ position: "fixed", inset: 0, background: "rgba(16,24,32,.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: T.panel, borderRadius: 14, width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(16,24,32,.28)" }}>
              <div style={{ padding: "18px 20px", borderBottom: `1px solid ${T.lineSoft}` }}>
                <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, color: T.ink }}>{cell.label}</div>
                <div style={{ fontFamily: sans, fontSize: 13, color: T.sub }}>Who's onsite on {cell.day}{cell.date ? ` (${fmtShortDate(cell.date)})` : ""}?</div>
              </div>
              <div style={{ padding: "14px 20px 0" }}>
                <div style={{ display: "flex", gap: 6, background: T.panel2, borderRadius: 9, padding: 3 }}>
                  <button onClick={() => setScope("week")}
                    style={{ flex: 1, fontFamily: sans, fontSize: 12.5, fontWeight: 700, padding: "7px 10px", borderRadius: 7, border: "none", cursor: "pointer", background: scope === "week" ? T.accent : "transparent", color: scope === "week" ? "#fff" : T.sub }}>
                    Just this week
                  </button>
                  <button onClick={() => setScope("always")}
                    style={{ flex: 1, fontFamily: sans, fontSize: 12.5, fontWeight: 700, padding: "7px 10px", borderRadius: 7, border: "none", cursor: "pointer", background: scope === "always" ? T.accent : "transparent", color: scope === "always" ? "#fff" : T.sub }}>
                    Every week (usual)
                  </button>
                </div>
                <div style={{ fontFamily: sans, fontSize: 11.5, color: T.faint, marginTop: 7 }}>
                  {scope === "week"
                    ? "Creates a real task for just this one date — every other week keeps its usual pattern, untouched."
                    : "Changes the regular pattern itself — affects this and every future week."}
                </div>
              </div>
              <div style={{ padding: 20, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {users.map((u) => {
                  const on = current.includes(u);
                  return <Chip key={u} label={u} on={on} color={clientColor(parseRowKey(cell.key).clientName)} onClick={() => {
                    const next = on ? current.filter((x) => x !== u) : [...current, u];
                    if (scope === "week") swapForWeek(cell.key, cell.day, next);
                    else setDefaultCellUsers(cell.key, cell.day, next);
                  }} />;
                })}
              </div>
              <div style={{ padding: "0 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {isSwapped ? (
                  <button onClick={() => resetWeekToUsual(cell.key, cell.day)}
                    style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: sans, fontSize: 12.5, fontWeight: 600, color: T.accent, background: "none", border: "none", cursor: "pointer" }}>
                    <RotateCcw size={13} /> Reset this week to usual
                  </button>
                ) : <span />}
              </div>
              <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.lineSoft}`, display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setCell(null)} style={{ fontFamily: sans, fontSize: 14, fontWeight: 700, padding: "8px 18px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", cursor: "pointer" }}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Headcount tab                                                      */
/* ------------------------------------------------------------------ */
function perUser(tasks, user) {
  const today = new Date();
  // The real weeks belonging to the current calendar month (a month can genuinely
  // have 4, 5, or 6 Mon-Fri weeks depending on how it falls) — matches the roster's
  // own month-aligned weeks, rather than an arbitrary flat 4-week window.
  const thisMonthStart = firstMondayOfMonth(today.getFullYear(), today.getMonth());
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const weekDates = [];
  for (let d = new Date(thisMonthStart); d <= monthEnd; d.setDate(d.getDate() + 7)) weekDates.push(new Date(d));
  const mine = tasks.filter((t) => t.assignedUsers.includes(user));
  const sumH = (f) => mine.filter((t) => t.frequency === f).reduce((a, t) => {
    if (t.onsite && t.client) return a + onsiteRealWeekHours(t, today);
    return a + (Number(t.hoursPerOccur) || 0) * userHourFraction(t, user);
  }, 0);
  const daily = sumH("Daily");
  const weekly = sumH("Weekly");
  const monthly = sumH("Monthly");
  const onsite = mine.filter((t) => t.onsite).reduce((a, t) => a + onsiteRealWeekHours(t, today), 0);
  const totWk = mine.reduce((a, t) => {
    if (t.onsite && t.client) return a + onsiteRealWeekHours(t, today);
    return a + weeklyEquiv(t) * userHourFraction(t, user);
  }, 0);
  // Monthly: for onsite tasks, sum real hours across every actual week in the current
  // calendar month (skipped/one-off dates correctly land in whichever week they're
  // actually in) instead of extrapolating from a single snapshot. Everything else
  // still uses the steady monthlyEquiv() estimate; there's no per-week visibility to
  // sum for non-onsite tasks.
  const totMo = mine.reduce((a, t) => {
    if (t.onsite && t.client) {
      return a + weekDates.reduce((s, d) => s + onsiteRealWeekHours(t, d), 0);
    }
    return a + monthlyEquiv(t) * userHourFraction(t, user);
  }, 0);
  return { daily, weekly, monthly, onsite, totWk, totMo, fte: totWk / BENCHMARK };
}
function Headcount({ tasks, users }) {
  const rows = users.map((u) => ({ u, ...perUser(tasks, u) }));
  const tot = rows.reduce((a, r) => ({
    daily: a.daily + r.daily, weekly: a.weekly + r.weekly, monthly: a.monthly + r.monthly,
    onsite: a.onsite + r.onsite, totWk: a.totWk + r.totWk, totMo: a.totMo + r.totMo,
  }), { daily: 0, weekly: 0, monthly: 0, onsite: 0, totWk: 0, totMo: 0 });
  // Team weekly/monthly load (the two headline cards) blends in unassigned hours —
  // work with nobody attached still counts toward the team's real total workload,
  // even though it isn't any one person's number in the table below.
  const unassignedTasks = tasks.filter((t) => t.assignedUsers.length === 0);
  const unassignedWk = unassignedTasks.reduce((a, t) => a + weeklyEquiv(t), 0);
  const unassignedMo = unassignedTasks.reduce((a, t) => a + monthlyEquiv(t), 0);
  const teamWk = tot.totWk + unassignedWk;
  const teamMo = tot.totMo + unassignedMo;
  const weeklyCapacity = BENCHMARK * users.length;
  const monthlyCapacity = BENCHMARK * 4.33 * users.length;
  const th = { fontFamily: sans, fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, padding: "0 12px 10px" };
  const num = { fontFamily: mono, fontSize: 12.5, color: T.ink, textAlign: "right", padding: "12px" };
  const weeklyPct = Math.round((teamWk / weeklyCapacity) * 100);
  const monthlyPct = Math.round((teamMo / monthlyCapacity) * 100);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
        {[
          ["Team weekly load", `${fmt(teamWk)} / ${fmt(weeklyCapacity)} h`, weeklyPct],
          ["Team monthly load", `${fmt(teamMo)} / ${fmt(monthlyCapacity)} h`, monthlyPct],
          ["Onsite hrs / wk", `${fmt(tot.onsite)} h`, null],
          ["Benchmark", `${BENCHMARK} h / person`, null],
        ].map(([l, v, pct]) => (
          <div key={l} style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: T.faint }}>{l}</div>
            <div style={{ fontFamily: mono, fontSize: 22, fontWeight: 700, color: T.ink, marginTop: 4 }}>{v}</div>
            {pct !== null && (
              <span style={{
                display: "inline-block", marginTop: 7, fontFamily: sans, fontSize: 11.5, fontWeight: 700,
                color: utilColor(pct / 100).c, background: `${utilColor(pct / 100).c}1a`, padding: "3px 10px", borderRadius: 999,
              }}>
                {pct}% of capacity
              </span>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontFamily: sans, fontSize: 11.5, color: T.faint }}>
        Team weekly/monthly load includes every hour, whether or not it's assigned to a real person — unassigned work still counts toward the total and the % of capacity. The table below only shows real people, so its per-person figures (and the "Total team load" row) don't include unassigned hours the same way. Per-person onsite hours reflect any "just this week" roster swap for the actual current week — a swap scheduled for a future week won't move these numbers until that week arrives.
      </div>
      <div style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.line}`, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left", paddingLeft: 16 }}>User</th>
            <th style={{ ...th, textAlign: "right" }}>Daily h/day</th>
            <th style={{ ...th, textAlign: "right" }}>Weekly h/wk</th>
            <th style={{ ...th, textAlign: "right" }}>Monthly h/mo</th>
            <th style={{ ...th, textAlign: "right" }}>Onsite h/wk</th>
            <th style={{ ...th, textAlign: "right" }}>Total wk</th>
            <th style={{ ...th, textAlign: "right" }}>Total mo</th>
            <th style={{ ...th, textAlign: "left", width: 190 }}>Capacity vs 38h</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const uc = utilColor(r.fte);
              return (
                <tr key={r.u} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                  <td style={{ padding: "12px 12px 12px 16px", fontFamily: sans, fontSize: 13.5, fontWeight: 600, color: T.ink }}>{r.u}</td>
                  <td style={num}>{fmt(r.daily)}</td>
                  <td style={num}>{fmt(r.weekly)}</td>
                  <td style={num}>{fmt(r.monthly)}</td>
                  <td style={num}>{fmt(r.onsite)}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{fmt(r.totWk)}</td>
                  <td style={num}>{fmt(r.totMo)}</td>
                  <td style={{ padding: "12px 16px 12px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1 }}><LoadBar hours={r.totWk} /></div>
                      <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: uc.c, width: 42, textAlign: "right" }}>{Math.round(r.fte * 100)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: `2px solid ${T.line}`, background: T.panel2 }}>
              <td style={{ padding: "12px 12px 12px 16px", fontFamily: sans, fontSize: 13, fontWeight: 700, color: T.ink }}>Total team load</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmt(tot.daily)}</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmt(tot.weekly)}</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmt(tot.monthly)}</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmt(tot.onsite)}</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmt(tot.totWk)}</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmt(tot.totMo)}</td>
              <td style={{ padding: "12px 16px", fontFamily: mono, fontSize: 12, color: T.sub }}>{fmt(tot.totWk / BENCHMARK)} FTE</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Analytics tab                                                      */
/* ------------------------------------------------------------------ */
function Analytics({ tasks, users, clients }) {
  const freqData = useMemo(() => {
    const hrs = (list) => list.reduce((a, t) => a + weeklyEquiv(t) * teamShareMultiplier(t), 0);
    const unassigned = tasks.filter((t) => t.assignedUsers.length === 0);
    const assigned = tasks.filter((t) => t.assignedUsers.length > 0);
    const unassignedSlice = { name: "Unassigned", value: hrs(unassigned) };
    const onsiteSlice = { name: "Onsite", value: hrs(assigned.filter((t) => t.onsite)) };
    const rest = FREQUENCIES.map((f) => ({ name: f, value: hrs(assigned.filter((t) => t.frequency === f && !t.onsite)) }));
    return [unassignedSlice, onsiteSlice, ...rest].filter((d) => d.value > 0.05);
  }, [tasks]);
  const total = freqData.reduce((a, d) => a + d.value, 0);
  const unassignedLoad = useMemo(() => {
    const list = tasks.filter((t) => t.assignedUsers.length === 0);
    return Math.round(list.reduce((a, t) => a + weeklyEquiv(t), 0) * 10) / 10;
  }, [tasks]);
  const loadData = useMemo(() => {
    const base = users.map((u) => ({ name: u, load: Math.round(perUser(tasks, u).totWk * 10) / 10 }));
    const withUnassigned = unassignedLoad > 0.05 ? [...base, { name: "Unassigned", load: unassignedLoad }] : base;
    return withUnassigned.sort((a, b) => b.load - a.load);
  }, [tasks, users, unassignedLoad]);
  // Per-client rollup — every task attached to a client, regardless of onsite/location
  // specifics, schedule status, or assignment. Same rule as everywhere else: hours
  // count if they exist, full stop.
  const clientRows = useMemo(() => {
    return (clients || [])
      .map((c) => {
        const mine = tasks.filter((t) => t.client === c.name);
        const weekly = Math.round(mine.reduce((a, t) => a + weeklyEquiv(t) * teamShareMultiplier(t), 0) * 10) / 10;
        const monthly = Math.round(mine.reduce((a, t) => a + monthlyEquiv(t) * teamShareMultiplier(t), 0) * 10) / 10;
        return { name: c.name, weekly, monthly, tasks: mine };
      })
      .filter((c) => c.weekly > 0.05)
      .sort((a, b) => b.weekly - a.weekly);
  }, [tasks, clients]);

  const card = { background: T.panel, borderRadius: 12, border: `1px solid ${T.line}`, padding: "18px 18px 8px" };
  const title = { fontFamily: sans, fontWeight: 700, fontSize: 15, color: T.ink };
  const sub = { fontFamily: sans, fontSize: 12.5, color: T.sub, margin: "2px 0 14px" };

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr", }}>
      <div style={card}>
        <div style={title}>Weekly load by engineer</div>
        <div style={sub}>Person-hours against the 38-hour full-time line. Anything past the line is over capacity — the Unassigned bar (if shown) is work with nobody attached yet, not a real person's load.</div>
        <div style={{ height: Math.max(220, loadData.length * 34) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={loadData} layout="vertical" margin={{ left: 6, right: 30, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke={T.lineSoft} />
              <XAxis type="number" tick={{ fontFamily: mono, fontSize: 11, fill: T.sub }} />
              <YAxis type="category" dataKey="name" width={78} tick={{ fontFamily: sans, fontSize: 12, fill: T.ink }} />
              <Tooltip formatter={(v) => [`${v} h/wk`, "Load"]} contentStyle={{ fontFamily: sans, fontSize: 12, borderRadius: 8, border: `1px solid ${T.line}` }} />
              <ReferenceLine x={BENCHMARK} stroke={T.ink} strokeDasharray="4 3" label={{ value: "38h", position: "top", fontSize: 11, fill: T.sub }} />
              <Bar dataKey="load" radius={[0, 5, 5, 0]} barSize={18}>
                {loadData.map((d, i) => <Cell key={i} fill={d.name === "Unassigned" ? "#c0433a" : utilColor(d.load / BENCHMARK).c} />)}
                <LabelList dataKey="load" position="right" style={{ fontFamily: mono, fontSize: 11, fill: T.sub }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={card}>
        <div style={title}>Where the team's time goes</div>
        <div style={sub}>Share of weekly person-hours by task frequency — onsite work sits alongside the recurring load, and anything with nobody assigned is broken out separately rather than blended in.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <div style={{ height: 300, width: 300, maxWidth: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={freqData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={110} paddingAngle={2} stroke="none">
                  {freqData.map((d) => <Cell key={d.name} fill={FREQ_COLORS[d.name]} />)}
                </Pie>
                <Tooltip formatter={(v) => [`${fmt(v)} h/wk (${Math.round((v / total) * 100)}%)`]} contentStyle={{ fontFamily: sans, fontSize: 12, borderRadius: 8, border: `1px solid ${T.line}` }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 8 }}>
            {[...freqData].sort((a, b) => b.value - a.value).map((d) => (
              <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: FREQ_COLORS[d.name] }} />
                <span style={{ fontFamily: sans, fontSize: 13, color: T.ink, flex: 1 }}>{d.name}</span>
                <span style={{ fontFamily: mono, fontSize: 12.5, color: T.sub }}>{fmt(d.value)}h</span>
                <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700, color: T.ink, width: 42, textAlign: "right" }}>{Math.round((d.value / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {clientRows.length > 0 && (
        <div style={card}>
          <div style={title}>Client hours per week</div>
          <div style={sub}>Weekly load by client, ranked highest first — the list below the chart shows exactly what work makes up each client's time.</div>
          <div style={{ height: Math.max(180, clientRows.length * 34) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientRows} layout="vertical" margin={{ left: 6, right: 30, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke={T.lineSoft} />
                <XAxis type="number" tick={{ fontFamily: mono, fontSize: 11, fill: T.sub }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontFamily: sans, fontSize: 12, fill: T.ink }} />
                <Tooltip formatter={(v) => [`${v} h/wk`, "Load"]} contentStyle={{ fontFamily: sans, fontSize: 12, borderRadius: 8, border: `1px solid ${T.line}` }} />
                <Bar dataKey="weekly" radius={[0, 5, 5, 0]} barSize={18} fill={T.accent}>
                  <LabelList dataKey="weekly" position="right" style={{ fontFamily: mono, fontSize: 11, fill: T.sub }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 14, marginBottom: 4 }}>
            {clientRows.map((c) => (
              <div key={c.name} style={{ padding: "10px 12px", background: T.panel2, borderRadius: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 13.5, color: T.ink }}>{c.name}</span>
                  <span style={{ fontFamily: mono, fontSize: 12, color: T.sub }}>{fmt(c.weekly)}h/wk · {fmt(c.monthly)}h/mo</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                  {c.tasks.map((t) => (
                    <span key={t.id} title={t.location ? `${t.name} — ${t.location}` : t.name}
                      style={{
                        fontFamily: sans, fontSize: 11, fontWeight: 600, color: "#fff",
                        background: t.onsite ? FREQ_COLORS.Onsite : FREQ_COLORS[t.frequency],
                        padding: "3px 8px", borderRadius: 6,
                      }}>
                      {abbreviateTask(t.name, 26)}{t.location ? ` (${t.location})` : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Capacity calendar — live month view, one block per person/task/day  */
/* ------------------------------------------------------------------ */
const LEGEND_KEYS = ["Onsite", ...FREQUENCIES];

// Every task scheduled to land on a given date, resolved against whichever
// mechanism it uses (weekday, day-of-month/range, ordinal/range, or annual/range).
// Shared by the agenda list for any month it's asked to render.
function getDayTasks(tasks, year, month, date) {
  const wd = DAYS[(date.getDay() + 6) % 7];
  const iso = toLocalISO(date);
  return tasks.filter((t) => {
    if (t.skipDates && t.skipDates.includes(iso)) return false;
    const byWeekday = USES_DAYS.includes(t.frequency) && t.days.includes(wd)
      && (t.frequency !== "Fortnightly" || isFortnightOnWeek(parseLocalDate(t.fortnightAnchor), date));
    const byOrdinal = (() => {
      if (!(t.ordinalWeek && t.ordinalDay)) return false;
      const anchor = nthWeekdayOfMonth(year, month, t.ordinalDay, t.ordinalWeek);
      if (anchor == null) return false;
      const offsets = [0, ...(t.ordinalOffsets || [])];
      return offsets.includes(date.getDate() - anchor);
    })();
    const byExactDate = t.exactDates && t.exactDates.length > 0 && t.exactDates.some((d) => {
      const dd = parseLocalDate(d);
      return dd && dd.toDateString() === date.toDateString();
    });
    return byWeekday || byOrdinal || byExactDate;
  });
}
// Total person-hours assigned on a given date (each assigned person counted separately,
// consistent with how the rest of the app treats workload). Shared by the top "Today"
// stat and each day row's own assigned/capacity line.
function dayHoursTotal(tasks, year, month, date) {
  const dayTasks = getDayTasks(tasks, year, month, date);
  return dayTasks.reduce((sum, t) => {
    const offset = t.splitHours ? getRangeOffset(t, year, month, date.getDate()) : null;
    const perPerson = (offset != null && t.dailyHours && t.dailyHours[offset] != null)
      ? Number(t.dailyHours[offset]) || 0
      : (Number(t.hoursPerOccur) || 0);
    return sum + perPerson * teamShareMultiplier(t);
  }, 0);
}

// One month, rendered as a scannable vertical list — no horizontal scrolling,
// each day gets as much width as the screen has rather than a cramped 1/7 column.
function MonthAgenda({ tasks, monthDate, dailyCapacity }) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = useMemo(() => new Date(), []);
  const monthLabel = monthDate.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const days = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1));

  return (
    <div>
      <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 15.5, color: T.ink, marginBottom: 8 }}>{monthLabel}</div>
      <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, overflow: "hidden" }}>
        {days.map((date, i) => {
          const wd = DAYS[(date.getDay() + 6) % 7];
          const isWeekend = wd === "Sat" || wd === "Sun";
          const isToday = date.toDateString() === today.toDateString();
          const dayTasks = getDayTasks(tasks, year, month, date);
          const dayTotal = isWeekend ? null : dayHoursTotal(tasks, year, month, date);
          const byPerson = {};
          dayTasks.forEach((t) => t.assignedUsers.forEach((u) => {
            if (!byPerson[u]) byPerson[u] = { hours: 0, items: [] };
            const offset = t.splitHours ? getRangeOffset(t, year, month, date.getDate()) : null;
            const dayHours = (offset != null && t.dailyHours && t.dailyHours[offset] != null)
              ? Number(t.dailyHours[offset]) || 0
              : (Number(t.hoursPerOccur) || 0);
            byPerson[u].hours += dayHours * userHourFraction(t, u);
            byPerson[u].items.push(t);
          }));
          const people = Object.keys(byPerson).sort();
          return (
            <div key={i} style={{
              padding: "10px 14px", borderBottom: i < days.length - 1 ? `1px solid ${T.lineSoft}` : "none",
              background: isToday ? T.accentSoft : T.panel,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                <span style={{ fontFamily: mono, fontWeight: isToday ? 800 : 700, fontSize: 13, color: isToday ? T.accent : T.ink, minWidth: 58 }}>{wd} {date.getDate()}</span>
                {isToday && <span style={{ fontFamily: sans, fontSize: 10, fontWeight: 700, color: T.accent, background: T.panel, padding: "1px 7px", borderRadius: 999, border: `1px solid ${T.accent}` }}>Today</span>}
                {dayTotal !== null && (
                  <span style={{ fontFamily: sans, fontSize: 12, color: T.faint, fontWeight: 500 }}>{fmt(dayTotal)}h / {fmt(dailyCapacity)}h</span>
                )}
                {people.length === 0 && <span style={{ fontFamily: sans, fontSize: 12, color: T.line }}>—</span>}
              </div>
              {people.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
                  {people.map((u) => (
                    <div key={u} title={byPerson[u].items.map((t) => t.name).join(", ")}>
                      <div style={{ fontFamily: sans, fontSize: 12, fontWeight: 700, color: T.ink }}>
                        {u} <span style={{ color: T.faint, fontWeight: 500 }}>· {fmt(byPerson[u].hours)}h</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 3 }}>
                        {byPerson[u].items.map((t) => (
                          <span key={t.id} title={`${t.name}${t.client ? ` — ${siteKeyOf(t)}` : ""}`}
                            style={{
                              fontFamily: sans, fontSize: 11, fontWeight: 600, color: "#fff",
                              background: t.onsite ? FREQ_COLORS.Onsite : FREQ_COLORS[t.frequency],
                              padding: "3px 8px", borderRadius: 6, lineHeight: 1.4,
                            }}>
                            {abbreviateTask(t.onsite ? `Onsite — ${siteKeyOf(t)}` : t.name, 28)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CapacityCalendar({ tasks, users, onToggleDay, onToggleUser }) {
  const today = useMemo(() => new Date(), []);
  const thisMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);
  const nextMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth() + 1, 1), [today]);
  const [dayPickTask, setDayPickTask] = useState(null); // task id

  const todayHours = useMemo(() => dayHoursTotal(tasks, today.getFullYear(), today.getMonth(), today), [tasks, today]);
  const dailyCapacity = (BENCHMARK / 5) * users.length;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 17, color: T.ink }}>Next 2 months</div>
          <div style={{ fontFamily: sans, fontSize: 12.5, color: T.sub, marginTop: 2 }}>
            Live view of who's doing what, each day, across the whole team. Tasks can be pinned to a weekday, a specific date each month, or left unscheduled below if neither fits.
          </div>
          <div style={{ fontFamily: sans, fontSize: 12.5, color: T.sub, marginTop: 4 }}>
            Today: <span style={{ fontFamily: sans, fontSize: 12, color: T.faint, fontWeight: 500 }}>{fmt(todayHours)}h</span> assigned · <span style={{ fontFamily: sans, fontSize: 12, color: T.faint, fontWeight: 500 }}>{fmt(dailyCapacity)}h</span> daily capacity
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {LEGEND_KEYS.map((f) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: FREQ_COLORS[f] }} />
              <span style={{ fontFamily: sans, fontSize: 11.5, color: T.sub }}>{f}</span>
            </div>
          ))}
        </div>
      </div>

      <MonthAgenda tasks={tasks} monthDate={thisMonth} dailyCapacity={dailyCapacity} />
      <MonthAgenda tasks={tasks} monthDate={nextMonth} dailyCapacity={dailyCapacity} />

      {(() => {
        const unscheduled = tasks.filter((t) => t.assignedUsers.length === 0 || !hasSchedule(t));
        if (!unscheduled.length) return null;
        return (
          <div style={{ background: T.panel, border: `1px dashed ${T.line}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 13.5, color: T.ink }}>Unscheduled</div>
            <div style={{ fontFamily: sans, fontSize: 12, color: T.sub, margin: "4px 0 12px" }}>
              Every task missing a person, a schedule, or both — the same rule as the Task Register and Onsite Schedule. Tap one to fix it directly.
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {unscheduled.map((t) => {
                const noUser = t.assignedUsers.length === 0;
                const noSchedule = !hasSchedule(t);
                const missing = [noUser ? "no user" : null, noSchedule ? "no schedule" : null].filter(Boolean).join(" · ");
                return (
                  <div key={t.id} onClick={() => setDayPickTask(t.id)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: T.panel2, borderRadius: 8, cursor: "pointer" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: t.onsite ? FREQ_COLORS.Onsite : FREQ_COLORS[t.frequency], flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: T.ink }}>{t.name}</div>
                      <div style={{ fontFamily: sans, fontSize: 11.5, color: T.sub }}>
                        {(() => {
                          const context = [
                            t.assignedUsers.length ? t.assignedUsers.join(", ") : null,
                            t.onsite && t.client ? siteKeyOf(t) : null,
                          ].filter(Boolean).join(" · ");
                          return (
                            <>
                              {context}{context ? " · " : ""}
                              <span style={{ color: "#c0433a", fontWeight: 600 }}>{missing}</span>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    <span style={{ fontFamily: sans, fontSize: 12, fontWeight: 700, color: T.accent }}>Fix →</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {dayPickTask && (() => {
        const task = tasks.find((x) => x.id === dayPickTask);
        if (!task) return null;
        const noSchedule = !hasSchedule(task);
        return (
          <div onClick={() => setDayPickTask(null)} style={{ position: "fixed", inset: 0, background: "rgba(16,24,32,.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: T.panel, borderRadius: 14, width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(16,24,32,.28)" }}>
              <div style={{ padding: "18px 20px", borderBottom: `1px solid ${T.lineSoft}` }}>
                <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, color: T.ink }}>{task.name}</div>
                <div style={{ fontFamily: sans, fontSize: 13, color: T.sub }}>{task.onsite && task.client ? siteKeyOf(task) : task.frequency}</div>
              </div>
              {noSchedule && (
                <div style={{ padding: "16px 20px 4px" }}>
                  <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, marginBottom: 8 }}>Which weekdays does this run on?</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {DAYS.map((d) => <Chip key={d} label={d} on={task.days.includes(d)} onClick={() => onToggleDay(task.id, d)} />)}
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 11.5, color: T.faint, marginTop: 8 }}>
                    Need a specific date-of-month or ordinal pattern (like "Second Tuesday") instead? Edit the task from the Task Register.
                  </div>
                </div>
              )}
              <div style={{ padding: 20 }}>
                <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, marginBottom: 8 }}>Who's covering it?</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {users.map((u) => <Chip key={u} label={u} on={task.assignedUsers.includes(u)} onClick={() => onToggleUser(task.id, u)} />)}
                </div>
              </div>
              <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.lineSoft}`, display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setDayPickTask(null)} style={{ fontFamily: sans, fontSize: 14, fontWeight: 700, padding: "8px 18px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", cursor: "pointer" }}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Overview — what each tab is for, landing page                      */
/* ------------------------------------------------------------------ */
const OVERVIEW_SECTIONS = [
  {
    id: "register", icon: LayoutList, title: "Task Register",
    desc: "Every task lives here — onsite, patching, all of it — as one complete list view, grouped by how often it runs. Tick tasks off as complete, edit hours/assignments/schedule, and check the Unassigned User & Schedule Summary panel at the top for anything missing a person or a schedule.",
  },
  {
    id: "roster", icon: CalendarDays, title: "Onsite Schedule",
    desc: "Who's onsite, where, and on which day — grouped by client with multi-site clients (like Ports Victoria or PICAC) broken into their locations. Tap a cell to add or remove people; browse 4 weeks ahead with real dates.",
  },
  {
    id: "patchingCalendar", icon: Wrench, title: "Patching Schedule", badge: "Coming soon",
    desc: "A live 2-month list showing only tasks flagged Patching, giving patch work its own dedicated space to plan and dig into the detail.",
  },
  {
    id: "calendar", icon: Calendar, title: "Calendar Summary",
    desc: "The same tasks as the Task Register — onsite, patching, everything — shown as a live, scrollable list covering this month and next, colour-coded by frequency. Tasks with no weekday, date-of-month, or ordinal pattern set appear under \"Unscheduled\".",
  },
  {
    id: "analytics", icon: PieIcon, title: "Analytics",
    desc: "Charts showing where the team's time goes by frequency, plus the Headcount table beneath it \u2014 each person's weekly/monthly load and how it stacks up against the 38h capacity benchmark.",
  },
  {
    id: "settings", icon: Settings2, title: "Team & Clients",
    desc: "Manage the people and clients used everywhere else in the app \u2014 add or remove team members, and add clients with their locations (for clients with more than one site).",
  },
];
function Overview({ onNavigate }) {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 19, color: T.ink }}>What's where</div>
        <div style={{ fontFamily: sans, fontSize: 13.5, color: T.sub, marginTop: 4 }}>A quick guide to each section — click a card to jump straight there.</div>
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        {OVERVIEW_SECTIONS.map((s) => (
          <button key={s.id} onClick={() => onNavigate(s.id)}
            style={{ textAlign: "left", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: 18, cursor: "pointer", display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: T.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <s.icon size={17} color={T.accent} />
              </div>
              <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, color: T.ink }}>{s.title}</span>
              {s.badge && (
                <span style={{ marginLeft: "auto", whiteSpace: "nowrap", fontFamily: sans, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: T.accentSoft, color: T.accent, border: `1px solid ${T.accent}33` }}>
                  {s.badge}
                </span>
              )}
            </div>
            <div style={{ fontFamily: sans, fontSize: 12.5, color: T.sub, lineHeight: 1.55 }}>{s.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings — team & clients (flexibility)                            */
/* ------------------------------------------------------------------ */
function Settings({ users, clients, setUsers, setClients, tasks }) {
  const [nu, setNu] = useState("");
  const [nc, setNc] = useState("");
  const [locInputs, setLocInputs] = useState({});
  const [confirm, setConfirm] = useState(null); // { title, message, action }
  const box = { background: T.panel, borderRadius: 12, border: `1px solid ${T.line}`, padding: 18 };
  const inp = { fontFamily: sans, fontSize: 14, padding: "8px 11px", border: `1px solid ${T.line}`, borderRadius: 8, flex: 1 };
  const addBtn = { fontFamily: sans, fontWeight: 700, fontSize: 13, padding: "8px 14px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", cursor: "pointer" };
  const usedUser = (u) => tasks.some((t) => t.assignedUsers.includes(u));
  const usedClient = (name) => tasks.some((t) => t.client === name);
  const usedLocation = (name, loc) => tasks.some((t) => t.client === name && t.location === loc);
  const askRemove = (title, action) => setConfirm({ title, message: "Are you sure you want to remove this? This can't be undone.", action });
  const row = (label, onDel, disabled) => (
    <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: T.panel2, borderRadius: 8 }}>
      <span style={{ fontFamily: sans, fontSize: 13.5, color: T.ink }}>{label}</span>
      <button disabled={disabled} onClick={() => askRemove(`Remove "${label}"?`, onDel)} title={disabled ? "In use — reassign first" : "Remove"}
        style={{ background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer", color: disabled ? T.line : T.faint }}><Trash2 size={15} /></button>
    </div>
  );
  const addClient = () => {
    const v = nc.trim();
    if (v && !clients.some((c) => c.name === v)) { setClients([...clients, { name: v, locations: [] }]); setNc(""); }
  };
  const removeClient = (name) => setClients(clients.filter((c) => c.name !== name));
  const addLocation = (name) => {
    const v = (locInputs[name] || "").trim();
    if (!v) return;
    setClients(clients.map((c) => (c.name === name && !c.locations.includes(v)) ? { ...c, locations: [...c.locations, v] } : c));
    setLocInputs({ ...locInputs, [name]: "" });
  };
  const removeLocation = (name, loc) => setClients(clients.map((c) => c.name === name ? { ...c, locations: c.locations.filter((l) => l !== loc) } : c));

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
      <div style={box}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, color: T.ink, marginBottom: 12 }}>Team members</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input style={inp} placeholder="Add person…" value={nu} onChange={(e) => setNu(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && nu.trim()) { setUsers([...users, nu.trim()]); setNu(""); } }} />
          <button style={addBtn} onClick={() => { if (nu.trim() && !users.includes(nu.trim())) { setUsers([...users, nu.trim()]); setNu(""); } }}>Add</button>
        </div>
        <div style={{ display: "grid", gap: 6 }}>{users.map((u) => row(u, () => setUsers(users.filter((x) => x !== u)), usedUser(u)))}</div>
      </div>
      <div style={box}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, color: T.ink, marginBottom: 12 }}>Clients &amp; locations</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input style={inp} placeholder="Add client…" value={nc} onChange={(e) => setNc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addClient(); }} />
          <button style={addBtn} onClick={addClient}>Add</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {clients.map((c) => (
            <div key={c.name} style={{ background: T.panel2, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 13.5, color: T.ink }}>{c.name}</span>
                <button disabled={usedClient(c.name)} onClick={() => askRemove(`Remove "${c.name}"?`, () => removeClient(c.name))} title={usedClient(c.name) ? "In use — reassign first" : "Remove"}
                  style={{ background: "none", border: "none", cursor: usedClient(c.name) ? "not-allowed" : "pointer", color: usedClient(c.name) ? T.line : T.faint }}><Trash2 size={14} /></button>
              </div>
              {c.locations.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {c.locations.map((loc) => (
                    <span key={loc} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: sans, fontSize: 12, color: T.ink, background: T.panel, border: `1px solid ${T.line}`, padding: "3px 4px 3px 9px", borderRadius: 999 }}>
                      {loc}
                      <button disabled={usedLocation(c.name, loc)} onClick={() => askRemove(`Remove "${loc}"?`, () => removeLocation(c.name, loc))} title={usedLocation(c.name, loc) ? "In use — reassign first" : "Remove"}
                        style={{ background: "none", border: "none", cursor: usedLocation(c.name, loc) ? "not-allowed" : "pointer", color: usedLocation(c.name, loc) ? T.line : T.faint, display: "flex" }}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <input style={{ ...inp, fontSize: 12.5, padding: "6px 9px" }} placeholder="Add location…" value={locInputs[c.name] || ""} onChange={(e) => setLocInputs({ ...locInputs, [c.name]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") addLocation(c.name); }} />
                <button style={{ ...addBtn, fontSize: 12, padding: "6px 10px" }} onClick={() => addLocation(c.name)}>Add</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {confirm && (
        <ConfirmModal title={confirm.title} message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { confirm.action(); setConfirm(null); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App shell                                                          */
/* ------------------------------------------------------------------ */
const TABS = [
  { id: "overview", label: "Overview", icon: Info },
  { id: "register", label: "Task Register", icon: LayoutList },
  { id: "roster", label: "Onsite Schedule", icon: CalendarDays },
  { id: "patchingCalendar", label: "Patching Schedule", icon: Wrench, badge: "Coming soon" },
  { id: "calendar", label: "Calendar Summary", icon: Calendar },
  { id: "analytics", label: "Analytics", icon: PieIcon },
  { id: "settings", label: "Team & Clients", icon: Settings2 },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("overview");
  const [tasks, setTasks] = useState(SEED_TASKS);
  const [users, setUsers] = useState(SEED_USERS);
  const [clients, setClients] = useState(SEED_CLIENTS);
  const [filters, setFilters] = useState({ user: "", site: "", frequency: "", search: "" });
  const [editing, setEditing] = useState(null); // task obj or {} for new

  useEffect(() => {
    loadState().then((s) => {
      if (s && s.tasks) { setTasks(s.tasks); setUsers(s.users || SEED_USERS); setClients(s.clients || SEED_CLIENTS); }
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (!ready) return;
    saveState({ tasks, users, clients });
  }, [tasks, users, clients, ready]);

  const filtered = useMemo(() => tasks.filter((t) => matchTask(t, filters)), [tasks, filters]);

  const saveTask = (t) => { setTasks((p) => p.some((x) => x.id === t.id) ? p.map((x) => x.id === t.id ? t : x) : [...p, t]); setEditing(null); };
  const delTask = (id) => setTasks((p) => p.filter((x) => x.id !== id));
  const delTasks = (ids) => setTasks((p) => p.filter((x) => !ids.includes(x.id)));
  const [confirmBulkDeleteIds, setConfirmBulkDeleteIds] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const toggleComplete = (id) => setTasks((p) => p.map((x) => x.id === id ? { ...x, completed: !x.completed } : x));
  const toggleTaskDay = (id, d) => setTasks((p) => p.map((x) => x.id === id
    ? { ...x, days: x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d] }
    : x));
  const toggleTaskUser = (id, u) => setTasks((p) => p.map((x) => x.id === id
    ? { ...x, assignedUsers: x.assignedUsers.includes(u) ? x.assignedUsers.filter((y) => y !== u) : [...x.assignedUsers, u] }
    : x));

  if (!ready) return <div style={{ fontFamily: sans, padding: 40, color: T.sub }}>Loading tracker…</div>;

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: sans, color: T.ink }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "22px 18px 60px" }}>
        {/* Header */}
        <header style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: T.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Gauge size={22} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>Resource Allocation Tracker</div>
              <div style={{ fontSize: 12.5, color: T.sub }}>Live workload, onsite roster & capacity · edits save automatically</div>
            </div>
          </div>
          {tab === "register" && (
            <button onClick={() => setEditing({})} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 14, padding: "10px 16px", borderRadius: 9, border: "none", background: T.accent, color: "#fff", cursor: "pointer" }}>
              <Plus size={17} /> New task
            </button>
          )}
        </header>

        {/* Tabs */}
        <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 16, background: T.panel, padding: 5, borderRadius: 12, border: `1px solid ${T.line}`, width: "fit-content" }}>
          {TABS.map((tb) => {
            const on = tab === tb.id; const Icon = tb.icon;
            return (
              <button key={tb.id} onClick={() => setTab(tb.id)}
                style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: sans, fontWeight: 600, fontSize: 13.5, padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer", background: on ? T.ink : "transparent", color: on ? "#fff" : T.sub }}>
                <Icon size={15} /> {tb.label}
                {tb.badge && (
                  <span style={{ marginLeft: 2, whiteSpace: "nowrap", fontFamily: sans, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: on ? "rgba(255,255,255,.22)" : T.accentSoft, color: on ? "#fff" : T.accent }}>
                    {tb.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Filters (connected views) */}
        {["register", "analytics"].includes(tab) && (
          <div style={{ marginBottom: 16 }}>
            <FilterBar filters={filters} setFilters={setFilters} users={users} clients={clients} />
          </div>
        )}

        {/* Body */}
        {tab === "overview" && <Overview onNavigate={setTab} />}
        {tab === "register" && <Register tasks={tasks} filtered={filtered} onEdit={setEditing} onDelete={setConfirmDeleteId} onToggleComplete={toggleComplete} onBulkDelete={setConfirmBulkDeleteIds} />}
        {tab === "roster" && <Roster tasks={tasks} users={users} clients={clients} filters={filters} updateTasks={setTasks} />}
        {tab === "patchingCalendar" && <CapacityCalendar tasks={tasks.filter((t) => t.patching)} users={users} onToggleDay={toggleTaskDay} onToggleUser={toggleTaskUser} />}
        {tab === "calendar" && <CapacityCalendar tasks={tasks} users={users} onToggleDay={toggleTaskDay} onToggleUser={toggleTaskUser} />}
        {tab === "analytics" && (
          <div style={{ display: "grid", gap: 20 }}>
            <Analytics tasks={filtered} users={filters.user ? users.filter((u) => u === filters.user) : users} clients={clients} />
            <Headcount tasks={filtered} users={filters.user ? users.filter((u) => u === filters.user) : users} />
          </div>
        )}
        {tab === "settings" && <Settings users={users} clients={clients} setUsers={setUsers} setClients={setClients} tasks={tasks} />}
      </div>

      {editing && (
        <TaskEditor initial={editing} users={users} clients={clients} onSave={saveTask} onCancel={() => setEditing(null)} />
      )}

      {confirmDeleteId && (() => {
        const task = tasks.find((x) => x.id === confirmDeleteId);
        if (!task) return null;
        return (
          <ConfirmModal
            title={`Delete "${task.name}"?`}
            message="Are you sure you want to delete this task? This can't be undone."
            onCancel={() => setConfirmDeleteId(null)}
            onConfirm={() => { delTask(confirmDeleteId); setConfirmDeleteId(null); }}
          />
        );
      })()}

      {confirmBulkDeleteIds && (
        <ConfirmModal
          title={`Delete ${confirmBulkDeleteIds.length} task${confirmBulkDeleteIds.length === 1 ? "" : "s"}?`}
          message="Are you sure you want to delete the selected tasks? This can't be undone."
          onCancel={() => setConfirmBulkDeleteIds(null)}
          onConfirm={() => { delTasks(confirmBulkDeleteIds); setConfirmBulkDeleteIds(null); }}
        />
      )}
    </div>
  );
}
