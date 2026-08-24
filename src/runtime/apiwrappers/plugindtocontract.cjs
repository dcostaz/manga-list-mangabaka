'use strict';

/**
 * Plugin contract version and capability constants.
 *
 * PLUGIN_CONTRACT_VERSION: increment major on any breaking PluginAPILike change.
 * This plugin declares only the new host-capability-contract.md vocabulary
 * (credential, search.query, search.lookup, enrich, enrich.cover, sync.*,
 * subscribe.*) — the old flat-tag constants below are kept only for parity
 * with the shared plugindtocontract.cjs shape other plugin repos use, and for
 * FilterNotApplicableError, which this plugin does not currently throw
 * (no `filterable` capability declared).
 */

const PLUGIN_CONTRACT_VERSION = '2.0.0';
const PLUGIN_SETTINGS_CONTRACT_VERSION = '1.0.0';

class FilterNotApplicableError extends Error {
  /** @param {string} [message] */
  constructor(message) {
    super(message || 'No filter spec fields match this plugin\'s filterSchema');
    this.name = 'FilterNotApplicableError';
  }
}

module.exports = {
  PLUGIN_CONTRACT_VERSION,
  PLUGIN_SETTINGS_CONTRACT_VERSION,
  FilterNotApplicableError,
};
