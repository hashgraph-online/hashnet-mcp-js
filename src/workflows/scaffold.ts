import type { PipelineDefinition } from './types';
import { registerPipeline } from './registry';

interface WorkflowMetadata {
  name: string;
  description: string;
  version?: string;
  requiredEnv?: string[];
}

export function scaffoldWorkflow<TInput, TContext>(definition: PipelineDefinition<TInput, TContext>) {
  if (!definition.version) {
    definition.version = '1.0.0';
  }
  if (!definition.requiredEnv) {
    definition.requiredEnv = ['REGISTRY_BROKER_API_KEY'];
  }
  return registerPipeline(definition);
}

export function defineWorkflow<TInput, TContext>(metadata: WorkflowMetadata, steps: PipelineDefinition<TInput, TContext>['steps'], createContext: PipelineDefinition<TInput, TContext>['createContext']) {
  return scaffoldWorkflow({ ...metadata, steps, createContext });
}
