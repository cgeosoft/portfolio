import { Electroview } from 'electrobun/view';
import type { PortfolioRPC, LogClientEventRequest, AppUpdateInfo } from '../../shared/rpc-types.js';
import { buildConsoleLogLine, CONTINUATION_INDENT, type ConsoleLogLevel } from '../../shared/log-format.js';

let updateAvailableHandler: ((info: AppUpdateInfo) => void) | null = null;

export function onUpdateAvailable(handler: (info: AppUpdateInfo) => void) {
  updateAvailableHandler = handler;
}

export const rpc = Electroview.defineRPC<PortfolioRPC>({
    maxRequestTime: 120_000,
    handlers: {
        requests: {},
        messages: {
            updateAvailable: (info: AppUpdateInfo) => {
                if (updateAvailableHandler) {
                    updateAvailableHandler(info);
                }
            },
        },
    }
});

export type ClientLogLevel = "info" | "success" | "warning" | "error" | "debug";

export interface ClientLogEntry {
    level: ClientLogLevel;
    source: string;
    step?: string;
    message: string;
    durationMs?: number;
    data?: Record<string, unknown>;
}

let electroviewInstanceRef: {
    hostSocket?: WebSocket;
    hostSocketCanSend?: boolean;
    flushHostMessagesViaFallback?: (queue: unknown[]) => void;
    pendingHostSocketMessages?: unknown[];
    hostSocketSendQueue?: unknown[];
} | undefined = undefined;

export function setElectroviewInstance(inst: unknown): void {
    electroviewInstanceRef = inst as typeof electroviewInstanceRef;
    if (typeof window !== "undefined") {
        (window as unknown as Record<string, unknown>)["__portfolioElectroview"] = inst;
    }
}

/** Devtools console styling that mirrors the main process terminal layout. */
const LEVEL_STYLES: Record<ConsoleLogLevel, string> = {
    debug: "color:#8b949e",
    info: "color:#58a6ff",
    success: "color:#3fb950",
    warning: "color:#d29922",
    error: "color:#f85149",
};

const DIM_STYLE = "color:#8b949e";

function writeWebviewConsoleLog(record: {
    level: ConsoleLogLevel;
    source: string;
    step?: string;
    message: string;
    durationMs?: number;
    data?: Record<string, unknown>;
}): void {
    const parts = buildConsoleLogLine(record);
    const [headline = "", ...rest] = parts.messageLines;
    const scope = parts.step ? `${parts.source}:${parts.step}` : parts.source;

    let format = `%c${parts.time}  %c${parts.levelLabel}  %c${scope}${parts.scopePadding}  %c${headline}`;
    const styles: string[] = [
        DIM_STYLE,
        `${LEVEL_STYLES[parts.level]};font-weight:bold`,
        DIM_STYLE,
        parts.level === "error" || parts.level === "warning" ? LEVEL_STYLES[parts.level] : "color:inherit",
    ];

    if (parts.duration) {
        format += `  %c${parts.duration}`;
        styles.push(DIM_STYLE);
    }
    if (parts.data) {
        format += `  %c${parts.data}`;
        styles.push(DIM_STYLE);
    }
    for (const line of rest) {
        format += `\n%c${CONTINUATION_INDENT}${line}`;
        styles.push(DIM_STYLE);
    }

    console.log(format, ...styles);
}

class ClientLogger {
    private buffer: ClientLogEntry[] = [];
    private isFlushing = false;

    public log(
        level: ClientLogLevel,
        step: string,
        message: string,
        durationMs?: number,
        data?: Record<string, unknown>,
    ): void {
        writeWebviewConsoleLog({ level, source: "webview", step, message, durationMs, data });

        if (this.buffer.length >= 200) {
            this.buffer.shift();
        }

        this.buffer.push({
            level,
            source: "webview",
            step,
            message,
            durationMs,
            data,
        });

        void this.flush();
    }

    public async flush(): Promise<void> {
        if (this.isFlushing || this.buffer.length === 0) return;
        this.isFlushing = true;
        try {
            while (this.buffer.length > 0) {
                const item = this.buffer[0];
                try {
                    const sendPromise = rpc.request.logClientEvent(item);
                    const timeoutPromise = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("log flush timeout")), 400)
                    );
                    await Promise.race([sendPromise, timeoutPromise]);
                    this.buffer.shift();
                } catch {
                    // Stop flushing if transport is unavailable or slow; retry later
                    break;
                }
            }
        } finally {
            this.isFlushing = false;
        }
    }

    public startTimer(step: string, startMessage?: string) {
        const startTime = performance.now();
        if (startMessage) {
            this.log("info", `${step}:start`, startMessage);
        }
        return {
            end: (level: ClientLogLevel = "info", endMessage = "completed", data?: Record<string, unknown>) => {
                const durationMs = Math.round(performance.now() - startTime);
                this.log(level, step, `${endMessage} in ${durationMs}ms`, durationMs, data);
                return durationMs;
            },
            fail: (error: unknown, failMessage = "failed", data?: Record<string, unknown>) => {
                const durationMs = Math.round(performance.now() - startTime);
                const errMsg = error instanceof Error ? error.message : String(error);
                this.log("error", step, `${failMessage}: ${errMsg} (after ${durationMs}ms)`, durationMs, {
                    ...data,
                    error: errMsg,
                });
                return durationMs;
            },
        };
    }
}

