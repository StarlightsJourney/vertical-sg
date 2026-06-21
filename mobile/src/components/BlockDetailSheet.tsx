import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import * as Linking from 'expo-linking';
import type { Block } from '../types';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAX_SHEET_HEIGHT = SCREEN_HEIGHT * 0.4;

interface BlockDetailSheetProps {
  block: Block | null;
  onClose: () => void;
  visible: boolean;
}

export default function BlockDetailSheet({
  block,
  onClose,
  visible,
}: BlockDetailSheetProps) {
  if (!block) {
    return null;
  }

  const hasLocation =
    block.lat !== null &&
    block.lat !== undefined &&
    block.lng !== null &&
    block.lng !== undefined;

  const handleGetDirections = () => {
    if (hasLocation) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${block.lat},${block.lng}`
      );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={styles.sheet} pointerEvents="box-none">
          <View style={styles.sheetContent}>
            {/* Drag handle */}
            <TouchableOpacity
              style={styles.dragHandleArea}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <View style={styles.dragHandle} />
            </TouchableOpacity>

            {/* Close button */}
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>

            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.address}>
                Blk {block.blk_no} {block.street}
              </Text>
              {block.town !== null && (
                <Text style={styles.town}>{block.town}</Text>
              )}
            </View>

            {/* Detail rows */}
            <View style={styles.details}>
              <DetailRow
                icon="🏢"
                label="Storeys"
                value={`${block.storeys} floors`}
              />
              <DetailRow
                icon="📏"
                label="Height"
                value={`${block.est_height_m}m`}
              />
              {block.year_completed !== null && (
                <DetailRow
                  icon="📅"
                  label="Year"
                  value={`${block.year_completed}`}
                />
              )}
              {block.total_dwelling_units !== null && (
                <DetailRow
                  icon="🏘️"
                  label="Units"
                  value={`${block.total_dwelling_units}`}
                />
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
                  {block.height_source === 'verified' ? 'Verified' : 'Estimated'}
                </Text>
              </View>
            </View>

            {/* Directions button or unavailable message */}
            <View style={styles.directionsContainer}>
              {hasLocation ? (
                <TouchableOpacity
                  style={styles.directionsButton}
                  onPress={handleGetDirections}
                  activeOpacity={0.8}
                >
                  <Text style={styles.directionsButtonText}>
                    🗺️ Get Directions
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.locationUnavailable}>
                  Location unavailable
                </Text>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Reusable detail row component */
function DetailRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailIcon}>{icon}</Text>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ---------- Backdrop ----------
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  backdropTouch: {
    flex: 1,
  },

  // ---------- Sheet ----------
  sheet: {
    maxHeight: MAX_SHEET_HEIGHT,
  },
  sheetContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    paddingTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 16,
      },
    }),
  },

  // ---------- Drag handle ----------
  dragHandleArea: {
    alignItems: 'center',
    paddingVertical: 4,
    marginBottom: 4,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },

  // ---------- Close button ----------
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  closeButtonText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '600',
  },

  // ---------- Header ----------
  header: {
    marginBottom: 16,
    paddingRight: 32,
  },
  address: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 24,
  },
  town: {
    fontSize: 14,
    fontWeight: '400',
    color: '#6B7280',
    marginTop: 2,
  },

  // ---------- Details ----------
  details: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailIcon: {
    fontSize: 16,
    width: 28,
    textAlign: 'center',
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '400',
    color: '#6B7280',
    width: 72,
    marginLeft: 4,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },

  // ---------- Badge ----------
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
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

  // ---------- Directions ----------
  directionsContainer: {
    marginTop: 4,
  },
  directionsButton: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionsButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  locationUnavailable: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 14,
  },
});
