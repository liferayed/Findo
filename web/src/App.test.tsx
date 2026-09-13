import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts via ReactDOM and renders the Accounts view', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
  });
});
