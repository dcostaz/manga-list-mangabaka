'use strict';

const fs = require('fs').promises;

/** @typedef {import('../../../../types/mangabakatypedefs').MangaBakaServiceSettings} MangaBakaServiceSettings */
/** @typedef {import('../../../../types/mangabakatypedefs').MangaBakaSettingsDocument} MangaBakaSettingsDocument */
/** @typedef {import('../../../../types/mangabakatypedefs').MangaBakaAPISettingsConstructorParams} MangaBakaAPISettingsConstructorParams */
/** @typedef {import('../../../../types/mangabakatypedefs').MangaBakaAPISettingsInitOptions} MangaBakaAPISettingsInitOptions */

class MangaBakaAPISettings {
  /**
   * @param {MangaBakaAPISettingsConstructorParams} [params]
   */
  constructor(params = {}) {
    const settings = params && typeof params === 'object' && params.settings && typeof params.settings === 'object'
      ? params.settings
      : {};

    this.componentName = 'MangaBakaAPI';
    this._settings = settings;
    this._settingsPath = params && typeof params === 'object' && typeof params.settingsPath === 'string'
      ? params.settingsPath
      : '';
  }

  /**
   * @param {MangaBakaAPISettingsInitOptions} [options]
   * @returns {Promise<MangaBakaAPISettings>}
   */
  static async init(options = {}) {
    const settingsPath = options && typeof options === 'object' && typeof options.settingsPath === 'string'
      ? options.settingsPath
      : '';
    const defaults = options && typeof options === 'object' ? options.defaultSettings : null;

    /** @type {Record<string, unknown>} */
    let fileSettings = {};
    if (settingsPath) {
      const raw = await fs.readFile(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid MangaBaka settings payload at ${settingsPath}`);
      }

      const metadata = parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata)
        ? parsed.metadata
        : null;
      const schema = parsed.schema && typeof parsed.schema === 'object' && !Array.isArray(parsed.schema)
        ? parsed.schema
        : null;
      const settings = parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)
        ? parsed.settings
        : null;

      if (!metadata || !schema || !settings) {
        throw new Error(`Expected MangaBaka settings payload with metadata/schema/settings sections at ${settingsPath}`);
      }

      fileSettings = parsed;
    }

    const defaultSettings = defaults && typeof defaults === 'object' ? defaults : {};
    return new MangaBakaAPISettings({
      settingsPath,
      settings: {
        ...fileSettings,
        ...defaultSettings,
      },
    });
  }

  /**
   * @returns {Record<string, unknown>}
   */
  toLegacyFormat() {
    const settingsSection = this._settings
      && typeof this._settings === 'object'
      && this._settings.settings
      && typeof this._settings.settings === 'object'
      ? /** @type {Record<string, unknown>} */ (this._settings.settings)
      : this._settings;

    return { ...settingsSection };
  }
}

module.exports = MangaBakaAPISettings;
