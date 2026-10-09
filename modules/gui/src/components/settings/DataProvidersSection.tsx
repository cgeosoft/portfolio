import { useState } from "react";
import {
  Database,
  TrendingUp,
  Newspaper,
  BarChart3,
  ArrowRightLeft,
  ShieldCheck,
  Search,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  PlayCircle,
  ExternalLink,
  Trash2,
  Radio,
  Check,
  Fingerprint,
  Users,
  Clock,
  Coins,
  Split,
  CalendarClock,
  Info,
  Layers,
  PieChart,
  Globe,
  Shapes,
} from "lucide-react";
import { rpc } from "../../rpc";
import { SectionHeader } from "./SettingsFields";
import { showToast } from "../common/Toaster";
import type { DesktopConfig, DataProviderId, DataProviderCategoryRouting } from "portfolio-shared/api-types";
import { DEFAULT_DATA_PROVIDER_ROUTING, SECRET_MASK } from "portfolio-shared/config-types";

interface DataProvidersSectionProps {
  config: DesktopConfig;
  onUpdateConfig: (updates: Partial<DesktopConfig>) => void;
}

type RoutedCategoryId = keyof DataProviderCategoryRouting;

interface CategoryDefinition {
  id: string;
  /** True when Settings stores a preferred provider for the category. */
  routed: boolean;
  label: string;
  description: string;
  icon: typeof TrendingUp;
  /**
   * Providers that supply this category. The toggle disables the others.
   * For a category that is not routed, the first one is the provider the app asks first.
   */
  providers: DataProviderId[];
}

/** Toggle order of every provider; matches the provider cards. */
const ALL_PROVIDERS: DataProviderId[] = ["yahoo", "finnhub", "fmp"];

/** Short provider names for the toggles and badges. */
const PROVIDER_SHORT_LABELS: Record<DataProviderId, string> = {
  fmp: "FMP",
  yahoo: "YF",
  finnhub: "FH",
};

/** Fallback order per category; mirrors CATEGORY_QUALITY_ORDER in modules/service/src/services/providers/chain.ts. */
const QUALITY_ORDER: Record<keyof DataProviderCategoryRouting, DataProviderId[]> = {
  quotes: ["fmp", "yahoo", "finnhub"],
  news: ["fmp", "finnhub", "yahoo"],
  charts: ["fmp", "yahoo"],
  fx: ["fmp", "yahoo", "finnhub"],
  fundamentals: ["fmp", "finnhub", "yahoo"],
  search: ["fmp", "yahoo", "finnhub"],
  companyNews: ["fmp", "finnhub"],
  dividends: ["fmp", "yahoo"],
  splits: ["fmp", "yahoo"],
  earnings: ["fmp", "finnhub", "yahoo"],
  analyst: ["fmp", "finnhub"],
  etfInfo: ["fmp", "yahoo"],
  etfHoldings: ["fmp", "yahoo"],
  etfSectors: ["fmp", "yahoo"],
  etfAssetClasses: ["yahoo", "fmp"],
};

