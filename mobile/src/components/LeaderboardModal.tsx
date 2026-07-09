import { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import MascotAvatar from './MascotAvatar';
import type { Profile } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  isDark?: boolean;
}

interface Row {
  user_id: string;
  total_floors: number;
  total_climbs: number;
}

// Same preview-only rationale as SocialScreen's MOCK_FEED_ITEMS — shown only
// when Public has fewer than 3 real rows, never written to the database.
const MOCK_ROWS: Row[] = [
  { user_id: 'mock-user-aaaa', total_floors: 480, total_climbs: 12 },
  { user_id: 'mock-user-bbbb', total_floors: 620, total_climbs: 18 },
  { user_id: 'mock-user-cccc', total_floors: 210, total_climbs: 6 },
];
const MOCK_PROFILES: Record<string, Profile> = {
  'mock-user-aaaa': { user_id: 'mock-user-aaaa', display_name: 'Wei Ling', avatar_idx: 1, featured_badge: null, is_pro: false, created_at: '', updated_at: '' },
  'mock-user-bbbb': { user_id: 'mock-user-bbbb', display_name: 'Farid', avatar_idx: 2, featured_badge: null, is_pro: false, created_at: '', updated_at: '' },
  'mock-user-cccc': { user_id: 'mock-user-cccc', display_name: 'Priya', avatar_idx: 3, featured_badge: null, is_pro: false, created_at: '', updated_at: '' },
};

export default function LeaderboardModal({ visible, onClose, onViewProfile, isDark = false }: Props) {
  const { user } = useAuth();
  const [scope, setScope] = useState<'public' | 'friends'>('public');
  const [rows, setRows] = useState<Row[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    if (scope === 'public') {
      const { data } = await supabase.from('leaderboard_weekly').select('*').order('total_floors', { ascending: false }).limit(50);
      const real = (data ?? []) as Row[];
      const merged = real.length < 3 ? [...real, ...MOCK_ROWS].sort((a, b) => b.total_floors - a.total_floors) : real;
      setRows(merged);
      setProfilesMap((prev) => ({ ...MOCK_PROFILES, ...prev }));
      setLoading(false);
      return;
    } else {
      if (!user) { setRows([]); setLoading(false); return; }
      const { data: following } = await supabase.from('follows').select('followee_id').eq('follower_id', user.id);
      const ids = [...(following ?? []).map((f: any) => f.followee_id), user.id];
      const { data } = await supabase.from('leaderboard_weekly').select('*').in('user_id', ids).order('total_floors', { ascending: false });
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, [scope, user]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  useEffect(() => {
    const realIds = rows.map((r) => r.user_id).filter((id) => !id.startsWith('mock-'));
    if (realIds.length === 0) return;
    supabase.from('profiles').select('*').in('user_id', realIds).then(({ data }) => {
      if (data) {
        setProfilesMap((prev) => {
          const next = { ...prev };
          for (const p of data as Profile[]) next[p.user_id] = p;
          return next;
        });
      }
    });
  }, [rows]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, isDark && { backgroundColor: '#1F2937' }]}>
          <View style={[styles.handle, isDark && { backgroundColor: '#4B5563' }]} />
          <View style={styles.header}>
            <Text style={[styles.title, isDark && { color: '#F9FAFB' }]}>This Week's Leaderboard</Text>
            <View style={[styles.toggle, isDark && { backgroundColor: '#111827' }]}>
              <TouchableOpacity
                style={[styles.toggleBtn, scope === 'public' && styles.toggleBtnActive, scope === 'public' && isDark && { backgroundColor: '#374151' }]}
                onPress={() => setScope('public')}
              >
                <Text style={[styles.toggleText, scope === 'public' && styles.toggleTextActive, isDark && { color: scope === 'public' ? '#F9FAFB' : '#9CA3AF' }]}>Public</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, scope === 'friends' && styles.toggleBtnActive, scope === 'friends' && isDark && { backgroundColor: '#374151' }]}
                onPress={() => setScope('friends')}
              >
                <Text style={[styles.toggleText, scope === 'friends' && styles.toggleTextActive, isDark && { color: scope === 'friends' ? '#F9FAFB' : '#9CA3AF' }]}>Friends</Text>
              </TouchableOpacity>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#2563EB" style={{ marginTop: 40 }} />
          ) : rows.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={36} color="#D1D5DB" />
              <Text style={styles.emptyText}>
                {scope === 'friends' ? "Add some climbers to see them here." : 'No climbs logged this week yet.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => item.user_id}
              contentContainerStyle={{ padding: 20 }}
              renderItem={({ item, index }) => {
                const isMe = user?.id === item.user_id;
                const isMock = item.user_id.startsWith('mock-');
                return (
                  <TouchableOpacity
                    style={[styles.row, isMe && styles.rowMe, isMe && isDark && { backgroundColor: 'rgba(37,99,235,0.22)' }]}
                    onPress={() => !isMe && !isMock && onViewProfile(item.user_id)}
                    disabled={isMe || isMock}
                  >
                    <Text style={[styles.rank, index < 3 && styles.rankTop]}>{index + 1}</Text>
                    <MascotAvatar skinIdx={profilesMap[item.user_id]?.avatar_idx ?? 0} size={32} />
                    <Text style={[styles.name, isDark && { color: '#F9FAFB' }]}>{isMe ? 'You' : (profilesMap[item.user_id]?.display_name ?? `Climber${item.user_id.slice(0, 4)}`)}</Text>
                    <Text style={styles.floors}>{item.total_floors} fl</Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent' },
  backdrop: { height: '15%' },
  sheet: { height: '85%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB', alignSelf: 'center', marginTop: 10 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 19, fontWeight: '800', color: '#111827', marginBottom: 12 },
  toggle: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3 },
  toggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  toggleBtnActive: { backgroundColor: '#FFFFFF', elevation: 1 },
  toggleText: { fontSize: 13, fontWeight: '600', color: '#9CA3AF' },
  toggleTextActive: { color: '#111827' },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowMe: { backgroundColor: '#EFF6FF', marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 10 },
  rank: { width: 22, fontSize: 14, fontWeight: '700', color: '#9CA3AF', textAlign: 'center' },
  rankTop: { color: '#F59E0B' },
  name: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111827' },
  floors: { fontSize: 13, fontWeight: '700', color: '#10B981' },
});
