import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { FilterBar } from '../components/ui/FilterBar';
import { EmptyState } from '../components/ui/EmptyState';

type Transaction = {
  id: string;
  account_id: string;
  account_nickname: string;
  transaction_date: string;
  amount: string;
  merchant_raw: string;
  type: 'debit' | 'credit' | 'transfer';
  reconciliation_status: string;
};

type Account = { id: string; nickname: string };

type Filter = { from: string; to: string; accountId: string | null; allTime: boolean };

const inputClass =
  'w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 ' +
  'focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function parseErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  if (Array.isArray(body.errors)) return body.errors.join(', ');
  if (typeof body.error === 'string') return body.error;
  return `request failed with status ${res.status}`;
}

function statusBadge(status: string) {
  if (status === 'confirmed') return <Badge tone="success">Confirmed</Badge>;
  if (status === 'unconfirmed') return <Badge tone="warning">Needs Review</Badge>;
  return <Badge tone="neutral">{status}</Badge>;
}

export function TransactionsPage() {
  const [searchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<Filter>({
    from: isoDateDaysAgo(30),
    to: isoDateDaysAgo(0),
    accountId: searchParams.get('account_id'),
    allTime: false,
  });

  const [transactionDate, setTransactionDate] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'debit' | 'credit'>('debit');
  const [merchantRaw, setMerchantRaw] = useState('');
  const [formAccountId, setFormAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadAccounts() {
    const res = await fetch('/accounts');
    if (res.ok) {
      const loaded: Account[] = await res.json();
      setAccounts(loaded);
      setFormAccountId((current) => current || loaded[0]?.id || '');
    }
  }

  async function loadTransactions() {
    const params = new URLSearchParams({
      ...(filter.allTime ? {} : { from: filter.from, to: filter.to }),
      ...(filter.accountId ? { account_id: filter.accountId } : {}),
    });
    const res = await fetch(`/transactions?${params}`);
    if (res.ok) {
      setTransactions(await res.json());
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    loadTransactions();
  }, [filter]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: formAccountId,
          transaction_date: transactionDate,
          amount: parseFloat(amount),
          type,
          merchant_raw: merchantRaw,
        }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res));
        return;
      }
      setTransactionDate('');
      setAmount('');
      setMerchantRaw('');
      await loadTransactions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error reaching the API');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div className="mb-4">
        <h1 className="font-serif text-xl font-semibold text-stone-900">Transactions</h1>
        <p className="mt-1 text-sm text-stone-500">View and add transactions across all of your accounts.</p>
      </div>

      <Card className="mb-6 p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Add a transaction</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select value={formAccountId} onChange={(e) => setFormAccountId(e.target.value)} className={inputClass}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.nickname}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            required
            className={inputClass}
          />
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (e.g. 42.50)"
            required
            className={inputClass}
          />
          <select value={type} onChange={(e) => setType(e.target.value as 'debit' | 'credit')} className={inputClass}>
            <option value="debit">Debit (money out)</option>
            <option value="credit">Credit (money in)</option>
          </select>
          <input
            value={merchantRaw}
            onChange={(e) => setMerchantRaw(e.target.value)}
            placeholder="Merchant (e.g. Blue Bottle Coffee)"
            required
            className={inputClass}
          />
          <div className="sm:col-span-2 lg:col-span-5">
            <Button type="submit" disabled={loading || !formAccountId}>
              {loading ? 'Adding...' : 'Add Transaction'}
            </Button>
          </div>
        </form>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </Card>

      <div className="mb-4">
        <FilterBar accounts={accounts} value={filter} onChange={setFilter} />
      </div>

      <Card className="overflow-hidden">
        {transactions.length === 0 ? (
          <EmptyState message="No transactions yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium">Merchant</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => {
                  const signedAmount = Math.abs(Number(transaction.amount)).toFixed(2);
                  const isDebit = transaction.type === 'debit';
                  return (
                    <tr key={transaction.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3 text-stone-600">{transaction.transaction_date}</td>
                      <td className="px-4 py-3 text-stone-600">{transaction.account_nickname}</td>
                      <td className="px-4 py-3 font-medium text-stone-900">{transaction.merchant_raw}</td>
                      <td className="px-4 py-3">
                        <Badge tone={isDebit ? 'muted' : 'success'}>{transaction.type}</Badge>
                      </td>
                      <td className="px-4 py-3">{statusBadge(transaction.reconciliation_status)}</td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          isDebit ? 'text-rose-600' : 'text-emerald-600'
                        }`}
                      >
                        {isDebit ? '-' : '+'}
                        {signedAmount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
