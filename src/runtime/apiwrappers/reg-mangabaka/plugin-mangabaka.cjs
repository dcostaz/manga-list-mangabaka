'use strict';

/**
 * L3a — the definition: DECLARE and bind (Plan-2026Q4-tracker-plugin-standardization §1.2–§1.3).
 *
 * The SDK builds the descriptor the host loads ({ pluginName, displayName, WrapperClass, SettingsClass }) from
 * the manifest, the client's auth strategy and factory, and the mapping. Every method the declared offers need is
 * bound by convention — `mapping.<method>(await client.<method>(...))` — so this file is the same for every
 * tracker built from the template: it names its siblings from the manifest's pluginName. Add explicit `methods`
 * here only where a source cannot follow the convention.
 */

const { defineTrackerPlugin } = require('@manga-list/plugin-sdk');
const manifest = require('./plugin-package.json');
const { createClient, auth } = require(`./client-${manifest.pluginName}.cjs`);
const mapping = require(`./mapping-${manifest.pluginName}.cjs`);

module.exports = defineTrackerPlugin({ manifest, auth, createClient, mapping });
