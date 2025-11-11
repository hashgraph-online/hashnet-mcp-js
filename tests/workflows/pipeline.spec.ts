import { describe, expect, it, vi } from 'vitest';
import { createPipeline } from '../../src/workflows/pipeline';

describe('pipeline engine', () => {
  it('runs steps sequentially and mutates context', async () => {
    const pipeline = createPipeline({
      name: 'test-pipeline',
      description: 'demo',
      createContext: async (input: { start: number }) => ({ value: input.start }),
      steps: [
        {
          name: 'increment',
          run: async ({ context }) => {
            context.value += 1;
            return context.value;
          },
        },
        {
          name: 'double',
          run: ({ context }) => {
            context.value *= 2;
            return context.value;
          },
        },
      ],
    });

    const result = await pipeline.run({ start: 1 });
    expect(result.context.value).toBe(4);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].skipped).toBe(false);
    expect(result.steps[1].output).toBe(4);
  });

  it('respects dry run mode', async () => {
    const stepFn = vi.fn();
    const pipeline = createPipeline({
      name: 'dry-run',
      description: 'dry',
      createContext: () => ({ value: 0 }),
      steps: [
        {
          name: 'run-me',
          run: stepFn,
        },
      ],
    });

    const result = await pipeline.run({}, { dryRun: true });
    expect(stepFn).not.toHaveBeenCalled();
    expect(result.steps[0].skipped).toBe(true);
    expect(result.dryRun).toBe(true);
  });

  it('calls hooks on success and error', async () => {
    const hooks = {
      onStepStart: vi.fn(),
      onStepSuccess: vi.fn(),
      onStepError: vi.fn(),
    };

    const error = new Error('boom');

    const pipeline = createPipeline({
      name: 'hooks',
      description: 'hooks',
      createContext: () => ({}),
      steps: [
        {
          name: 'success',
          run: () => 'ok',
          allowDuringDryRun: true,
        },
        {
          name: 'failure',
          run: () => {
            throw error;
          },
        },
      ],
    });

    await expect(pipeline.run({}, { hooks, dryRun: false })).rejects.toThrow('boom');
    expect(hooks.onStepStart).toHaveBeenCalledTimes(2);
    expect(hooks.onStepSuccess).toHaveBeenCalledTimes(1);
    expect(hooks.onStepError).toHaveBeenCalledTimes(1);
  });
});
