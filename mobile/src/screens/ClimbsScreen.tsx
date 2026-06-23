import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import storage from '../utils/storage';
import type { ClimbLog } from '../types';

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getTierColor(storeys: number): string {
  if (storeys <= 10) return '#4A90D9';
  if (storeys <= 20) return '#FF9500';
  if (storeys <= 30) return '#FF3B30';
  if (storeys <= 39) return '#8B0000';
  return '#7C3AED';
}

export default function ClimbsScreen() {
  const [climbHistory, setClimbHistory] = useState<ClimbLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    storage.getClimbHistory().then((history) => {
      setClimbHistory(history);
      setLoading(false);
    });
  }, []);

  const totalClimbs = climbHistory.length;
  const totalFloors = climbHistory.reduce((sum, c) => sum + c.storeys, 0);
  const totalMeters = Math.round(totalFloors * 2.8);

  const renderClimb = useCallback(({ item, index }: { item: ClimbLog; index: number }) => {
    const tierColor = getTierColor(item.storeys);
    return (
      <TouchableOpacity style={styles.climbRow} activeOpacity={0.6}>
        <View style={styles.climbIndex}>
          <Text style={styles.climbIndexText}>#{totalClimbs - index}</Text>
        </View>
        <View style={[styles.tierDot, { backgroundColor: tierColor }]} />
        <View style={styles.climbContent}>
          <Text style={styles.climbAddr} numberOfLines={1}>
            Blk {item.blk_no} {item.street}
          </Text>
          <Text style={styles.climbDate}>{formatDate(item.climbedAt)} · {formatRelativeTime(item.climbedAt)}</Text>
        </View>
        <View style={styles.climbRight}>
          <Text style={[styles.climbFloors, { color: tierColor }]}>{item.storeys}</Text>
          <Text style={styles.climbFloorsLabel}>fl</Text>
        </View>
      </TouchableOpacity>
    );
  }, [totalClimbs]);

  return (
    <View style={styles.container}>
      {/* Header area */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Climbs</Text>
      </View>

      {loading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      ) : climbHistory.length === 0 ? (
        <View style={styles.centerContent}>
          <Text style={styles.emptyText}>
            Log a climb to see it here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={climbHistory}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderClimb}
          ListHeaderComponent={
            <View style={styles.statsBar}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{totalClimbs}</Text>
                <Text style={styles.statLabel}>Climbs</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{totalFloors}</Text>
                <Text style={styles.statLabel}>Floors</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>~{totalMeters}m</Text>
                <Text style={styles.statLabel}>Vertical</Text>
              </View>
            </View>
          }
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={Separator}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  statsBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
  },
  climbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
  },
  climbIndex: {
    width: 36,
    alignItems: 'flex-start',
  },
  climbIndexText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  tierDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  climbContent: {
    flex: 1,
    marginRight: 8,
  },
  climbAddr: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  climbDate: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
    marginTop: 2,
  },
  climbRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  climbFloors: {
    fontSize: 18,
    fontWeight: '700',
  },
  climbFloorsLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    marginLeft: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginLeft: 68,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 22,
  },
  listContent: {
    paddingBottom: 32,
  },
});
