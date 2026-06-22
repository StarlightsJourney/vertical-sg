/**
 * Simple in-memory key-value store. Data persists for the session but
 * resets on app restart. Swap to AsyncStorage for persistence across
 * restarts (requires EAS rebuild).
 */
const store = new Map<string, string>();

export default {
  async getItem(key: string): Promise<string | null> {
    return store.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key);
  },
};
