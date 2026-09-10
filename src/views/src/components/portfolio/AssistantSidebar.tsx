import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { PortfolioItem, FinancialPortfolioData } from "../../types/portfolio";
import type { PortfolioChatMessage, AssistantConversation } from "../../../../shared/rpc-types";
import { cleanThinkTags, formatTimeAgo } from "./utils";
import {
  Sparkles,
  Bot,
  Send,
  Trash2,
  X,
  Copy,
  Check,
  Settings,
  AlertCircle,
  TrendingUp,
  ShieldAlert,
  Wallet,
  Activity,
  MessageSquare,
  Plus,
  ChevronDown,
} from "lucide-react";

interface AssistantSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  portfolio: PortfolioItem | null;
  portfolioData: FinancialPortfolioData | null;
  onOpenSettings?: () => void;
  conversations?: AssistantConversation[];
  currentConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onDeleteConversation?: (id: string) => void;
  messages: PortfolioChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  onClearMessages: () => void;
  isLoading: boolean;
  error?: string | null;
  activeProvider?: string;
  activeModel?: string;
}

const SUGGESTIONS = [
  {
    icon: TrendingUp,
    label: "Portfolio health summary",
    prompt: "Provide an executive summary of my portfolio health, total returns, and current valuation.",
  },
  {
    icon: ShieldAlert,
    label: "Risk & asset concentration",
    prompt: "Assess my portfolio risk exposure and asset allocation concentration. Are there any overweight positions?",
  },
  {
    icon: Activity,
    label: "Technical indicators (RSI/SMA)",
    prompt: "Review the technical indicators (RSI 14, SMA 50, SMA 200) for all my holdings. Which ones appear overbought or oversold?",
  },
  {
    icon: Wallet,
    label: "Cash liquidity & buffer",
    prompt: "Analyze my cash liquidity buffer and explain whether my cash reserve is optimal given my current holdings.",
  },
];

