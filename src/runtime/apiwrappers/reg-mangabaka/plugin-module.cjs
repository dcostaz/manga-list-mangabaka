'use strict';

const path = require('path');
const WrapperClass = require(path.join(__dirname, 'api-wrapper-mangabaka.cjs'));
const SettingsClass = require(path.join(__dirname, 'api-settings-mangabaka.cjs'));

/** @typedef {import('../../../../types/plugintypedefs').PluginModuleDescriptor} PluginModuleDescriptor */

/** @type {PluginModuleDescriptor} */
const pluginModule = {
  WrapperClass,
  SettingsClass,
};

module.exports = pluginModule;
