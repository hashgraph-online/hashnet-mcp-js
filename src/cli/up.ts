#!/usr/bin/env node

import { parseCliArgs } from "./args.js";

async function main(): Promise<void> {
  try {
    const parsed = parseCliArgs(process.argv.slice(2));

    if (parsed.helpText) {
      process.stdout.write(`${parsed.helpText}\n`);
      return;
    }

    Object.assign(process.env, parsed.env);
    await import("../index.js");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

void main();
