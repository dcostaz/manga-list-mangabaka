'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MangaBakaAPIWrapper = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-wrapper-mangabaka.cjs',
));

function createMockHttpClient() {
  const hooks = {
    getCalls: [],
    profileHandler: () => ({ status: 200, data: { ok: true } }),
  };

  const client = {
    interceptors: { response: { use() { return 0; } } },
    async get(url, config) {
      hooks.getCalls.push({ url, config });
      const result = hooks.profileHandler(url, config);
      if (result && result.throw) throw result.throw;
      return result;
    },
  };

  return { client, hooks };
}

async function createWrapper(httpClient) {
  return MangaBakaAPIWrapper.init({
    serviceSettings: {
      'api.baseUrl': 'https://api.mangabaka.org/v1',
      'api.endpoints.myProfile.template': '${baseUrl}/my/profile',
    },
    httpClient,
    context: { cache: null, utils: null },
  });
}

// ---------------------------------------------------------------------------
// Credentials — Personal Access Token (PAT) sent as x-api-key. No token
// endpoint, no refresh flow: OAuth2 client_credentials was tried first and
// confirmed live (401 "Missing required scope") to be unable to reach
// personal library data — see api-wrapper-mangabaka.cjs's own credential
// section comment for the full story.
// ---------------------------------------------------------------------------

test('credentialSchema declares a single Personal Access Token field, not client_id/client_secret', async () => {
  const wrapper = await createWrapper(createMockHttpClient().client);
  assert.deepEqual(wrapper.credentialSchema.map((f) => f.key), ['api_key']);
});

test('setCredentials/getCredentials round-trip the api_key', async () => {
  const wrapper = await createWrapper(createMockHttpClient().client);
  await wrapper.setCredentials({ api_key: 'mb-test-token' });
  assert.deepEqual(await wrapper.getCredentials(), { api_key: 'mb-test-token' });
});

test('_authHeaders throws when no credential is set, returns x-api-key otherwise', async () => {
  const wrapper = await createWrapper(createMockHttpClient().client);
  assert.throws(() => wrapper._authHeaders(), /Credentials not found/);

  await wrapper.setCredentials({ api_key: 'mb-test-token' });
  assert.deepEqual(wrapper._authHeaders(), { 'x-api-key': 'mb-test-token' });
});

test('testCredentials - calls the profile endpoint with x-api-key and returns true on success', async () => {
  const { client, hooks } = createMockHttpClient();
  const wrapper = await createWrapper(client);

  const result = await wrapper.testCredentials({ api_key: 'mb-test-token' });

  assert.equal(result, true);
  assert.equal(hooks.getCalls.length, 1);
  assert.equal(hooks.getCalls[0].url, 'https://api.mangabaka.org/v1/my/profile');
  assert.equal(hooks.getCalls[0].config.headers['x-api-key'], 'mb-test-token');
});

test('testCredentials - returns false on a 401 (invalid token), never throws', async () => {
  const { client, hooks } = createMockHttpClient();
  const unauthorized = new Error('Unauthorized');
  unauthorized.response = { status: 401 };
  hooks.profileHandler = () => ({ throw: unauthorized });
  const wrapper = await createWrapper(client);

  const result = await wrapper.testCredentials({ api_key: 'bad-token' });
  assert.equal(result, false);
});

test('testCredentials - returns false when no api_key is supplied at all', async () => {
  const wrapper = await createWrapper(createMockHttpClient().client);
  assert.equal(await wrapper.testCredentials({}), false);
  assert.equal(await wrapper.testCredentials(null), false);
});

test('refreshCredentials - throws when no current credential is supplied', async () => {
  const wrapper = await createWrapper(createMockHttpClient().client);
  await assert.rejects(() => wrapper.refreshCredentials(null), /current credential is required/);
});

test('refreshCredentials - validates the token still works and returns it unchanged', async () => {
  const { client } = createMockHttpClient();
  const wrapper = await createWrapper(client);

  const current = { api_key: 'mb-test-token' };
  const refreshed = await wrapper.refreshCredentials(current);

  assert.deepEqual(refreshed, current);
});

test('refreshCredentials - throws a clear error when the token no longer validates', async () => {
  const { client, hooks } = createMockHttpClient();
  const unauthorized = new Error('Unauthorized');
  unauthorized.response = { status: 401 };
  hooks.profileHandler = () => ({ throw: unauthorized });
  const wrapper = await createWrapper(client);

  await assert.rejects(
    () => wrapper.refreshCredentials({ api_key: 'revoked-token' }),
    /no longer valid; generate a new one/,
  );
});
