import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClimbLog } from '../types';

/**
 * Persistent storage backed by AsyncStorage.
 * Data survives app restarts and device reboots.
 */

export default {
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },

  async getClimbHistory(): Promise<ClimbLog[]> {
    const val = await AsyncStorage.getItem('climb_history');
    return val ? JSON.parse(val) : [];
  },

  async addClimb(climb: ClimbLog): Promise<void> {
    const history = await this.getClimbHistory();
    history.unshift(climb);
    await AsyncStorage.setItem('climb_history', JSON.stringify(history));
  },

  async getClimbCount(blockId: string): Promise<number> {
    const history = await this.getClimbHistory();
    return history.filter(c => c.block_id === blockId).length;
  },
};
