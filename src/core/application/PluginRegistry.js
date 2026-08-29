/**
 * Social Media Downloader — Plugin Registry
 * Central registry for all first-class platform plugins.
 */

export class PluginRegistry {
  constructor() {
    /** @type {Map<string, any>} */
    this.plugins = new Map();
  }

  /**
   * Registers a platform plugin.
   * @param {any} plugin
   */
  register(plugin) {
    if (!plugin || !plugin.id) {
      throw new TypeError('Plugin must have a valid string id');
    }
    const id = String(plugin.id).toLowerCase();
    this.plugins.set(id, plugin);
  }

  /**
   * Gets a registered plugin by id.
   * @param {string} id
   * @returns {any | undefined}
   */
  get(id) {
    return this.plugins.get(String(id).toLowerCase());
  }

  /**
   * Returns a list of all registered plugins.
   * @returns {any[]}
   */
  list() {
    return Array.from(this.plugins.values());
  }

  /**
   * Detects the matching plugin for a given context (URL, hostname, or tab).
   * @param {Object} context
   * @param {string} [context.url]
   * @param {string} [context.hostname]
   * @returns {any | null}
   */
  detect(context) {
    if (!context) return null;
    for (const plugin of this.plugins.values()) {
      if (typeof plugin.matches === 'function' && plugin.matches(context)) {
        return plugin;
      }
    }
    return null;
  }
}

// Global default singleton registry
export const defaultRegistry = new PluginRegistry();
