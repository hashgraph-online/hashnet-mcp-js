export * from './pipeline';
export * from './registry';
export * from './types';
export * from './errors';
export * from './utils/credits';
export * from './scaffold';

// Register built-in workflows by importing their definitions.
import './discovery';
import './registration';
import './register-advanced';
import './register-erc8004';
import './openrouter-chat';
import './registry-showcase';
import './ledger-auth';
import './x402-topup';
import './history-topup';
import './agentverse-bridge';
import './erc8004-discovery';
import './erc8004-x402';
import './x402-registration';
import './chat';
import './ops';
import './combined';
