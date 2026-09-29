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
});
