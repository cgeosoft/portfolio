/**
 * The screens of the website tour and the hotspots on each. `capture.ts`
 * finds every target in the running app, so the markers follow the layout.
 * Texts appear on the website: short active sentences, only verified facts.
 */
import type { Page } from "playwright-core";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * An element in the page. `text` (or `re`, a case-insensitive regex) matches
 * the deepest visible element containing it; `css` selects instead, and with
 * `text` keeps the selected elements that contain it.
 * `nth` picks among matches, `up` climbs parents, then `mode`:
 *   self     the element
 *   card     the closest card (`.cx-card` or a bordered, rounded box)
 *   control  the closest button, input, select or link
 *   row      the closest table row
 *   column   the table column under the header cell, down to row `rows`
 * `within` limits the search to the card holding that text.
 * `sub` takes a part of the result: [x, y, w, h] as fractions.
 */
export interface Query {
  text?: string;
  re?: string;
  css?: string;
  exact?: boolean;
  nth?: number;
  up?: number;
  mode?: "self" | "card" | "control" | "row" | "column";
  rows?: number;
  within?: string;
  sub?: [number, number, number, number];
}

export interface Hotspot {
  id: string;
  title: string;
  text: string;
  /** Where the marker sits and what the highlight covers (several queries: their union). */
  target: Query | Query[];
  /**
   * The close-up shown in the popover, when it differs from the target. Keep it
   * near 400x280 CSS pixels so the popover shows it at about full size.
   */
  crop?: Query | Query[];
  /** Marker position inside the target, as fractions. Default: the centre. */
  at?: [number, number];
  /** Padding around the crop, CSS pixels. Default 14. */
  pad?: number;
}

export interface Screen {
  id: string;
  /** Tab label on the website. */
  label: string;
  title: string;
  text: string;
  /** App route, after `#`. */
  hash: string;
  /** Text that shows once the screen has loaded. */
  ready: string;
  prepare?: (page: Page) => Promise<void>;
  settleMs?: number;
  hotspots: Hotspot[];
}

/** The subtitle of the Income & Events card: unique to the card, while its title also labels the Analysis sidebar entry. */
const INCOME_CARD = "Dividends of the next 12 months";

/**
 * Scrolls the dashboard so the card holding `text` sits at the top. Cards
 * below it render as their data arrives, so it waits until the card stays put.
 */
