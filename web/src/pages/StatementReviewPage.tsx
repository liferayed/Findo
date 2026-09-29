import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { useToast } from '../components/ui/ToastProvider';
import { parseErrorMessage } from './DocumentsPage';

type ReviewRow = {
  index: number;
  date: string;
  merchant: string;
  amount: number;
  kind: 'new' | 'corroborate' | 'duplicate' | 'possible' | 'ambiguous';
  candidate?: { id: string };
  confidence?: number;
  difference?: number;
};

type ReviewResponse = {
  accountId: string;
  rows: ReviewRow[];
  balanceMismatch: { statementEndingBalance: number; reconstructedBalance: number; gap: number } | null;
};

const KIND_BADGE: Record<ReviewRow['kind'], { label: string; tone: 'success' | 'warning' | 'muted' | 'danger' }> = {
  new: { label: 'New', tone: 'success' },
  corroborate: { label: 'Merged', tone: 'muted' },
  duplicate: { label: 'Possible Duplicate', tone: 'warning' },
  possible: { label: 'Needs Tag', tone: 'warning' },
  ambiguous: { label: 'Ambiguous', tone: 'danger' },
};

type Tag = { reason: 'tip' | 'tax' | 'fee' | 'other'; note: string };

export function StatementReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [tags, setTags] = useState<Record<number, Tag>>({});
  const [openPopoverIndex, setOpenPopoverIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const res = await fetch(`/documents/${id}/review`);
      if (!res.ok) {
        setError(await parseErrorMessage(res));
        return;
      }
      setData(await res.json());
    })();
  }, [id]);

  useEffect(() => {
    if (!data) return;
    const initial: Record<number, boolean> = {};
    data.rows.forEach((r) => {
      if (r.kind === 'new') initial[r.index] = true;
    });
    setChecked(initial);
  }, [data]);

  function toggleRow(row: ReviewRow) {
    if (row.kind === 'possible') {
      if (checked[row.index]) {
        setChecked((c) => ({ ...c, [row.index]: false }));
        setTags((t) => {
          const next = { ...t };
          delete next[row.index];
          return next;
        });
      } else {
        setOpenPopoverIndex(row.index);
      }
      return;
    }
    setChecked((c) => ({ ...c, [row.index]: !c[row.index] }));
  }

  const visibleRows = data?.rows.filter((r) => r.kind !== 'corroborate') ?? [];
  const mergedCount = (data?.rows.length ?? 0) - visibleRows.length;

  function buildSelections() {
    if (!data) return [];
    return data.rows
      .filter((r) => r.kind !== 'corroborate' && checked[r.index])
      .map((r) => {
        if (r.kind === 'new') return { index: r.index, action: 'new' as const };
        if (r.kind === 'possible') {
          const tag = tags[r.index];
          return { index: r.index, action: 'tag' as const, adjustmentReason: tag?.reason, adjustmentNote: tag?.note ?? '' };
        }
        return { index: r.index, action: 'force' as const };
      });
  }

  async function handleConfirm() {
    if (!id) return;
    setSubmitting(true);
    setSubmitError(null);
    let res: Response;
    try {
      res = await fetch(`/documents/${id}/confirm-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections: buildSelections() }),
      });
    } catch {
      setSubmitError("Couldn't reach the server. Try again.");
      setSubmitting(false);
      return;
    }
    if (!res.ok) {
      setSubmitError(await parseErrorMessage(res));
      setSubmitting(false);
      return;
    }
    showToast('Statement confirmed and saved.');
    navigate('/documents');
  }

  return (
    <section>
      <div className="mb-4">
        <h1 className="font-serif text-xl font-semibold text-stone-900">Review Statement</h1>
        <p className="mt-1 text-sm text-stone-500">Check the rows you want to save, then confirm.</p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {data?.balanceMismatch && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          ${Math.abs(data.balanceMismatch.gap).toFixed(2)} gap between our records and this statement — possibly a missed
          transaction.
        </div>
      )}

      {mergedCount > 0 && (
        <p className="mb-3 text-xs text-stone-400">
          {mergedCount} row{mergedCount > 1 ? 's' : ''} merged into existing transactions automatically.
        </p>
      )}

      <Card className="overflow-hidden">
        {!data ? (
          <EmptyState message="Loading…" />
        ) : visibleRows.length === 0 ? (
          <EmptyState message="No transactions need your review." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">Save</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Merchant</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.index} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={Boolean(checked[row.index])}
                      onChange={() => toggleRow(row)}
                      aria-label={`Save row ${row.index}`}
                    />
                  </td>
                  <td className="px-4 py-3">{row.date}</td>
                  <td className="px-4 py-3">{row.merchant}</td>
                  <td className="px-4 py-3 text-right">${Math.abs(row.amount).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={KIND_BADGE[row.kind].tone}>{KIND_BADGE[row.kind].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {openPopoverIndex !== null && data && (
        <TagPopover
          key={openPopoverIndex}
          row={data.rows.find((r) => r.index === openPopoverIndex)!}
          onCancel={() => setOpenPopoverIndex(null)}
          onConfirm={(tag) => {
            setTags((t) => ({ ...t, [openPopoverIndex]: tag }));
            setChecked((c) => ({ ...c, [openPopoverIndex]: true }));
            setOpenPopoverIndex(null);
          }}
        />
      )}

      {submitError && <ErrorBanner>{submitError}</ErrorBanner>}
      {visibleRows.length > 0 && openPopoverIndex === null && (
        <div className="mt-4 flex justify-end">
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Saving…' : `Confirm & Save ${Object.values(checked).filter(Boolean).length} Transactions`}
          </Button>
        </div>
      )}
    </section>
  );
}

function TagPopover({
  row,
  onCancel,
  onConfirm,
}: {
  row: ReviewRow;
  onCancel: () => void;
  onConfirm: (tag: Tag) => void;
}) {
  const [reason, setReason] = useState<Tag['reason'] | ''>('');
  const [note, setNote] = useState('');
  const statementAmount = Math.abs(row.amount);
  const receiptAmount = Math.abs(row.amount - (row.difference ?? 0));
  const canConfirm = reason !== '' && (reason !== 'other' || note.trim() !== '');

  return (
    <div className="mt-3 max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="mb-2 text-stone-700">
        Receipt: ${receiptAmount.toFixed(2)} → Statement: ${statementAmount.toFixed(2)}
      </p>
      <label htmlFor="tag-reason" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-500">
        Reason
      </label>
      <select
        id="tag-reason"
        className="mb-2 w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value as Tag['reason'])}
      >
        <option value="" disabled>
          Select…
        </option>
        <option value="tip">Tip</option>
        <option value="tax">Tax</option>
        <option value="fee">Fee</option>
        <option value="other">Other</option>
      </select>
      {reason === 'other' && (
        <>
          <label htmlFor="tag-note" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            Note
          </label>
          <input
            id="tag-note"
            className="mb-2 w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button className="text-xs font-semibold text-stone-500" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="rounded-md bg-emerald-800 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          disabled={!canConfirm}
          onClick={() => onConfirm({ reason: reason as Tag['reason'], note })}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
