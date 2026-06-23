export interface Block {
  block_id: string;
  blk_no: string;
  street: string;
  town: string | null;
  storeys: number;
  est_height_m: number;
  height_source: 'estimated' | 'verified';
  year_completed: number | null;
  total_dwelling_units: number | null;
  lat: number | null;
  lng: number | null;
}

export interface BoundsRect {
  sw: [number, number];
  ne: [number, number];
}

export interface ClimbLog {
  block_id: string;
  blk_no: string;
  street: string;
  storeys: number;
  climbedAt: string; // ISO date string
}
