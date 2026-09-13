import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionsPage } from './TransactionsPage';

const accountsFixture = [
  { id: 'a1', nickname: 'Chase Checking' },
  { id: 'a2', nickname: 'Ally Savings' },
];

const transactionsFixture = [
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
  {
    id: 't2',
    account_id: 'a2',
    account_nickname: 'Ally Savings',
    transaction_date: '2026-09-10',
    amount: '-12.00',
    merchant_raw: 'Uber',
    type: 'debit',
    reconciliation_status: 'unconfirmed',
  },
];

describe('TransactionsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/accounts')) {
          return Promise.resolve({ ok: true, json: async () => accountsFixture });
        }
        return Promise.resolve({ ok: true, json: async () => transactionsFixture });
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

  it('renders a "Needs Review" badge for unconfirmed transactions', async () => {
    render(
      <MemoryRouter>
        <TransactionsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Needs Review')).toBeInTheDocument();
  });

  it('refetches transactions with updated query params when the FilterBar account changes', async () => {
    render(
      <MemoryRouter>
        <TransactionsPage />
      </MemoryRouter>,
    );
    await screen.findByText('Blue Bottle Coffee');

    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'a2' } });

    await waitFor(() => {
      const calls = (global.fetch as vi.Mock).mock.calls as Array<[string]>;
      const matched = calls.some(([url]) => url.startsWith('/transactions?') && url.includes('account_id=a2'));
      expect(matched).toBe(true);
    });
  });

  it('populates the add-transaction account select from GET /accounts', async () => {
    render(
      <MemoryRouter>
        <TransactionsPage />
      </MemoryRouter>,
    );
    await screen.findByText('Blue Bottle Coffee');

    const addTransactionAccountSelect = screen.getAllByRole('combobox')[0];
    expect(within(addTransactionAccountSelect).getByText('Chase Checking')).toBeInTheDocument();
    expect(within(addTransactionAccountSelect).getByText('Ally Savings')).toBeInTheDocument();
  });
});
