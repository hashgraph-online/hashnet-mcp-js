import type { RegisterAgentQuoteResponse } from '@hashgraphonline/standards-sdk';

export interface CreditShortfallSummary {
  requiredCredits: number;
  availableCredits: number;
  shortfallCredits: number;
  estimatedHbar?: number | null;
  creditsPerHbar?: number | null;
  registry?: string;
  protocol?: string;
  accountId?: string | null;
}

export class InsufficientCreditsError extends Error {
  readonly code = 'INSUFFICIENT_CREDITS';
  readonly summary: CreditShortfallSummary;

  constructor(quote: RegisterAgentQuoteResponse, hint?: string) {
    const shortfall = Math.max(0, quote.shortfallCredits ?? 0);
    const message = hint ?? `Insufficient registry credits (shortfall: ${shortfall})`;
    super(message);
    this.name = 'InsufficientCreditsError';
    this.summary = {
      requiredCredits: quote.requiredCredits ?? 0,
      availableCredits: quote.availableCredits ?? 0,
      shortfallCredits: shortfall,
      estimatedHbar: quote.estimatedHbar,
      creditsPerHbar: quote.creditsPerHbar,
      registry: quote.registry,
      protocol: quote.protocol,
      accountId: quote.accountId,
    };
  }
}

export function isInsufficientCreditsError(error: unknown): error is InsufficientCreditsError {
  return error instanceof InsufficientCreditsError || Boolean(error && (error as { code?: string }).code === 'INSUFFICIENT_CREDITS');
}
