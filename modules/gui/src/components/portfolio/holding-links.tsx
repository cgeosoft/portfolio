import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PortfolioHolding, PortfolioTransaction } from "portfolio-shared/portfolio";
import { HoldingIntelModal } from "./HoldingIntelModal";

/**
 * Clickable instrument references. `HoldingLinksHost` (mounted once in App) owns the holding
 * details modal and publishes the active portfolio's holdings; any component opens a holding
 * with `openHolding(symbol)` and links names, symbols and ISINs with `HoldingLink` or, in
 * Markdown, `useHoldingLinkPlugin()` plus `holdingSymbolFromHref()` in its `a` override.
 */

export const OPEN_HOLDING_EVENT = "portfolio:open-holding";

/** Markdown links the remark plugin creates point here; the `a` override renders them as buttons. */
const HOLDING_HREF_PREFIX = "#holding:";

export const HOLDING_LINK_CLASS =
  "inline cursor-pointer underline decoration-dotted decoration-slate-500 underline-offset-2 hover:text-accent-bright hover:decoration-accent-bright transition-colors";

/** Holdings with company data to show: not cash, crypto or private assets. */
export function hasCompanyIntel(h: PortfolioHolding): boolean {
  return !h.isPrivate && h.assetType !== "Cash" && h.assetType !== "Crypto";
}

export function openHolding(symbol: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_HOLDING_EVENT, { detail: symbol }));
}

// ---------------------------------------------------------------------------
// Index of linkable holdings
// ---------------------------------------------------------------------------

export interface HoldingIndex {
  holdings: Map<string, PortfolioHolding>;
  /** Any reference (symbol, symbol without exchange suffix, ISIN, name, short name) in lower case to the symbol. */
  exact: Map<string, string>;
  /** Matches references inside running text; null when nothing is linkable. */
  pattern: RegExp | null;
  /** Case-sensitive reference from `pattern` to the symbol. */
  terms: Map<string, string>;
}

const EMPTY_INDEX: HoldingIndex = { holdings: new Map(), exact: new Map(), pattern: null, terms: new Map() };

const LEGAL_SUFFIX = /[,\s]+(inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|plc|ag|se|sa|s\.a\.|nv|n\.v\.|holdings?|group|class [a-c])$/i;

