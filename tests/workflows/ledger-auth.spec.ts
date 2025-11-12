import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';

const client = {
  createLedgerChallenge: vi.fn().mockResolvedValue({ challengeId: 'c1', message: 'sign-me' }),
  verifyLedgerChallenge: vi.fn().mockResolvedValue({ key: 'ledger-key' }),
};

const withBrokerMock = vi.fn((fn: (client: typeof client) => Promise<unknown>) => fn(client));

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
}));

const { ledgerAuthWorkflow } = await import('../../src/workflows/ledger-auth');

describe('ledgerAuthWorkflow', () => {
  beforeEach(() => {
    withBrokerMock.mockClear();
    client.createLedgerChallenge.mockClear();
    client.verifyLedgerChallenge.mockClear();
  });

  it('returns challenge when no signature provided', async () => {
    const result = await ledgerAuthWorkflow.run({ accountId: '0.0.1', network: 'testnet' });
    expect(client.createLedgerChallenge).toHaveBeenCalled();
    expect(result.steps[0].output).toEqual({ challengeId: 'c1', message: 'sign-me' });
    expect(client.verifyLedgerChallenge).not.toHaveBeenCalled();
  });

  it('verifies ledger challenge when signature provided', async () => {
    const input = { accountId: '0.0.1', network: 'mainnet', signature: '0xabc' };
    const result = await ledgerAuthWorkflow.run(input);
    expect(client.verifyLedgerChallenge).toHaveBeenCalledWith({
      challengeId: 'c1',
      accountId: '0.0.1',
      network: 'mainnet',
      signature: '0xabc',
      signatureKind: undefined,
      publicKey: undefined,
      expiresInMinutes: undefined,
    });
    expect(result.context.verification).toEqual({ key: 'ledger-key' });
  });
});
