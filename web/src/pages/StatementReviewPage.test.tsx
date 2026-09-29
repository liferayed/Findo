import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui/ToastProvider';
import { StatementReviewPage } from './StatementReviewPage';

function renderPage(id = 'stmt-1') {
  return render(
    <MemoryRouter initialEntries={[`/documents/${id}/review`]}>
      <ToastProvider>
        <Routes>
          <Route path="/documents/:id/review" element={<StatementReviewPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('StatementReviewPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders a row per extracted transaction with a status badge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accountId: 'a1',
          rows: [
            { index: 0, date: '2026-01-14', merchant: 'TARGET 1234', amount: -48.23, kind: 'new' },
            { index: 1, date: '2026-01-15', merchant: 'SHELL OIL', amount: -30, kind: 'duplicate', candidate: { id: 'c1' }, confidence: 0.9 },
          ],
          balanceMismatch: null,
        }),
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('TARGET 1234')).toBeInTheDocument());
    expect(screen.getByText('SHELL OIL')).toBeInTheDocument();
    expect(screen.getByText(/possible duplicate/i)).toBeInTheDocument();
  });

  it('shows the balance-mismatch banner when present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accountId: 'a1',
          rows: [],
          balanceMismatch: { statementEndingBalance: 100, reconstructedBalance: 62.46, gap: -37.54 },
        }),
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(/gap between our records/i)).toBeInTheDocument());
    expect(screen.getByText(/37\.54/)).toBeInTheDocument();
  });

  it('shows an empty state and no banner when there is no mismatch and no rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accountId: 'a1', rows: [], balanceMismatch: null }) }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(/no transactions/i)).toBeInTheDocument());
    expect(screen.queryByText(/gap between our records/i)).not.toBeInTheDocument();
  });

  it('shows an error banner if the review fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'not ready' }) }));
    renderPage();
    await waitFor(() => expect(screen.getByText('not ready')).toBeInTheDocument());
  });

  it('checking a possible row opens a tag popover; canceling leaves it unchecked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accountId: 'a1',
          rows: [{ index: 0, date: '2026-01-14', merchant: 'Target', amount: -50.4, kind: 'possible', candidate: { id: 'c1' }, confidence: 0.8, difference: -8.4 }],
          balanceMismatch: null,
        }),
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Target')).toBeInTheDocument());
    const checkbox = screen.getByLabelText('Save row 0') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(screen.getByText(/receipt.*\$42\.00.*statement.*\$50\.40/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(checkbox.checked).toBe(false);
  });

  it('confirming the popover with tip checks the row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accountId: 'a1',
          rows: [{ index: 0, date: '2026-01-14', merchant: 'Target', amount: -50.4, kind: 'possible', candidate: { id: 'c1' }, confidence: 0.8, difference: -8.4 }],
          balanceMismatch: null,
        }),
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Target')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Save row 0'));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'tip' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect((screen.getByLabelText('Save row 0') as HTMLInputElement).checked).toBe(true);
  });

  it('other requires a note before the popover confirm button is enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accountId: 'a1',
          rows: [{ index: 0, date: '2026-01-14', merchant: 'Target', amount: -50.4, kind: 'possible', candidate: { id: 'c1' }, confidence: 0.8, difference: -8.4 }],
          balanceMismatch: null,
        }),
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Target')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Save row 0'));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'other' } });
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'valet parking' } });
    expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled();
  });

  it('switching from one possible row to another resets the popover state instead of leaking it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accountId: 'a1',
          rows: [
            { index: 0, date: '2026-01-14', merchant: 'Target', amount: -50.4, kind: 'possible', candidate: { id: 'c1' }, confidence: 0.8, difference: -8.4 },
            { index: 1, date: '2026-01-15', merchant: 'Costco', amount: -20, kind: 'possible', candidate: { id: 'c2' }, confidence: 0.8, difference: -5 },
          ],
          balanceMismatch: null,
        }),
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Target')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Save row 0'));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'valet parking' } });
    expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled();

    // Switch to row 1's checkbox without canceling or confirming row 0's popover.
    fireEvent.click(screen.getByLabelText('Save row 1'));

    expect((screen.getByLabelText(/reason/i) as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
  });

  it('Confirm & Save sends the right selections and navigates away on success', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === '/documents/stmt-1/review') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            accountId: 'a1',
            rows: [
              { index: 0, date: '2026-01-14', merchant: 'Target', amount: -48.23, kind: 'new' },
              { index: 1, date: '2026-01-15', merchant: 'Shell Oil', amount: -30, kind: 'duplicate', candidate: { id: 'c1' } },
            ],
            balanceMismatch: null,
          }),
        });
      }
      if (url === '/documents/stmt-1/confirm-review' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/documents/stmt-1/review']}>
        <ToastProvider>
          <Routes>
            <Route path="/documents/:id/review" element={<StatementReviewPage />} />
            <Route path="/documents" element={<div>Documents Page Stub</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Target')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Save row 1')); // force the duplicate

    fireEvent.click(screen.getByRole('button', { name: /confirm & save 2/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/documents/stmt-1/confirm-review',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            selections: [
              { index: 0, action: 'new' },
              { index: 1, action: 'force' },
            ],
          }),
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('Documents Page Stub')).toBeInTheDocument());
  });

  it('a tagged possible row is included with its reason and note', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === '/documents/stmt-2/review') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            accountId: 'a1',
            rows: [{ index: 0, date: '2026-01-14', merchant: 'Target', amount: -50.4, kind: 'possible', candidate: { id: 'c1' }, difference: -8.4 }],
            balanceMismatch: null,
          }),
        });
      }
      if (url === '/documents/stmt-2/confirm-review') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/documents/stmt-2/review']}>
        <ToastProvider>
          <Routes>
            <Route path="/documents/:id/review" element={<StatementReviewPage />} />
            <Route path="/documents" element={<div>Documents Page Stub</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Target')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Save row 0'));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'fee' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & save 1/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/documents/stmt-2/confirm-review',
        expect.objectContaining({
          body: JSON.stringify({ selections: [{ index: 0, action: 'tag', adjustmentReason: 'fee', adjustmentNote: '' }] }),
        }),
      ),
    );
  });

  it('shows an error and stays on the page if confirm-review fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/documents/stmt-3/review') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ accountId: 'a1', rows: [{ index: 0, date: '2026-01-14', merchant: 'Target', amount: -48.23, kind: 'new' }], balanceMismatch: null }),
          });
        }
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'this statement has already been confirmed' }) });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/documents/stmt-3/review']}>
        <ToastProvider>
          <Routes>
            <Route path="/documents/:id/review" element={<StatementReviewPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Target')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /confirm & save 1/i }));
    await waitFor(() => expect(screen.getByText('this statement has already been confirmed')).toBeInTheDocument());
    expect(screen.getByText('Target')).toBeInTheDocument(); // still on the page
  });

  it('an unassigned row (declined statement) shows an account picker instead of a status badge, and requires an account before it can be checked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/accounts') return Promise.resolve({ ok: true, json: async () => [{ id: 'a1', nickname: 'New Checking' }] });
        if (url === '/documents/stmt-8/review') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ accountId: null, rows: [{ index: 0, date: '2026-01-14', merchant: 'Target', amount: -48.23, kind: 'unassigned' }], balanceMismatch: null }),
          });
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }),
    );
    renderPage('stmt-8');
    await waitFor(() => expect(screen.getByText('Target')).toBeInTheDocument());
    const checkbox = screen.getByLabelText('Save row 0') as HTMLInputElement;
    expect(checkbox).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/account for row 0/i), { target: { value: 'a1' } });
    expect(checkbox).not.toBeDisabled();
  });

  it('confirm-review selections include accountId for unassigned rows', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === '/accounts') return Promise.resolve({ ok: true, json: async () => [{ id: 'a1', nickname: 'New Checking' }] });
      if (url === '/documents/stmt-9/review') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ accountId: null, rows: [{ index: 0, date: '2026-01-14', merchant: 'Target', amount: -48.23, kind: 'unassigned' }], balanceMismatch: null }),
        });
      }
      if (url === '/documents/stmt-9/confirm-review') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/documents/stmt-9/review']}>
        <ToastProvider>
          <Routes>
            <Route path="/documents/:id/review" element={<StatementReviewPage />} />
            <Route path="/documents" element={<div>Documents Page Stub</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Target')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/account for row 0/i), { target: { value: 'a1' } });
    fireEvent.click(screen.getByLabelText('Save row 0'));
    fireEvent.click(screen.getByRole('button', { name: /confirm & save 1/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/documents/stmt-9/confirm-review',
        expect.objectContaining({ body: JSON.stringify({ selections: [{ index: 0, action: 'new', accountId: 'a1' }] }) }),
      ),
    );
  });
});
