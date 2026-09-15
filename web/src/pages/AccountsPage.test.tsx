import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsPage } from './AccountsPage';

describe('AccountsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/institutions') {
          return { ok: true, json: async () => [] };
        }
        return {
          ok: true,
          json: async () => [
            { id: 'a1', nickname: 'Chase Checking', type: 'checking', institution_name: 'Chase', last_four: '4821', is_active: true },
          ],
        };
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

describe('AccountsPage institution autocomplete', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/accounts') {
          return { ok: true, json: async () => [] };
        }
        if (url === '/institutions') {
          return {
            ok: true,
            json: async () => [
              { id: 'i1', canonical_name: 'Chase', aliases: ['Chase', 'Chase Bank'] },
              { id: 'i2', canonical_name: 'Bank of America', aliases: ['Bank of America', 'BofA'] },
            ],
          };
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders fetched institutions as datalist options, including aliases', async () => {
    render(
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>,
    );

    // Note: findAllByRole resolves as soon as ANY match exists — the account
    // type <select> already has static options at first render, so it would
    // resolve before the async /institutions fetch populates the datalist.
    // waitFor keeps polling until the datalist options specifically show up.
    await waitFor(() => {
      const options = screen.getAllByRole('option', { hidden: true });
      const values = options.map((o) => (o as HTMLOptionElement).value);
      expect(values).toContain('Chase');
      expect(values).toContain('Bank of America');
      expect(values).toContain('BofA');
    });
  });

  it('still accepts free text not in the registry', async () => {
    render(
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>,
    );

    const institutionInput = await screen.findByPlaceholderText('Institution (e.g. Chase)');
    fireEvent.change(institutionInput, { target: { value: 'Local Credit Union' } });
    expect((institutionInput as HTMLInputElement).value).toBe('Local Credit Union');
  });
});
