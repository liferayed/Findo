import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from './FilterBar';

const accounts = [{ id: 'a1', nickname: 'Chase Checking' }];
const baseValue = { from: '2026-08-13', to: '2026-09-13', accountId: null, allTime: false };

describe('FilterBar', () => {
  it('renders from/to dates and an account dropdown', () => {
    render(<FilterBar accounts={accounts} value={baseValue} onChange={() => {}} />);
    expect(screen.getByLabelText('From')).toHaveValue('2026-08-13');
    expect(screen.getByLabelText('to')).toHaveValue('2026-09-13');
    expect(screen.getByText('Chase Checking')).toBeInTheDocument();
  });

  it('calls onChange with the new from date', () => {
    const onChange = vi.fn();
    render(<FilterBar accounts={accounts} value={baseValue} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseValue, from: '2026-08-01' });
  });

  it('calls onChange toggling allTime when the toggle is clicked', () => {
    const onChange = vi.fn();
    render(<FilterBar accounts={accounts} value={baseValue} onChange={onChange} />);
    fireEvent.click(screen.getByText('All time'));
    expect(onChange).toHaveBeenCalledWith({ ...baseValue, allTime: true });
  });

  it('calls onChange with the selected account id', () => {
    const onChange = vi.fn();
    render(<FilterBar accounts={accounts} value={baseValue} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'a1' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseValue, accountId: 'a1' });
  });
});
