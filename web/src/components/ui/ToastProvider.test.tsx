import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from './ToastProvider';

function Trigger() {
  const { showToast } = useToast();
  return <button onClick={() => showToast('Account added')}>trigger</button>;
}

describe('ToastProvider', () => {
  it('shows a toast when showToast is called, then auto-dismisses', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    screen.getByText('trigger').click();
    expect(await screen.findByText('Account added')).toBeInTheDocument();
  });
});
