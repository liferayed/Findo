import type { ReactNode } from 'react';

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
      <span>⚠️</span>
      <span>{children}</span>
    </div>
  );
}
