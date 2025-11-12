#!/usr/bin/env tsx
import { listPipelines } from '../src/workflows';

const pipelines = listPipelines();
for (const pipeline of pipelines) {
  console.log(`- ${pipeline.name} (${pipeline.version ?? '1.0.0'}) – ${pipeline.description}`);
}
