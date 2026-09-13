type FilterValue = { from: string; to: string; accountId: string | null; allTime: boolean };

type Props = {
  accounts: Array<{ id: string; nickname: string }>;
  value: FilterValue;
  onChange: (next: FilterValue) => void;
};

const dateInputClass = 'rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700';

export function FilterBar({ accounts, value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <label htmlFor="filter-from" className="text-[11px] font-semibold text-stone-400">
          From
        </label>
        <input
          id="filter-from"
          aria-label="From"
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className={dateInputClass}
        />
        <label htmlFor="filter-to" className="text-[11px] font-semibold text-stone-400">
          to
        </label>
        <input
          id="filter-to"
          aria-label="to"
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className={dateInputClass}
        />
      </div>
      <div className="h-5 w-px self-stretch bg-stone-200" />
      <button
        type="button"
        onClick={() => onChange({ ...value, allTime: !value.allTime })}
        className={`rounded-md border px-3 py-1 text-xs font-semibold ${
          value.allTime ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-stone-200 bg-white text-stone-600'
        }`}
      >
        All time
      </button>
      <div className="h-5 w-px self-stretch bg-stone-200" />
      <select
        aria-label="Account"
        value={value.accountId ?? ''}
        onChange={(e) => onChange({ ...value, accountId: e.target.value || null })}
        className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700"
      >
        <option value="">All accounts</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.nickname}
          </option>
        ))}
      </select>
    </div>
  );
}
