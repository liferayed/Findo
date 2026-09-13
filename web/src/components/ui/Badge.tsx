import type { HTMLAttributes } from 'react';

type Tone = 'neutral' | 'success' | 'muted' | 'accent' | 'warning' | 'danger';

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
};

const tones: Record<Tone, string> = {
  neutral: 'bg-stone-100 text-stone-700',
  success: 'bg-emerald-50 text-emerald-800',
  muted: 'bg-stone-100 text-stone-500',
  accent: 'bg-amber-50 text-amber-900',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-rose-50 text-rose-700',
};

export function Badge({ tone = 'neutral', className = '', ...rest }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...rest}
    />
  );
}
