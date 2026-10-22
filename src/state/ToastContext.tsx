import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type ToastKind = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
}

export interface ToastContextValue {
  toasts: Toast[];
  push: (kind: ToastKind, title: string, detail?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      const id = `toast-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      setToasts((previous) => [...previous.slice(-4), { id, kind, title, detail }]);
      window.setTimeout(() => {
        setToasts((previous) => previous.filter((toast) => toast.id !== id));
      }, kind === "error" ? 10000 : 5000);
      return id;
    },
    [],
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}
