import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import Mapbox, { MapView, Camera, PointAnnotation } from '@rnmapbox/maps';
import { useLocation } from '../hooks/useLocation';
import { fetchNearbyBlocks } from '../services/blocks';
import type { Block, SortMode } from '../types';
import BlockDetailSheet from '../components/BlockDetailSheet';

// Set Mapbox access token before any map renders
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');

const RADIUS_PRESETS = [1000, 3000, 5000];

function getMarkerColor(storeys: number): string {
  if (storeys <= 10) return '#4A90D9';
  if (storeys <= 20) return '#FF9500';
  if (storeys <= 30) return '#FF3B30';
  return '#8B0000';
}

function getMarkerSize(storeys: number): number {
  if (storeys <= 10) return 12;
  if (storeys <= 20) return 14;
  if (storeys <= 30) return 16;
  return 18;
}

export default function MapScreen() {
  const location = useLocation();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortMode>('storeys');
  const [radius, setRadius] = useState(5000);

  const fetchBlocks = useCallback(async () => {
    if (location.loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNearbyBlocks({
        lat: location.latitude,
        lng: location.longitude,
        radius,
        sortBy,
      });
      setBlocks(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load blocks',
      );
    } finally {
      setLoading(false);
    }
  }, [
    location.latitude,
    location.longitude,
    location.loading,
    radius,
    sortBy,
  ]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  const handleCloseDetail = useCallback(() => {
    setSelectedBlock(null);
  }, []);

  // Camera requires [lng, lat] format
  const cameraCoordinate: [number, number] = [
    location.longitude,
    location.latitude,
  ];

  return (
    <View style={styles.container}>
      <MapView style={styles.map} logoEnabled={false}>
        <Camera
          centerCoordinate={cameraCoordinate}
          zoomLevel={13}
          animationMode="flyTo"
        />
        {blocks.map((block) => {
          if (block.lat == null || block.lng == null) return null;
          const size = getMarkerSize(block.storeys);
          return (
            <PointAnnotation
              key={block.block_id}
              id={block.block_id}
              coordinate={[block.lng, block.lat]}
              onSelected={() => setSelectedBlock(block)}
            >
              <View style={styles.markerContainer}>
                <View
                  style={[
                    styles.marker,
                    {
                      backgroundColor: getMarkerColor(block.storeys),
                      width: size * 2,
                      height: size * 2,
                      borderRadius: size,
                    },
                  ]}
                />
              </View>
            </PointAnnotation>
          );
        })}
      </MapView>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Loading indicator */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}

      {/* Controls bar */}
      <View style={styles.controlsContainer}>
        <View style={styles.controlsRow}>
          <View style={styles.sortGroup}>
            <TouchableOpacity
              style={[
                styles.sortButton,
                sortBy === 'storeys' && styles.sortButtonActive,
              ]}
              onPress={() => setSortBy('storeys')}
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'storeys' && styles.sortButtonTextActive,
                ]}
              >
                Tallest
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.sortButton,
                sortBy === 'distance' && styles.sortButtonActive,
              ]}
              onPress={() => setSortBy('distance')}
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'distance' && styles.sortButtonTextActive,
                ]}
              >
                Nearest
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.radiusLabel}>{radius / 1000}km</Text>
        </View>
        <View style={styles.radiusRow}>
          {RADIUS_PRESETS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[
                styles.radiusButton,
                radius === r && styles.radiusButtonActive,
              ]}
              onPress={() => setRadius(r)}
            >
              <Text
                style={[
                  styles.radiusButtonText,
                  radius === r && styles.radiusButtonTextActive,
                ]}
              >
                {r / 1000}km
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Block Detail Sheet overlay */}
      <BlockDetailSheet
        block={selectedBlock}
        onClose={handleCloseDetail}
        visible={selectedBlock !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  errorBanner: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    zIndex: 10,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sortGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 8,
  },
  sortButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  sortButtonText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '600',
  },
  sortButtonTextActive: {
    color: '#FFFFFF',
  },
  radiusLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  radiusRow: {
    flexDirection: 'row',
  },
  radiusButton: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  radiusButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: '#FFFFFF',
  },
  radiusButtonText: {
    color: '#CCCCCC',
    fontSize: 12,
    fontWeight: '500',
  },
  radiusButtonTextActive: {
    color: '#FFFFFF',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
});
