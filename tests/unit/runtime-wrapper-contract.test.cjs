'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MangaBakaAPIWrapper = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-wrapper-mangabaka.cjs',
));
const MangaBakaAPISettings = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-settings-mangabaka.cjs',
));

test('wrapper contract - init preserves instance and settings payload', async () => {
  const apiSettings = await MangaBakaAPISettings.init({
    defaultSettings: { 'api.baseUrl': 'https://api.mangabaka.org/v1' },
  });

  const wrapper = await MangaBakaAPIWrapper.init({
    apiSettings,
    serviceSettings: { featureFlags: { search: true } },
  });

  assert.ok(wrapper instanceof MangaBakaAPIWrapper);
  assert.equal(wrapper.apiSettings, apiSettings);
  assert.deepEqual(wrapper.settings, { featureFlags: { search: true } });
});

test('wrapper contract - init normalizes invalid option shapes', async () => {
  const wrapper = await MangaBakaAPIWrapper.init({
    apiSettings: { not: 'an-instance' },
    serviceSettings: 'invalid-shape',
  });

  assert.equal(wrapper.apiSettings, null);
  assert.deepEqual(wrapper.settings, {});
});

test('wrapper contract - serviceName remains runtime module stable', () => {
  assert.equal(MangaBakaAPIWrapper.serviceName, 'mangabaka');
});

test('wrapper contract - pluginType is tracker (personal client_credentials grant scopes to this user)', async () => {
  const wrapper = await MangaBakaAPIWrapper.init();
  assert.deepEqual(wrapper.pluginType, ['tracker']);
});

test('wrapper contract - credentialSchema declares a single Personal Access Token field', async () => {
  const wrapper = await MangaBakaAPIWrapper.init();
  const keys = wrapper.credentialSchema.map((field) => field.key).sort();
  assert.deepEqual(keys, ['api_key']);
});

// ---------------------------------------------------------------------------
// get capabilities() — must match plugin-package.json exactly (the drift guard
// established during the MangaDex/MangaUpdates capability-vocabulary migration)
// ---------------------------------------------------------------------------

test('capabilities getter matches plugin-package.json exactly', () => {
  const manifest = require(path.join(
    __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'plugin-package.json',
  ));
  const wrapperCapabilities = Object.getOwnPropertyDescriptor(MangaBakaAPIWrapper.prototype, 'capabilities').get.call({});

  assert.ok(Array.isArray(wrapperCapabilities));
  assert.deepEqual([...wrapperCapabilities].sort(), [...manifest.capabilities].sort());
});

test('initialize/getStatus - lifecycle stub matches PluginAPILike contract', async () => {
  const wrapper = await MangaBakaAPIWrapper.init();
  assert.deepEqual(wrapper.getStatus(), { status: 'initializing' });
  const result = await wrapper.initialize();
  assert.deepEqual(result, { status: 'ok' });
  assert.deepEqual(wrapper.getStatus(), { status: 'ok' });
});
