import { supabase } from '../config/supabase';
import type { Block, SortMode } from '../types';

export interface NearbyBlocksParams {
  lat: number;
  lng: number;
  radius: number; // in metres
  sortBy: SortMode;
}

export async function fetchNearbyBlocks(
  params: NearbyBlocksParams,
): Promise<Block[]> {
  const { lat, lng, radius, sortBy } = params;

  const { data, error } = await supabase.rpc('nearby_blocks', {
    lat,
    lng,
    radius_m: radius,
    sort_by: sortBy,
  });

  if (error) {
    console.error('Error fetching nearby blocks:', error);
    throw error;
  }

  return (data ?? []) as Block[];
}
