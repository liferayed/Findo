import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

type Account = {
  id: string;
  nickname: string;
  type: string;
  institution_name: string;
  last_four: string | null;
  is_active: boolean;
};

const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'brokerage', 'loan'];

const inputClass =
  'w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 ' +
  'focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

function accountTypeLabel(type: string): string {
  return type.replace('_', ' ');
}

async function parseErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  if (Array.isArray(body.errors)) return body.errors.join(', ');
  if (typeof body.error === 'string') return body.error;
  return `request failed with status ${res.status}`;
}

export function AccountsPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [nickname, setNickname] = useState('');
  const [type, setType] = useState(ACCOUNT_TYPES[0]);
  const [institutionName, setInstitutionName] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [institutions, setInstitutions] = useState<{ id: string; canonical_name: string }[]>([]);

  async function loadAccounts() {
    const res = await fetch('/accounts');
    if (res.ok) {
      setAccounts(await res.json());
    }
  }

  async function loadInstitutions() {
    const res = await fetch('/institutions');
    if (res.ok) {
      setInstitutions(await res.json());
    }
  }

  useEffect(() => {
    loadAccounts();
    loadInstitutions();
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
    <section>
      <div className="mb-4">
        <h1 className="font-serif text-xl font-semibold text-stone-900">Accounts</h1>
        <p className="mt-1 text-sm text-stone-500">
          Track balances by connecting checking, savings, credit card, brokerage, and loan accounts.
        </p>
      </div>

      <Card className="mb-6 p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Add an account</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Nickname (e.g. Chase-Checking)"
            required
            className={inputClass}
          />
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {accountTypeLabel(t)}
              </option>
            ))}
          </select>
          <input
            value={institutionName}
            onChange={(e) => setInstitutionName(e.target.value)}
            placeholder="Institution (e.g. Chase)"
            list="institutions-datalist"
            required
            className={inputClass}
          />
          <datalist id="institutions-datalist">
            {institutions.map((inst) => (
              <option key={inst.id} value={inst.canonical_name} />
            ))}
          </datalist>
          <input
            value={lastFour}
            onChange={(e) => setLastFour(e.target.value)}
            placeholder="Last 4 digits (optional)"
            maxLength={4}
            className={inputClass}
          />
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={loading}>
              {loading ? 'Adding...' : 'Add Account'}
            </Button>
          </div>
        </form>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </Card>

      <Card className="overflow-hidden">
        {accounts.length === 0 ? (
          <p className="p-5 text-sm text-stone-500">No accounts yet — add one above to get started.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Institution</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                  <tr
                    key={account.id}
                    className={`border-b border-stone-100 last:border-0 ${account.is_active ? '' : 'opacity-60'}`}
                  >
                    <td className="px-4 py-3 font-medium text-stone-900">
                      {account.nickname}
                      {account.last_four && (
                        <span className="ml-1 font-normal text-stone-400">••{account.last_four}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-600">{account.institution_name}</td>
                    <td className="px-4 py-3">
                      <Badge tone="accent">{accountTypeLabel(account.type)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={account.is_active ? 'accent' : 'muted'}>
                        {account.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => navigate(`/transactions?account_id=${account.id}`)}
                        >
                          View Transactions
                        </Button>
                        <Button variant={account.is_active ? 'danger' : 'secondary'} onClick={() => toggleActive(account)}>
                          {account.is_active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </section>
  );
}
