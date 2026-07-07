import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClimbLog } from '../types';

/**
 * Local AsyncStorage wrapper.
 *
 * Phase 2a: local climb history persists alongside Supabase for offline fallback.
 * The primary storage is now Supabase (see services/climbs.ts).
 * This module retains local-only persistence methods used by other features
 * (starred blocks, pending reports) and provides the offline queue.
 */

const CLIMB_HISTORY_KEY = 'climb_history';
const CLIMB_QUEUE_KEY = 'climb_sync_queue'; // climbs queued for sync when offline

export default {
  // Generic key-value
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  },

  // --- Local climb history (read-only after migration; Phase 2a uses Supabase) ---
  async getClimbHistory(): Promise<ClimbLog[]> {
    const val = await AsyncStorage.getItem(CLIMB_HISTORY_KEY);
    return val ? JSON.parse(val) : [];
  },

  async addClimb(climb: ClimbLog): Promise<void> {
    const history = await this.getClimbHistory();
    history.unshift(climb);
    await AsyncStorage.setItem(CLIMB_HISTORY_KEY, JSON.stringify(history));
  },

  async clearClimbHistory(): Promise<void> {
    await AsyncStorage.removeItem(CLIMB_HISTORY_KEY);
  },

  // --- Offline climb queue (for Supabase writes that fail due to no signal) ---
  async getClimbQueue(): Promise<ClimbLog[]> {
    const val = await AsyncStorage.getItem(CLIMB_QUEUE_KEY);
    return val ? JSON.parse(val) : [];
  },

  async queueClimb(climb: ClimbLog): Promise<void> {
    const queue = await this.getClimbQueue();
    queue.push(climb);
    await AsyncStorage.setItem(CLIMB_QUEUE_KEY, JSON.stringify(queue));
  },

  async clearClimbQueue(): Promise<void> {
    await AsyncStorage.removeItem(CLIMB_QUEUE_KEY);
  },

  // --- Pending amenity reports ---
  async getPendingReports(): Promise<any[]> {
    const val = await AsyncStorage.getItem('pending_reports');
    return val ? JSON.parse(val) : [];
  },

  async setPendingReports(reports: any[]): Promise<void> {
    await AsyncStorage.setItem('pending_reports', JSON.stringify(reports));
  },

  // --- Starred blocks ---
  async getStarredBlocks(): Promise<string[]> {
    const val = await AsyncStorage.getItem('starred_blocks');
    return val ? JSON.parse(val) : [];
  },

  async setStarredBlocks(ids: string[]): Promise<void> {
    await AsyncStorage.setItem('starred_blocks', JSON.stringify(ids));
  },
};