export const clientLogger = new ClientLogger();

let rpcReadyVerified = false;
let rpcReadyPromise: Promise<boolean> | null = null;

export function forceFallbackToNativeBridge(): void {
    if (typeof window === "undefined") return;
    const win = window as unknown as Record<string, unknown>;
    const inst = electroviewInstanceRef || (win["__portfolioElectroview"] as typeof electroviewInstanceRef);

    if (inst) {
        inst.hostSocketCanSend = false;
        if (inst.hostSocket) {
            try {
                inst.hostSocket.close();
            } catch {}
        }
        if (typeof inst.flushHostMessagesViaFallback === "function") {
            if (inst.pendingHostSocketMessages && inst.pendingHostSocketMessages.length > 0) {
                inst.flushHostMessagesViaFallback(inst.pendingHostSocketMessages);
            }
            if (inst.hostSocketSendQueue && inst.hostSocketSendQueue.length > 0) {
                inst.flushHostMessagesViaFallback(inst.hostSocketSendQueue);
            }
        }
        clientLogger.log("warning", "rpc_failover", "Forced RPC failover to native WebKitGTK bridge");
    }
}

/**
 * Wait until Electrobun bridge, encryption, and socket transport are ready and verified with a live ping.
 * Prevents initial RPC packets from being dropped or queued before connection initialization.
 */
export function ensureRpcReady(timeoutMs = 5000): Promise<boolean> {
    if (typeof window === "undefined" || rpcReadyVerified) {
        return Promise.resolve(true);
    }
    if (rpcReadyPromise) {
        return rpcReadyPromise;
    }

    rpcReadyPromise = (async () => {
        const start = Date.now();
        clientLogger.log("info", "rpc_handshake", "Waiting for Electrobun RPC bridge to be ready...");

        while (Date.now() - start < timeoutMs) {
            const win = window as unknown as Record<string, unknown>;
            const hasEncrypt = typeof win["__electrobun_encrypt"] === "function";
            const hasDecrypt = typeof win["__electrobun_decrypt"] === "function";
            const isPlaintext = Boolean(win["__electrobunPlaintextHostSocket"]);
            const inst = electroviewInstanceRef || (win["__portfolioElectroview"] as typeof electroviewInstanceRef);

            const socketActive = inst?.hostSocket?.readyState === WebSocket.OPEN &&
                Boolean(inst?.hostSocketCanSend);
            const hasBridge = Boolean(win["__electrobunHostBridge"]);

            if ((hasEncrypt && hasDecrypt) || isPlaintext || hasBridge) {
                // Attempt active RPC roundtrip ping with a 250ms timeout
                try {
                    const pingStart = performance.now();
                    const pingPromise = rpc.request.logClientEvent({
                        level: "debug",
                        source: "webview",
                        step: "handshake_ping",
                        message: "RPC handshake live ping",
                    });
                    const timeoutPromise = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("RPC handshake ping timed out")), 250)
                    );
                    await Promise.race([pingPromise, timeoutPromise]);
                    const dur = Math.round(performance.now() - pingStart);
                    rpcReadyVerified = true;
                    clientLogger.log("success", "rpc_ready", `RPC bridge verified and responsive in ${dur}ms`, dur, {
                        socketActive,
                        hasBridge,
                        socketReadyState: inst?.hostSocket?.readyState,
                    });
                    return true;
                } catch {
                    // Ping failed or timed out.
                    // If native bridge exists, socket is failing or dead. Switch to native bridge.
                    if (hasBridge) {
                        clientLogger.log("warning", "rpc_ping_failed", "RPC ping timed out. Triggering native bridge failover.");
                        forceFallbackToNativeBridge();
                        await new Promise((resolve) => setTimeout(resolve, 50));
                        continue;
                    }
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 30));
        }

        const totalWait = Date.now() - start;
        const win = window as unknown as Record<string, unknown>;
        clientLogger.log("warning", "rpc_timeout", `RPC readiness wait timed out after ${totalWait}ms`, totalWait, {
            hasEncrypt: typeof win["__electrobun_encrypt"] === "function",
            hasDecrypt: typeof win["__electrobun_decrypt"] === "function",
            hasBridge: Boolean(win["__electrobunHostBridge"]),
            hostSocketPort: win["__electrobunHostSocketPort"],
        });
        return false;
    })().finally(() => {
        if (!rpcReadyVerified) {
            rpcReadyPromise = null;
        }
    });

    return rpcReadyPromise;
}
