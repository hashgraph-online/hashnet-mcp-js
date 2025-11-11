import { createPipeline } from './pipeline';
import type { PipelineDefinition } from './types';

const pipelines = new Map<string, ReturnType<typeof createPipeline<any, any>>>();

export function registerPipeline<TInput, TContext>(definition: PipelineDefinition<TInput, TContext>) {
  const pipeline = createPipeline(definition);
  pipelines.set(definition.name, pipeline);
  return pipeline;
}

export function getPipeline(name: string) {
  return pipelines.get(name);
}

export function listPipelines() {
  return Array.from(pipelines.values()).map((pipeline) => pipeline.definition);
}
