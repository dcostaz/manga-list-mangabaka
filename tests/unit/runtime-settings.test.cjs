'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fsPromises = require('fs').promises;
const os = require('os');

const MangaBakaAPISettings = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-settings-mangabaka.cjs',
));
const { buildEffectiveSettingsDocument } = require(path.join(__dirname, '..', '..', 'scripts', 'build-runtime-plugin-package.cjs'));

/**
 * @returns {Promise<string>}
 */
async function createTempDir() {
  return await fsPromises.mkdtemp(path.join(os.tmpdir(), 'manga-list-mangabaka-settings-test-'));
}

test('settings contract - init loads merged settings payload and legacy view', async () => {
  const tempDir = await createTempDir();
  const settingsPath = path.join(tempDir, 'effective-settings.json');

  try {
    const effective = buildEffectiveSettingsDocument();
    await fsPromises.writeFile(settingsPath, JSON.stringify(effective, null, 2), 'utf8');

    const settings = await MangaBakaAPISettings.init({ settingsPath });
    const legacy = settings.toLegacyFormat();

    assert.equal(settings.componentName, 'MangaBakaAPI');
    assert.equal(legacy['api.baseUrl'], 'https://api.mangabaka.org/v1');
    assert.equal(legacy['retry.enabled'], true);
    assert.equal(typeof legacy['cache.ttl.default'], 'number');
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
});

test('settings contract - init rejects invalid payload shape', async () => {
  const tempDir = await createTempDir();
  const invalidPath = path.join(tempDir, 'invalid-settings.json');

  try {
    await fsPromises.writeFile(invalidPath, JSON.stringify({ settings: {} }, null, 2), 'utf8');

    await assert.rejects(
      async () => MangaBakaAPISettings.init({ settingsPath: invalidPath }),
      /metadata\/schema\/settings/,
    );
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
});

test('settings contract - merged payload includes required communication, caching, and resilience fields', () => {
  const effective = buildEffectiveSettingsDocument();

  assert.equal(effective.metadata.componentName, 'MangaBakaAPI');
  assert.equal(typeof effective.schema['api.baseUrl'], 'object');
  assert.equal(typeof effective.schema['cache.ttl.default'], 'object');
  assert.equal(typeof effective.schema['retry.maxAttempts'], 'object');

  assert.equal(typeof effective.settings['api.baseUrl'], 'string');
  assert.equal(typeof effective.settings['api.authBaseUrl'], 'string');
  assert.equal(typeof effective.settings['connection.timeout.request'], 'number');
  assert.equal(typeof effective.settings['cache.enabled'], 'boolean');
  assert.equal(typeof effective.settings['cache.ttl.default'], 'number');
  assert.equal(typeof effective.settings['retry.enabled'], 'boolean');
  assert.equal(typeof effective.settings['rateLimit.global.enabled'], 'boolean');
  assert.equal(typeof effective.settings['resilience.circuitBreaker.enabled'], 'boolean');
});

test('settings contract - credential template declares client_id/client_secret, not username/password', () => {
  const effective = buildEffectiveSettingsDocument();
  const template = effective.settings['ui.credentialsTemplate'];

  assert.ok(Array.isArray(template));
  const keys = template.map((field) => field.key).sort();
  assert.deepEqual(keys, ['client_id', 'client_secret']);
});
