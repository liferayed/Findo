import { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { FilterBar } from '../components/ui/FilterBar';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/ToastProvider';

type Account = { id: string; nickname: string };

type ExtractResult = {
  file_ref: string;
  original_filename: string;
  is_readable: boolean;
  extraction: { merchant: string; transaction_date: string | null; total: number; line_items: Array<{ description: string; amount: number }> } | null;
  detected_account_id: string | null;
};

type HistoryRow = {
  id: string;
  original_filename: string | null;
  received_at: string;
  channel: string;
  parse_status: string;
  account_nickname: string | null;
  transaction_merchant_raw: string | null;
  transaction_amount: string | null;
};

type Stage =
  | { name: 'idle' }
  | { name: 'processing' }
  | { name: 'clarify'; extract: ExtractResult }
  | { name: 'confirm'; extract: ExtractResult; accountId: string; wasDetected: boolean }
  | { name: 'manual'; fileRef: string; originalFilename: string }
  | { name: 'failed'; extract: ExtractResult };

const inputClass =
  'w-full rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-900 ' +
  'focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700';

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

export function DocumentsPage() {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [file, setFile] = useState<File | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [filter, setFilter] = useState({ from: isoDateDaysAgo(30), to: isoDateDaysAgo(0), accountId: null as string | null, allTime: false });

  async function loadAccounts() {
    const res = await fetch('/accounts');
    if (res.ok) setAccounts(await res.json());
  }

  async function loadHistory() {
    const params = new URLSearchParams();
    if (!filter.allTime) {
      params.set('from', filter.from);
      params.set('to', filter.to);
    }
    if (filter.accountId) params.set('account_id', filter.accountId);
    const res = await fetch(`/documents?${params.toString()}`);
    if (res.ok) setHistory(await res.json());
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    loadHistory();
  }, [filter]);

  const modalOpen = stage.name === 'clarify' || stage.name === 'confirm' || stage.name === 'manual' || stage.name === 'failed';

  async function handleUpload() {
    if (!file) return;
    setStage({ name: 'processing' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('channel', 'web_upload');

    let res: Response;
    try {
      res = await fetch('/documents/extract', { method: 'POST', body: formData });
    } catch {
      setStage({ name: 'idle' });
      showToast("Couldn't upload the file — check your connection and try again.", 'error');
      return;
    }
    if (!res.ok) {
      setStage({ name: 'idle' });
      showToast("Couldn't upload the file — check your connection and try again.", 'error');
      return;
    }
    const result: ExtractResult = await res.json();
    setFile(null);

    if (!result.is_readable) {
      setStage({ name: 'failed', extract: result });
    } else if (result.detected_account_id) {
      setStage({ name: 'confirm', extract: result, accountId: result.detected_account_id, wasDetected: true });
    } else {
      setStage({ name: 'clarify', extract: result });
    }
  }

  async function submitConfirm(payload: {
    fileRef: string;
    originalFilename: string;
    accountId: string;
    merchant: string;
    transactionDate: string;
    amount: number;
    lineItems: Array<{ description: string; amount: number }>;
    isManual: boolean;
  }, onError: (message: string) => void) {
    let res: Response;
    try {
      res = await fetch('/documents/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_ref: payload.fileRef,
          original_filename: payload.originalFilename,
          channel: 'web_upload',
          account_id: payload.accountId,
          merchant: payload.merchant,
          transaction_date: payload.transactionDate,
          amount: payload.amount,
          line_items: payload.lineItems,
          is_manual: payload.isManual,
        }),
      });
    } catch {
      onError('Couldn\'t reach the server. Check your connection and try again.');
      return;
    }
    if (!res.ok) {
      onError(await parseErrorMessage(res));
      return;
    }
    setStage({ name: 'idle' });
    showToast(`Transaction saved — $${payload.amount.toFixed(2)} at ${payload.merchant}`);
    loadHistory();
  }

  return (
    <section>
      <div className="mb-4">
        <h1 className="font-serif text-xl font-semibold text-stone-900">Documents</h1>
        <p className="mt-1 text-sm text-stone-500">
          Upload a receipt or bank statement — Findo reads it and creates transactions automatically.
        </p>
      </div>

      <Card className="mb-6 border-dashed p-5 text-center">
        <p className="mb-3 text-sm font-semibold text-stone-900">Drop a file here, or choose one</p>
        <label className="inline-block cursor-pointer rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50">
          Choose File
          <input
            type="file"
            accept="image/jpeg,image/png"
            aria-label="Choose File"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <Button className="ml-2" disabled={!file || stage.name === 'processing'} onClick={handleUpload}>
          {stage.name === 'processing' ? 'Reading…' : 'Upload'}
        </Button>
      </Card>

      {!modalOpen && (
        <>
          <FilterBar accounts={accounts} value={filter} onChange={setFilter} />

          <Card className="mt-4 overflow-hidden">
            {history.length === 0 ? (
              <EmptyState message="No uploads yet — add a receipt above to get started." />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">File</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3">{row.original_filename ?? 'Untitled'}</td>
                      <td className="px-4 py-3 text-stone-600">{row.channel === 'chat' ? 'Chat' : 'Web'}</td>
                      <td className="px-4 py-3 text-stone-600">{row.account_nickname ?? '—'}</td>
                      <td className="px-4 py-3">
                        <Badge tone={row.parse_status === 'parsed' ? 'success' : row.parse_status === 'failed' ? 'danger' : 'muted'}>
                          {row.parse_status === 'parsed' ? 'Parsed' : row.parse_status === 'failed' ? 'Unreadable' : 'Processing'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.transaction_merchant_raw ? `$${Math.abs(Number(row.transaction_amount)).toFixed(2)} · ${row.transaction_merchant_raw}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {stage.name === 'failed' && (
        <Modal title="Couldn't read this receipt" onClose={() => setStage({ name: 'idle' })}>
          <p className="mb-4 text-xs text-stone-500">
            The image is too blurry or the receipt is cut off. Try a clearer photo, or enter the transaction yourself.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStage({ name: 'idle' })}>
              Try Another File
            </Button>
            <Button onClick={() => setStage({ name: 'manual', fileRef: stage.extract.file_ref, originalFilename: stage.extract.original_filename })}>
              Enter Manually
            </Button>
          </div>
        </Modal>
      )}

      {stage.name === 'clarify' && (
        <Modal title="Which account is this for?" subtitle={`Couldn't tell from ${stage.extract.original_filename}`} onClose={() => setStage({ name: 'idle' })}>
          <ErrorBanner>No institution or account number found on this file.</ErrorBanner>
          <div className="flex flex-col gap-2">
            {accounts.map((account) => (
              <button
                key={account.id}
                onClick={() => setStage({ name: 'confirm', extract: stage.extract, accountId: account.id, wasDetected: false })}
                className="rounded-lg border border-stone-200 px-3 py-2.5 text-left text-sm hover:border-emerald-700 hover:bg-emerald-50"
              >
                {account.nickname}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {stage.name === 'confirm' && stage.extract.extraction && (
        <ConfirmForm
          key={stage.extract.file_ref}
          fileRef={stage.extract.file_ref}
          originalFilename={stage.extract.original_filename}
          accounts={accounts}
          initialAccountId={stage.accountId}
          detected={stage.wasDetected}
          merchant={stage.extract.extraction.merchant}
          transactionDate={stage.extract.extraction.transaction_date ?? isoDateDaysAgo(0)}
          amount={stage.extract.extraction.total}
          lineItems={stage.extract.extraction.line_items}
          itemsEditable={false}
          onClose={() => setStage({ name: 'idle' })}
          onSubmit={submitConfirm}
        />
      )}

      {stage.name === 'manual' && (
        <ConfirmForm
          key={stage.fileRef}
          fileRef={stage.fileRef}
          originalFilename={stage.originalFilename}
          accounts={accounts}
          initialAccountId=""
          detected={false}
          merchant=""
          transactionDate={isoDateDaysAgo(0)}
          amount={0}
          lineItems={[]}
          itemsEditable
          title="Enter transaction details"
          onClose={() => setStage({ name: 'idle' })}
          onSubmit={submitConfirm}
        />
      )}
    </section>
  );
}

type ConfirmFormProps = {
  fileRef: string;
  originalFilename: string;
  accounts: Account[];
  initialAccountId: string;
  detected: boolean;
  merchant: string;
  transactionDate: string;
  amount: number;
  lineItems: Array<{ description: string; amount: number }>;
  itemsEditable: boolean;
  title?: string;
  onClose: () => void;
  onSubmit: (
    payload: {
      fileRef: string;
      originalFilename: string;
      accountId: string;
      merchant: string;
      transactionDate: string;
      amount: number;
      lineItems: Array<{ description: string; amount: number }>;
      isManual: boolean;
    },
    onError: (message: string) => void,
  ) => void;
};

function ConfirmForm({
  fileRef,
  originalFilename,
  accounts,
  initialAccountId,
  detected,
  merchant: initialMerchant,
  transactionDate: initialDate,
  amount: initialAmount,
  lineItems: initialLineItems,
  itemsEditable,
  title = 'Confirm transaction',
  onClose,
  onSubmit,
}: ConfirmFormProps) {
  const [accountId, setAccountId] = useState(initialAccountId);
  const [merchant, setMerchant] = useState(initialMerchant);
  const [transactionDate, setTransactionDate] = useState(initialDate);
  const [amount, setAmount] = useState(String(initialAmount || ''));
  const [lineItems, setLineItems] = useState(initialLineItems);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleSubmit() {
    setSaving(true);
    setError(null);
    onSubmit(
      {
        fileRef,
        originalFilename,
        accountId,
        merchant,
        transactionDate,
        amount: parseFloat(amount),
        lineItems,
        // itemsEditable is true only for the manual-entry fallback (reached because the
        // receipt was unreadable) — the same signal doubles as isManual here so the backend
        // records parse_status/is_manual accurately instead of hard-coding a successful parse.
        isManual: itemsEditable,
      },
      (message) => {
        setError(message);
        setSaving(false);
      },
    );
  }

  return (
    <Modal title={title} subtitle={`From ${originalFilename}`} onClose={onClose}>
      {error && <ErrorBanner>{error} Your entries are kept — try again.</ErrorBanner>}
      <div className="mb-3">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-400">Merchant</label>
        <input className={inputClass} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
      </div>
      <div className="mb-3 flex gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-400">Date</label>
          <input type="date" className={inputClass} value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-400">Total</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className={inputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          Account {detected && <Badge tone="success">Detected</Badge>}
        </label>
        <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="" disabled>
            Select an account…
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.nickname}
            </option>
          ))}
        </select>
      </div>

      {!itemsEditable && lineItems.length > 0 && (
        <div className="mb-3">
          <div className="border-t border-stone-200 pt-2 text-xs font-semibold text-stone-700">Items on this receipt</div>
          <div className="mt-1.5 max-h-32 overflow-y-auto rounded-lg border border-stone-200 bg-white px-3">
            {lineItems.map((item, i) => (
              <div key={i} className="flex justify-between border-b border-stone-100 py-1.5 text-xs text-stone-600 last:border-0">
                <span>{item.description}</span>
                <span>{item.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-stone-400">Reference only — the total above is what's saved.</p>
        </div>
      )}

      {itemsEditable && (
        <div className="mb-3">
          <div className="border-t border-stone-200 pt-2 text-xs font-semibold text-stone-700">Items (optional)</div>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {lineItems.map((item, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  className={`${inputClass} flex-[2]`}
                  placeholder="Item"
                  value={item.description}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[i] = { ...next[i], description: e.target.value };
                    setLineItems(next);
                  }}
                />
                <input
                  className={`${inputClass} flex-1`}
                  placeholder="0.00"
                  value={item.amount || ''}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[i] = { ...next[i], amount: parseFloat(e.target.value) || 0 };
                    setLineItems(next);
                  }}
                />
                <button
                  type="button"
                  aria-label="Remove item"
                  className="px-1 text-xs font-semibold text-stone-400 hover:text-stone-600"
                  onClick={() => setLineItems(lineItems.filter((_, idx) => idx !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-1.5 text-xs font-semibold text-stone-500"
            onClick={() => setLineItems([...lineItems, { description: '', amount: 0 }])}
          >
            + Add Item
          </button>
          <p className="mt-1.5 text-[10px] text-stone-400">
            Optional — doesn't need to add up to the total exactly. Only the total above is saved as the transaction amount.
          </p>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving || !accountId || !merchant || !amount}>
          {saving ? 'Saving…' : itemsEditable ? 'Save Transaction' : 'Confirm & Save'}
        </Button>
      </div>
    </Modal>
  );
}