const CATEGORIES: CategoryDefinition[] = [
  {
    id: "quotes",
    routed: true,
    label: "Market Quotes",
    description: "Real-time prices, daily change, volume, and 52-week price ranges.",
    icon: TrendingUp,
    providers: ["fmp", "yahoo", "finnhub"],
  },
  {
    id: "fx",
    routed: true,
    label: "Exchange Rates (FX)",
    description: "Foreign currency rates for multi-currency portfolio valuation.",
    icon: ArrowRightLeft,
    providers: ["fmp", "yahoo", "finnhub"],
  },
  {
    id: "search",
    routed: true,
    label: "Symbol Search",
    description: "Asset ticker lookup and auto-completion when entering transactions.",
    icon: Search,
    providers: ["fmp", "yahoo", "finnhub"],
  },
  {
    id: "identifiers",
    routed: false,
    label: "ISIN & CUSIP Lookup",
    description: "Resolves an ISIN or CUSIP to a ticker when entering transactions.",
    icon: Fingerprint,
    providers: ["fmp"],
  },
  {
    id: "charts",
    routed: true,
    label: "Historical Charts",
    description: "Daily candle history, portfolio trendlines, and technical indicators.",
    icon: BarChart3,
    providers: ["fmp", "yahoo"],
  },
  {
    id: "marketHours",
    routed: false,
    label: "Market Hours & Holidays",
    description: "Exchange sessions and closures. Without FMP the built-in table applies.",
    icon: Clock,
    providers: ["fmp"],
  },
  {
    id: "news",
    routed: true,
    label: "Market News",
    description: "General market and macroeconomic headlines.",
    icon: Newspaper,
    providers: ["fmp", "yahoo", "finnhub"],
  },
  {
    id: "companyNews",
    routed: true,
    label: "Company News",
    description: "Holding-specific headlines for the daily brief and AI reports.",
    icon: Newspaper,
    providers: ["finnhub", "fmp"],
  },
  {
    id: "fundamentals",
    routed: true,
    label: "Company Profile & Fundamentals",
    description: "Sector, industry, country, and valuation ratios.",
    icon: ShieldCheck,
    providers: ["fmp", "yahoo", "finnhub"],
  },
  {
    id: "dividends",
    routed: true,
    label: "Dividends",
    description: "Dividend history, ex-dates, pay dates, and frequency.",
    icon: Coins,
    providers: ["fmp", "yahoo"],
  },
  {
    id: "splits",
    routed: true,
    label: "Stock Splits",
    description: "Split history per holding.",
    icon: Split,
    providers: ["fmp", "yahoo"],
  },
  {
    id: "earnings",
    routed: true,
    label: "Earnings",
    description: "Last and upcoming earnings dates with estimates.",
    icon: CalendarClock,
    providers: ["fmp", "finnhub", "yahoo"],
  },
  {
    id: "analyst",
    routed: true,
    label: "Analyst Recommendations",
    description: "Price targets, grades, and consensus for holdings and AI reports.",
    icon: Users,
    providers: ["fmp", "finnhub"],
  },
  {
    id: "etfInfo",
    routed: true,
    label: "ETF Facts",
    description: "Expense ratio, assets under management, and holdings count.",
    icon: Info,
    providers: ["fmp", "yahoo"],
  },
  {
    id: "etfHoldings",
    routed: true,
    label: "ETF Holdings",
    description: "Fund look-through. FMP has the full list, Yahoo the top ten.",
    icon: Layers,
    providers: ["fmp", "yahoo"],
  },
  {
    id: "etfSectors",
    routed: true,
    label: "ETF Sector Weights",
    description: "Sector breakdown of funds.",
    icon: PieChart,
    providers: ["fmp", "yahoo"],
  },
  {
    id: "etfCountries",
    routed: false,
    label: "ETF Country Weights",
    description: "Country breakdown of funds.",
    icon: Globe,
    providers: ["fmp"],
  },
  {
    id: "etfAssetClasses",
    routed: true,
    label: "ETF Asset Classes",
    description: "Stock, bond, and cash split of funds.",
    icon: Shapes,
    providers: ["yahoo", "fmp"],
  },
];


interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

