import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium ' +
  'px-3 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';

const variants: Record<Variant, string> = {
  primary: 'bg-emerald-800 text-white hover:bg-emerald-700 shadow-sm',
  secondary: 'bg-white text-stone-700 border border-stone-300 hover:bg-stone-50 shadow-sm',
  danger: 'bg-white text-rose-700 border border-stone-300 hover:bg-rose-50 shadow-sm',
  ghost: 'text-stone-600 hover:bg-stone-100',
};

export function Button({ variant = 'primary', className = '', ...rest }: Props) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}
