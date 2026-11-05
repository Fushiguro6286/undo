"use client";
// Fallback console (spec section 15): plain AG Grid (community) instead of AG Studio, for when Studio or its license
// is unavailable. Same data, same approval queue, evidence viewer and timeline; only the layout shell differs.
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import type { ConsoleData } from "./data";
import { ApprovalQueue, ClaimTimeline, EvidenceViewer, select, useConsole } from "./widgets";

ModuleRegistry.registerModules([AllCommunityModule]);

type Claim = ConsoleData["claims"][number];

// The site's own color tokens, so the grid follows light and dark mode.
const theme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--ink)",
  borderColor: "var(--line)",
  accentColor: "var(--accent)",
  headerBackgroundColor: "var(--paper)",
  headerFontFamily: "var(--font-mono)",
  headerFontSize: 11,
  fontFamily: "inherit",
  borderRadius: 0,
  wrapperBorderRadius: 0,
});

const COLUMNS: ColDef<Claim>[] = [
  { headerName: "Opened", field: "createdAt", sort: "desc", width: 120, valueFormatter: (p) => new Date(p.value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) },
  { headerName: "Item", valueGetter: (p) => p.data?.item?.name ?? "—", flex: 2, minWidth: 180 },
  { headerName: "Consent", field: "mode", width: 120 },
  { headerName: "Fault", field: "faultParty", width: 110, valueFormatter: (p) => p.value ?? "—" },
  { headerName: "Status", field: "status", flex: 1, minWidth: 150 },
  { headerName: "Amount", field: "amount", width: 100, type: "rightAligned", valueFormatter: (p) => (p.value ? `$${p.value}` : "—") },
  { headerName: "Reasons", valueGetter: (p) => p.data?.reasons.map((r) => r.code).join(", "), flex: 2, minWidth: 200 },
];

export default function GridConsole() {
  const { data } = useConsole();
  if (!data) return null;
  return (
    <div className="page grid-console">
      <section className="card">
        <h2>Approval queue</h2>
        <ApprovalQueue />
      </section>
      <section className="card">
        <h2>Claims</h2>
        <p className="muted small">Click a claim to show its evidence and timeline.</p>
        <div className="grid-console-table">
          <AgGridReact<Claim> theme={theme} rowData={data.claims} columnDefs={COLUMNS} getRowId={(p) => p.data.id} onRowClicked={(e) => e.data && select(e.data.id)} />
        </div>
      </section>
      <section className="card"><h2>Evidence</h2><EvidenceViewer /></section>
      <section className="card"><h2>Timeline</h2><ClaimTimeline /></section>
    </div>
  );
}
