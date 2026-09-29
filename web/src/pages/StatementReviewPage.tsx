import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorBanner } from '../components/ui/ErrorBanner';
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

export function StatementReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const visibleRows = data?.rows.filter((r) => r.kind !== 'corroborate') ?? [];
  const mergedCount = (data?.rows.length ?? 0) - visibleRows.length;

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
                    <input type="checkbox" defaultChecked={row.kind === 'new'} aria-label={`Save row ${row.index}`} />
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
    </section>
  );
}
