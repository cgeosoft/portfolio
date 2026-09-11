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
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Trash2,
  Radio,
  Check,
} from "lucide-react";
import { rpc } from "../../rpc";
import type { DesktopConfig, DataProviderId, DataProviderCategoryRouting } from "../../../../shared/rpc-types";

interface DataProvidersSectionProps {
  config: DesktopConfig;
  onUpdateConfig: (updates: Partial<DesktopConfig>) => void;
}

interface CategoryDefinition {
  id: keyof DataProviderCategoryRouting;
  label: string;
  description: string;
  icon: typeof TrendingUp;
  recommended: DataProviderId;
  yahooNote: string;
  finnhubNote: string;
}

const CATEGORIES: CategoryDefinition[] = [
  {
    id: "quotes",
    label: "Market Quotes",
    description: "Real-time prices, daily change, volume, and 52-week price ranges.",
    icon: TrendingUp,
    recommended: "yahoo",
    yahooNote: "Global coverage (stocks, ETFs, crypto, funds) without rate limits",
    finnhubNote: "Real-time US and global equities (60 calls per minute limit)",
  },
  {
    id: "news",
    label: "Market & Company News",
    description: "Macroeconomic headlines and holding-specific news for AI reports.",
    icon: Newspaper,
    recommended: "finnhub",
    yahooNote: "General Yahoo Finance search news headlines",
    finnhubNote: "Curated macroeconomic market news plus ticker-specific feeds",
  },
  {
    id: "charts",
    label: "Historical Charts",
    description: "Daily candle history, portfolio trendlines, and technical indicators.",
    icon: BarChart3,
    recommended: "yahoo",
    yahooNote: "Multi-year OHLCV candle histories across all global symbols",
    finnhubNote: "Stock candle resolution (subject to API rate limits)",
  },
  {
    id: "fx",
    label: "Exchange Rates (FX)",
    description: "Foreign currency rates for multi-currency portfolio valuation.",
    icon: ArrowRightLeft,
    recommended: "yahoo",
    yahooNote: "Global currency pairs against your base currency",
    finnhubNote: "Forex rates endpoint against major world currencies",
  },
  {
    id: "fundamentals",
    label: "Fundamentals & Ratings",
    description: "P/E ratios, beta, market cap, dividend yield, and analyst consensus.",
    icon: ShieldCheck,
    recommended: "finnhub",
    yahooNote: "Basic company profile and market metadata",
    finnhubNote: "Deep analyst consensus ratings, beta, and valuation ratios",
  },
  {
    id: "search",
    label: "Symbol Search",
    description: "Asset ticker lookup and auto-completion when entering transactions.",
    icon: Search,
    recommended: "yahoo",
    yahooNote: "Comprehensive search covering stocks, ETFs, indices, and crypto",
    finnhubNote: "Symbol lookup and display ticker resolution",
  },
];

