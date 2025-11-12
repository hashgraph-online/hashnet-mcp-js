import type { Logger } from 'pino';

export interface PipelineHooks<TContext> {
  onStepStart?: (info: PipelineStepLifecycleEvent<TContext>) => void | Promise<void>;
  onStepSuccess?: (info: PipelineStepLifecycleEvent<TContext> & { output: unknown }) => void | Promise<void>;
  onStepError?: (info: PipelineStepLifecycleEvent<TContext> & { error: unknown }) => void | Promise<void>;
}

export interface PipelineStepLifecycleEvent<TContext> {
  pipeline: string;
  step: string;
  index: number;
  context: TContext;
}

export interface PipelineDefinition<TInput, TContext> {
  name: string;
  description: string;
  version?: string;
  requiredEnv?: string[];
  createContext: (input: TInput) => Promise<TContext> | TContext;
  steps: PipelineStep<TInput, TContext, unknown>[];
}

export interface PipelineStep<TInput, TContext, TResult> {
  name: string;
  description?: string;
  run: (args: PipelineStepRunArgs<TInput, TContext>) => Promise<TResult> | TResult;
  skip?: (args: PipelineStepRunArgs<TInput, TContext>) => Promise<boolean> | boolean;
  allowDuringDryRun?: boolean;
}

export interface PipelineStepRunArgs<TInput, TContext> {
  input: TInput;
  context: TContext;
  dryRun: boolean;
  logger: Logger;
}

export interface PipelineExecutionOptions<TContext> {
  dryRun?: boolean;
  hooks?: PipelineHooks<TContext>;
}

export interface PipelineStepResult<TResult> {
  name: string;
  durationMs: number;
  skipped: boolean;
  output?: TResult;
  error?: string;
}

export interface PipelineRunResult<TContext> {
  pipeline: string;
  context: TContext;
  steps: PipelineStepResult<unknown>[];
  dryRun: boolean;
}
