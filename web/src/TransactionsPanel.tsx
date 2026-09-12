import { useEffect, useState } from 'react';
import { Button } from './components/ui/Button';
import { Badge } from './components/ui/Badge';

type Transaction = {
  id: string;
  account_id: string;
  transaction_date: string;
  amount: string;
  merchant_raw: string;
  type: 'debit' | 'credit' | 'transfer';
  reconciliation_status: string;
};

type Props = {
  accountId: string;
  accountLabel: string;
};

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

async function parseErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  if (Array.isArray(body.errors)) return body.errors.join(', ');
  if (typeof body.error === 'string') return body.error;
  return `request failed with status ${res.status}`;
}

export function TransactionsPanel({ accountId, accountLabel }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionDate, setTransactionDate] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'debit' | 'credit'>('debit');
  const [merchantRaw, setMerchantRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadTransactions() {
    const res = await fetch(`/accounts/${accountId}/transactions`);
    if (res.ok) {
      setTransactions(await res.json());
    }
  }

  useEffect(() => {
    loadTransactions();
  }, [accountId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
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
    <div>
      <h3 className="mb-3 text-sm font-medium text-slate-700">Transactions — {accountLabel}</h3>

      <form onSubmit={handleSubmit} className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={loading}>
            {loading ? 'Adding...' : 'Add Transaction'}
          </Button>
        </div>
      </form>

      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

      {transactions.length === 0 ? (
        <p className="text-sm text-slate-500">No transactions yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Merchant</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => {
                const signedAmount = Math.abs(Number(transaction.amount)).toFixed(2);
                const isDebit = transaction.type === 'debit';
                return (
                  <tr key={transaction.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 text-slate-600">{transaction.transaction_date}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{transaction.merchant_raw}</td>
                    <td className="px-3 py-2">
                      <Badge tone={isDebit ? 'muted' : 'success'}>{transaction.type}</Badge>
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium tabular-nums ${
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
    </div>
  );
}
