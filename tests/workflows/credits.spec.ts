import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RegistryBrokerError } from '@hashgraphonline/standards-sdk';

const withBrokerMock = vi.fn();

vi.mock('../../src/broker', () => ({
  withBroker: (...args: any[]) => withBrokerMock(...args),
}));

import { runCreditAwareRegistration } from '../../src/workflows/utils/credits';

describe('runCreditAwareRegistration', () => {
  beforeEach(() => {
    withBrokerMock.mockReset();
  });

  it('returns registerAgent response when no shortfall', async () => {
    withBrokerMock.mockResolvedValueOnce({ attemptId: 'attempt-1' });
    const result = await runCreditAwareRegistration({ payload: { profile: { display_name: 'demo' } } as any });
    expect(result).toEqual({ attemptId: 'attempt-1' });
  });

  it('supports onShortfall retry semantics', async () => {
    withBrokerMock
      .mockRejectedValueOnce(new RegistryBrokerError('credits', { status: 402, statusText: 'Payment Required', body: {} }))
      .mockResolvedValueOnce({ requiredCredits: 10, availableCredits: 0, shortfallCredits: 10 })
      .mockResolvedValueOnce({ attemptId: 'ok' });

    const result = await runCreditAwareRegistration({
      payload: { profile: { display_name: 'demo' } } as any,
      onShortfall: async () => 'retry',
    });
    expect(result).toEqual({ attemptId: 'ok' });
  });
});
