import { supabase } from '../config/supabase';
import storage from '../utils/storage';
import type { ClimbRecord } from '../types';

/**
 * Primary climb logging via Supabase with AsyncStorage fallback for offline use.
 *
 * Pattern: try Supabase insert → on any failure (network, server, etc.),
 * queue in AsyncStorage. Background sync drains the queue when connectivity returns.
 */

let syncInProgress = false;

/**
 * Try to log a climb to Supabase. Falls back to local queue on failure.
 *
 * `qty` is the number of full sets (whole climbs of the building);
 * `partialFloors` is an optional incomplete final set (e.g. gave up
 * partway up the last ascent). Total floors = storeys * qty + partialFloors.
 */
export async function logClimb(
  userId: string,
  blockId: string,
  blkNo: string,
  street: string,
  storeys: number,
  qty: number,
  partialFloors: number = 0,
): Promise<{ synced: boolean; error?: string }> {
  const floorsClimbed = storeys * qty + partialFloors;

  try {
    const { error } = await supabase.from('climbs').insert({
      user_id: userId,
      block_id: blockId,
      climb_qty: qty,
      partial_floors: partialFloors,
      floors_climbed: floorsClimbed,
      synced: true,
    });

    if (error) {
      // Network/transient error — queue locally
      await queueClimbsLocally(blkNo, street, storeys, blockId, floorsClimbed);
      return { synced: false, error: error.message };
    }

    return { synced: true };
  } catch (_err) {
    // Any failure (network offline, DNS, timeout) → queue locally
    await queueClimbsLocally(blkNo, street, storeys, blockId, floorsClimbed);
    return { synced: false, error: _err instanceof Error ? _err.message : 'Network unavailable' };
  }
}

/** Queue a climb in local AsyncStorage for later sync (one row per log action). */
async function queueClimbsLocally(
  blkNo: string,
  street: string,
  storeys: number,
  blockId: string,
  floorsClimbed: number,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const entry = {
    block_id: blockId,
    blk_no: blkNo,
    street,
    storeys,
    floors: floorsClimbed,
    climbedAt: timestamp,
  };
  await storage.queueClimb(entry);
  // Also add to local history so it appears immediately
  await storage.addClimb(entry);
}

/** Get all climbs for a user from Supabase. */
export async function getUserClimbs(userId: string): Promise<ClimbRecord[]> {
  const { data, error } = await supabase
    .from('climbs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('Error fetching user climbs:', error.message);
    return [];
  }

  return (data ?? []) as ClimbRecord[];
}

/** Get unread notification count for the bell badge. */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);

  if (error) return 0;
  return count ?? 0;
}

/** Sync queued climbs from AsyncStorage to Supabase. Called when connectivity returns. */
export async function syncQueuedClimbs(userId: string): Promise<number> {
  if (syncInProgress) return 0;
  syncInProgress = true;

  try {
    const queue = await storage.getClimbQueue();
    if (queue.length === 0) return 0;

    let synced = 0;
    for (const climb of queue) {
      // Reconstruct qty/partial from the total so it matches the server-side
      // floors_climbed = climb_qty*storeys + partial_floors consistency check.
      const qty = Math.floor(climb.floors / climb.storeys);
      const partial = climb.floors % climb.storeys;
      const { error } = await supabase.from('climbs').insert({
        user_id: userId,
        block_id: climb.block_id,
        climb_qty: qty,
        partial_floors: partial,
        floors_climbed: climb.floors,
        synced: true,
        created_at: climb.climbedAt, // preserve original timestamp
      });

      if (error) {
        console.warn('Failed to sync queued climb:', error.message);
        break; // Stop on first failure; remaining will retry next sync
      }
      synced++;
    }

    if (synced > 0) {
      // Remove synced climbs from queue
      const remaining = queue.slice(synced);
      await storage.setItem(
        'climb_sync_queue',
        JSON.stringify(remaining),
      );
    }

    return synced;
  } finally {
    syncInProgress = false;
  }
}

/** Migrate all local AsyncStorage climbs to Supabase. Called once after first auth. */
export async function migrateLocalClimbs(userId: string): Promise<number> {
  const history = await storage.getClimbHistory();
  if (history.length === 0) return 0;

  let migrated = 0;
  for (const climb of history) {
    const qty = Math.floor(climb.floors / climb.storeys);
    const partial = climb.floors % climb.storeys;
    const { error } = await supabase.from('climbs').insert({
      user_id: userId,
      block_id: climb.block_id,
      climb_qty: qty,
      partial_floors: partial,
      floors_climbed: climb.floors,
      synced: true,
      created_at: climb.climbedAt,
    });

    if (error) {
      console.warn('Migration error for climb:', error.message);
      continue;
    }
    migrated++;
  }

  // Clear local history after successful migration
  if (migrated > 0) {
    await storage.clearClimbHistory();
  }

  return migrated;
}

/**
 * Check for badges earned in the last few seconds — called right after
 * logging a climb so a celebration can show up immediately, rather than
 * waiting for the user to notice the notification bell.
 */
export async function checkRecentBadges(userId: string, withinMs: number = 8000): Promise<string[]> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data, error } = await supabase
    .from('user_badges')
    .select('badge_key')
    .eq('user_id', userId)
    .gte('earned_at', since);

  if (error || !data) return [];
  return data.map((d) => d.badge_key as string);
}
