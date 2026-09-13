import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error';

type Toast = { message: string; tone: ToastTone };

type ToastContextValue = { showToast: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setToast({ message, tone });
    timeoutRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const isError = toast?.tone === 'error';

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          className={
            'fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-xl ' +
            (isError ? 'bg-rose-900 text-rose-50' : 'bg-emerald-900 text-emerald-50')
          }
        >
          <span>{isError ? '⚠' : '✓'}</span>
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className={isError ? 'ml-2 text-rose-300 hover:text-rose-100' : 'ml-2 text-emerald-300 hover:text-emerald-100'}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
