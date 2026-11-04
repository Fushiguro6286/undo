"use client";
// AG Studio, configured for Undo: the Undo theme, the claims table as a data source, the two custom widgets, and
// one saved layout (the default below, or the merchant's own saved in this browser).
import { useMemo, useRef, useState } from "react";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { enableStudioDevValidations, studioTheme, type AgDataSourcesDefinition, type AgReportState, type AgStudioApi, type AgStudioMode } from "ag-studio";
import { ApprovalQueue, EvidenceViewer, refresh, useConsole } from "./widgets";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

// Every color is a token from app/globals.css, so the console follows the app's light and dark mode.
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const line = { width: 1, color: "var(--line)" };
const theme = studioTheme.withParams({
  fontFamily: FONT,
  foregroundColor: "var(--ink)",
  textColor: "var(--ink)",
  subtleTextColor: "var(--muted)",
  backgroundColor: "var(--card)",
  borderColor: "var(--line)",
  accentColor: "var(--accent)",
  rowHoverColor: "var(--accent-soft)",
  studioWrapperBorder: false,
  studioWrapperBackgroundColor: "var(--bg)",
  studioCanvasBorder: false,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: "var(--bg)",
  studioWidgetBackgroundColor: "var(--card)",
  studioWidgetBorder: line,
  studioWidgetBorderRadius: 14,
  studioCanvasFontFamily: FONT,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontSize: 18,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: "var(--ink)",
  gridHeaderTextColor: "var(--muted)",
  gridHeaderFontWeight: 600,
  gridRowBorder: line,
  gridWrapperBorder: false,
});

const WIDGETS = { queue: "approval-queue", evidence: "evidence-viewer" } as const;
const title = (text: string) => ({ title: { enabled: true, text } });
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number) => ({ xTrack, yTrack, xSpan, ySpan });
const cols = ["opened", "item", "fault", "status", "mode", "amount", "order", "claim"].map((f) => ({ id: `claims.${f}` }));

export const DEFAULT_LAYOUT: AgReportState = {
  pages: [{
    id: "claims",
    widgets: {
      queue: { type: WIDGETS.queue, format: title("Approval queue") },
      evidence: { type: WIDGETS.evidence, format: title("Evidence") },
      all: { type: "grid", dataMapping: { cols }, sort: [{ field: { id: "claims.opened" }, direction: "desc" }], format: title("All claims") },
    },
    widgetLayout: { queue: at(0, 0, 11, 36), evidence: at(11, 0, 13, 36), all: at(0, 36, 24, 22) },
  }],
  selectedPageId: "claims",
  panels: { filters: { collapsed: true } }, // no page filters yet: give the canvas the room
} as unknown as AgReportState; // custom widget types aren't in the default registry typings

const LAYOUT_KEY = "undo-console-layout-v1";
const savedLayout = (): AgReportState | undefined => {
  try {
    const s = localStorage.getItem(LAYOUT_KEY);
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
};

const widgets = (base: { menu: any[] }) =>
  createWidgets<any>({
    additionalTypes: [
      { id: WIDGETS.queue, label: "Approval queue", form: (p: any) => p.createDefaults({}), comp: ApprovalQueue, defaultSize: { width: 520, height: 560 }, minSize: { width: 320, height: 240 }, ai: { description: "Remedies waiting for the merchant's approval, with approve, edit and reject." } },
      { id: WIDGETS.evidence, label: "Evidence viewer", form: (p: any) => p.createDefaults({}), comp: EvidenceViewer, defaultSize: { width: 620, height: 560 }, minSize: { width: 320, height: 240 }, ai: { description: "Listing photo next to the delivered photo, vision findings, fault reasons and the audit-chain check." } },
    ],
    menu: [...base.menu, { label: "Undo", widgetIds: [WIDGETS.queue, WIDGETS.evidence] }],
  });

export default function Studio({ licenseKey }: { licenseKey?: string }) {
  const { data } = useConsole();
  const apiRef = useRef<AgStudioApi>(null);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [initialState] = useState(() => savedLayout() ?? DEFAULT_LAYOUT);
  const [saved, setSaved] = useState<string>();

  const sources = useMemo<AgDataSourcesDefinition>(() => ({
    description: "Claims on agent purchases at Fernleaf Goods: who was at fault and where each claim stands.",
    sources: [{
      id: "claims",
      data: (data?.claims ?? []).map((c) => ({
        claim: c.id.slice(0, 8),
        opened: c.createdAt,
        item: c.item?.name ?? "",
        fault: c.faultParty ?? "—",
        status: c.status,
        mode: c.mode ?? "",
        amount: c.amount === null ? null : Number(c.amount),
        order: c.paypalOrderId,
      })),
      fields: [
        { id: "opened", name: "Opened", format: "dateTimeFormat" },
        { id: "item", name: "Item", format: "textFormat" },
        { id: "fault", name: "Fault", format: "textFormat" },
        { id: "status", name: "Status", format: "textFormat" },
        { id: "mode", name: "Consent", format: "textFormat" },
        { id: "amount", name: "Paid", format: "currencyFormat" },
        { id: "order", name: "PayPal order", format: "textFormat" },
        { id: "claim", name: "Claim", format: "textFormat" },
      ],
    }],
  }), [data?.claims]);

  const api = () => apiRef.current;
  const changeMode = (next: AgStudioMode) => {
    api()?.setProperty("mode", next);
    setMode(next);
  };
  const save = () => {
    const s = api()?.getState();
    if (!s) return;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(s));
      setSaved("Layout saved in this browser.");
    } catch {
      setSaved("This browser blocks saving.");
    }
  };
  const reset = () => {
    try { localStorage.removeItem(LAYOUT_KEY); } catch {}
    api()?.setState(structuredClone(DEFAULT_LAYOUT));
    setSaved("Default layout restored.");
  };

  return (
    <div className="uc-shell">
      <div className="uc-bar">
        <button className={mode === "view" ? "" : "uc-ghost"} onClick={() => changeMode("view")}>Work</button>
        <button className={mode === "edit" ? "" : "uc-ghost"} onClick={() => changeMode("edit")}>Edit layout</button>
        {mode === "edit" && <><button className="uc-ghost" onClick={save}>Save layout</button><button className="uc-ghost" onClick={reset}>Reset layout</button></>}
        <button className="uc-ghost" onClick={() => refresh()}>Refresh</button>
        {saved && <span className="muted uc-small">{saved}</span>}
      </div>
      <div className="uc-studio">
        <AgStudioProvider licenseKey={licenseKey}>
          <AgStudio onApiReady={(e) => { apiRef.current = e.api; }} data={sources} mode={mode} widgets={widgets as any} initialState={initialState} theme={theme} style={{ height: "100%", width: "100%" }} />
        </AgStudioProvider>
      </div>
    </div>
  );
}
