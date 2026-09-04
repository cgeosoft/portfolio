import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Bot,
  Cpu,
  Globe,
  Check,
  AlertCircle,
  RefreshCw,
  X,
  PlayCircle,
  Terminal,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { rpc } from "../../rpc";
import type { LlmTestStepId } from "../../../../shared/rpc-types";

export interface TestLlmModalProps {
  isOpen: boolean;
  onClose: () => void;
  provider: string;
  providerName: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

type StepStatus = "pending" | "running" | "passed" | "failed";

interface StepState {
  id: LlmTestStepId;
  title: string;
  description: string;
  status: StepStatus;
  message?: string;
  latencyMs?: number;
}

const INITIAL_STEPS: StepState[] = [
  {
    id: "config",
    title: "Configuration & Credentials",
    description: "Validating provider format, model identifier, and required API credentials.",
    status: "pending",
  },
  {
    id: "connection",
    title: "Endpoint Reachability & Handshake",
    description: "Establishing network connectivity to server daemon or API gateway.",
    status: "pending",
  },
  {
    id: "inference",
    title: "Model Diagnostic Inference",
    description: "Transmitting test prompt payload to evaluate model responsiveness.",
    status: "pending",
  },
  {
    id: "integrity",
    title: "Output Integrity & Latency Benchmark",
    description: "Sanitizing response output and benchmarking end-to-end latency.",
    status: "pending",
  },
];

export function TestLlmModal({
  isOpen,
  onClose,
  provider,
  providerName,
  model,
  apiKey,
  baseUrl,
}: TestLlmModalProps) {
  const [steps, setSteps] = useState<StepState[]>(INITIAL_STEPS);
  const [isRunning, setIsRunning] = useState(false);
  const [overallResult, setOverallResult] = useState<"idle" | "passed" | "failed">("idle");
  const [generatedOutput, setGeneratedOutput] = useState<string>("");
  const [totalTimeMs, setTotalTimeMs] = useState<number>(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const runTestSequence = useCallback(async () => {
    setIsRunning(true);
    setOverallResult("idle");
    setGeneratedOutput("");
    setTotalTimeMs(0);

    const freshSteps: StepState[] = INITIAL_STEPS.map((s) => ({ ...s, status: "pending" }));
    setSteps(freshSteps);

    const startTime = Date.now();
    let currentOutput = "";

    const stepOrder: LlmTestStepId[] = ["config", "connection", "inference", "integrity"];

    for (let i = 0; i < stepOrder.length; i++) {
      if (!isMountedRef.current) return;

      const stepId = stepOrder[i];

      // Mark current step as running
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status: "running" as StepStatus } : s))
      );

      // Brief natural pause for smooth visual step transition
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!isMountedRef.current) return;

