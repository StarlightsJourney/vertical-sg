import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
  Animated,
  PanResponder,
  LayoutAnimation,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../config/supabase';
import type { AppNotification } from '../types';

// No setLayoutAnimationEnabledExperimental() call — it's a no-op on the New
// Architecture (which this app runs on) and only logs a warning; Android
// LayoutAnimation works there without it.

interface Props {
  visible: boolean;
  onClose: () => void;
  isDark?: boolean;
  /** Fired whenever the locally-held unread count changes (load, mark-read,
   * mark-all-read, swipe-dismiss, clear-all) so a parent badge (e.g. the
   * Social tab's bell) can update the instant it happens instead of waiting
   * on its own separate poll/refetch. */
  onUnreadCountChange?: (count: number) => void;
}

const SWIPE_DISMISS_THRESHOLD = 90;

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

interface SwipeableNotifRowProps {
  item: AppNotification;
  isDark: boolean;
  onPress: () => void;
  onDismiss: () => void;
}

// Swipe-to-dismiss for a single row. react-native-gesture-handler isn't a
// dependency of this app (checked package.json/node_modules), so this uses
// a plain PanResponder + Animated, the same primitive App.tsx already uses
// for its edge-swipe tab gesture.
function SwipeableNotifRow({ item, isDark, onPress, onDismiss }: SwipeableNotifRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt: GestureResponderEvent, gestureState: PanResponderGestureState) =>
        Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5,
      onPanResponderMove: (_evt, gestureState) => {
        translateX.setValue(gestureState.dx);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (Math.abs(gestureState.dx) > SWIPE_DISMISS_THRESHOLD) {
          Animated.timing(translateX, {
            toValue: gestureState.dx > 0 ? 600 : -600,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onDismiss());
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      },
    })
  ).current;

  const { icon, color } = getNotifIcon(item.type);

  return (
    <View style={styles.swipeWrap}>
      <View style={[styles.dismissBackdrop, isDark && { backgroundColor: '#3B1414' }]}>
        <Ionicons name="trash-outline" size={18} color="#EF4444" />
        <Text style={styles.dismissBackdropText}>Swipe to dismiss</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <TouchableOpacity
          style={[
            styles.notifRow,
            isDark && { backgroundColor: '#111827' },
            !item.read && styles.unread,
            isDark && !item.read && { backgroundColor: '#1F2937' },
          ]}
          onPress={onPress}
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
      </Animated.View>
    </View>
  );
}

export default function NotificationsModal({ visible, onClose, isDark = false, onUnreadCountChange }: Props) {
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

  // Report the live unread count up to the parent any time the local list
  // changes for any reason (initial load, tap-to-read, mark-all, swipe
  // dismiss, clear-all) — this is what lets a bell badge elsewhere clear
  // instantly instead of trailing behind its own poll/refetch cycle.
  useEffect(() => {
    onUnreadCountChange?.(notifications.filter((n) => !n.read).length);
  }, [notifications, onUnreadCountChange]);

  const handleMarkRead = async (notifId: string) => {
    // Optimistic — flip it locally right away rather than waiting on the
    // network round-trip + a full reload before the UI (and the unread
    // count derived from it) reflects the change.
    setNotifications((prev) => prev.map((n) => (n.notification_id === notifId ? { ...n, read: true } : n)));
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('notification_id', notifId);
  };

  const handleMarkAllRead = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', session.user.id)
      .eq('read', false);
  };

  // There's no separate "dismissed" column on notifications — swiping a row
  // away marks it read (so it stops counting toward unread) and drops it
  // from the currently-visible list. It's a soft dismiss: reopening later
  // still shows it, just already read.
  const handleDismiss = async (notifId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setNotifications((prev) => prev.filter((n) => n.notification_id !== notifId));
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('notification_id', notifId);
  };

  const handleClearAll = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setNotifications([]);
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', session.user.id)
      .eq('read', false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdropArea} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, isDark && { backgroundColor: '#111827' }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={[styles.title, isDark && { color: '#F9FAFB' }]}>Notifications</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={handleMarkAllRead} hitSlop={6}>
                <Text style={styles.markAll}>Mark all read</Text>
              </TouchableOpacity>
              {notifications.length > 0 && (
                <TouchableOpacity onPress={handleClearAll} hitSlop={6}>
                  <Text style={styles.clearAll}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#2563EB" />
            </View>
          ) : notifications.length > 0 ? (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.notification_id}
              renderItem={({ item }) => (
                <SwipeableNotifRow
                  item={item}
                  isDark={isDark}
                  onPress={() => handleMarkRead(item.notification_id)}
                  onDismiss={() => handleDismiss(item.notification_id)}
                />
              )}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  markAll: { fontSize: 13, color: '#2563EB', fontWeight: '600' },
  clearAll: { fontSize: 13, color: '#EF4444', fontWeight: '600' },
  listContent: { paddingBottom: 32 },
  swipeWrap: { justifyContent: 'center' },
  dismissBackdrop: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 24,
    gap: 8,
    backgroundColor: '#FEE2E2',
  },
  dismissBackdropText: { fontSize: 12, fontWeight: '600', color: '#EF4444' },
  notifRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
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
