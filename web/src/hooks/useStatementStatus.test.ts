import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStatementStatus } from './useStatementStatus';

describe('useStatementStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns null status when sharedItemId is null and never polls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStatementStatus(null));
    expect(result.current.status).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches immediately and polls every 3s while pending/processing, stops once ready', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      const status = call < 3 ? 'processing' : 'ready_for_review';
      return { ok: true, json: async () => ({ status, page: call, totalPages: 3 }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStatementStatus('s1'));
    await vi.waitFor(() => expect(result.current.status).toBe('processing'));
    expect(fetchMock).toHaveBeenCalledWith('/documents/s1/status');

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(result.current.status).toBe('ready_for_review');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(3); // no more polls once settled
  });

  it('surfaces a fetch failure as an error and stops polling', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStatementStatus('s1'));
    await vi.waitFor(() => expect(result.current.error).not.toBeNull());
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