      try {
        const res = await rpc.request.testLlmStep({
          step: stepId,
          provider,
          model,
          apiKey: apiKey || undefined,
          baseUrl: baseUrl || undefined,
          previousOutput: currentOutput,
        });

        if (!isMountedRef.current) return;

        if (res.success) {
          if (res.output) {
            currentOutput = res.output;
            setGeneratedOutput(res.output);
          }

          setSteps((prev) =>
            prev.map((s) =>
              s.id === stepId
                ? {
                    ...s,
                    status: "passed" as StepStatus,
                    message: res.message,
                    latencyMs: res.latencyMs,
                  }
                : s
            )
          );
        } else {
          setSteps((prev) =>
            prev.map((s) =>
              s.id === stepId
                ? {
                    ...s,
                    status: "failed" as StepStatus,
                    message: res.message || "Step verification failed.",
                  }
                : s
            )
          );
          setOverallResult("failed");
          setIsRunning(false);
          return;
        }
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setSteps((prev) =>
          prev.map((s) =>
            s.id === stepId
              ? {
                  ...s,
                  status: "failed" as StepStatus,
                  message: msg,
                }
              : s
          )
        );
        setOverallResult("failed");
        setIsRunning(false);
        return;
      }
    }

    if (isMountedRef.current) {
      setTotalTimeMs(Date.now() - startTime);
      setOverallResult("passed");
      setIsRunning(false);
    }
  }, [provider, model, apiKey, baseUrl]);

  // Run automatically on modal open
  useEffect(() => {
    if (isOpen) {
      runTestSequence();
    }
  }, [isOpen, runTestSequence]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isRunning) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isRunning, onClose]);

  if (!isOpen) return null;

  const passedCount = steps.filter((s) => s.status === "passed").length;
  const progressPercent = Math.round((passedCount / steps.length) * 100);

  const displayEndpoint =
    baseUrl?.trim() ||
    (provider === "ollama"
      ? "http://127.0.0.1:11434"
      : provider === "llamacpp-server" || provider === "llamacpp"
      ? "http://127.0.0.1:9100"
      : "Predefined Cloud Endpoint");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in font-mono">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#DD3C73]/15 border border-[#DD3C73]/30 flex items-center justify-center text-[#DD3C73]">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100">
                  Inference Provider Diagnostics
                </h3>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#243C8F]/30 text-blue-300 border border-[#243C8F]/60">
                  {providerName}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Verifying configuration, connectivity, and model execution
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isRunning}
            className="text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Configuration Summary Pill */}
        <div className="px-6 py-3 bg-slate-950/70 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Cpu className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
            <span className="text-slate-400 text-[11px]">Model:</span>
            <span className="text-slate-200 font-bold text-[11px] truncate max-w-[220px]" title={model}>
              {model || "Not specified"}
            </span>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-slate-400 text-[11px]">Endpoint:</span>
            <span className="text-slate-300 font-semibold text-[11px] truncate max-w-[200px]" title={displayEndpoint}>
              {displayEndpoint}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-slate-800 w-full overflow-hidden shrink-0">
          <div
            className={`h-full transition-all duration-300 ${
              overallResult === "failed"
                ? "bg-rose-500"
                : overallResult === "passed"
                ? "bg-[#A7E2C0]"
                : "bg-[#DD3C73]"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Modal Body: Steps List */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="space-y-3">
            {steps.map((step, idx) => {
              const isPassed = step.status === "passed";
              const isRunningStep = step.status === "running";
              const isFailed = step.status === "failed";

              return (
                <div
                  key={step.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isPassed
                      ? "bg-slate-950/40 border-[#A7E2C0]/30 shadow-sm"
                      : isRunningStep
                      ? "bg-[#DD3C73]/10 border-[#DD3C73]/50 shadow-md shadow-[#DD3C73]/5"
                      : isFailed
                      ? "bg-rose-950/20 border-rose-800/60"
                      : "bg-slate-950/30 border-slate-800/60 opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Status Indicator Icon */}
                    <div className="mt-0.5 shrink-0">
                      {isPassed ? (
                        <div className="w-5 h-5 rounded-full bg-[#A7E2C0]/20 border border-[#A7E2C0] flex items-center justify-center text-[#A7E2C0]">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      ) : isRunningStep ? (
                        <div className="w-5 h-5 rounded-full bg-[#DD3C73]/20 border border-[#DD3C73] flex items-center justify-center text-[#DD3C73]">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        </div>
                      ) : isFailed ? (
                        <div className="w-5 h-5 rounded-full bg-rose-500/20 border border-rose-500 flex items-center justify-center text-rose-400">
                          <AlertCircle className="w-3 h-3" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border border-slate-700 bg-slate-900 flex items-center justify-center text-[10px] text-slate-500 font-bold">
                          {idx + 1}
                        </div>
                      )}
                    </div>

                    {/* Step Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded border uppercase tracking-wider ${
                              isPassed
                                ? "text-[#A7E2C0] border-[#A7E2C0]/30 bg-[#A7E2C0]/10"
                                : isRunningStep
                                ? "text-[#DD3C73] border-[#DD3C73]/40 bg-[#DD3C73]/20"
                                : isFailed
                                ? "text-rose-400 border-rose-800 bg-rose-950/30"
                                : "text-slate-500 border-slate-800 bg-slate-900"
                            }`}
                          >
                            Step {idx + 1}
                          </span>
                          <span
                            className={`text-xs font-bold uppercase tracking-wider truncate ${
                              isPassed
                                ? "text-slate-200"
                                : isRunningStep
                                ? "text-[#DD3C73]"
                                : isFailed
                                ? "text-rose-300"
                                : "text-slate-500"
                            }`}
                          >
                            {step.title}
                          </span>
                        </div>

                        {step.latencyMs !== undefined && (
                          <span className="text-[10px] text-slate-400 shrink-0 font-mono flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-500" />
                            {step.latencyMs}ms
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        {step.description}
                      </p>

                      {/* Step Status Feedback Message */}
                      {step.message && (
                        <div
                          className={`text-[11px] mt-2 p-2 rounded-lg font-mono break-words ${
                            isPassed
                              ? "bg-slate-900 text-[#A7E2C0] border border-[#A7E2C0]/20"
                              : isFailed
                              ? "bg-rose-950/40 text-rose-300 border border-rose-800/50"
                              : "bg-slate-900 text-slate-300 border border-slate-800"
                          }`}
                        >
                          {step.message}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Model Response Preview upon Success */}
          {overallResult === "passed" && generatedOutput && (
            <div className="p-4 rounded-xl bg-slate-950/80 border border-[#A7E2C0]/40 space-y-2 animate-fade-in">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-[#A7E2C0] font-bold uppercase tracking-wider text-[10px]">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Model Response Output</span>
                </div>
                {totalTimeMs > 0 && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    Roundtrip: {totalTimeMs}ms
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-200 bg-slate-900/90 p-3 rounded-lg border border-slate-800 font-mono leading-relaxed break-words">
                &ldquo;{generatedOutput}&rdquo;
              </div>
            </div>
          )}

          {/* Overall Failure Notice */}
          {overallResult === "failed" && (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/60 flex items-start gap-3 animate-fade-in">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-rose-200 uppercase tracking-wider">
                  Diagnostics Unsuccessful
                </div>
                <p className="text-[11px] text-rose-300/90 mt-0.5 leading-relaxed">
                  The test stopped because one of the verification steps failed. Check your server status, base URL, or API key and retry.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
            <span>100% Local Validation</span>
          </div>

          <div className="flex items-center gap-2">
            {overallResult === "failed" && (
              <button
                type="button"
                onClick={runTestSequence}
                disabled={isRunning}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Diagnostics</span>
              </button>
            )}

            {overallResult === "passed" && (
              <button
                type="button"
                onClick={runTestSequence}
                disabled={isRunning}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
              >
                <PlayCircle className="w-3.5 h-3.5 text-[#DD3C73]" />
                <span>Retest</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              disabled={isRunning}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                overallResult === "passed"
                  ? "bg-[#A7E2C0] hover:bg-[#8fd4ad] text-slate-950"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-200"
              }`}
            >
              {overallResult === "passed" ? "Done" : "Close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
