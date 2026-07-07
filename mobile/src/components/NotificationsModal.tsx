import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../config/supabase';
import type { AppNotification } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  isDark?: boolean;
}

function formatRelativeTime(ts: string): string {
  const now = Date.now();
  const then = new Date(ts).getTime();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
}

function getNotifIcon(type: string) {
  switch (type) {
    case 'verification_corroborated': return { icon: 'people-outline', color: '#2563EB' };
    case 'block_verified': return { icon: 'checkmark-circle', color: '#10B981' };
    case 'block_disputed': return { icon: 'warning-outline', color: '#F59E0B' };
    case 'photo_reported': return { icon: 'flag-outline', color: '#EF4444' };
    case 'badge_earned': return { icon: 'ribbon', color: '#F59E0B' };
    case 'pioneer': return { icon: 'flag', color: '#7C3AED' };
    default: return { icon: 'notifications-outline', color: '#6B7280' };
  }
}

export default function NotificationsModal({ visible, onClose, isDark = false }: Props) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (data) setNotifications(data as AppNotification[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) loadNotifications();
  }, [visible, loadNotifications]);

  const handleMarkRead = async (notifId: string) => {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('notification_id', notifId);
    loadNotifications();
  };

  const handleMarkAllRead = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', session.user.id)
      .eq('read', false);
    loadNotifications();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdropArea} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, isDark && { backgroundColor: '#111827' }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={[styles.title, isDark && { color: '#F9FAFB' }]}>Notifications</Text>
            <TouchableOpacity onPress={handleMarkAllRead}>
              <Text style={styles.markAll}>Mark all read</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#2563EB" />
            </View>
          ) : notifications.length > 0 ? (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.notification_id}
              renderItem={({ item }) => {
                const { icon, color } = getNotifIcon(item.type);
                return (
                  <TouchableOpacity
                    style={[styles.notifRow, !item.read && styles.unread, isDark && !item.read && { backgroundColor: '#1F2937' }]}
                    onPress={() => handleMarkRead(item.notification_id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconCircle, { backgroundColor: color + '1A' }]}>
                      <Ionicons name={icon as any} size={18} color={color} />
                    </View>
                    <View style={styles.notifContent}>
                      <Text style={[styles.notifMsg, isDark && { color: '#F9FAFB' }]} numberOfLines={2}>
                        {item.message}
                      </Text>
                      <Text style={styles.notifTime}>{formatRelativeTime(item.created_at)}</Text>
                    </View>
                    {!item.read && <View style={styles.unreadDot} />}
                  </TouchableOpacity>
                );
              }}
              contentContainerStyle={styles.listContent}
            />
          ) : (
            <View style={styles.center}>
              <Ionicons name="notifications-off-outline" size={48} color={isDark ? '#4B5563' : '#D1D5DB'} />
              <Text style={[styles.emptyText, isDark && { color: '#9CA3AF' }]}>No notifications yet</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent' },
  backdropArea: { height: '15%', backgroundColor: 'transparent' },
  sheet: {
    height: '85%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center', marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  title: { fontSize: 20, fontWeight: '800', color: '#111827' },
  markAll: { fontSize: 13, color: '#2563EB', fontWeight: '600' },
  listContent: { paddingBottom: 32 },
  notifRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  unread: { backgroundColor: '#F0F7FF' },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  notifContent: { flex: 1, marginRight: 8 },
  notifMsg: { fontSize: 14, color: '#111827', fontWeight: '500', lineHeight: 19 },
  notifTime: { fontSize: 11, color: '#9CA3AF', marginTop: 3 },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#2563EB',
  },
  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24,
  },
  emptyText: { fontSize: 15, color: '#9CA3AF', marginTop: 12 },
});
