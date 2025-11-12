export * from './pipeline';
export * from './registry';
export * from './types';

// Register built-in workflows by importing their definitions.
import './discovery';
import './registration';
import './chat';
import './ops';
import './combined';
