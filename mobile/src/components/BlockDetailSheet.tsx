import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  ScrollView,
} from 'react-native';
import * as Linking from 'expo-linking';
import type { Block } from '../types';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAX_SHEET_HEIGHT = SCREEN_HEIGHT * 0.42;
// Padding to clear the Android gesture navigation bar
const BOTTOM_INSET = Platform.OS === 'android' ? 32 : 0;

interface BlockDetailSheetProps {
  block: Block | null;
  distanceKm: number | null;
  onClose: () => void;
  visible: boolean;
}

export default function BlockDetailSheet({
  block,
  distanceKm,
  onClose,
  visible,
}: BlockDetailSheetProps) {
  if (!block) return null;

  const hasLocation =
    block.lat != null &&
    block.lng != null;

  const handleGetDirections = () => {
    if (hasLocation) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${block.lat},${block.lng}`,
      );
    }
  };

  const heightTier = getHeightTier(block.storeys);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <ScrollView
            style={styles.sheetContent}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {/* Drag handle */}
            <View style={styles.dragHandle} />

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerRow}>
                <View style={styles.headerLeft}>
                  <Text style={styles.address} numberOfLines={2}>
                    Blk {block.blk_no} {block.street}
                  </Text>
                  {block.town && (
                    <Text style={styles.town}>{block.town}</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  activeOpacity={0.7}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Height tier indicator */}
            <View style={[styles.tierBar, { backgroundColor: heightTier.color }]}>
              <View style={styles.tierDot} />
              <Text style={styles.tierLabel}>
                {heightTier.label} · {block.storeys} storeys · {block.est_height_m}m
              </Text>
            </View>

            {/* Detail rows */}
            <View style={styles.details}>
              {distanceKm != null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Distance</Text>
                  <Text style={styles.detailValue}>
                    {distanceKm < 1
                      ? `${Math.round(distanceKm * 1000)}m`
                      : `${distanceKm.toFixed(1)}km`}
                  </Text>
                </View>
              )}
              {block.year_completed && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Year built</Text>
                  <Text style={styles.detailValue}>{block.year_completed}</Text>
                </View>
              )}
              {block.total_dwelling_units && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Dwelling units</Text>
                  <Text style={styles.detailValue}>
                    {block.total_dwelling_units.toLocaleString()}
                  </Text>
                </View>
              )}
            </View>

            {/* Height source badge */}
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.badge,
                  block.height_source === 'verified'
                    ? styles.badgeVerified
                    : styles.badgeEstimated,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    block.height_source === 'verified'
                      ? styles.badgeTextVerified
                      : styles.badgeTextEstimated,
                  ]}
                >
                  {block.height_source === 'verified'
                    ? '✓ Verified height'
                    : 'Estimated height'}
                </Text>
              </View>
            </View>

            {/* Directions button */}
            <View style={styles.directionsContainer}>
              {hasLocation ? (
                <TouchableOpacity
                  style={styles.directionsButton}
                  onPress={handleGetDirections}
                  activeOpacity={0.8}
                >
                  <Text style={styles.directionsButtonText}>Get Directions</Text>
                  <Text style={styles.directionsSubtext}>Open in Google Maps</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.locationUnavailable}>
                  Location unavailable for this block
                </Text>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Returns a label and color for a block's height tier.
 */
function getHeightTier(storeys: number): { label: string; color: string } {
  if (storeys <= 10) return { label: 'Low-rise', color: '#4A90D9' };
  if (storeys <= 20) return { label: 'Mid-rise', color: '#FF9500' };
  if (storeys <= 30) return { label: 'High-rise', color: '#FF3B30' };
  return { label: 'Very tall', color: '#8B0000' };
}

const styles = StyleSheet.create({
  // Backdrop
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  backdropTouch: {
    flex: 1,
  },

  // Sheet
  sheet: {
    maxHeight: MAX_SHEET_HEIGHT,
  },
  sheetContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 24 + BOTTOM_INSET,
    paddingTop: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: {
        elevation: 16,
      },
    }),
  },

  // Drag handle
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 16,
  },

  // Header
  header: {
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flex: 1,
    paddingRight: 12,
  },
  address: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  town: {
    fontSize: 14,
    fontWeight: '400',
    color: '#6B7280',
    marginTop: 2,
  },

  // Close button
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '600',
  },

  // Height tier indicator
  tierBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 14,
  },
  tierDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.4)',
    marginRight: 10,
  },
  tierLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },

  // Details
  details: {
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  detailLabel: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '400',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },

  // Badge
  badgeRow: {
    marginBottom: 16,
    marginTop: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  badgeEstimated: {
    backgroundColor: '#FEF3C7',
  },
  badgeVerified: {
    backgroundColor: '#D1FAE5',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  badgeTextEstimated: {
    color: '#92400E',
  },
  badgeTextVerified: {
    color: '#065F46',
  },

  // Directions
  directionsContainer: {
    marginTop: 4,
  },
  directionsButton: {
    backgroundColor: '#2563EB',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionsButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  directionsSubtext: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  locationUnavailable: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 16,
    fontStyle: 'italic',
  },
});
