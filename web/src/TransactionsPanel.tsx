import { useEffect, useState } from 'react';

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
    <div style={{ marginTop: 12, paddingLeft: 16, borderLeft: '2px solid #ddd' }}>
      <h3 style={{ marginBottom: 4 }}>Transactions — {accountLabel}</h3>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
        <input
          type="date"
          value={transactionDate}
          onChange={(e) => setTransactionDate(e.target.value)}
          required
        />
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (e.g. 42.50)"
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as 'debit' | 'credit')}>
          <option value="debit">Debit (money out)</option>
          <option value="credit">Credit (money in)</option>
        </select>
        <input
          value={merchantRaw}
          onChange={(e) => setMerchantRaw(e.target.value)}
          placeholder="Merchant (e.g. Blue Bottle Coffee)"
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Adding...' : 'Add Transaction'}
        </button>
      </form>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <ul style={{ marginTop: 12, paddingLeft: 0, listStyle: 'none' }}>
        {transactions.map((transaction) => (
          <li key={transaction.id} style={{ marginBottom: 6 }}>
            {transaction.transaction_date} — <strong>{transaction.merchant_raw}</strong>{' '}
            {transaction.type === 'debit' ? '-' : '+'}
            {Math.abs(Number(transaction.amount)).toFixed(2)} ({transaction.type})
          </li>
        ))}
        {transactions.length === 0 && <li style={{ opacity: 0.6 }}>No transactions yet.</li>}
      </ul>
    </div>
  );
}
