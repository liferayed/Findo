import type { HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLDivElement>;

export function Card({ className = '', ...rest }: Props) {
  return (
    <div
      className={`rounded-lg border border-stone-200 bg-white shadow-sm ${className}`}
      {...rest}
    />
  );
}
