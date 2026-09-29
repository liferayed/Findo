import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui/ToastProvider';
import { DocumentsPage } from './DocumentsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DocumentsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('DocumentsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/accounts')) {
          return Promise.resolve({ ok: true, json: async () => [{ id: 'a1', nickname: 'Chase Checking' }] });
        }
        if (url.startsWith('/documents/extract')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              file_ref: 'api/uploads/receipts/x.png',
              original_filename: 'coffee.png',
              is_readable: true,
              extraction: { merchant: 'Coffee Shop', transaction_date: '2026-09-11', total: 4.5, line_items: [] },
              detected_account_id: 'a1',
            }),
          });
        }
        if (url.startsWith('/documents/confirm')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ document_id: 'd1', transaction: { id: 't1' }, message: 'Got it' }),
          });
        }
        if (url.startsWith('/documents')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function selectAFile() {
    const file = new File(['x'], 'coffee.png', { type: 'image/png' });
    const input = screen.getByLabelText('Choose File') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('detected account pre-fills the Confirm modal and Confirm & Save shows a success toast', async () => {
    renderPage();
    selectAFile();
    fireEvent.click(screen.getByText('Upload'));

    expect(await screen.findByText('Confirm transaction')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Coffee Shop')).toBeInTheDocument();
    expect(screen.getByText('Detected')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Confirm & Save'));

    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  it('shows the clarification modal when no account is detected, then proceeds to confirm', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith('/accounts')) {
        return Promise.resolve({ ok: true, json: async () => [{ id: 'a1', nickname: 'Chase Checking' }] });
      }
      if (url.startsWith('/documents/extract')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            file_ref: 'api/uploads/receipts/y.png',
            original_filename: 'blurry-card.png',
            is_readable: true,
            extraction: { merchant: 'Store', transaction_date: '2026-09-09', total: 10, line_items: [] },
            detected_account_id: null,
          }),
        });
      }
      if (url.startsWith('/documents')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderPage();
    selectAFile();
    fireEvent.click(screen.getByText('Upload'));

    expect(await screen.findByText('Which account is this for?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Chase Checking'));

    expect(await screen.findByText('Confirm transaction')).toBeInTheDocument();
  });

  it('does not show the Detected badge when the account was manually chosen via the clarification modal', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith('/accounts')) {
        return Promise.resolve({ ok: true, json: async () => [{ id: 'a1', nickname: 'Chase Checking' }] });
      }
      if (url.startsWith('/documents/extract')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            file_ref: 'api/uploads/receipts/y.png',
            original_filename: 'blurry-card.png',
            is_readable: true,
            extraction: { merchant: 'Store', transaction_date: '2026-09-09', total: 10, line_items: [] },
            detected_account_id: null,
          }),
        });
      }
      if (url.startsWith('/documents')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderPage();
    selectAFile();
    fireEvent.click(screen.getByText('Upload'));

    expect(await screen.findByText('Which account is this for?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Chase Checking'));

    expect(await screen.findByText('Confirm transaction')).toBeInTheDocument();
    expect(screen.queryByText('Detected')).not.toBeInTheDocument();
  });

  it('a PDF file is uploaded to the statement endpoint, not the receipt one', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('/accounts')) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.startsWith('/documents/statements')) {
        return Promise.resolve({ ok: true, status: 202, json: async () => ({ shared_item_id: 'stmt-1' }) });
      }
      if (url.startsWith('/documents/stmt-1/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'pending', page: null, totalPages: null }) });
      }
      if (url.startsWith('/documents')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
    const input = screen.getByLabelText('Choose File') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/documents/statements', expect.anything()));
    expect(fetchMock).not.toHaveBeenCalledWith('/documents/extract', expect.anything());
  });

  it('an image with the "full statement" toggle checked also goes to the statement endpoint', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('/accounts')) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.startsWith('/documents/statements')) {
        return Promise.resolve({ ok: true, status: 202, json: async () => ({ shared_item_id: 'stmt-2' }) });
      }
      if (url.startsWith('/documents/stmt-2/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'pending', page: null, totalPages: null }) });
      }
      if (url.startsWith('/documents')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(screen.getByLabelText(/this is a full statement/i));
    const file = new File(['x'], 'statement.png', { type: 'image/png' });
    const input = screen.getByLabelText('Choose File') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/documents/statements', expect.anything()));
  });

  it('an image without the toggle still goes to the receipt endpoint (unchanged default)', async () => {
    renderPage();
    selectAFile();
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByText('Confirm transaction')).toBeInTheDocument());
  });

  it('shows a processing card with page progress while the statement is being read', async () => {
    let statusCall = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('/accounts')) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.startsWith('/documents/statements')) {
        return Promise.resolve({ ok: true, status: 202, json: async () => ({ shared_item_id: 'stmt-3' }) });
      }
      if (url.startsWith('/documents/stmt-3/status')) {
        statusCall += 1;
        return Promise.resolve({ ok: true, json: async () => ({ status: 'processing', page: statusCall, totalPages: 3 }) });
      }
      if (url.startsWith('/documents')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
    const input = screen.getByLabelText('Choose File') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));

    await waitFor(() => expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument());
  });

  it('navigates to the review page once status becomes ready_for_review', async () => {
    let statusCall = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('/accounts')) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.startsWith('/documents/statements')) {
        return Promise.resolve({ ok: true, status: 202, json: async () => ({ shared_item_id: 'stmt-4' }) });
      }
      if (url.startsWith('/documents/stmt-4/status')) {
        statusCall += 1;
        const status = statusCall < 2 ? 'processing' : 'ready_for_review';
        return Promise.resolve({ ok: true, json: async () => ({ status, page: statusCall, totalPages: 2 }) });
      }
      if (url.startsWith('/documents')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/documents']}>
        <ToastProvider>
          <Routes>
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/documents/:id/review" element={<div>Review Page Stub</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
    const input = screen.getByLabelText('Choose File') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));

    await waitFor(() => expect(screen.getByText('Review Page Stub')).toBeInTheDocument(), { timeout: 10000 });
  });

  it('shows the account-offer screen when status becomes needs_account, and creating an account submits it', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.startsWith('/accounts') && (!opts || opts.method === undefined)) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.startsWith('/documents/statements')) {
        return Promise.resolve({ ok: true, status: 202, json: async () => ({ shared_item_id: 'stmt-5' }) });
      }
      if (url.startsWith('/documents/stmt-5/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'needs_account', page: null, totalPages: null }) });
      }
      if (url === '/documents/stmt-5/account-offer' && (!opts || opts.method === undefined)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ institutionName: 'Chase', accountTypeText: 'Total Checking', lastFour: '4432', suggestedType: null }),
        });
      }
      if (url === '/documents/stmt-5/account-offer' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      if (url.startsWith('/documents')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.reject(new Error(`unexpected fetch: ${url} ${opts?.method}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
    const input = screen.getByLabelText('Choose File') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));

    await waitFor(() => expect(screen.getByText(/no matching account/i)).toBeInTheDocument());
    expect(screen.getByDisplayValue('Chase')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decline|skip/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/account type/i), { target: { value: 'checking' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/documents/stmt-5/account-offer',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('declining the account offer navigates straight to the review page (no create-account step)', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.startsWith('/accounts')) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.startsWith('/documents/statements')) return Promise.resolve({ ok: true, status: 202, json: async () => ({ shared_item_id: 'stmt-6' }) });
      if (url.startsWith('/documents/stmt-6/status')) return Promise.resolve({ ok: true, json: async () => ({ status: 'needs_account', page: null, totalPages: null }) });
      if (url === '/documents/stmt-6/account-offer' && (!opts || opts.method === undefined)) {
        return Promise.resolve({ ok: true, json: async () => ({ institutionName: 'Chase', accountTypeText: null, lastFour: '4432', suggestedType: null }) });
      }
      if (url === '/documents/stmt-6/account-offer' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      if (url.startsWith('/documents')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/documents']}>
        <ToastProvider>
          <Routes>
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/documents/:id/review" element={<div>Review Page Stub</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Choose File') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByText(/no matching account/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /assign accounts myself/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/documents/stmt-6/account-offer', expect.objectContaining({ method: 'POST', body: JSON.stringify({ accept: false }) })),
    );
    await waitFor(() => expect(screen.getByText('Review Page Stub')).toBeInTheDocument());
  });

  it('shows an error and stays put when declining the account offer fails', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.startsWith('/accounts')) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.startsWith('/documents/statements')) return Promise.resolve({ ok: true, status: 202, json: async () => ({ shared_item_id: 'stmt-7' }) });
      if (url.startsWith('/documents/stmt-7/status')) return Promise.resolve({ ok: true, json: async () => ({ status: 'needs_account', page: null, totalPages: null }) });
      if (url === '/documents/stmt-7/account-offer' && (!opts || opts.method === undefined)) {
        return Promise.resolve({ ok: true, json: async () => ({ institutionName: 'Chase', accountTypeText: null, lastFour: '4432', suggestedType: null }) });
      }
      if (url === '/documents/stmt-7/account-offer' && opts?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'already resolved' }) });
      }
      if (url.startsWith('/documents')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/documents']}>
        <ToastProvider>
          <Routes>
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/documents/:id/review" element={<div>Review Page Stub</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Choose File') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByText(/no matching account/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /assign accounts myself/i }));

    await waitFor(() => expect(screen.getByText('already resolved')).toBeInTheDocument());
    expect(screen.queryByText('Review Page Stub')).not.toBeInTheDocument();
  });

  it('the history table shows a statement as one row with a transaction count and a Review action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/accounts')) return Promise.resolve({ ok: true, json: async () => [] });
        if (url.startsWith('/documents')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              { id: 'stmt-7', original_filename: 'jan-statement.pdf', channel: 'web_upload', document_type: 'bank_statement', status: 'ready_for_review', transaction_count: 5, account_nickname: 'Chase Checking' },
            ],
          });
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('jan-statement.pdf')).toBeInTheDocument());
    expect(screen.getByText(/5 transactions/i)).toBeInTheDocument();
    expect(screen.getByText(/ready for review/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review/i })).toHaveAttribute('href', '/documents/stmt-7/review');
  });
});
