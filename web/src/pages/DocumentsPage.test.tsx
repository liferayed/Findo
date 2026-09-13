import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
});
