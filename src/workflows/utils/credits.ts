import type { AgentRegistrationRequest, RegisterAgentResponse } from '@hashgraphonline/standards-sdk';
import { RegistryBrokerError } from '@hashgraphonline/standards-sdk';
import { withBroker } from '../../broker';
import { InsufficientCreditsError } from '../errors';

export type ShortfallResolution = 'retry' | 'abort' | void;

export interface CreditAwareRegistrationOptions {
  payload: AgentRegistrationRequest;
  onShortfall?: (quoteError: InsufficientCreditsError) => Promise<ShortfallResolution> | ShortfallResolution;
}

export async function runCreditAwareRegistration({ payload, onShortfall }: CreditAwareRegistrationOptions) {
  while (true) {
    try {
      const response = await withBroker((client) => client.registerAgent(payload));
      return response;
    } catch (error) {
      const converted = await translateCreditError(error, payload);
      if (converted) {
        const action = (await onShortfall?.(converted)) ?? 'abort';
        if (action === 'retry') {
          continue;
        }
        throw converted;
      }
      throw error;
    }
  }
}

async function translateCreditError(error: unknown, payload: AgentRegistrationRequest) {
  if (!(error instanceof RegistryBrokerError) || error.status !== 402) {
    return null;
  }
  const quote = await withBroker((client) => client.getRegistrationQuote(payload));
  return new InsufficientCreditsError(quote);
}

export async function waitForRegistrationCompletion(attemptId: string) {
  return withBroker((client) =>
    client.waitForRegistrationCompletion(attemptId, {
      intervalMs: 2_000,
      timeoutMs: 5 * 60_000,
    }),
  );
}

export async function retryWithFixedDelays<T>(fn: () => Promise<T>, attempts = 3, delayMs = 1_000) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
