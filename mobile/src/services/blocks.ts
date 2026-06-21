import { supabase } from '../config/supabase';
import type { Block, SortMode } from '../types';

export interface NearbyBlocksParams {
  lat: number;
  lng: number;
  radius: number; // in metres
  sortBy: SortMode;
}

export interface BoundsParams {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  sortBy: SortMode;
  limit?: number;
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

export async function fetchBlocksInBounds(
  params: BoundsParams,
): Promise<Block[]> {
  const { data, error } = await supabase.rpc('blocks_in_bounds', {
    min_lat: params.minLat,
    min_lng: params.minLng,
    max_lat: params.maxLat,
    max_lng: params.maxLng,
    sort_by: params.sortBy,
    result_limit: params.limit ?? 200,
  });

  if (error) {
    console.error('Error fetching blocks in bounds:', error);
    throw error;
  }

  return (data ?? []) as Block[];
}
