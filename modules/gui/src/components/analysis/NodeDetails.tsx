/**
 * Details of one graph node: what it says, its facts, its source, and the
 * edges with their one-line rationale. Amounts in `local` follow the
 * hide-values switch; they exist only on this machine.
 */
import { ExternalLink, X } from "lucide-react";
import type { AnalysisEdge, AnalysisNode } from "portfolio-shared/api-types";
import { openExternal } from "../../environment";
import { t } from "../../i18n";
import { fmtCurrency } from "../portfolio/utils";
import { HoldingLink } from "../portfolio/holding-links";
import { graphPalette, kindLabel, nodeColor } from "./shared";

const MONEY_KEYS = new Set(["value", "totalValue", "cashBalance", "gain"]);

function factValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return /percent$/i.test(key) ? `${value}%` : String(value);
  if (typeof value === "boolean") return value ? t("analysis.details.yes") : t("analysis.details.no");
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => (v && typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => factValue(k, x)).join(" ") : factValue(key, v)))
      .join(", ");
  }
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([k, x]) => `${k} ${factValue(k, x)}`).join(", ");
  return String(value);
}

/** A fact key as words: `weightPercent` -> "weight percent". */
const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

interface NodeDetailsProps {
  node: AnalysisNode;
  nodes: readonly AnalysisNode[];
  edges: readonly AnalysisEdge[];
  hideValues: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function NodeDetails({ node, nodes, edges, hideValues, onSelect, onClose }: NodeDetailsProps) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = edges.filter((e) => e.sourceId === node.id || e.targetId === node.id);
  const color = nodeColor(node, graphPalette());
  const facts = Object.entries(node.facts).filter(([k, v]) => k !== "text" && v !== undefined && v !== null && v !== "");
  const text = typeof node.facts.text === "string" ? node.facts.text : "";
  const currency = typeof node.local?.currency === "string" ? node.local.currency : "EUR";
  const symbol = typeof node.facts.symbol === "string" ? node.facts.symbol : null;

  return (
    <div className="cx-card p-3.5 flex flex-col gap-3 min-h-0 overflow-y-auto custom-scrollbar text-xs">
      <div className="flex items-start gap-2">
        <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {node.id} · {kindLabel(node.kind)}
            {node.status === "failed" ? ` · ${t("analysis.details.failed")}` : ""}
          </div>
          <div className="text-sm font-bold text-slate-100 font-sans">{node.title}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-800/40 cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {node.summary && <p className="text-slate-300 leading-relaxed font-sans">{node.summary}</p>}
      {symbol && (
        <div className="text-slate-400">
          {t("analysis.details.holding")} <HoldingLink reference={symbol} />
        </div>
      )}

      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{words(k)}</dt>
              <dd className="text-slate-200 wrap-break-word">{factValue(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {text && <pre className="whitespace-pre-wrap text-[11px] text-slate-400 leading-relaxed font-mono">{text}</pre>}

      {node.local && Object.keys(node.local).some((k) => k !== "currency") && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{t("analysis.details.local")}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {Object.entries(node.local)
              .filter(([k]) => k !== "currency")
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{words(k)}</dt>
                  <dd className="text-slate-200">{typeof v === "number" ? (MONEY_KEYS.has(k) ? fmtCurrency(v, currency, hideValues) : hideValues ? "••" : String(v)) : String(v ?? "")}</dd>
                </div>
              ))}
          </dl>
          <p className="mt-1 text-[10px] text-slate-600">{t("analysis.details.localNote")}</p>
        </div>
      )}

      {node.source && (node.source.provider || node.source.url) && (
        <div className="text-slate-500 flex flex-wrap items-center gap-x-2">
          {node.source.provider && <span>{t("analysis.details.source", { source: node.source.provider })}</span>}
          {node.source.url && (
            <button type="button" onClick={() => openExternal(node.source!.url!)} className="inline-flex items-center gap-1 text-[#DD3C73] hover:underline cursor-pointer">
              <ExternalLink className="w-3 h-3" />
              {t("analysis.details.openSource")}
            </button>
          )}
        </div>
      )}

      {links.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{t("analysis.details.links", { count: links.length })}</div>
          <ul className="space-y-1">
            {links.map((e) => {
              const otherId = e.sourceId === node.id ? e.targetId : e.sourceId;
              const other = byId.get(otherId);
              const outgoing = e.sourceId === node.id;
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => onSelect(otherId)} className="w-full text-left rounded-md px-1.5 py-1 hover:bg-slate-800/40 cursor-pointer">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${e.type === "contradicts" ? "text-rose-400" : e.type === "supports" || e.type === "motivates" ? "text-mint" : "text-slate-500"}`}>
                      {outgoing ? "→" : "←"} {t(`analysis.edges.${e.type}`)}
                    </span>{" "}
                    <span className="text-slate-200">
                      {otherId} {other?.title ?? ""}
                    </span>
                    {e.rationale && <span className="block text-[11px] text-slate-500">{e.rationale}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
