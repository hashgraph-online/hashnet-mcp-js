#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPipelines } from '../src/workflows';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const pipelines = listPipelines();

for (const pipeline of pipelines) {
  const filename = `${pipeline.name}.json`;
  const absSample = path.join(projectRoot, 'examples', 'workflows', filename);
  const hasSample = fs.existsSync(absSample);
  const relSample = hasSample ? path.relative(process.cwd(), absSample) : null;
  const payloadHint = relSample ? ` [payload: ${relSample}]` : '';
  console.log(`- ${pipeline.name} (${pipeline.version ?? '1.0.0'}) – ${pipeline.description}${payloadHint}`);
}
