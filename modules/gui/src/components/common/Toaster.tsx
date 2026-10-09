import { useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

export type ToastKind = "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

/** How long a toast stays before it hides itself. */
const TOAST_DURATION_MS: Record<ToastKind, number> = { success: 4000, error: 8000 };

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Shows a short message in the corner of the window. It hides itself after a few seconds. */
export function showToast(message: string, kind: ToastKind = "success"): void {
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
  emit();
  setTimeout(() => dismissToast(id), TOAST_DURATION_MS[kind]);
}

/** Renders the toasts. Mount it once, in App. */
export function Toaster() {
  const items = useSyncExternalStore(subscribe, () => toasts);
  if (items.length === 0) return null;

  return (
    <div className="fixed top-16 right-6 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-lg border bg-widget shadow-2xl text-xs font-mono animate-popover-in ${
            t.kind === "success" ? "border-mint/40 text-mint" : "border-[#DD3C73]/40 text-[#DD3C73]"
          }`}
        >
          {t.kind === "success" ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          <span className="flex-1 min-w-0">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="text-slate-500 hover:text-slate-300 p-0.5 rounded transition-colors shrink-0 cursor-pointer"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
