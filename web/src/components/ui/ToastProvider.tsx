import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastContextValue = { showToast: (message: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setMessage(next);
    timeoutRef.current = setTimeout(() => setMessage(null), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-emerald-50 shadow-xl">
          <span>✓</span>
          <span>{message}</span>
          <button
            onClick={() => setMessage(null)}
            className="ml-2 text-emerald-300 hover:text-emerald-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