/** Provider name and subtitle, with the latency of the last test and a link to get a key. */
function ProviderTitle({
  name,
  subtitle,
  latencyMs,
  keyLabel,
  keyUrl,
}: {
  name: string;
  subtitle: string;
  latencyMs?: number;
  keyLabel?: string;
  keyUrl?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="text-sm font-bold text-slate-100">{name}</div>
        <div className="text-[11px] text-slate-400">{subtitle}</div>
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        {latencyMs !== undefined && (
          <span className="text-[10px] text-slate-400 font-mono">
            Latency: <strong className="text-slate-200">{latencyMs}ms</strong>
          </span>
        )}
        {keyLabel && keyUrl && (
          <button
            type="button"
            onClick={() => rpc.request.openExternalUrl({ url: keyUrl })}
            className="text-[#DD3C73] hover:underline flex items-center gap-1 font-mono cursor-pointer"
          >
            <span>{keyLabel}</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function TestButton({ testing, disabled = false, onClick }: { testing: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={testing || disabled}
      onClick={onClick}
      className="shrink-0 w-24 flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {testing ? (
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#DD3C73]" />
      ) : (
        <PlayCircle className="w-3.5 h-3.5 text-[#DD3C73]" />
      )}
      <span>{testing ? "Testing" : "Test"}</span>
    </button>
  );
}

function ClearButton({ disabled = false, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 w-24 flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Trash2 className="w-3.5 h-3.5 text-[#DD3C73]" />
      <span>Clear</span>
    </button>
  );
}

export function DataProvidersSection({ config, onUpdateConfig }: DataProvidersSectionProps) {
  // Finnhub API Key state
  const [finnhubApiKey, setFinnhubApiKey] = useState(config.finnhubApiKey || "");
  const [showFinnhubKey, setShowFinnhubKey] = useState(false);
  const [isTestingFinnhub, setIsTestingFinnhub] = useState(false);
  const [finnhubTestResult, setFinnhubTestResult] = useState<ConnectionTestResult | null>(null);

  // FMP API Key state
  const [fmpApiKey, setFmpApiKey] = useState(config.fmpApiKey || "");
  const [showFmpKey, setShowFmpKey] = useState(false);
  const [isTestingFmp, setIsTestingFmp] = useState(false);
  const [fmpTestResult, setFmpTestResult] = useState<ConnectionTestResult | null>(null);

  // Yahoo Finance state
  const [isTestingYahoo, setIsTestingYahoo] = useState(false);
  const [yahooTestResult, setYahooTestResult] = useState<ConnectionTestResult | null>(null);

  // Cache clearing state
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheClearMessage, setCacheClearMessage] = useState<string | null>(null);

  const routing: DataProviderCategoryRouting = { ...DEFAULT_DATA_PROVIDER_ROUTING, ...config.dataProviderRouting };

  /** Keeps the result for the latency readout and shows its message as a toast. */
  const reportTest = (set: (result: ConnectionTestResult) => void, result: ConnectionTestResult) => {
    set(result);
    showToast(result.message, result.success ? "success" : "error");
  };

  const handleTestYahoo = async () => {
    setIsTestingYahoo(true);
    setYahooTestResult(null);
    try {
      const res = await rpc.request.testYahooConnection({});
      if (res.success) {
        reportTest(setYahooTestResult, {
          success: true,
          message: "Yahoo Finance connection verified",
          latencyMs: res.latencyMs,
        });
      } else {
        reportTest(setYahooTestResult, {
          success: false,
          message: res.error || "Failed to reach Yahoo Finance",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reportTest(setYahooTestResult, {
        success: false,
        message: msg || "Connection test failed",
      });
    } finally {
      setIsTestingYahoo(false);
    }
  };

  const handleTestFinnhub = async () => {
    setIsTestingFinnhub(true);
    setFinnhubTestResult(null);
    try {
      const res = await rpc.request.testFinnhubConnection({ apiKey: finnhubApiKey });
      if (res.success) {
        reportTest(setFinnhubTestResult, {
          success: true,
          message: "Finnhub connection verified",
          latencyMs: res.latencyMs,
        });
      } else {
        reportTest(setFinnhubTestResult, {
          success: false,
          message: res.error || "Finnhub authentication failed",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reportTest(setFinnhubTestResult, {
        success: false,
        message: msg || "Connection test failed",
      });
    } finally {
      setIsTestingFinnhub(false);
    }
  };

  const handleSaveFinnhubKey = (newKey: string) => {
    const trimmed = newKey.trim();
    setFinnhubApiKey(trimmed);
    setFinnhubTestResult(null);
    onUpdateConfig({ finnhubApiKey: trimmed });
  };

  const handleTestFmp = async () => {
    setIsTestingFmp(true);
    setFmpTestResult(null);
    try {
      const res = await rpc.request.testFmpConnection({ apiKey: fmpApiKey });
      if (res.success) {
        reportTest(setFmpTestResult, {
          success: true,
          message: "FMP connection verified",
          latencyMs: res.latencyMs,
        });
      } else {
        reportTest(setFmpTestResult, {
          success: false,
          message: res.error || "FMP authentication failed",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reportTest(setFmpTestResult, {
        success: false,
        message: msg || "Connection test failed",
      });
    } finally {
      setIsTestingFmp(false);
    }
  };

  const handleSaveFmpKey = (newKey: string) => {
    const trimmed = newKey.trim();
    setFmpApiKey(trimmed);
    setFmpTestResult(null);
    onUpdateConfig({ fmpApiKey: trimmed });
  };

  const handleSelectProvider = (category: keyof DataProviderCategoryRouting, provider: DataProviderId) => {
    const updated: DataProviderCategoryRouting = {
      ...routing,
      [category]: provider,
    };
    onUpdateConfig({ dataProviderRouting: updated });
    rpc.request.saveConfig({ dataProviderRouting: updated });
  };

  const handleClearCache = async () => {
    setIsClearingCache(true);
    setCacheClearMessage(null);
    try {
      const res = await rpc.request.clearMarketCache({});
      const count = res.clearedEntries ?? 0;
      setCacheClearMessage(`Purged ${count} cached market records. Fresh data will load on next refresh.`);
      setTimeout(() => setCacheClearMessage(null), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCacheClearMessage(`Failed to clear market cache: ${msg}`);
    } finally {
      setIsClearingCache(false);
    }
  };

  const isFinnhubConfigured = Boolean(finnhubApiKey && finnhubApiKey.trim().length > 0);
  const isFmpConfigured = Boolean(fmpApiKey && fmpApiKey.trim().length > 0);
  const isProviderConfigured = (provider: DataProviderId) =>
    provider === "fmp" ? isFmpConfigured : provider === "finnhub" ? isFinnhubConfigured : true;
  /** The provider the app uses for a category: the preferred one when it has a key, else the next best with a key. */
  const effectiveProvider = (cat: CategoryDefinition): DataProviderId | null => {
    if (cat.routed) {
      const preferred = routing[cat.id as RoutedCategoryId];
      if (isProviderConfigured(preferred)) return preferred;
      return QUALITY_ORDER[cat.id as RoutedCategoryId].find((p) => cat.providers.includes(p) && isProviderConfigured(p)) ?? null;
    }
    return cat.providers.find(isProviderConfigured) ?? null;
  };

  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-8">
      {/* Section Header */}
      <SectionHeader
        icon={Database}
        title="Data Providers"
        description="Manage market data providers. Providers operate independently. Select which provider supplies each data category."
      />

      {/* Part 1: Provider Cards */}
      <div className="space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>Providers</span>
        </div>

        <div className="flex flex-col divide-y divide-slate-800">
          {/* Yahoo Finance */}
          <div className="py-4 space-y-2.5">
            <ProviderTitle name="Yahoo Finance" subtitle="Public Market Data Engine" latencyMs={yahooTestResult?.latencyMs} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled
                className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-left text-slate-500 font-mono cursor-not-allowed"
              >
                No key needed
              </button>
              <TestButton testing={isTestingYahoo} onClick={handleTestYahoo} />
              <ClearButton disabled onClick={() => {}} />
            </div>
          </div>

          {/* Finnhub */}
          <div className="py-4 space-y-2.5">
            <ProviderTitle
              name="Finnhub Stock API"
              subtitle="Institutional Financial Intelligence"
              latencyMs={finnhubTestResult?.latencyMs}
              keyLabel="Get free key"
              keyUrl="https://finnhub.io/register"
            />
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showFinnhubKey ? "text" : "password"}
                  value={finnhubApiKey === SECRET_MASK ? "" : finnhubApiKey}
                  onChange={(e) => {
                    setFinnhubApiKey(e.target.value);
                    setFinnhubTestResult(null);
                  }}
                  onBlur={() => handleSaveFinnhubKey(finnhubApiKey)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  placeholder={finnhubApiKey === SECRET_MASK ? "•••••••• (stored)" : "Enter Finnhub API Key"}
                  className="w-full bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-lg pl-9 pr-9 py-2 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowFinnhubKey(!showFinnhubKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  {showFinnhubKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <TestButton testing={isTestingFinnhub} disabled={!isFinnhubConfigured} onClick={handleTestFinnhub} />
              <ClearButton disabled={!isFinnhubConfigured} onClick={() => handleSaveFinnhubKey("")} />
            </div>
          </div>

          {/* FMP */}
          <div className="py-4 space-y-2.5">
            <ProviderTitle
              name="Financial Modeling Prep"
              subtitle="Premium Market & Fundamentals Data"
              latencyMs={fmpTestResult?.latencyMs}
              keyLabel="Get API key"
              keyUrl="https://site.financialmodelingprep.com/developer/docs"
            />
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showFmpKey ? "text" : "password"}
                  value={fmpApiKey === SECRET_MASK ? "" : fmpApiKey}
                  onChange={(e) => {
                    setFmpApiKey(e.target.value);
                    setFmpTestResult(null);
                  }}
                  onBlur={() => handleSaveFmpKey(fmpApiKey)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  placeholder={fmpApiKey === SECRET_MASK ? "•••••••• (stored)" : "Enter FMP API Key"}
                  className="w-full bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-lg pl-9 pr-9 py-2 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowFmpKey(!showFmpKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  {showFmpKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <TestButton testing={isTestingFmp} disabled={!isFmpConfigured} onClick={handleTestFmp} />
              <ClearButton disabled={!isFmpConfigured} onClick={() => handleSaveFmpKey("")} />
            </div>
          </div>
        </div>
      </div>

      {/* Part 2: Category Routing Matrix */}
      <div className="space-y-4">
        <div className="border-b border-slate-800/80 pb-2">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>Categories</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Assign the preferred provider per category. Providers without a key are unavailable and the next best one is selected. If a provider fails or lacks data, the next configured one fills the gap.
          </p>
        </div>

        <div className="flex flex-col">
          {CATEGORIES.map((cat) => {
            const selected = effectiveProvider(cat);
            const unavailable = selected === null;
            const Icon = cat.icon;

            return (
              <div
                key={cat.id}
                aria-disabled={unavailable}
                className={`-mx-2 px-2 py-2 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                  unavailable ? "opacity-40" : "hover:bg-slate-800/50"
                }`}
              >
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <Icon className="w-4 h-4 mt-px text-[#DD3C73] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-200">{cat.label}</div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{cat.description}</p>
                  </div>
                </div>

                {/* Segmented Provider Toggle */}
                <div className="shrink-0 flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
                  {ALL_PROVIDERS.map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      disabled={!cat.providers.includes(provider) || !isProviderConfigured(provider)}
                      onClick={() => cat.routed && handleSelectProvider(cat.id as RoutedCategoryId, provider)}
                      className={`w-[4.5rem] flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-mono transition-all disabled:cursor-not-allowed disabled:opacity-30 ${
                        cat.routed ? "cursor-pointer" : "cursor-default"
                      } ${
                        selected === provider
                          ? "bg-[#DD3C73]/20 text-[#DD3C73] font-bold shadow-sm"
                          : cat.routed
                            ? "text-slate-400 hover:text-slate-200 disabled:hover:text-slate-400"
                            : "text-slate-400"
                      }`}
                    >
                      {selected === provider && <Check className="w-3 h-3" />}
                      <span>{PROVIDER_SHORT_LABELS[provider]}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Part 3: Market Data Cache Management */}
      <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-3">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-slate-200">Market Data Cache</div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Quotes and currency rates are cached in SQLite to accelerate load times and prevent API rate limiting.
            </p>
          </div>

          <button
            type="button"
            disabled={isClearingCache}
            onClick={handleClearCache}
            className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>{isClearingCache ? "Purging..." : "Clear Market Cache"}</span>
          </button>
        </div>

        {cacheClearMessage && (
          <div className="text-xs text-mint bg-mint/10 border border-mint/30 rounded-lg px-3 py-2">
            {cacheClearMessage}
          </div>
        )}
      </div>
    </div>
  );
}
