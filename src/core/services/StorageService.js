/**
 * Social Media Downloader — Storage Service
 * Namespaced chrome.storage.local wrapper (SPEC §49 / AGENTS §47).
 * Handles persistent configuration and historical deduplication registry
 * with safe in-memory fallback for test environments.
 */

export class StorageService {
  /** @type {Map<string, any>} */
  static _memoryStore = new Map();

  /**
   * Reads a namespaced key from storage.
   * @param {string} key
   * @param {any} [defaultValue=null]
   * @returns {Promise<any>}
   */
  static async get(key, defaultValue = null) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get([key], (result) => {
            if (chrome.runtime.lastError || !result || !(key in result)) {
              resolve(defaultValue);
            } else {
              resolve(result[key]);
            }
          });
        } catch (e) {
          resolve(defaultValue);
        }
      });
    }
    return StorageService._memoryStore.has(key) ? StorageService._memoryStore.get(key) : defaultValue;
  }

  /**
   * Writes a namespaced key to storage.
   * @param {string} key
   * @param {any} value
   * @returns {Promise<boolean>}
   */
  static async set(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.set({ [key]: value }, () => {
            resolve(!chrome.runtime.lastError);
          });
        } catch (e) {
          resolve(false);
        }
      });
    }
    StorageService._memoryStore.set(key, value);
    return true;
  }

  /**
   * Removes a namespaced key from storage.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  static async remove(key) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.remove([key], () => {
            resolve(!chrome.runtime.lastError);
          });
        } catch (e) {
          resolve(false);
        }
      });
    }
    StorageService._memoryStore.delete(key);
    return true;
  }

  /**
   * Loads user settings from 'core.settings'.
   * @returns {Promise<{ deduplicate: boolean, historicalDedup: boolean }>}
   */
  static async getSettings() {
    const defaultSettings = { deduplicate: false, historicalDedup: false };
    const saved = await StorageService.get('core.settings', defaultSettings);
    return { ...defaultSettings, ...(saved || {}) };
  }

  /**
   * Saves user settings to 'core.settings'.
   * @param {Partial<{ deduplicate: boolean, historicalDedup: boolean }>} patch
   * @returns {Promise<boolean>}
   */
  static async saveSettings(patch) {
    const current = await StorageService.getSettings();
    const updated = { ...current, ...patch };
    return StorageService.set('core.settings', updated);
  }

  /**
   * Checks whether a binary signature is in the historical deduplication registry.
   * @param {string} signature - "${crc32}_${byteLength}"
   * @returns {Promise<boolean>}
   */
  static async isHistoricallyDownloaded(signature) {
    if (!signature) return false;
    const history = await StorageService.get('core.dedup_history', []);
    if (Array.isArray(history)) {
      return history.includes(signature);
    }
    return false;
  }

  /**
   * Adds multiple binary signatures to the historical deduplication registry.
   * @param {string[]} signatures
   * @returns {Promise<void>}
   */
  static async addHistoricalSignatures(signatures) {
    if (!Array.isArray(signatures) || signatures.length === 0) return;
    const history = await StorageService.get('core.dedup_history', []);
    const set = new Set(Array.isArray(history) ? history : []);
    for (const sig of signatures) {
      if (sig) set.add(sig);
    }
    // Cap history at 50,000 entries to prevent unbounded storage growth
    let array = Array.from(set);
    if (array.length > 50000) {
      array = array.slice(array.length - 50000);
    }
    await StorageService.set('core.dedup_history', array);
  }

  /**
   * Clears the historical deduplication registry.
   * @returns {Promise<boolean>}
   */
  static async clearHistory() {
    return StorageService.set('core.dedup_history', []);
  }
}
