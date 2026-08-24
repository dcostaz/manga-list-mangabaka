'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const JSZip = require('jszip');
const {
  PLUGIN_CONTRACT_VERSION,
} = require('../../src/runtime/apiwrappers/plugindtocontract.cjs');

const {
  buildMangabakaPackage,
  buildEffectiveSettingsDocument,
  buildManifest,
} = require('../../scripts/build-runtime-plugin-package.cjs');

/**
 * @returns {Promise<string>}
 */
async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'manga-list-mangabaka-build-test-'));
}

test('buildManifest returns plugin loader compatible metadata', () => {
  const manifest = buildManifest('1.0.0');

  assert.equal(manifest.pluginName, 'mangabaka');
  assert.equal(manifest.pluginType, 'tracker');
  assert.equal(manifest.hostApiVersion, '1.0.0');
  assert.equal(typeof manifest.pluginContractVersion, 'string');
  assert.equal(manifest.entrypoints.pluginModule, 'apiwrappers/reg-mangabaka/plugin-module.cjs');
  // settingsFile points to the build-generated effective payload, not a source-controlled file.
  assert.equal(manifest.entrypoints.settingsFile, 'apiwrappers/reg-mangabaka/mangabaka-api-settings.json');
});

test('exports centralized plugin contract version', () => {
  assert.equal(typeof PLUGIN_CONTRACT_VERSION, 'string');
  assert.equal(PLUGIN_CONTRACT_VERSION, '2.0.0');
});

test('buildEffectiveSettingsDocument merges definition and values into runtime payload', () => {
  const effective = buildEffectiveSettingsDocument();

  assert.equal(effective.metadata.componentName, 'MangaBakaAPI');
  assert.equal(typeof effective.schema['api.baseUrl'], 'object');
  assert.equal(typeof effective.schema['api.endpoints.seriesDetail.template'], 'object');
  assert.equal(effective.settings['api.baseUrl'], 'https://api.mangabaka.org/v1');
  assert.equal(effective.settings['api.authBaseUrl'], 'https://mangabaka.org/auth');
  assert.equal(effective.settings['api.endpoints.token.template'], '${authBaseUrl}/oauth2/token');
  assert.equal(effective.settings['api.endpoints.seriesSearch.template'], '${baseUrl}/series/search');
  assert.equal(effective.settings['oauth.scope'], 'library.read library.write');
});

test('buildMangabakaPackage creates zip with plugin-package.json and runtime files', async () => {
  const tempDir = await createTempDir();
  const outputPath = path.join(tempDir, 'mangabaka-runtime.zip');

  try {
    const result = await buildMangabakaPackage({ outputPath, hostApiVersion: '1.2.3' });
    assert.equal(result.outputPath, outputPath);

    const zipBuffer = await fs.readFile(outputPath);
    const zip = await JSZip.loadAsync(zipBuffer);
    const entries = Object.keys(zip.files)
      .filter((entry) => !entry.endsWith('/'))
      .sort((a, b) => a.localeCompare(b));

    assert.deepEqual(entries, [
      'apiwrappers/plugindtocontract.cjs',
      'apiwrappers/reg-mangabaka/api-settings-mangabaka.cjs',
      'apiwrappers/reg-mangabaka/api-wrapper-mangabaka.cjs',
      'apiwrappers/reg-mangabaka/mangabaka-api-settings.json',
      'apiwrappers/reg-mangabaka/plugin-module.cjs',
      'images/mangabaka-icon.svg',
      'plugin-package.json',
    ]);

    const manifestFile = zip.file('plugin-package.json');
    assert.ok(manifestFile);
    const manifest = JSON.parse(await manifestFile.async('string'));

    assert.equal(manifest.pluginName, 'mangabaka');
    assert.equal(manifest.hostApiVersion, '1.2.3');
    assert.equal(manifest.entrypoints.pluginModule, 'apiwrappers/reg-mangabaka/plugin-module.cjs');
    assert.equal(manifest.entrypoints.settingsFile, 'apiwrappers/reg-mangabaka/mangabaka-api-settings.json');

    const settingsFile = zip.file('apiwrappers/reg-mangabaka/mangabaka-api-settings.json');
    assert.ok(settingsFile);
    assert.equal(zip.file('apiwrappers/reg-mangabaka/mangabaka-api-settings.definition.json'), null);
    assert.equal(zip.file('apiwrappers/reg-mangabaka/mangabaka-api-settings.values.json'), null);
    const effectiveSettings = JSON.parse(await settingsFile.async('string'));
    assert.equal(effectiveSettings.metadata.componentName, 'MangaBakaAPI');
    assert.equal(effectiveSettings.settings['api.endpoints.myLibrary.template'], '${baseUrl}/my/library');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
