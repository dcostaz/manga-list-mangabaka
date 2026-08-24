#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const readline = require('node:readline/promises');

async function promptForInput(questionText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return (await rl.question(questionText)).trim();
  } finally {
    rl.close();
  }
}

async function run() {
  if (process.env.CI === 'true') {
    console.error('Interactive search integration test cannot run in CI.');
    process.exit(1);
  }

  let query = typeof process.env.MB_TEST_SEARCH_QUERY === 'string'
    ? process.env.MB_TEST_SEARCH_QUERY.trim()
    : '';

  if (!query) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const promptedQuery = await promptForInput('Search query (default: Dice): ');
      query = promptedQuery || 'Dice';
    } else {
      query = 'Dice';
    }
  }

  process.stdout.write('[search-test-runner] Launching manual search integration test...\n');
  process.stdout.write(`[search-test-runner] Query: ${query}\n`);
  process.stdout.write('[search-test-runner] No credentials needed — MangaBaka\'s search/lookup endpoints are public.\n\n');

  const child = spawn(
    process.execPath,
    ['--test', '--test-concurrency=1', 'tests/integration/runtime-wrapper-search-integration.manual.cjs'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        ENABLE_REAL_SEARCH_TEST: '1',
        MB_TEST_SEARCH_QUERY: query,
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