export function DataProvidersSection({ config, onUpdateConfig }: DataProvidersSectionProps) {
  // Finnhub API Key state
  const [finnhubApiKey, setFinnhubApiKey] = useState(config.finnhubApiKey || "");
  const [showFinnhubKey, setShowFinnhubKey] = useState(false);
  const [isTestingFinnhub, setIsTestingFinnhub] = useState(false);
  const [finnhubTestResult, setFinnhubTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  // Yahoo Finance state
  const [isTestingYahoo, setIsTestingYahoo] = useState(false);
  const [yahooTestResult, setYahooTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  // Cache clearing state
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheClearMessage, setCacheClearMessage] = useState<string | null>(null);

  const routing: DataProviderCategoryRouting = config.dataProviderRouting || {
    quotes: "yahoo",
    news: "finnhub",
    charts: "yahoo",
    fx: "yahoo",
    fundamentals: "finnhub",
    search: "yahoo",
  };

  const handleTestYahoo = async () => {
    setIsTestingYahoo(true);
    setYahooTestResult(null);
    try {
      const res = await rpc.request.testYahooConnection({});
      if (res.success) {
        setYahooTestResult({
          success: true,
          message: "Yahoo Finance connection verified",
          latencyMs: res.latencyMs,
        });
      } else {
        setYahooTestResult({
          success: false,
          message: res.error || "Failed to reach Yahoo Finance",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setYahooTestResult({
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
        setFinnhubTestResult({
          success: true,
          message: "Finnhub connection verified",
          latencyMs: res.latencyMs,
        });
      } else {
        setFinnhubTestResult({
          success: false,
          message: res.error || "Finnhub authentication failed",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFinnhubTestResult({
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
    rpc.request.saveConfig({ finnhubApiKey: trimmed });
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

  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-8">
      {/* Section Header */}
      <div className="border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-wider">
          <Database className="w-4 h-4 text-[#DD3C73]" />
          <span>Data Providers</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Manage market data providers. Providers operate independently. Select which provider supplies each data category.
        </p>
      </div>

      {/* Part 1: Provider Cards */}
      <div className="space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>Configured Providers</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Yahoo Finance Card */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-100">Yahoo Finance</div>
                  <div className="text-[11px] text-slate-400">Public Market Data Engine</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#A7E2C0]/15 text-[#A7E2C0] border border-[#A7E2C0]/30">
                  Ready (Keyless)
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Provides quotes, historical candles, currency exchange rates, and symbol search without an API key.
              </p>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {["Quotes", "Historical Charts", "FX Rates", "Symbol Search", "News"].map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800/80 text-slate-300 border border-slate-700/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={isTestingYahoo}
                  onClick={handleTestYahoo}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isTestingYahoo ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#DD3C73]" />
                  ) : (
                    <PlayCircle className="w-3.5 h-3.5 text-[#DD3C73]" />
                  )}
                  <span>{isTestingYahoo ? "Testing Connection..." : "Test Connection"}</span>
                </button>

                {yahooTestResult?.latencyMs !== undefined && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    Latency: <strong className="text-slate-200">{yahooTestResult.latencyMs}ms</strong>
                  </span>
                )}
              </div>

              {yahooTestResult && (
                <div
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
                    yahooTestResult.success
                      ? "bg-[#A7E2C0]/10 border-[#A7E2C0]/30 text-[#A7E2C0]"
                      : "bg-[#DD3C73]/10 border-[#DD3C73]/30 text-[#DD3C73]"
                  }`}
                >
                  {yahooTestResult.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="truncate">{yahooTestResult.message}</span>
                </div>
              )}
            </div>
          </div>

          {/* Finnhub Card */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-100">Finnhub Stock API</div>
                  <div className="text-[11px] text-slate-400">Institutional Financial Intelligence</div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                    isFinnhubConfigured
                      ? "bg-[#A7E2C0]/15 text-[#A7E2C0] border-[#A7E2C0]/30"
                      : "bg-[#E3EACD]/15 text-[#E3EACD] border-[#E3EACD]/30"
                  }`}
                >
                  {isFinnhubConfigured ? "Key Configured" : "Key Required"}
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Supplies macroeconomic news, company headlines, analyst consensus, and valuation ratios. Free tier provides 60 calls per minute.
              </p>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {["Market News", "Fundamentals", "Analyst Ratings", "Quotes", "FX Rates"].map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800/80 text-slate-300 border border-slate-700/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* API Key Input */}
              <div className="pt-2 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 font-semibold">API Key</span>
                  <button
                    type="button"
                    onClick={() => rpc.request.openExternalUrl({ url: "https://finnhub.io/register" })}
                    className="text-[#DD3C73] hover:underline flex items-center gap-1 font-mono cursor-pointer"
                  >
                    <span>Get free key</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>

                <div className="relative">
                  <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showFinnhubKey ? "text" : "password"}
                    value={finnhubApiKey}
                    onChange={(e) => handleSaveFinnhubKey(e.target.value)}
                    placeholder="Enter Finnhub API Key"
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
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={isTestingFinnhub || !isFinnhubConfigured}
                  onClick={handleTestFinnhub}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-40"
                >
                  {isTestingFinnhub ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#DD3C73]" />
                  ) : (
                    <PlayCircle className="w-3.5 h-3.5 text-[#DD3C73]" />
                  )}
                  <span>{isTestingFinnhub ? "Verifying Key..." : "Test Connection"}</span>
                </button>

                {finnhubTestResult?.latencyMs !== undefined && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    Latency: <strong className="text-slate-200">{finnhubTestResult.latencyMs}ms</strong>
                  </span>
                )}
              </div>

              {finnhubTestResult && (
                <div
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
                    finnhubTestResult.success
                      ? "bg-[#A7E2C0]/10 border-[#A7E2C0]/30 text-[#A7E2C0]"
                      : "bg-[#DD3C73]/10 border-[#DD3C73]/30 text-[#DD3C73]"
                  }`}
                >
                  {finnhubTestResult.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="truncate">{finnhubTestResult.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Part 2: Category Routing Matrix */}
      <div className="space-y-4">
        <div className="border-b border-slate-800/80 pb-2">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>Category Routing</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Assign one provider per category. If a provider fails or lacks data, the system falls back safely to prevent interruption.
          </p>
        </div>

        <div className="space-y-3">
          {CATEGORIES.map((cat) => {
            const selected = routing[cat.id];
            const Icon = cat.icon;
            const needsFinnhubKey = selected === "finnhub" && !isFinnhubConfigured;

            return (
              <div
                key={cat.id}
                className="p-3.5 sm:p-4 rounded-xl bg-slate-950/50 border border-slate-800 hover:border-slate-700/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-[#DD3C73] shrink-0" />
                    <span className="text-xs font-bold text-slate-200">{cat.label}</span>
                    {cat.recommended === "yahoo" ? (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                        Default: Yahoo
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                        Default: Finnhub
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{cat.description}</p>
                  {needsFinnhubKey && (
                    <div className="flex items-center gap-1.5 text-[10px] text-[#E3EACD] pt-0.5">
                      <AlertCircle className="w-3 h-3 text-[#E3EACD] shrink-0" />
                      <span>Finnhub API key not set. Falling back to Yahoo Finance until configured.</span>
                    </div>
                  )}
                </div>

                {/* Segmented Provider Toggle */}
                <div className="shrink-0 flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleSelectProvider(cat.id, "yahoo")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                      selected === "yahoo"
                        ? "bg-[#DD3C73]/20 text-[#DD3C73] font-bold shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {selected === "yahoo" && <Check className="w-3 h-3" />}
                    <span>Yahoo Finance</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectProvider(cat.id, "finnhub")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                      selected === "finnhub"
                        ? "bg-[#DD3C73]/20 text-[#DD3C73] font-bold shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {selected === "finnhub" && <Check className="w-3 h-3" />}
                    <span>Finnhub</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Part 3: Market Data Cache Management */}
      <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-xs font-bold text-slate-200">Market Data Cache</div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Quotes and currency rates are cached in SQLite to accelerate load times and prevent API rate limiting.
            </p>
          </div>

          <button
            type="button"
            disabled={isClearingCache}
            onClick={handleClearCache}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>{isClearingCache ? "Purging..." : "Clear Market Cache"}</span>
          </button>
        </div>

        {cacheClearMessage && (
          <div className="text-xs text-[#A7E2C0] bg-[#A7E2C0]/10 border border-[#A7E2C0]/30 rounded-lg px-3 py-2">
            {cacheClearMessage}
          </div>
        )}
      </div>
    </div>
  );
}
