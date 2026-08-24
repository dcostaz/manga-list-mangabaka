'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MangaBakaAPIWrapper = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-wrapper-mangabaka.cjs',
));

function createMockCacheAdapter() {
  const hooks = { data: new Map(), reads: [], writes: [] };
  return {
    cacheAdapter: {
      async getValue(key, options) {
        hooks.reads.push({ key, options });
        return hooks.data.has(key) ? hooks.data.get(key) || null : null;
      },
      async setValue(key, value, ttlSeconds, options) {
        hooks.data.set(key, value);
        hooks.writes.push({ key, value, ttlSeconds, options });
      },
    },
    hooks,
  };
}

function createMockHttpClient() {
  const hooks = {
    postCalls: [],
    tokenResponse: { access_token: 'fresh-token', token_type: 'Bearer', expires_in: 3600 },
  };

  const client = {
    interceptors: { response: { use() { return 0; } } },
    async post(url, body, config) {
      hooks.postCalls.push({ url, body, config });
      return { data: hooks.tokenResponse };
    },
  };

  return { client, hooks };
}

async function createWrapper(httpClient, cacheAdapter) {
  const wrapper = await MangaBakaAPIWrapper.init({
    serviceSettings: {
      'api.baseUrl': 'https://api.mangabaka.org/v1',
      'api.authBaseUrl': 'https://mangabaka.org/auth',
      'api.endpoints.token.template': '${authBaseUrl}/oauth2/token',
      'oauth.scope': 'library.read library.write',
    },
    httpClient,
    context: { cache: cacheAdapter, utils: null },
  });
  await wrapper.setCredentials({ client_id: 'demo-client', client_secret: 'demo-secret' });
  return wrapper;
}

test('token cache key follows mangabaka convention', async () => {
  const { cacheAdapter } = createMockCacheAdapter();
  const { client } = createMockHttpClient();
  const wrapper = await createWrapper(client, cacheAdapter);

  assert.equal(wrapper._getTokenCacheKey(), 'mangabaka_access_token');
});

test('getToken - requests client_credentials grant with the correct form body', async () => {
  const { cacheAdapter } = createMockCacheAdapter();
  const { client, hooks } = createMockHttpClient();
  const wrapper = await createWrapper(client, cacheAdapter);

  const token = await wrapper.getToken();

  assert.equal(token, 'fresh-token');
  assert.equal(hooks.postCalls.length, 1);
  assert.equal(hooks.postCalls[0].url, 'https://mangabaka.org/auth/oauth2/token');
  const body = new URLSearchParams(hooks.postCalls[0].body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), 'demo-client');
  assert.equal(body.get('client_secret'), 'demo-secret');
  assert.equal(body.get('scope'), 'library.read library.write');
  assert.equal(hooks.postCalls[0].config.headers['Content-Type'], 'application/x-www-form-urlencoded');
});

test('getToken - caches the token with userScoped: true and TTL under the real expiry', async () => {
  const { cacheAdapter, hooks: cacheHooks } = createMockCacheAdapter();
  const { client } = createMockHttpClient();
  const wrapper = await createWrapper(client, cacheAdapter);

  await wrapper.getToken();

  assert.equal(cacheHooks.writes.length, 1);
  assert.equal(cacheHooks.writes[0].key, 'mangabaka_access_token');
  assert.equal(cacheHooks.writes[0].value, 'fresh-token');
  assert.equal(cacheHooks.writes[0].ttlSeconds, 3600 - 30);
  assert.deepEqual(cacheHooks.writes[0].options, { userScoped: true });
});

test('getToken - returns cache hit without a new HTTP call unless forceRefresh is set', async () => {
  const { cacheAdapter, hooks: cacheHooks } = createMockCacheAdapter();
  const { client, hooks: httpHooks } = createMockHttpClient();
  cacheHooks.data.set('mangabaka_access_token', 'from-cache');

  const wrapper = await createWrapper(client, cacheAdapter);

  const cached = await wrapper.getToken();
  assert.equal(cached, 'from-cache');
  assert.equal(httpHooks.postCalls.length, 0);

  const refreshed = await wrapper.getToken(true);
  assert.equal(refreshed, 'fresh-token');
  assert.equal(httpHooks.postCalls.length, 1);
});

test('testCredentials - returns true on a valid token response, false on failure', async () => {
  const { cacheAdapter } = createMockCacheAdapter();
  const { client, hooks } = createMockHttpClient();
  const wrapper = await createWrapper(client, cacheAdapter);

  assert.equal(await wrapper.testCredentials({ client_id: 'x', client_secret: 'y' }), true);

  client.post = async () => { throw new Error('invalid_client'); };
  assert.equal(await wrapper.testCredentials({ client_id: 'x', client_secret: 'bad' }), false);
});

test('refreshCredentials - throws when no current credential is supplied', async () => {
  const { cacheAdapter } = createMockCacheAdapter();
  const { client } = createMockHttpClient();
  const wrapper = await createWrapper(client, cacheAdapter);

  await assert.rejects(() => wrapper.refreshCredentials(null), /current credential is required/);
});

test('refreshCredentials - validates the credential still works and returns it unchanged', async () => {
  const { cacheAdapter } = createMockCacheAdapter();
  const { client } = createMockHttpClient();
  const wrapper = await createWrapper(client, cacheAdapter);

  const current = { client_id: 'demo-client', client_secret: 'demo-secret' };
  const refreshed = await wrapper.refreshCredentials(current);

  assert.deepEqual(refreshed, current);
});
