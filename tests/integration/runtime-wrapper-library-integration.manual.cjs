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
  'interactive library integration - authenticates via client_credentials and reads the real /v1/my/library shape',
  {
    skip: shouldSkip && 'Set ENABLE_REAL_LIBRARY_TEST=1 and run locally (not CI).',
    timeout: 60000,
  },
  async () => {
    const clientId = typeof process.env.MB_TEST_CLIENT_ID === 'string' ? process.env.MB_TEST_CLIENT_ID.trim() : '';
    const clientSecret = typeof process.env.MB_TEST_CLIENT_SECRET === 'string' ? process.env.MB_TEST_CLIENT_SECRET.trim() : '';
    assert.ok(clientId, 'MB_TEST_CLIENT_ID is required.');
    assert.ok(clientSecret, 'MB_TEST_CLIENT_SECRET is required.');

    const effectiveSettings = buildEffectiveSettingsDocument();
    const wrapper = await MangaBakaAPIWrapper.init({
      serviceSettings: effectiveSettings.settings,
      httpClient: createFetchHttpClient(),
    });

    await wrapper.setCredentials({ client_id: clientId, client_secret: clientSecret });

    process.stdout.write('[library-test] Requesting client_credentials token...\n');
    const token = await wrapper.getToken(true);
    assert.equal(typeof token, 'string');
    assert.ok(token.length > 0, 'Expected a non-empty access token');
    process.stdout.write('[library-test] Token acquired.\n');

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
