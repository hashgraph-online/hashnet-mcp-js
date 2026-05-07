import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { summarizeGuardCanaryDrift, type GuardCanaryRegistration } from '../../src/workflows/guard-canary.js';

const guardCanaryRegistrationSchema = z.object({
  profile: z
    .object({
      mcpServer: z
        .object({
          capabilities: z.array(z.string()).optional(),
          connectionInfo: z
            .object({
              url: z.string().optional(),
            })
            .optional(),
          tools: z
            .array(
              z.object({
                name: z.string().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'guard-canary',
);

const readFixture = async (fileName: string): Promise<GuardCanaryRegistration> =>
  guardCanaryRegistrationSchema.parse(
    JSON.parse(await readFile(path.join(fixtureDir, fileName), 'utf8')),
  );

describe('guard canary manifest drift', () => {
  it('keeps the safe baseline in the safe state', async () => {
    const baseline = await readFixture('safe-baseline.json');
    const summary = summarizeGuardCanaryDrift(baseline, baseline);
    expect(summary).toEqual({
      baselineDomain: 'hashnet.example.com',
      candidateDomain: 'hashnet.example.com',
      domainChanged: false,
      addedCapabilities: [],
      removedCapabilities: [],
      addedTools: [],
      removedTools: [],
      risk: 'safe',
    });
  });

  it('flags capability and tool expansion for review', async () => {
    const baseline = await readFixture('safe-baseline.json');
    const changedCapability = await readFixture('changed-capability.json');
    const summary = summarizeGuardCanaryDrift(baseline, changedCapability);
    expect(summary.risk).toBe('review');
    expect(summary.domainChanged).toBe(false);
    expect(summary.addedCapabilities).toEqual(['shared-policy']);
    expect(summary.addedTools).toEqual(['hol.updateAgent']);
  });

  it('flags domain drift for review even when capabilities stay stable', async () => {
    const baseline = await readFixture('safe-baseline.json');
    const changedDomain = await readFixture('changed-domain.json');
    const summary = summarizeGuardCanaryDrift(baseline, changedDomain);
    expect(summary.risk).toBe('review');
    expect(summary.domainChanged).toBe(true);
    expect(summary.baselineDomain).toBe('hashnet.example.com');
    expect(summary.candidateDomain).toBe('unexpected.example.net');
    expect(summary.addedCapabilities).toEqual([]);
    expect(summary.addedTools).toEqual([]);
  });
});
