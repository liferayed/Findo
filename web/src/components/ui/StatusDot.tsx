type Tone = 'ok' | 'error' | 'unknown';

type Props = {
  tone: Tone;
};

const dotColors: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  error: 'bg-rose-500',
  unknown: 'bg-slate-300',
};

export function StatusDot({ tone }: Props) {
  return <span className={`inline-block h-2 w-2 rounded-full ${dotColors[tone]}`} aria-hidden="true" />;
}
