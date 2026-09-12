import { useEffect, useState } from 'react';

type Account = {
  id: string;
  nickname: string;
  type: string;
  institution_name: string;
  last_four: string | null;
  is_active: boolean;
};

const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'brokerage', 'loan'];

async function parseErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  if (Array.isArray(body.errors)) return body.errors.join(', ');
  if (typeof body.error === 'string') return body.error;
  return `request failed with status ${res.status}`;
}

export function AccountsPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [nickname, setNickname] = useState('');
  const [type, setType] = useState(ACCOUNT_TYPES[0]);
  const [institutionName, setInstitutionName] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadAccounts() {
    const res = await fetch('/accounts');
    if (res.ok) {
      setAccounts(await res.json());
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname,
          type,
          institution_name: institutionName,
          last_four: lastFour || undefined,
        }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res));
        return;
      }
      setNickname('');
      setInstitutionName('');
      setLastFour('');
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error reaching the API');
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(account: Account) {
    const res = await fetch(`/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !account.is_active }),
    });
    if (res.ok) {
      await loadAccounts();
    }
  }

  return (
    <section style={{ marginTop: 32 }}>
      <h2>Accounts</h2>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Nickname (e.g. Chase-Checking)"
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={institutionName}
          onChange={(e) => setInstitutionName(e.target.value)}
          placeholder="Institution (e.g. Chase)"
          required
        />
        <input
          value={lastFour}
          onChange={(e) => setLastFour(e.target.value)}
          placeholder="Last 4 digits (optional)"
          maxLength={4}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Adding...' : 'Add Account'}
        </button>
      </form>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none' }}>
        {accounts.map((account) => (
          <li key={account.id} style={{ marginBottom: 8, opacity: account.is_active ? 1 : 0.5 }}>
            <strong>{account.nickname}</strong> — {account.institution_name} ({account.type})
            {account.last_four ? ` ••${account.last_four}` : ''}
            {' — '}
            {account.is_active ? 'active' : 'inactive'}{' '}
            <button type="button" onClick={() => toggleActive(account)}>
              {account.is_active ? 'Deactivate' : 'Reactivate'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
