import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionsPage } from './TransactionsPage';

describe('TransactionsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/accounts')) {
          return Promise.resolve({ ok: true, json: async () => [{ id: 'a1', nickname: 'Chase Checking' }] });
        }
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 't1',
              account_id: 'a1',
              account_nickname: 'Chase Checking',
              transaction_date: '2026-09-11',
              amount: '-6.25',
              merchant_raw: 'Blue Bottle Coffee',
              type: 'debit',
              reconciliation_status: 'confirmed',
            },
          ],
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists transactions with a status badge', async () => {
    render(
      <MemoryRouter>
        <TransactionsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Blue Bottle Coffee')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
  });
});
