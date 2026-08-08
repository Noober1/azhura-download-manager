import { useSyncExternalStore } from "react";

export type ToastLevel = "error" | "info";
export type Toast = { id: number; message: string; level: ToastLevel };

const AUTO_DISMISS_MS = 5000;

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function notify() {
  for (const cb of listeners) cb();
}

/** Queues a transient message for `<ToastHost />` to render. Module-scope
 *  (not React state) because `App.tsx`/`AddWindow.tsx`/`DetailWindow.tsx` are
 *  three separate Vite entry points, each its own webview with its own React
 *  tree — there's no shared component tree to lift state into. Mirrors
 *  `notify.ts`'s existing module-level-state pattern for the same reason. */
export function showToast(message: string, level: ToastLevel = "error"): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, level }];
  notify();
  setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Toast[] {
  return toasts;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}
