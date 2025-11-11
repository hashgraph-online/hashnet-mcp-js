import { config } from '../config';
import { logger as baseLogger } from '../logger';
import type {
  PipelineDefinition,
  PipelineExecutionOptions,
  PipelineRunResult,
  PipelineStep,
  PipelineStepResult,
  PipelineStepRunArgs,
} from './types';

export function createPipeline<TInput, TContext>(definition: PipelineDefinition<TInput, TContext>) {
  async function run(input: TInput, options?: PipelineExecutionOptions<TContext>): Promise<PipelineRunResult<TContext>> {
    const pipelineLogger = baseLogger.child({ pipeline: definition.name });
    const dryRun = options?.dryRun ?? config.workflowDryRun;
    const context = await definition.createContext(input);
    const stepsResults: PipelineStepResult<unknown>[] = [];

    for (let index = 0; index < definition.steps.length; index += 1) {
      const step = definition.steps[index] as PipelineStep<TInput, TContext, unknown>;
      const stepLogger = pipelineLogger.child({ step: step.name, index });
      const stepArgs: PipelineStepRunArgs<TInput, TContext> = {
        input,
        context,
        dryRun,
        logger: stepLogger,
      };

      const shouldSkip = await shouldSkipStep(step, stepArgs, dryRun);
      const startedAt = Date.now();

      if (shouldSkip) {
        stepLogger.info({ dryRun }, 'pipeline.step.skipped');
        stepsResults.push({ name: step.name, durationMs: 0, skipped: true });
        // eslint-disable-next-line no-await-in-loop
        await options?.hooks?.onStepStart?.({ pipeline: definition.name, step: step.name, index, context });
        // eslint-disable-next-line no-await-in-loop
        await options?.hooks?.onStepSuccess?.({ pipeline: definition.name, step: step.name, index, context, output: undefined });
        continue;
      }

      pipelineLogger.info({ step: step.name }, 'pipeline.step.start');
      // eslint-disable-next-line no-await-in-loop
      await options?.hooks?.onStepStart?.({ pipeline: definition.name, step: step.name, index, context });

      try {
        // eslint-disable-next-line no-await-in-loop
        const output = await step.run(stepArgs);
        const durationMs = Date.now() - startedAt;
        stepLogger.info({ durationMs }, 'pipeline.step.success');
        stepsResults.push({ name: step.name, durationMs, skipped: false, output });
        // eslint-disable-next-line no-await-in-loop
        await options?.hooks?.onStepSuccess?.({ pipeline: definition.name, step: step.name, index, context, output });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        stepLogger.error({ durationMs, error: message }, 'pipeline.step.error');
        stepsResults.push({ name: step.name, durationMs, skipped: false, error: message });
        // eslint-disable-next-line no-await-in-loop
        await options?.hooks?.onStepError?.({ pipeline: definition.name, step: step.name, index, context, error });
        throw error;
      }
    }

    return {
      pipeline: definition.name,
      context,
      steps: stepsResults,
      dryRun,
    };
  }

  return { definition, run };
}

async function shouldSkipStep<TInput, TContext>(
  step: PipelineStep<TInput, TContext, unknown>,
  args: PipelineStepRunArgs<TInput, TContext>,
  dryRun: boolean,
): Promise<boolean> {
  if (dryRun && step.allowDuringDryRun !== true) {
    return true;
  }
  if (step.skip) {
    return Boolean(await step.skip(args));
  }
  return false;
}
