import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getPipeline } from '../../src/workflows';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

export async function runWorkflow<TInput>(name: string, defaultPayload: TInput, prompt?: () => Promise<Partial<TInput>>) {
  const pipeline = getPipeline(name);
  if (!pipeline) throw new Error(`Pipeline ${name} not found.`);
  const overrides = (await prompt?.()) ?? {};
  const payload = { ...defaultPayload, ...overrides } as TInput;
  const result = await pipeline.run(payload);
  await writeReport(name, result);
  console.log(JSON.stringify(result, null, 2));
}

async function writeReport(name: string, result: unknown) {
  const fileName = `${name.replace(/workflow\./, '')}-report.json`;
  await writeFile(path.join(projectRoot, fileName), JSON.stringify(result, null, 2));
}

export async function ask(question: string, fallback = '') {
  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer || fallback;
}
