import { RegistryBrokerError } from '@hashgraphonline/standards-sdk';
import { describe, expect, it, beforeEach, vi } from 'vitest';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';

const fakeClient = {
  getRegistrationQuote: vi.fn(),
  registerAgent: vi.fn(),
  waitForRegistrationCompletion: vi.fn(),
};

const withBrokerMock = vi.fn(async (fn: (client: typeof fakeClient) => Promise<unknown>) => fn(fakeClient));

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
}));

describe('registration pipeline credits handling', () => {
  beforeEach(() => {
    vi.resetModules();
    withBrokerMock.mockClear();
    fakeClient.getRegistrationQuote.mockReset();
    fakeClient.registerAgent.mockReset();
    fakeClient.waitForRegistrationCompletion.mockReset();
  });

  it('throws InsufficientCreditsError when broker rejects registration due to shortfall', async () => {
    const { registrationPipeline } = await import('../../src/workflows/registration');
    fakeClient.getRegistrationQuote.mockResolvedValue({
      requiredCredits: 20,
      availableCredits: 5,
      shortfallCredits: 15,
      creditsPerHbar: 10,
    });
    fakeClient.registerAgent.mockRejectedValue(
      new RegistryBrokerError('Insufficient credits', {
        status: 402,
        statusText: 'Payment Required',
        body: { shortfallCredits: 15, requiredCredits: 20, availableCredits: 5 },
      }),
    );
    await expect(registrationPipeline.run({ payload: { profile: {} } })).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
    });
    expect(fakeClient.registerAgent).toHaveBeenCalled();
  });

  it('continues to registration when no shortfall remains', async () => {
    const { registrationPipeline } = await import('../../src/workflows/registration');
    fakeClient.getRegistrationQuote.mockResolvedValue({
      requiredCredits: 20,
      availableCredits: 25,
      shortfallCredits: 0,
      creditsPerHbar: 10,
    });
    fakeClient.registerAgent.mockResolvedValue({ attemptId: 'attempt-1' });
    fakeClient.waitForRegistrationCompletion.mockResolvedValue({ result: { uaid: 'uaid:test' } });

    const result = await registrationPipeline.run({ payload: { profile: {} } });

    expect(fakeClient.registerAgent).toHaveBeenCalled();
    expect(result.context.uaid).toBe('uaid:test');
  });
});
