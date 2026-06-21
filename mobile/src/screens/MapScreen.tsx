import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import Mapbox, {
  MapView,
  Camera,
  ShapeSource,
  CircleLayer,
  SymbolLayer,
} from '@rnmapbox/maps';
import { useLocation } from '../hooks/useLocation';
import { fetchNearbyBlocks, fetchBlocksInBounds } from '../services/blocks';
import type { Block, SortMode } from '../types';
import BlockDetailSheet from '../components/BlockDetailSheet';

// Set Mapbox access token before any map renders
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');

const RADIUS_PRESETS = [1000, 3000, 5000];

export default function MapScreen() {
  const location = useLocation();
  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortByRef = useRef<SortMode>('storeys');
  const blocksRef = useRef<Block[]>([]);
  const zoomRef = useRef(13);
  const mapBoundsRef = useRef<{
    ne: [number, number];
    sw: [number, number];
  } | null>(null);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortMode>('storeys');
  const [radius, setRadius] = useState(5000);

  // Keep refs in sync with state
  sortByRef.current = sortBy;
  blocksRef.current = blocks;

  // Convert blocks array to a GeoJSON FeatureCollection for the ShapeSource
  const geojson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: blocks
        .filter((b) => b.lat != null && b.lng != null)
        .map((b) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [b.lng!, b.lat!] as [number, number],
          },
          properties: {
            block_id: b.block_id,
            blk_no: b.blk_no,
            street: b.street,
            storeys: b.storeys,
            est_height_m: b.est_height_m,
            height_source: b.height_source,
            town: b.town,
            year_completed: b.year_completed,
            total_dwelling_units: b.total_dwelling_units,
            lat: b.lat,
            lng: b.lng,
          },
        })),
    };
  }, [blocks]);

  // Fetch nearby blocks — used when "Nearest" sort is active
  const fetchNearby = useCallback(async () => {
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

  // Fetch blocks in the given map bounds — used when "Tallest" sort is active
  const fetchBounds = useCallback(
    async (
      bounds: { ne: [number, number]; sw: [number, number] },
      sort: SortMode,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchBlocksInBounds({
          minLat: bounds.sw[1],
          minLng: bounds.sw[0],
          maxLat: bounds.ne[1],
          maxLng: bounds.ne[0],
          sortBy: sort,
        });
        setBlocks(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load blocks',
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Handle camera changes: track bounds and zoom, debounce bounds fetch
  const handleCameraChanged = useCallback(
    (e: { properties: Record<string, any> }) => {
      const bounds = e.properties?.bounds;
      const zoom = e.properties?.zoom;

      if (bounds?.ne && bounds?.sw) {
        mapBoundsRef.current = {
          ne: bounds.ne as [number, number],
          sw: bounds.sw as [number, number],
        };
      }
      if (typeof zoom === 'number') {
        zoomRef.current = zoom;
      }

      // Don't fetch bounds in "Nearest" mode
      if (sortByRef.current === 'distance') return;

      // Debounce: wait 300ms after the last camera movement
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        // Double-check mode hasn't changed mid-debounce
        if (sortByRef.current === 'distance') return;
        if (mapBoundsRef.current) {
          fetchBounds(mapBoundsRef.current, sortByRef.current);
        }
      }, 300);
    },
    [fetchBounds],
  );

  // Handle tap on map: clusters zoom in, individual points show detail sheet
  const handleMapPress = useCallback(
    async (e: { properties: Record<string, any> }) => {
      const queryResult =
        await mapRef.current?.queryRenderedFeaturesAtPoint([
          e.properties.screenPointX,
          e.properties.screenPointY,
        ]);
      const features = queryResult?.features ?? [];

      if (features.length === 0) return;

      const feature = features[0] as any;

      if (feature.properties?.cluster) {
        // Tapped a cluster — zoom in by 2 levels
        cameraRef.current?.setCamera({
          centerCoordinate: feature.geometry.coordinates,
          zoomLevel: zoomRef.current + 2,
          animationDuration: 300,
        });
      } else {
        // Tapped an individual block — show detail sheet
        const blockId: string | undefined = feature.properties?.block_id;
        if (blockId) {
          const block = blocksRef.current.find(
            (b) => b.block_id === blockId,
          );
          if (block) setSelectedBlock(block);
        }
      }
    },
    [],
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedBlock(null);
  }, []);

  // Camera requires [lng, lat] format
  const cameraCoordinate: [number, number] = [
    location.longitude,
    location.latitude,
  ];

  // Fetch data when sort mode, radius, or location availability changes
  useEffect(() => {
    if (location.loading) return;

    if (sortBy === 'distance') {
      fetchNearby();
    }
    // In 'storeys' mode the camera-change handler drives fetching
  }, [sortBy, radius, location.loading, fetchNearby]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        logoEnabled={false}
        onPress={handleMapPress}
        onCameraChanged={handleCameraChanged}
      >
        <Camera
          ref={cameraRef}
          centerCoordinate={cameraCoordinate}
          zoomLevel={13}
          animationMode="flyTo"
        />

        <ShapeSource
          id="blocks"
          shape={geojson}
          cluster
          clusterRadius={50}
          clusterMaxZoomLevel={14}
        >
          {/* Cluster background circles */}
          <CircleLayer
            id="clusters-bg"
            filter={['has', 'point_count']}
            style={{
              circleColor: '#2563EB',
              circleRadius: 18,
              circleOpacity: 0.9,
              circleStrokeWidth: 2,
              circleStrokeColor: '#fff',
            }}
          />

          {/* Cluster count labels */}
          <SymbolLayer
            id="clusters"
            filter={['has', 'point_count']}
            style={{
              textField: ['get', 'point_count'],
              textSize: 14,
              textColor: '#fff',
              textIgnorePlacement: true,
              textAllowOverlap: true,
            }}
          />

          {/* Individual block points — coloured circles by height tier */}
          <CircleLayer
            id="unclustered-points"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleColor: [
                'step',
                ['get', 'storeys'],
                '#4A90D9', // 1-10: blue
                11,
                '#FF9500', // 11-20: orange
                21,
                '#FF3B30', // 21-30: red
                31,
                '#8B0000', // 31+: dark red
              ],
              circleRadius: [
                'step',
                ['get', 'storeys'],
                7, // 1-10
                11,
                9, // 11-20
                21,
                11, // 21-30
                31,
                13, // 31+
              ],
              circleStrokeWidth: 1.5,
              circleStrokeColor: '#fff',
            }}
          />
        </ShapeSource>
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
});
