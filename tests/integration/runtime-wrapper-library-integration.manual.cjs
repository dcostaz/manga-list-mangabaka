'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MangaBakaAPIWrapper = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-wrapper-mangabaka.cjs',
));
const { buildEffectiveSettingsDocument } = require(path.join(__dirname, '..', '..', 'scripts', 'build-runtime-plugin-package.cjs'));

const shouldSkip = process.env.ENABLE_REAL_LIBRARY_TEST !== '1' || process.env.CI === 'true';

function createFetchHttpClient() {
  async function send(method, url, dataOrConfig, maybeConfig) {
    const hasBody = method === 'post' || method === 'patch';
    const data = hasBody ? dataOrConfig : undefined;
    const config = hasBody ? (maybeConfig || {}) : (dataOrConfig || {});
    const params = config.params ? new URLSearchParams(config.params).toString() : '';
    const fullUrl = params ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url;

    const response = await fetch(fullUrl, {
      method: method.toUpperCase(),
      headers: config.headers || {},
      body: hasBody ? (typeof data === 'string' ? data : JSON.stringify(data || {})) : undefined,
    });
    const rawText = await response.text();
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch (_error) { parsed = rawText; }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} for ${method.toUpperCase()} ${url}`);
      error.response = { status: response.status, data: parsed };
      throw error;
    }
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), data: parsed };
  }

  return {
    interceptors: { response: { use() { return 0; } } },
    get: (url, config) => send('get', url, config),
    post: (url, data, config) => send('post', url, data, config),
    patch: (url, data, config) => send('patch', url, data, config),
    delete: (url, config) => send('delete', url, config),
  };
}

test(
  'interactive library integration - authenticates via Personal Access Token and reads the real /v1/my/library shape',
  {
    skip: shouldSkip && 'Set ENABLE_REAL_LIBRARY_TEST=1 and run locally (not CI).',
    timeout: 60000,
  },
  async () => {
    const apiKey = typeof process.env.MB_TEST_API_KEY === 'string' ? process.env.MB_TEST_API_KEY.trim() : '';
    assert.ok(apiKey, 'MB_TEST_API_KEY is required.');

    const effectiveSettings = buildEffectiveSettingsDocument();
    const wrapper = await MangaBakaAPIWrapper.init({
      serviceSettings: effectiveSettings.settings,
      httpClient: createFetchHttpClient(),
    });

    await wrapper.setCredentials({ api_key: apiKey });

    process.stdout.write('[library-test] Validating Personal Access Token via testCredentials()...\n');
    const valid = await wrapper.testCredentials({ api_key: apiKey });
    assert.equal(valid, true, 'testCredentials() should succeed with a real Personal Access Token');
    process.stdout.write('[library-test] Token validated against GET /v1/my/profile.\n');

    process.stdout.write('[library-test] Fetching the RAW GET /v1/my/library response (bypassing getReadingList()\'s\n');
    process.stdout.write('[library-test] field mapping entirely) to see MangaBaka\'s actual field names...\n');
    const rawEndpoint = wrapper._resolveEndpoint('api.endpoints.myLibrary.template');
    const rawResponse = await wrapper.httpClient.get(rawEndpoint, { headers: wrapper._authHeaders() });
    process.stdout.write(`[library-test] RAW /v1/my/library response: ${JSON.stringify(rawResponse.data, null, 2)}\n\n`);

    process.stdout.write('[library-test] Fetching GET /v1/my/library via getReadingList()...\n');
    process.stdout.write('[library-test] NOTE: getReadingList()/pullProgress() encode ASSUMPTIONS about the\n');
    process.stdout.write('[library-test] response shape (see docs/plugins/mangabaka/architecture.md) — a\n');
    process.stdout.write('[library-test] thrown error or an empty/malformed result here is expected on\n');
    process.stdout.write('[library-test] the first real run and should drive a wrapper fix, not be treated\n');
    process.stdout.write('[library-test] as this test being broken.\n\n');

    const list = await wrapper.getReadingList();
    process.stdout.write(`[library-test] getReadingList() returned ${JSON.stringify(list, null, 2)}\n`);
    assert.ok(Array.isArray(list), 'getReadingList() must return an array even if empty');

    if (list.length > 0) {
      const [firstEntry] = list;
      process.stdout.write(`[library-test] Verifying pullProgress(${firstEntry.pluginEntryId})...\n`);
      const progress = await wrapper.pullProgress(firstEntry.pluginEntryId);
      process.stdout.write(`[library-test] pullProgress() returned ${JSON.stringify(progress, null, 2)}\n`);
    } else {
      process.stdout.write('[library-test] Library is empty — add one series to your MangaBaka library and re-run to verify pullProgress().\n');
    }

    process.stdout.write('[library-test] Library integration test completed — review the shapes above against api-wrapper-mangabaka.cjs and correct any ASSUMPTION-marked code.\n');
  },
);
