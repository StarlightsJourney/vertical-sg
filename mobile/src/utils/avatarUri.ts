import { supabase } from '../config/supabase';
import type { Profile } from '../types';

/** Resolves a profile's uploaded photo (if any) to a public Storage URL, for passing as MascotAvatar's photoUri prop. */
export function avatarUriFor(profile: Profile | null | undefined): string | undefined {
  if (!profile?.avatar_photo_path) return undefined;
  return supabase.storage.from('building-photos').getPublicUrl(profile.avatar_photo_path).data.publicUrl;
}
