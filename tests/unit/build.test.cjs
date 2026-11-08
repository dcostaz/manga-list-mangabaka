'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { buildRuntimePluginPackage, locateTracker } = require('../../scripts/build-runtime-plugin-package.cjs');

test('the package holds the three layers, the manifest twice, the merged settings, and no SDK', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-build-'));
    try {
        const { id } = locateTracker();
        const { outputPath } = await buildRuntimePluginPackage({ outputPath: path.join(dir, 'out.zip') });
        const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
        const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
        const reg = `apiwrappers/reg-${id}`;
        assert.deepEqual(names, [
            'images/mangabaka-icon.svg',
            `${reg}/client-${id}.cjs`,
            `${reg}/${id}-api-settings.json`,
            `${reg}/mapping-${id}.cjs`,
            `${reg}/plugin-${id}.cjs`,
            `${reg}/plugin-package.json`,
            'plugin-package.json',
        ].sort());
        const root = JSON.parse(await zip.file('plugin-package.json').async('string'));
        const beside = JSON.parse(await zip.file(`${reg}/plugin-package.json`).async('string'));
        assert.deepEqual(root, beside);
        assert.equal(root.entrypoints.pluginModule, `${reg}/plugin-${id}.cjs`);
        const settings = JSON.parse(await zip.file(`${reg}/${id}-api-settings.json`).async('string'));
        assert.deepEqual(Object.keys(settings).sort(), ['metadata', 'schema', 'settings']);
        assert.equal(settings.settings['cache.provider'], undefined, 'a deleted key (Decision 5) does not ship');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
