import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from './ToastProvider';

function Trigger() {
  const { showToast } = useToast();
  return <button onClick={() => showToast('Account added')}>trigger</button>;
}

function ErrorTrigger() {
  const { showToast } = useToast();
  return <button onClick={() => showToast("Couldn't upload the file", 'error')}>trigger-error</button>;
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

  it('defaults to the success (emerald) styling with a checkmark when no tone is given', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    screen.getByText('trigger').click();
    const message = await screen.findByText('Account added');
    expect(message.parentElement).toHaveClass('bg-emerald-900');
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('renders the error (rose) styling with a warning icon when tone is "error", distinct from the default', async () => {
    render(
      <ToastProvider>
        <ErrorTrigger />
      </ToastProvider>,
    );

    screen.getByText('trigger-error').click();
    const message = await screen.findByText("Couldn't upload the file");
    expect(message.parentElement).toHaveClass('bg-rose-900');
    expect(message.parentElement).not.toHaveClass('bg-emerald-900');
    expect(screen.getByText('⚠')).toBeInTheDocument();
  });
});
