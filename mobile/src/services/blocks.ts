import { supabase } from '../config/supabase';
import type { Block } from '../types';

export async function fetchBlocksInBounds(
  params: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
    sortBy: string;
    limit?: number;
  },
): Promise<Block[]> {
  const { data, error } = await supabase.rpc('blocks_in_bounds', {
    min_lat: params.minLat,
    min_lng: params.minLng,
    max_lat: params.maxLat,
    max_lng: params.maxLng,
    sort_by: params.sortBy,
    result_limit: params.limit ?? 500,
  });

  if (error) {
    console.error('Error fetching blocks in bounds:', error);
    throw error;
  }

  return (data ?? []) as Block[];
}
