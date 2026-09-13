import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsPage } from './AccountsPage';

describe('AccountsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: 'a1', nickname: 'Chase Checking', type: 'checking', institution_name: 'Chase', last_four: '4821', is_active: true },
        ],
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists accounts fetched from the API', async () => {
    render(
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Chase Checking')).toBeInTheDocument();
  });
});
