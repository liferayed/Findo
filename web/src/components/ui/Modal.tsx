import type { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
};

export function Modal({ title, subtitle, onClose, children }: Props) {
  return (
    <div
      data-testid="modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/70 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-stone-50 shadow-2xl"
      >
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 className="font-serif text-base font-semibold text-stone-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-stone-400">{subtitle}</p>}
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
