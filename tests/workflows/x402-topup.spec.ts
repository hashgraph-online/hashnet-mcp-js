import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';

const client = {
  verifyLedgerChallenge: vi.fn().mockResolvedValue({ key: 'ledger-key' }),
  getX402Minimums: vi.fn().mockResolvedValue({ minimums: {} }),
  buyCreditsWithX402: vi.fn().mockResolvedValue({ creditedCredits: 50 }),
};

const withBrokerMock = vi.fn((fn: (client: typeof client) => Promise<unknown>) => fn(client));

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
}));

const { x402TopUpWorkflow } = await import('../../src/workflows/x402-topup');

describe('x402TopUpWorkflow', () => {
  beforeEach(() => {
    withBrokerMock.mockClear();
    client.verifyLedgerChallenge.mockClear();
    client.getX402Minimums.mockClear();
    client.buyCreditsWithX402.mockClear();
  });

  it('purchases credits with optional ledger verification', async () => {
    const input = {
      accountId: '0.0.1',
      credits: 25,
      evmPrivateKey: '0xabc',
      ledgerVerification: { challengeId: 'c1', accountId: '0.0.1', network: 'mainnet', signature: '0xbeef' },
    };
    const result = await x402TopUpWorkflow.run(input);
    expect(client.verifyLedgerChallenge).toHaveBeenCalled();
    expect(client.getX402Minimums).toHaveBeenCalled();
    expect(client.buyCreditsWithX402).toHaveBeenCalledWith(expect.objectContaining({ credits: 25 }));
    expect(result.context.purchase).toEqual({ creditedCredits: 50 });
  });
});
