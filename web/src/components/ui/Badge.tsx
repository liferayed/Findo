import type { HTMLAttributes } from 'react';

type Tone = 'neutral' | 'success' | 'muted' | 'accent';

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
};

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-50 text-emerald-700',
  muted: 'bg-slate-100 text-slate-500',
  accent: 'bg-indigo-50 text-indigo-700',
};

export function Badge({ tone = 'neutral', className = '', ...rest }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...rest}
    />
  );
}
