import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const POLL_INTERVAL_MS = 3000;
const ACTIVE_STATUSES = new Set(['pending', 'processing']);

type StatementStatus = {
  status: string | null;
  page: number | null;
  totalPages: number | null;
  error: string | null;
};

// Polls GET /documents/:id/status every 3s while the statement is pending/processing (F1.7
// design §1), stopping as soon as it settles into any other status (needs_account,
// ready_for_review, failed, parsed) or hits an error — so a finished/failed upload doesn't
// keep hitting the API forever while the page sits open.
export function useStatementStatus(sharedItemId: string | null): StatementStatus {
  const [state, setState] = useState<StatementStatus>({ status: null, page: null, totalPages: null, error: null });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!sharedItemId) {
      setState({ status: null, page: null, totalPages: null, error: null });
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/documents/${sharedItemId}/status`);
        if (!res.ok) {
          throw new Error(`status check failed with ${res.status}`);
        }
        const body = await res.json();
        if (cancelled) return;
        flushSync(() => setState({ status: body.status, page: body.page, totalPages: body.totalPages, error: null }));
        if (ACTIVE_STATUSES.has(body.status) || body.status === null || body.status === undefined) {
          timeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        flushSync(() =>
          setState((prev) => ({ ...prev, error: err instanceof Error ? err.message : 'status check failed' })),
        );
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [sharedItemId]);

  return state;
}