async function scrollToCard(page: Page, text: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const offset = await page.evaluate((needle) => {
      const el = Array.from(document.querySelectorAll(".cx-card")).find((c) => (c.textContent ?? "").toLowerCase().includes(needle.toLowerCase()));
      if (!el) return null;
      let scroller = el.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement;
      if (!scroller) return null;
      const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
      scroller.scrollTop += delta;
      return Math.abs(delta);
    }, text);
    if (offset !== null && offset < 2 && attempt > 4) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not scroll to the card with ${text}`);
}

export const SCREENS: Screen[] = [
  {
    id: "overview",
    label: "Overview",
    title: "The whole portfolio on one screen",
    text: "Value, returns, history and allocation, priced from live quotes in your base currency.",
    hash: "overview",
    ready: "Portfolio Performance History",
    hotspots: [
      {
        id: "value",
        title: "Total value",
        text: "Holdings plus cash in your base currency, with the gain since your first deposit.",
        target: { text: "Total Portfolio Value", mode: "card" },
        at: [0.62, 0.55],
      },
      {
        id: "day",
        title: "Today's move",
        text: "The day gain across every position, from live Yahoo Finance quotes.",
        target: { text: "Day Gain / Loss", mode: "card" },
        at: [0.62, 0.55],
      },
      {
        id: "tiles",
        title: "The fine print",
        text: "Invested capital, realized P&L, dividends, fees and taxes withheld. Pick the tiles under Metrics.",
        target: { text: "Invested Capital", mode: "card" },
        crop: { text: "Invested Capital", mode: "card", sub: [0, 0, 0.34, 1] },
        at: [0.5, 0.5],
      },
      {
        id: "benchmark",
        title: "Against a benchmark",
        text: "Draw the S&P 500, Nasdaq 100, MSCI World, Euro Stoxx 50 or FTSE All-World over your returns. Zoom from one month to all time.",
        target: [{ text: "vs S&P 500", mode: "control" }, { text: "ALL", exact: true, mode: "control" }],
        crop: { text: "Portfolio Performance History", mode: "card", sub: [0.58, 0, 0.42, 0.62] },
        at: [0.3, 0.5],
      },
      {
        id: "chart",
        title: "Performance history",
        text: "Value with cash, invested capital and cost basis, day by day since the first transaction.",
        target: { text: "Portfolio Performance History", mode: "card" },
        crop: { text: "Portfolio Performance History", mode: "card", sub: [0.08, 0.3, 0.46, 0.7] },
        at: [0.62, 0.6],
      },
      {
        id: "allocation",
        title: "Allocation",
        text: "Asset classes on the inner ring, single holdings on the outer one.",
        target: { text: "Asset Allocation & Weight", mode: "card" },
        crop: { text: "Asset Allocation & Weight", mode: "card", sub: [0.12, 0.18, 0.76, 0.82] },
        at: [0.5, 0.58],
      },
    ],
  },
  {
    id: "positions",
    label: "Positions",
    title: "Every position, with indicators",
    text: "Stocks, ETFs and crypto in one table, in any listing currency.",
    hash: "overview",
    ready: "Active Positions",
    prepare: (page) => scrollToCard(page, "Active Positions"),
    hotspots: [
      {
        id: "holding",
        title: "Positions",
        text: "Ticker, asset type, shares and average cost for each holding.",
        target: [{ text: "Asset", exact: true, mode: "column", rows: 4 }, { text: "Shares & Avg Cost", mode: "column", rows: 4 }],
        crop: [{ text: "Asset", exact: true, mode: "column", rows: 3 }, { text: "Shares & Avg Cost", mode: "column", rows: 3 }],
        at: [0.2, 0.45],
      },
      {
        id: "price",
        title: "Any currency",
        text: "The price in its own currency next to the value in yours, converted at live FX rates, with the portfolio weight.",
        target: { text: "Price & Valuation", mode: "column", rows: 4 },
        at: [0.5, 0.45],
      },
      {
        id: "returns",
        title: "Day and total return",
        text: "In percent and in money, for today and since you bought.",
        target: [{ text: "24H Change", mode: "column", rows: 4 }, { text: "Total Return", mode: "column", rows: 4 }],
        at: [0.5, 0.45],
      },
      {
        id: "range",
        title: "52-week range",
        text: "Where the price sits between the low and the high of the last year.",
        target: { text: "52W Range", mode: "column", rows: 4 },
        at: [0.5, 0.45],
      },
      {
        id: "rsi",
        title: "RSI 14",
        text: "Momentum for each holding, marked oversold, neutral or overbought.",
        target: { text: "RSI", exact: true, mode: "column", rows: 4 },
        at: [0.5, 0.45],
      },
      {
        id: "filter",
        title: "Search and filter",
        text: "Find a symbol or narrow the table to stocks, ETFs or crypto.",
        target: [{ text: "All Asset Types", mode: "control" }, { css: "input[placeholder^='Search symbol']" }],
        at: [0.5, 0.5],
      },
    ],
  },
  {
    id: "income",
    label: "Analysis",
    title: "Dividends you got and dividends to come",
    text: "The Analysis tab: exposure, income and markets. Here, twelve months of expected income, yields and the next ex-dividend dates.",
    hash: "analysis",
    ready: "Income & Events",
    prepare: async (page) => {
      // Analysis shows one card at a time; the sidebar picks it.
      await page.getByRole("button", { name: "Income & Events" }).click();
      await page.getByText(INCOME_CARD).waitFor({ timeout: 15_000 });
    },
    hotspots: [
      {
        id: "summary",
        title: "Income at a glance",
        text: "Expected income for the next 12 months, what came in over the last 12, yield on cost and current yield.",
        target: [{ text: "Expected, next 12 months", mode: "card" }, { text: "Current yield", mode: "card" }],
        crop: [{ text: "Expected, next 12 months", mode: "card" }, { text: "Received, last 12 months", mode: "card" }],
        at: [0.5, 0.5],
      },
      {
        id: "calendar",
        title: "Monthly income",
        text: "Declared and estimated dividends, month by month.",
        target: { css: "canvas", within: INCOME_CARD },
        crop: [{ text: "Declared", exact: true }, { css: "canvas", within: INCOME_CARD, sub: [0, 0, 0.55, 1] }],
        at: [0.55, 0.5],
      },
      {
        id: "upcoming",
        title: "Next 30 days",
        text: "Ex-dividend dates coming up, with the amount per share.",
        target: { text: "Next 30 days", exact: true, up: 1 },
        crop: { text: "Next 30 days", exact: true, up: 1, sub: [0, 0, 1, 0.38] },
        at: [0.5, 0.5],
      },
      {
        id: "table",
        title: "Per holding",
        text: "Payment frequency, the next ex-date, both yields and the income expected from each position.",
        target: [{ text: "Symbol", exact: true, mode: "column", rows: 5 }, { text: "Next 12 months", mode: "column", rows: 5 }],
        crop: [{ text: "Symbol", exact: true, mode: "column", rows: 4 }, { text: "Next ex-date", mode: "column", rows: 4 }],
        at: [0.5, 0.5],
      },
      {
        id: "sections",
        title: "Three views",
        text: "Exposure to sectors, countries and the stocks inside your funds, income and events, and the markets. One at a time.",
        target: { css: "nav[aria-label='Analysis']" },
        at: [0.85, 0.5],
      },
    ],
  },
  {
    id: "assistant",
    label: "Assistant",
    title: "An assistant that knows your portfolio",
    text: "Ask anything about your holdings. It runs on the model you pick: local, a cloud key or the Claude Code CLI.",
    hash: "overview",
    ready: "Portfolio Performance History",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Toggle Assistant" }).click();
      await page.getByText("Inspect Context").waitFor({ timeout: 15_000 });
      // The charts measure their container again once the sidebar has taken its space.
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    },
    hotspots: [
      {
        id: "brief",
        title: "Daily brief",
        text: "Each morning the assistant sums up the last session. The brief lands here, so you can ask a follow-up.",
        target: [{ text: "Daily brief for", mode: "card" }, { text: "Analyst", exact: true, up: 2 }],
        at: [0.5, 0.55],
      },
      {
        id: "context",
        title: "See what it sees",
        text: "Open the exact context the model gets: weights, percentages and tickers. Money amounts stay home.",
        target: { text: "Inspect Context", mode: "card" },
        at: [0.85, 0.5],
      },
      {
        id: "model",
        title: "Your model",
        text: "Ollama, llama.cpp, LM Studio, any OpenAI-compatible key, or the Claude Code CLI.",
        target: { text: "Model:", up: 1 },
        at: [0.3, 0.5],
      },
      {
        id: "ask",
        title: "Ask anything",
        text: "Questions about holdings, risk or metrics, answered from your own numbers.",
        target: { css: "textarea", mode: "card" },
        crop: [{ css: "textarea", mode: "card" }, { text: "Enter to send" }],
        at: [0.4, 0.5],
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    title: "A written report every week",
    text: "The assistant reviews the week: movers, risks and what to watch. Missed one while the app was closed? It runs on the next start.",
    hash: "reports",
    ready: "Executive Summary",
    hotspots: [
      {
        id: "summary",
        title: "Executive summary",
        text: "The week in one line, on top of the full review.",
        target: { text: "Executive Summary", mode: "card" },
        crop: { text: "Executive Summary", mode: "card", sub: [0, 0, 0.55, 1] },
        at: [0.5, 0.5],
      },
      {
        id: "body",
        title: "The review",
        text: "Winners, laggards, macro context and risks, written from your holdings and live market data.",
        target: { text: "Executive Summary", mode: "card", sub: [0, 1.15, 1, 4.4] },
        crop: { text: "Executive Summary", mode: "card", sub: [0, 1.15, 0.45, 3.6] },
        at: [0.5, 0.4],
        pad: 10,
      },
      {
        id: "week",
        title: "Any week",
        text: "Each report covers one week. Pick an earlier week or analyze the current one again.",
        target: [{ re: "\\d{4}-w\\d{2}", mode: "control" }, { text: "Analyze", exact: true, mode: "control" }],
        at: [0.4, 0.5],
      },
      {
        id: "stats",
        title: "The numbers",
        text: "Value, period return, cash and the top winner and loser of the week.",
        target: { text: "Performance States", mode: "card" },
        at: [0.5, 0.5],
      },
      {
        id: "prompt",
        title: "No black box",
        text: "The model, the time and the full prompt behind each report.",
        target: { text: "Report Telemetry", mode: "card" },
        at: [0.5, 0.4],
      },
    ],
  },
  {
    id: "suggestions",
    label: "Suggestions",
    title: "Rebalancing ideas, with the math done",
    text: "The assistant proposes trades from weights alone. The app turns them into shares and amounts with live prices.",
    hash: "suggestions",
    ready: "Target Portfolio",
    hotspots: [
      {
        id: "idea",
        title: "A concrete trade",
        text: "Action, shares, amount and the weight before and after, with the reason and a price range.",
        target: { text: "P1", exact: true, mode: "card" },
        crop: { text: "P1", exact: true, mode: "card", sub: [0, 0, 0.6, 1] },
        at: [0.55, 0.45],
      },
      {
        id: "private",
        title: "Weights only",
        text: "The model never sees money amounts. The app computes them on your machine.",
        target: { text: "The assistant sees weights only", up: 1 },
        at: [0.5, 0.5],
      },
      {
        id: "target",
        title: "Target portfolio",
        text: "Every holding now and after the selected suggestions, with the change in percentage points.",
        target: { text: "Target Portfolio", mode: "card" },
        crop: { text: "Target Portfolio", mode: "card", sub: [0, 0, 1, 0.44] },
        at: [0.5, 0.3],
      },
      {
        id: "recalculate",
        title: "Fresh ideas",
        text: "Run it again after you trade. The list says when transactions changed since the last run.",
        target: { text: "Recalculate", mode: "control" },
        at: [0.5, 0.5],
      },
    ],
  },
  {
    id: "transactions",
    label: "Transactions",
    title: "Every trade, dividend and deposit",
    text: "Type them in or import a broker CSV. The ledger is the single source of every number.",
    hash: "transactions",
    ready: "Transaction Ledger",
    hotspots: [
      {
        id: "import",
        title: "Broker CSV import",
        text: "Trade Republic, Scalable Capital, Interactive Brokers and Degiro, with a dry-run preview.",
        target: { text: "Import CSV", mode: "control" },
        at: [0.5, 0.5],
      },
      {
        id: "add",
        title: "Add by hand",
        text: "Buys, sells, dividends, interest, deposits and withdrawals, with fees and taxes.",
        target: { text: "Add Transaction", mode: "control" },
        at: [0.5, 0.5],
      },
      {
        id: "search",
        title: "Search the ledger",
        text: "Filter by symbol or by transaction type.",
        target: [{ css: "input[placeholder^='Search ledger']" }, { text: "All Types", mode: "control" }],
        at: [0.5, 0.5],
      },
      {
        id: "types",
        title: "Clear types",
        text: "Each entry carries its type, so dividends and sells stand out at a glance.",
        target: { text: "Type", exact: true, mode: "column", rows: 6 },
        crop: [{ text: "Date", exact: true, mode: "column", rows: 4 }, { text: "Type", exact: true, mode: "column", rows: 4 }],
        at: [0.25, 0.5],
      },
      {
        id: "costs",
        title: "Fees and taxes",
        text: "Kept per transaction and summed on the overview.",
        target: { text: "Fee / Tax", mode: "column", rows: 6 },
        crop: [{ text: "Total Amount", mode: "column", rows: 4 }, { text: "Fee / Tax", mode: "column", rows: 4 }],
        at: [0.5, 0.5],
      },
    ],
  },
];
