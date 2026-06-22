import type { ClimbLog } from '../types';

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

  async getClimbHistory(): Promise<ClimbLog[]> {
    const val = store.get('climb_history');
    return val ? JSON.parse(val) : [];
  },

  async addClimb(climb: ClimbLog): Promise<void> {
    const history = await this.getClimbHistory();
    history.unshift(climb);
    store.set('climb_history', JSON.stringify(history));
  },

  async getClimbCount(blockId: string): Promise<number> {
    const history = await this.getClimbHistory();
    return history.filter(c => c.block_id === blockId).length;
  },
};
