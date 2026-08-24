#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { Writable } = require('node:stream');
const readline = require('node:readline/promises');

function createMaskedOutputStream() {
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!output.muted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    },
  });

  output.muted = false;
  return output;
}

async function promptForApiKey() {
  const output = createMaskedOutputStream();
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });

  try {
    process.stdout.write('MangaBaka Personal Access Token: ');
    output.muted = true;
    const apiKey = (await rl.question('')).trim();
    output.muted = false;
    process.stdout.write('\n');

    return apiKey;
  } finally {
    rl.close();
  }
}

async function run() {
  if (process.env.CI === 'true') {
    console.error('Interactive library integration test cannot run in CI.');
    process.exit(1);
  }

  let apiKey = typeof process.env.MB_TEST_API_KEY === 'string' ? process.env.MB_TEST_API_KEY.trim() : '';

  if (!apiKey) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error('No interactive terminal detected. Set MB_TEST_API_KEY and retry.');
      process.exit(1);
    }

    apiKey = await promptForApiKey();
  }

  if (!apiKey) {
    console.error('A Personal Access Token is required.');
    process.exit(1);
  }

  process.stdout.write('[library-test-runner] Launching manual library integration test...\n');
  process.stdout.write('[library-test-runner] This test EXISTS TO VERIFY the /v1/my/library shape assumptions\n');
  process.stdout.write('[library-test-runner] documented in docs/plugins/mangabaka/architecture.md — expect it to\n');
  process.stdout.write('[library-test-runner] surface a mismatch on first real run; that is the point.\n\n');

  const child = spawn(
    process.execPath,
    ['--test', '--test-concurrency=1', 'tests/integration/runtime-wrapper-library-integration.manual.cjs'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        ENABLE_REAL_LIBRARY_TEST: '1',
        MB_TEST_API_KEY: apiKey,
      },
    },
  );

  child.on('exit', (code) => {
    process.exit(typeof code === 'number' ? code : 1);
  });

  child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