export function AssistantSidebar({
  isOpen,
  onClose,
  portfolio,
  portfolioData,
  onOpenSettings,
  conversations = [],
  currentConversationId = null,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  messages,
  onSendMessage,
  onClearMessages,
  isLoading,
  error,
  activeProvider = "Local LLM",
  activeModel,
}: AssistantSidebarProps) {
  const [inputText, setInputText] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isConvDropdownOpen, setIsConvDropdownOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const convDropdownRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or loading change
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, isOpen]);

  // Focus textarea when sidebar opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 150);
    }
  }, [isOpen]);

  // Click outside to close conversations dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (convDropdownRef.current && !convDropdownRef.current.contains(e.target as Node)) {
        setIsConvDropdownOpen(false);
      }
    };
    if (isConvDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isConvDropdownOpen]);

  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isLoading) return;
    setInputText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await onSendMessage(trimmed);
  }, [inputText, isLoading, onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    // Auto-resize textarea
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const handleCopyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(cleanThinkTags(content, false));
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  const activeConversation = conversations.find((c) => c.id === currentConversationId);
  const conversationTitle = activeConversation ? activeConversation.title : "New Conversation";

  return (
    <aside
      aria-label="AI Portfolio Assistant"
      className={`shrink-0 flex flex-col h-full bg-[#0c1220] border-l border-slate-800/80 transition-all duration-300 ease-in-out font-mono text-slate-200 z-30 select-text ${
        isOpen
          ? "w-full sm:w-[400px] lg:w-[430px] opacity-100 visible"
          : "w-0 opacity-0 invisible overflow-hidden border-l-0"
      }`}
    >
      {/* Sidebar Header */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 bg-[#090e1a] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-[#DD3C73]/15 border border-[#DD3C73]/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-[#DD3C73]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-100">
                Assistant
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onNewChat && (
            <button
              onClick={() => {
                setIsConvDropdownOpen(false);
                onNewChat();
              }}
              className="p-1.5 rounded-md text-slate-400 hover:text-[#DD3C73] hover:bg-slate-800/60 transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
              title="Start New Chat"
              type="button"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={onClearMessages}
              className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 transition-colors cursor-pointer"
              title="Delete current conversation"
              type="button"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              title="Assistant Settings"
              type="button"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
            title="Close Assistant (Ctrl+J)"
            type="button"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Conversation Selection Menu Bar */}
      <div className="relative px-3 py-1.5 bg-[#080d17] border-b border-slate-800/80 flex items-center justify-between gap-2 shrink-0" ref={convDropdownRef}>
        <button
          type="button"
          onClick={() => setIsConvDropdownOpen((prev) => !prev)}
          data-open={isConvDropdownOpen}
          data-variant="outlined"
          className="cx-menu-trigger text-[11px] font-medium text-slate-300 hover:text-white px-2 py-1 flex-1 text-left"
          title="Select conversation"
        >
          <MessageSquare className="w-3 h-3 text-[#DD3C73] shrink-0" />
          <span className="truncate flex-1">{conversationTitle}</span>
          <ChevronDown className="cx-menu-chevron w-3 h-3 text-slate-500" />
        </button>

        {onNewChat && (
          <button
            type="button"
            onClick={() => {
              setIsConvDropdownOpen(false);
              onNewChat();
            }}
            className="px-2 py-1 text-[10.5px] font-bold tracking-wider rounded bg-[#DD3C73]/15 hover:bg-[#DD3C73]/25 text-[#DD3C73] border border-[#DD3C73]/40 transition-colors cursor-pointer shrink-0 flex items-center gap-1 uppercase"
            title="Start New Chat"
          >
            <Plus className="w-3 h-3" />
            <span>New Chat</span>
          </button>
        )}

        {/* Conversations Dropdown Menu */}
        {isConvDropdownOpen && (
          <div className="cx-menu absolute left-3 right-3 top-full mt-1 z-50 font-mono">
            <div className="cx-menu-label">
              <span>Saved Conversations ({conversations.length})</span>
            </div>

            <div className="max-h-60 overflow-y-auto custom-scrollbar">
              {conversations.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-500">
                  No saved conversations yet.
                </div>
              ) : (
                conversations.map((c) => {
                  const isActive = c.id === currentConversationId;
                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        onSelectConversation?.(c.id);
                        setIsConvDropdownOpen(false);
                      }}
                      data-active={isActive}
                      className="cx-menu-item justify-between group"
                    >
                      <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                        <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-[#DD3C73]" : "text-slate-500"}`} />
                        <div className="truncate min-w-0">
                          <div className="truncate text-xs">{c.title}</div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span>{formatTimeAgo(c.updatedAt)}</span>
                            <span>•</span>
                            <span>{c.messages?.length || 0} messages</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isActive && <Check className="w-3.5 h-3.5 text-[#DD3C73]" />}
                        {onDeleteConversation && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteConversation(c.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-all cursor-pointer"
                            title="Delete conversation"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Model / Provider Indicator Bar */}
      <div className="px-4 py-1.5 bg-[#080c16] border-b border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400 shrink-0">
        <div className="flex items-center gap-1.5 truncate min-w-0">
          <Bot className="w-3 h-3 text-[#DD3C73] shrink-0" />
          <span className="uppercase text-slate-500 font-semibold">Model:</span>
          <span className="text-slate-300 truncate">{activeModel || activeProvider}</span>
        </div>
        <div className="text-[9.5px] text-slate-500 uppercase tracking-wider shrink-0 pl-1">
          {portfolioData?.holdings ? `${portfolioData.holdings.length} Assets` : "0 Assets"}
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col justify-center items-center text-center py-6 px-2 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#DD3C73]/10 border border-[#DD3C73]/25 flex items-center justify-center">
              <Bot className="w-6 h-6 text-[#DD3C73]" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Portfolio Intelligence Assistant
              </h4>
              <p className="text-[11px] text-slate-400 leading-relaxed max-w-[280px]">
                Ask questions about your asset allocation, technical indicators, unrealized gains, or risk exposure.
              </p>
            </div>

            {/* Quick Suggestions */}
            <div className="w-full space-y-1.5 pt-2 text-left">
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
                Suggested questions
              </div>
              {SUGGESTIONS.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setInputText(item.prompt);
                      textareaRef.current?.focus();
                    }}
                    className="w-full p-2.5 rounded-lg bg-[#111827]/80 hover:bg-[#151f33] border border-slate-800 hover:border-[#DD3C73]/40 text-left transition-all cursor-pointer group flex items-center gap-2.5"
                  >
                    <Icon className="w-3.5 h-3.5 text-[#DD3C73] shrink-0 group-hover:scale-110 transition-transform" />
                    <span className="text-xs text-slate-300 group-hover:text-slate-100 font-medium">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isUser = msg.role === "user";
            const cleanedContent = cleanThinkTags(msg.content, false);

            return (
              <div
                key={index}
                className={`flex flex-col ${isUser ? "items-end" : "items-start"} group`}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-slate-500 uppercase tracking-wider">
                  <span>{isUser ? "You" : "Analyst"}</span>
                </div>

                <div
                  className={`relative rounded-xl text-xs leading-relaxed max-w-[92%] px-3.5 py-2.5 break-words ${
                    isUser
                      ? "bg-[#DD3C73]/15 border border-[#DD3C73]/40 text-slate-100 font-mono shadow-sm"
                      : "bg-[#111728] border border-slate-800 text-slate-200 shadow-md"
                  }`}
                >
                  {isUser ? (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <div className="prose prose-invert prose-xs max-w-none space-y-2 text-xs">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSanitize]}
                        components={{
                          h1: ({ children }) => (
                            <h1 className="text-sm font-bold text-[#DD3C73] mt-2 mb-1 uppercase tracking-wider border-b border-slate-800 pb-1">
                              {children}
                            </h1>
                          ),
                          h2: ({ children }) => (
                            <h2 className="text-xs font-bold text-slate-200 mt-2 mb-1 uppercase tracking-wider">
                              {children}
                            </h2>
                          ),
                          h3: ({ children }) => (
                            <h3 className="text-xs font-semibold text-slate-300 mt-1.5 mb-0.5">
                              {children}
                            </h3>
                          ),
                          p: ({ children }) => (
                            <p className="my-1.5 leading-relaxed text-slate-300 font-sans text-xs">
                              {children}
                            </p>
                          ),
                          ul: ({ children }) => (
                            <ul className="list-disc pl-4 space-y-1 my-1.5 text-slate-300 text-xs">
                              {children}
                            </ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="list-decimal pl-4 space-y-1 my-1.5 text-slate-300 text-xs">
                              {children}
                            </ol>
                          ),
                          li: ({ children }) => (
                            <li className="text-slate-300 text-xs">{children}</li>
                          ),
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#DD3C73] underline underline-offset-2 hover:text-[#e8558a] transition-colors"
                            >
                              {children}
                            </a>
                          ),
                          strong: ({ children }) => (
                            <strong className="font-bold text-slate-100">{children}</strong>
                          ),
                          code: ({ children }) => (
                            <code className="bg-slate-900 px-1 py-0.5 rounded text-[11px] text-[#A7E2C0] font-mono border border-slate-800">
                              {children}
                            </code>
                          ),
                          table: ({ children }) => (
                            <div className="overflow-x-auto my-2 border border-slate-800 rounded">
                              <table className="w-full text-left text-[11px] border-collapse">{children}</table>
                            </div>
                          ),
                          th: ({ children }) => (
                            <th className="bg-slate-900/80 px-2 py-1 border-b border-slate-800 font-semibold text-slate-300">
                              {children}
                            </th>
                          ),
                          td: ({ children }) => (
                            <td className="px-2 py-1 border-b border-slate-800/60 text-slate-300 font-mono">
                              {children}
                            </td>
                          ),
                        }}
                      >
                        {cleanedContent}
                      </ReactMarkdown>

                      {/* Copy message button */}
                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => handleCopyMessage(msg.content, index)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 cursor-pointer"
                          title="Copy response"
                          type="button"
                        >
                          {copiedIndex === index ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex flex-col items-start space-y-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider px-1">
              Analyst
            </span>
            <div className="rounded-xl px-3.5 py-3 bg-[#111728] border border-slate-800 text-slate-300 text-xs flex items-center gap-2.5 shadow-md">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#DD3C73] animate-ping" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#DD3C73] animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#DD3C73]" />
              </div>
              <span className="text-slate-400 text-xs">Analyzing portfolio metrics...</span>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold">Assistant Request Failed</div>
                <div className="text-[11px] leading-relaxed text-rose-300/90">{error}</div>
              </div>
            </div>
            {onOpenSettings && error.toLowerCase().includes("api key") && (
              <button
                onClick={onOpenSettings}
                className="w-full py-1.5 px-2.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-semibold tracking-wide transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                type="button"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Configure Assistant in Settings</span>
              </button>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 border-t border-slate-800/80 bg-[#090e1a] shrink-0">
        <div className="relative flex items-end gap-2 bg-[#0e1526] border border-slate-700/80 focus-within:border-[#DD3C73]/70 focus-within:ring-1 focus-within:ring-[#DD3C73]/40 rounded-xl p-2 transition-all shadow-inner">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your holdings, risks, metrics..."
            rows={1}
            disabled={isLoading}
            className="flex-1 bg-transparent border-0 resize-none text-xs text-slate-100 placeholder-slate-500 focus:outline-none custom-scrollbar max-h-[120px] py-1 font-mono leading-relaxed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim() || isLoading}
            className="h-8 w-8 rounded-lg bg-[#DD3C73] hover:bg-[#c93264] disabled:opacity-40 disabled:hover:bg-[#DD3C73] disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer shadow-md"
            title="Send Message (Enter)"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-slate-500">
          <span>Enter to send, Shift+Enter for newline</span>
          {portfolio?.baseCurrency && (
            <span className="font-semibold text-slate-400">
              Grounded in {portfolio.baseCurrency}
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