/** "Apple Inc." -> "Apple", "Alphabet Inc. Class A" -> "Alphabet". */
function shortName(name: string): string {
  let out = name.trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(LEGAL_SUFFIX, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildHoldingIndex(holdings: PortfolioHolding[], transactions: PortfolioTransaction[] = []): HoldingIndex {
  const linkable = holdings.filter(hasCompanyIntel);
  if (linkable.length === 0) return EMPTY_INDEX;

  const bySymbol = new Map<string, PortfolioHolding>();
  for (const h of linkable) bySymbol.set(h.symbol, h);

  const isins = new Map<string, Set<string>>();
  for (const tx of transactions) {
    const isin = tx.isin?.trim().toUpperCase();
    if (!isin || !bySymbol.has(tx.symbol)) continue;
    if (!isins.has(tx.symbol)) isins.set(tx.symbol, new Set());
    isins.get(tx.symbol)!.add(isin);
  }

  // A reference two holdings share (a name, a base symbol) links neither.
  const exact = new Map<string, string>();
  const terms = new Map<string, string>();
  const clashes = new Set<string>();
  const add = (term: string, symbol: string, inText: boolean) => {
    const key = term.toLowerCase();
    if (!key || clashes.has(key)) return;
    const owner = exact.get(key);
    if (owner && owner !== symbol) {
      clashes.add(key);
      exact.delete(key);
      for (const [t, s] of terms) if (t.toLowerCase() === key && s === owner) terms.delete(t);
      return;
    }
    exact.set(key, symbol);
    if (inText) terms.set(term, symbol);
  };

  for (const h of linkable) {
    const symbol = h.symbol;
    add(symbol, symbol, symbol.length >= 2 && /[A-Z]/.test(symbol));
    const dot = symbol.indexOf(".");
    if (dot >= 3) add(symbol.slice(0, dot), symbol, true);
    for (const isin of isins.get(symbol) ?? []) add(isin, symbol, true);
    const name = h.name?.trim();
    if (name && name.toLowerCase() !== symbol.toLowerCase()) {
      add(name, symbol, name.length >= 4);
      const short = shortName(name);
      if (short !== name && short.length >= 4) add(short, symbol, true);
    }
  }

  const sorted = [...terms.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = sorted.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${sorted.join("|")})(?![\\p{L}\\p{N}_])`, "gu") : null;
  return { holdings: bySymbol, exact, pattern, terms };
}

/** The holding a whole reference ("VWCE", "IE00BK5BQT80", "Apple") names, if any. */
export function findHoldingSymbol(index: HoldingIndex, text: string): string | null {
  return index.exact.get(text.trim().toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Store shared by the host and the components that render links
// ---------------------------------------------------------------------------

let currentIndex: HoldingIndex = EMPTY_INDEX;
const listeners = new Set<() => void>();

function setHoldingIndex(next: HoldingIndex): void {
  currentIndex = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useHoldingIndex(): HoldingIndex {
  return useSyncExternalStore(subscribe, () => currentIndex);
}

interface HoldingLinksHostProps {
  holdings?: PortfolioHolding[];
  transactions?: PortfolioTransaction[];
}

/** Mount once: publishes the linkable holdings and shows the holding details modal on request. */
export function HoldingLinksHost({ holdings, transactions }: HoldingLinksHostProps) {
  const index = useMemo(() => buildHoldingIndex(holdings ?? [], transactions), [holdings, transactions]);
  const [open, setOpen] = useState<PortfolioHolding | null>(null);

  useEffect(() => {
    setHoldingIndex(index);
  }, [index]);

  useEffect(() => () => setHoldingIndex(EMPTY_INDEX), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const symbol = (e as CustomEvent<string>).detail;
      const holding = index.holdings.get(symbol);
      if (holding) setOpen(holding);
    };
    window.addEventListener(OPEN_HOLDING_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HOLDING_EVENT, onOpen);
  }, [index]);

  if (!open) return null;
  return createPortal(<HoldingIntelModal holding={open} onClose={() => setOpen(null)} />, document.body);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface HoldingLinkProps {
  /** The holding symbol, or any reference to it (ISIN, name). */
  reference: string | null | undefined;
  children?: ReactNode;
  className?: string;
}

/** Wraps `children` (default: the reference) in a button that opens the holding; plain text when nothing matches. */
export function HoldingLink({ reference, children, className = "" }: HoldingLinkProps) {
  const index = useHoldingIndex();
  const content = children ?? reference;
  const symbol = reference ? (index.holdings.has(reference) ? reference : findHoldingSymbol(index, reference)) : null;
  if (!symbol) return <>{content}</>;
  return <HoldingButton symbol={symbol} name={index.holdings.get(symbol)?.name} className={className}>{content}</HoldingButton>;
}

export function HoldingButton({ symbol, name, children, className = "" }: { symbol: string; name?: string; children: ReactNode; className?: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className={`${HOLDING_LINK_CLASS} ${className}`}
      title={`Show details for ${name && name !== symbol ? `${name} (${symbol})` : symbol}`}
      onClick={(e) => {
        e.stopPropagation();
        openHolding(symbol);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          openHolding(symbol);
        }
      }}
    >
      {children}
    </span>
  );
}

/** Plain text with every holding reference in it as a link. */
export function HoldingText({ text }: { text: string }) {
  const index = useHoldingIndex();
  const parts = splitText(text, index);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => {
        const symbol = p.type === "link" ? holdingSymbolFromHref(p.url) : null;
        const value = p.type === "link" ? p.children?.[0]?.value ?? "" : p.value ?? "";
        return symbol ? (
          <HoldingButton key={i} symbol={symbol} name={index.holdings.get(symbol)?.name}>
            {value}
          </HoldingButton>
        ) : (
          <span key={i}>{value}</span>
        );
      })}
    </>
  );
}

/** The holding symbol a Markdown link from `useHoldingLinkPlugin()` points to. */
export function holdingSymbolFromHref(href: string | undefined): string | null {
  if (!href?.startsWith(HOLDING_HREF_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(HOLDING_HREF_PREFIX.length));
  } catch {
    return null;
  }
}

/** Renders a Markdown `a` element: a holding button for holding links, `fallback` for the rest. */
export function renderHoldingAnchor(href: string | undefined, children: ReactNode, fallback: () => ReactNode): ReactNode {
  const symbol = holdingSymbolFromHref(href);
  if (symbol === null) return fallback();
  return <HoldingButton symbol={symbol} name={currentIndex.holdings.get(symbol)?.name}>{children}</HoldingButton>;
}

// Minimal mdast shapes; the GUI does not depend on @types/mdast.
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/** Nodes whose text must stay as it is. */
const SKIP_TYPES = new Set(["link", "linkReference", "definition", "code", "html", "image", "imageReference"]);

function holdingLinkNode(symbol: string, children: MdNode[]): MdNode {
  return { type: "link", url: HOLDING_HREF_PREFIX + encodeURIComponent(symbol), children };
}

function splitText(value: string, index: HoldingIndex): MdNode[] | null {
  if (!index.pattern) return null;
  const out: MdNode[] = [];
  let last = 0;
  index.pattern.lastIndex = 0;
  for (const match of value.matchAll(index.pattern)) {
    const symbol = index.terms.get(match[0]);
    if (!symbol || match.index === undefined) continue;
    if (match.index > last) out.push({ type: "text", value: value.slice(last, match.index) });
    out.push(holdingLinkNode(symbol, [{ type: "text", value: match[0] }]));
    last = match.index + match[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function linkHoldings(node: MdNode, index: HoldingIndex): void {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (SKIP_TYPES.has(child.type)) continue;
    if (child.type === "inlineCode") {
      const symbol = child.value ? findHoldingSymbol(index, child.value) : null;
      if (symbol) children[i] = holdingLinkNode(symbol, [child]);
      continue;
    }
    // **AAPL** or *Apple*: a whole emphasised reference links even when running text would not (single-letter symbols).
    if ((child.type === "strong" || child.type === "emphasis") && child.children?.length === 1 && child.children[0].type === "text") {
      const symbol = findHoldingSymbol(index, child.children[0].value ?? "");
      if (symbol) {
        child.children = [holdingLinkNode(symbol, child.children)];
        continue;
      }
    }
    if (child.type === "text") {
      const parts = child.value ? splitText(child.value, index) : null;
      if (parts) {
        children.splice(i, 1, ...parts);
        i += parts.length - 1;
      }
      continue;
    }
    linkHoldings(child, index);
  }
}

/** A remark plugin that turns references to the portfolio's holdings into holding links. */
export function useHoldingLinkPlugin(): () => (tree: MdNode) => void {
  const index = useHoldingIndex();
  return useMemo(() => () => (tree: MdNode) => linkHoldings(tree, index), [index]);
}
