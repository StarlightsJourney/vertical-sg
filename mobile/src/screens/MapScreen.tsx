import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ScrollView,
  Switch,
  Animated,
} from 'react-native';
import {
  Map as MapView,
  Camera,
  GeoJSONSource,
  Layer,
  Images,
  type MapRef,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { useLocation } from '../hooks/useLocation';
import { supabase } from '../config/supabase';
import { fetchBlocksInBounds } from '../services/blocks';
import { logClimb, checkRecentBadges } from '../services/climbs';
import BadgeCelebration from '../components/BadgeCelebration';
import type { Block, BoundsRect, ClimbLog } from '../types';
import BlockDetailSheet from '../components/BlockDetailSheet';
import BuildingDetailSheet from '../components/BuildingDetailSheet';
import NotificationsModal from '../components/NotificationsModal';
import SearchScreen from '../components/SearchScreen';
import UserLocationRing from '../components/UserLocationRing';
import Ionicons from '@expo/vector-icons/Ionicons';
import storage from '../utils/storage';
import * as Linking from 'expo-linking';
import { useAuth } from '../contexts/AuthContext';

// Light (default) and dark map styles for day/night auto-switching
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LIGHT_STYLE = require('../../assets/map-style.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DARK_STYLE = require('../../assets/map-style-dark.json');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WATER_COOLERS_RAW: Array<{ name: string; lat: number; lng: number; status: string; level: string; temperature: string; operator: string }> = require('../../assets/water-coolers.json');
const AMENITIES_RAW: Array<{ name: string; lat: number; lng: number; type: string; category: string }> = require('../../assets/amenities.json');

// Default Singapore bounds for initial fetch before map camera settles
const SG_BOUNDS: BoundsRect = { sw: [103.6, 1.2], ne: [104.0, 1.48] };

/** Haversine distance in km between two lat/lng points. */
function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const HEIGHT_TIERS = [
  { label: '1–10', color: '#4A90D9' },
  { label: '11–20', color: '#FF9500' },
  { label: '21–30', color: '#FF3B30' },
  { label: '31–39', color: '#8B0000' },
  { label: '40+', color: '#7C3AED' },
] as const;

const FILTER_OPTIONS = [
  { value: 21, label: '21+' },
  { value: 31, label: '31+' },
  { value: 40, label: '40+' },
  { value: 0, label: 'All' },
] as const;

const FILTER_COLORS: Record<number, string> = { 21: '#FF3B30', 31: '#8B0000', 40: '#7C3AED', 0: '#6B7280' };

/** Bucket a building's storey count into the same 5 tiers as HEIGHT_TIERS. */
function tierIndex(storeys: number): number {
  if (storeys <= 10) return 0;
  if (storeys <= 20) return 1;
  if (storeys <= 30) return 2;
  if (storeys <= 39) return 3;
  return 4;
}

/** Slow-pulsing amber border, wrapped around a "Popular" suggested-climb card. */
function PulsingBorder({ children }: { children: React.ReactNode }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // borderColor can't animate on the native driver — animate opacity of a
  // solid-amber border overlay instead, which can.
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  return (
    <View style={mStyles.pulsingWrap}>
      {children}
      <Animated.View pointerEvents="none" style={[mStyles.pulsingBorder, { opacity }]} />
    </View>
  );
}

export default function MapScreen({ isDark: isDarkProp }: { isDark?: boolean }) {
  const location = useLocation();
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef<Block[]>([]);
  const zoomRef = useRef(13);
  const boundsRef = useRef<BoundsRect | null>(null);
  const prevBoundsRef = useRef<BoundsRect | null>(null);
  const { user, isAnonymous } = useAuth();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [selectedBlockDist, setSelectedBlockDist] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minFilter, setMinFilter] = useState(21);
  const [zoom, setZoom] = useState(13);
  const [searchVisible, setSearchVisible] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [placementType, setPlacementType] = useState<string | null>(null);
  const [placementCenter, setPlacementCenter] = useState<[number, number]>([103.8198, 1.3521]);
  const [descModalVisible, setDescModalVisible] = useState(false);
  const [descText, setDescText] = useState('');
  const [pendingReports, setPendingReports] = useState<Array<{ name: string; lat: number; lng: number; type: string; desc: string; at: string; status: string }>>([]);
  const [recentBlocks, setRecentBlocks] = useState<Block[]>([]);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [climbCounts, setClimbCounts] = useState<Map<string, number>>(new Map());
  const [climbHistory, setClimbHistory] = useState<ClimbLog[]>([]);
  const [celebratingBadges, setCelebratingBadges] = useState<string[]>([]);
  const [tapY, setTapY] = useState<number>(0);
  const [selectedWaterCooler, setSelectedWaterCooler] = useState<{
    name: string;
    type: string;
    lat: number;
    lng: number;
  } | null>(null);

  // Building detail sheet (expanded view)
  const [detailBlock, setDetailBlock] = useState<Block | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  // Notifications
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifVisible, setNotifVisible] = useState(false);

  // Saved (starred) buildings — full records, refetched whenever starredIds changes,
  // independent of whatever's currently in the viewport-scoped `blocks` state.
  const [savedBlocks, setSavedBlocks] = useState<Block[]>([]);

  // Map layers panel — amenity visibility toggles + shortcut to the height filter
  const [layersVisible, setLayersVisible] = useState(false);
  const [amenityVisibility, setAmenityVisibility] = useState({ water: true, toilet: true, foodShop: true });

  // Use prop if provided (from App.tsx tab bar), otherwise auto-detect
  const isDark = isDarkProp ?? (() => {
    const hour = new Date().getHours();
    return hour < 6 || hour >= 19;
  })();

  // Sync ref with state
  blocksRef.current = blocks;

  // Build GeoJSON FeatureCollection from blocks for the map source
  const geojson = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: blocks
      .filter((b) => b.lat != null && b.lng != null)
      .filter((b) => minFilter === 0 || (b.storeys != null && b.storeys >= minFilter))
      .map((b) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [b.lng!, b.lat!] as [number, number],
        },
        properties: {
          block_id: b.block_id,
          storeys: b.storeys,
          est_height_m: b.est_height_m,
          height_source: b.height_source,
          town: b.town,
          street: b.street,
          year_completed: b.year_completed,
          total_dwelling_units: b.total_dwelling_units,
          climbed: climbCounts.has(b.block_id),
        },
      })),
  }), [blocks, minFilter, climbCounts]);

  // Combined water coolers + amenities + pending reports as one native GeoJSON
  // source. No distance-sort/cap needed — GPU-rendered circle+symbol layers
  // handle hundreds of points fine, unlike the old per-point <Marker> views.
  const amenitiesGeojson = useMemo((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = [];

    if (amenityVisibility.water) {
      for (const wc of WATER_COOLERS_RAW) {
        if (!wc.lat || !wc.lng) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [wc.lng, wc.lat] },
          properties: {
            amenity_type: wc.status,
            icon: 'water-outline',
            color: wc.status === 'verified' ? '#06B6D4' : '#EC4899',
            pending: false,
            name: wc.name,
            lat: wc.lat,
            lng: wc.lng,
          },
        });
      }
    }

    for (const a of AMENITIES_RAW) {
      if (!a.lat || !a.lng) continue;
      const category = a.type === 'toilet' ? 'toilet' : 'foodShop';
      if (!amenityVisibility[category]) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
        properties: {
          amenity_type: a.type,
          icon: a.type === 'toilet' ? 'male-female-outline' : 'cafe-outline',
          color: a.type === 'toilet' ? '#8B5CF6' : '#F59E0B',
          pending: false,
          name: a.name,
          lat: a.lat,
          lng: a.lng,
        },
      });
    }

    for (const r of pendingReports) {
      if (!r.lat || !r.lng) continue;
      const category = r.type === 'Toilet' ? 'toilet' : r.type === 'Food / Shop' ? 'foodShop' : 'water';
      if (!amenityVisibility[category]) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          amenity_type: `unverified-${r.type}`,
          icon: r.type === 'Toilet' ? 'male-female-outline' : r.type === 'Food / Shop' ? 'cafe-outline' : 'water-outline',
          color: '#9CA3AF',
          pending: true,
          name: r.name,
          lat: r.lat,
          lng: r.lng,
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }, [pendingReports, amenityVisibility]);

  // Suggested climbs banner — nearest buildings, spread across as many different
  // height tiers as are available nearby, so the suggestions vary in difficulty
  // rather than just being "the 3 closest" (which tend to cluster in one tier).
  const recommendations = useMemo(() => {
    if (location.loading || location.latitude == null || blocks.length === 0) return [];
    const withDist = blocks
      .filter((b) => b.lat != null && b.lng != null)
      .map((b) => ({ block: b, dist: haversineKm(location.latitude, location.longitude, b.lat!, b.lng!) }))
      .sort((a, b) => a.dist - b.dist);

    const picked: typeof withDist = [];
    const alreadyPicked = (id: string) => picked.some((p) => p.block.block_id === id);

    // Reserve a slot each for 21-30, 31-39, and 40+ storeys first (the
    // buildings actually worth suggesting a climb for) — otherwise nearby
    // 1-10 storey blocks tend to crowd out the taller ones entirely.
    for (const tier of [2, 3, 4]) {
      const nearest = withDist.find((c) => tierIndex(c.block.storeys) === tier && !alreadyPicked(c.block.block_id));
      if (nearest) picked.push(nearest);
    }
    // Fill remaining slots (up to 5) with whatever's nearest overall.
    for (const cand of withDist) {
      if (picked.length === 5) break;
      if (alreadyPicked(cand.block.block_id)) continue;
      picked.push(cand);
    }

    return picked.sort((a, b) => a.dist - b.dist);
  }, [blocks, location.loading, location.latitude, location.longitude]);

  // Popularity per recommended block — distinct climbers, fetched only for the
  // handful of blocks currently shown in the banner. 0 climbers → "New";
  // several distinct people → "Popular" (an animated border, not just text,
  // since a plain badge blended into the rest of the card's chrome).
  const [recPopularity, setRecPopularity] = useState<Record<string, number>>({});
  const recIds = useMemo(() => recommendations.map((r) => r.block.block_id).sort().join(','), [recommendations]);

  useEffect(() => {
    if (recommendations.length === 0) { setRecPopularity({}); return; }
    const ids = recommendations.map((r) => r.block.block_id);
    supabase.from('climbs').select('block_id, user_id').in('block_id', ids).then(({ data }) => {
      if (!data) return;
      const climbersByBlock: Record<string, Set<string>> = {};
      for (const row of data as { block_id: string; user_id: string }[]) {
        (climbersByBlock[row.block_id] ??= new Set()).add(row.user_id);
      }
      const counts: Record<string, number> = {};
      for (const id of ids) counts[id] = climbersByBlock[id]?.size ?? 0;
      setRecPopularity(counts);
    });
  }, [recIds]);

  // Fetch blocks within visible map bounds
  const fetchBounds = useCallback(
    async (
      b: BoundsRect,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchBlocksInBounds({
          minLat: b.sw[1],
          minLng: b.sw[0],
          maxLat: b.ne[1],
          maxLng: b.ne[0],
          sortBy: 'storeys',
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

  // Debounced handler for map region changes: track bounds/zoom, fetch blocks
  const handleRegionDidChange = useCallback(
    (event: any) => {
      const ev = event.nativeEvent ?? event;
      const boundsArr = ev.bounds;
      const zoom = ev.zoom;

      if (boundsArr) {
        boundsRef.current = {
          sw: [boundsArr[0], boundsArr[1]],
          ne: [boundsArr[2], boundsArr[3]],
        };
      }
      if (ev.center) setPlacementCenter(ev.center as [number, number]);
      if (typeof zoom === 'number') {
        zoomRef.current = zoom;
        setZoom(zoom);
      }

      // Debounce: wait 600ms after last camera movement
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        if (boundsRef.current) {
          const cur = boundsRef.current;
          const prev = prevBoundsRef.current;
          const threshold = 0.003; // ~300m
          if (prev &&
            Math.abs(prev.ne[0] - cur.ne[0]) < threshold &&
            Math.abs(prev.ne[1] - cur.ne[1]) < threshold &&
            Math.abs(prev.sw[0] - cur.sw[0]) < threshold &&
            Math.abs(prev.sw[1] - cur.sw[1]) < threshold) {
            return; // Not enough movement — skip fetch
          }
          prevBoundsRef.current = cur;
          fetchBounds(cur);
        }
      }, 600);
    },
    [fetchBounds],
  );

  // Handle tap on map: show block detail sheet for tapped pin
  const handleMapPress = useCallback(async (event: any) => {
    const point = event.nativeEvent?.point;
    if (!point) return;

    const features = await mapRef.current?.queryRenderedFeatures(point);
    if (!features || features.length === 0) return;

    const props = features[0].properties ?? {};
    if (props.block_id) {
      const block = blocksRef.current.find(
        (b) => b.block_id === props.block_id,
      );
      if (block) {
        setSelectedBlock(block);
        setSelectedWaterCooler(null); // deselect any water cooler
        setTapY(point[1]);
        setRecentBlocks((prev) => {
          const filtered = prev.filter((b) => b.block_id !== block.block_id);
          return [block, ...filtered].slice(0, 10);
        });
        // Compute distance from user location
        if (block.lat != null && block.lng != null && location.latitude) {
          const km = haversineKm(
            location.latitude, location.longitude,
            block.lat, block.lng,
          );
          setSelectedBlockDist(km);
        } else {
          setSelectedBlockDist(null);
        }
      }
    } else if (props.amenity_type) {
      setSelectedWaterCooler({
        name: props.name,
        type: props.amenity_type,
        lat: props.lat,
        lng: props.lng,
      });
      setSelectedBlock(null); // deselect any building
    }
  }, [location.latitude, location.longitude]);

  const handleCloseDetail = useCallback(() => {
    setSelectedBlock(null);
    setSelectedBlockDist(null);
    setSelectedWaterCooler(null);
    setTapY(0);
  }, []);

  const handleViewDetails = useCallback((block: Block) => {
    setDetailBlock(block);
    setDetailVisible(true);
  }, []);

  const handleToggleStar = useCallback((block: Block) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(block.block_id)) next.delete(block.block_id);
      else next.add(block.block_id);
      storage.setItem('starred_blocks', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleLogClimb = useCallback(async (block: Block, qty: number, partialFloors: number) => {
    if (!user) return;

    await logClimb(
      user.id,
      block.block_id,
      block.blk_no,
      block.street,
      block.storeys,
      qty,
      partialFloors,
    );

    // Update local state immediately (optimistic)
    setClimbCounts((prev) => {
      const next = new Map(prev);
      next.set(block.block_id, (next.get(block.block_id) || 0) + qty);
      return next;
    });

    // Refresh climb history
    storage.getClimbHistory().then(setClimbHistory);

    // Show a celebration if this climb just earned a badge — the DB trigger
    // awards badges synchronously with the insert, so it's already there.
    checkRecentBadges(user.id).then((keys) => {
      if (keys.length > 0) setCelebratingBadges(keys);
    });
  }, [user]);

  const handleSelectSearchBlock = useCallback((block: Block) => {
    setSearchVisible(false);
    setSelectedBlock(block);
    if (block.lat != null && block.lng != null) {
      cameraRef.current?.flyTo({ center: [block.lng, block.lat], zoom: 16, duration: 800 });
    }
    setRecentBlocks((prev) => {
      const filtered = prev.filter((b) => b.block_id !== block.block_id);
      return [block, ...filtered].slice(0, 10);
    });
    if (block.lat != null && block.lng != null && location.latitude) {
      setSelectedBlockDist(haversineKm(location.latitude, location.longitude, block.lat, block.lng));
    }
  }, [location.latitude, location.longitude]);

  // Camera initial position [lng, lat]
  const cameraCenter: [number, number] = [
    location.longitude,
    location.latitude,
  ];

  // Fetch blocks when location is ready
  useEffect(() => {
    if (location.loading) return;
    if (boundsRef.current) {
      fetchBounds(boundsRef.current);
    } else {
      fetchBounds(SG_BOUNDS);
    }
  }, [location.loading, fetchBounds]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // Load pending reports + starred blocks from storage on mount
  useEffect(() => {
    storage.getItem('pending_reports').then((val) => {
      if (val) { try { setPendingReports(JSON.parse(val)); } catch {} }
    });
  }, []);

  // Load starred blocks from storage on mount
  useEffect(() => {
    storage.getItem('starred_blocks').then((val) => {
      if (val) {
        try { setStarredIds(new Set(JSON.parse(val))); } catch {}
      }
    });
  }, []);

  // Fetch full records for starred blocks (for the "Saved" row up top) whenever
  // the starred set changes — independent of the current viewport's `blocks`.
  useEffect(() => {
    if (starredIds.size === 0) {
      setSavedBlocks([]);
      return;
    }
    supabase
      .from('blocks')
      .select('*')
      .in('block_id', Array.from(starredIds))
      .then(({ data }) => {
        if (data) setSavedBlocks(data as Block[]);
      });
  }, [starredIds]);

  // Load climb history on mount
  useEffect(() => {
    storage.getClimbHistory().then((history) => {
      setClimbHistory(history);
      const counts = new Map<string, number>();
      history.forEach((c) => {
        counts.set(c.block_id, (counts.get(c.block_id) || 0) + 1);
      });
      setClimbCounts(counts);
    });
  }, []);

  // Poll unread notification count when authenticated
  useEffect(() => {
    if (!user || isAnonymous) return;
    const { getUnreadNotificationCount } = require('../services/climbs');
    const poll = () => {
      getUnreadNotificationCount(user.id).then((count: number) => setUnreadCount(count));
    };
    poll();
    const t = setInterval(poll, 30000); // every 30s
    return () => clearInterval(t);
  }, [user, isAnonymous]);


  // Cycling filter: find current index and label
  const currentFilterIdx = FILTER_OPTIONS.findIndex(f => f.value === minFilter);
  const currentLabel = FILTER_OPTIONS[currentFilterIdx]?.label ?? '21+';

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
        logo={false}
        compass={false}
        onPress={handleMapPress}
        onRegionDidChange={handleRegionDidChange}
        onRegionIsChanging={() => {
          if (selectedBlock) handleCloseDetail();
          if (selectedWaterCooler) setSelectedWaterCooler(null);
        }}
      >
        <Camera
          ref={cameraRef}
          center={cameraCenter}
          zoom={13}
          minZoom={10}
          maxBounds={[103.5, 1.15, 104.1, 1.5]}
          duration={500}
        />

        {/* Amenity icons — native circle+symbol layers (GPU-rendered, stay
            perfectly locked to the map during pan/zoom, unlike the old
            <Marker> views which were separate RN views repositioned over the
            bridge on every camera frame and visibly drifted/lagged behind). */}
        <Images
          images={{
            'water-outline': { source: require('../../assets/markers/water-outline.png'), sdf: true },
            'male-female-outline': { source: require('../../assets/markers/male-female-outline.png'), sdf: true },
            'cafe-outline': { source: require('../../assets/markers/cafe-outline.png'), sdf: true },
          }}
        />
        {zoom >= 11 && (
          <GeoJSONSource id="amenities" data={amenitiesGeojson}>
            <Layer id="amenity-bg" source="amenities" type="circle"
              paint={{
                'circle-radius': 10,
                'circle-color': '#FFFFFF',
                'circle-opacity': ['case', ['get', 'pending'], 0.85, 1],
                'circle-stroke-width': ['case', ['get', 'pending'], 1.5, 1],
                'circle-stroke-color': ['case', ['get', 'pending'], '#9CA3AF', '#FFFFFF'],
              }}
            />
            <Layer id="amenity-icon" source="amenities" type="symbol"
              layout={{
                'icon-image': ['get', 'icon'],
                'icon-size': 0.15,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
              paint={{
                'icon-color': ['get', 'color'],
              }}
            />
          </GeoJSONSource>
        )}

        {!location.loading && location.latitude != null && (
          <UserLocationRing longitude={location.longitude} latitude={location.latitude} />
        )}

        <GeoJSONSource
          id="blocks"
          data={geojson}
        >
          {/* Individual block pins — coloured circles by height tier */}
          <Layer
            id="block-pins"
            source="blocks"
            type="circle"
            paint={{
              'circle-color': [
                'step',
                ['get', 'storeys'],
                '#4A90D9', // 1-10: blue
                11,
                '#FF9500', // 11-20: orange
                21,
                '#FF3B30', // 21-30: red
                31,
                '#8B0000', // 31-39: dark red
                40,
                '#7C3AED', // 40+: purple
              ],
              'circle-radius': 5,
              'circle-stroke-width': [
                'case',
                ['get', 'climbed'],
                3,
                1.5,
              ],
              'circle-stroke-color': [
                'case',
                ['get', 'climbed'],
                '#F59E0B',
                '#ffffff',
              ],
              'circle-opacity': 0.85,
            }}
          />
        </GeoJSONSource>

      </MapView>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}

      {/* Strava-style top search bar */}
      <TouchableOpacity
        style={[styles.topSearchBar, { backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)' }]}
        onPress={() => setSearchVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="search" size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
        <Text style={styles.searchPlaceholder}>Search blocks...</Text>
        {!isAnonymous && user && (
          <TouchableOpacity
            style={mStyles.notifBellInline}
            onPress={(e) => { e.stopPropagation?.(); setNotifVisible(true); }}
            activeOpacity={0.7}
          >
            <Ionicons name="notifications-outline" size={20} color={isDark ? '#D1D5DB' : '#374151'} />
            {unreadCount > 0 && (
              <View style={mStyles.notifBadge}>
                <Text style={mStyles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* Saved buildings row — starred blocks, tap to fly the camera there */}
      {savedBlocks.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.savedRow}
          contentContainerStyle={styles.savedRowContent}
        >
          {savedBlocks.map((b) => (
            <TouchableOpacity
              key={b.block_id}
              style={[styles.savedChip, { backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)' }]}
              onPress={() => handleSelectSearchBlock(b)}
              activeOpacity={0.8}
            >
              <Ionicons name="star" size={13} color="#F59E0B" />
              <Text style={[styles.savedChipText, { color: isDark ? '#F9FAFB' : '#111827' }]}>
                Blk {b.blk_no} · {b.storeys}fl
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Right-side vertical icon stack: height filter, layers, alert/report, location */}
      <View style={styles.rightIconStack}>
        <TouchableOpacity
          style={[styles.stackBtn, { backgroundColor: FILTER_COLORS[minFilter] || '#6B7280' }]}
          onPress={() => {
            const next = (currentFilterIdx + 1) % FILTER_OPTIONS.length;
            setMinFilter(FILTER_OPTIONS[next].value);
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.filterToggleText}>{currentLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.stackBtn, { backgroundColor: '#6B7280' }]} onPress={() => setLayersVisible(true)} activeOpacity={0.8}>
          <Ionicons name="layers-outline" size={21} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.stackBtn, { backgroundColor: '#F59E0B' }]} onPress={() => setAlertVisible(true)} activeOpacity={0.8}>
          <Ionicons name="add-circle" size={21} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.stackBtn, { backgroundColor: '#2563EB' }]}
          onPress={() => {
            cameraRef.current?.easeTo({ center: cameraCenter, zoom: 15, duration: 500 });
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="locate" size={21} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Suggested climbs banner — just above the tab bar */}
      {recommendations.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.recBanner}
          contentContainerStyle={styles.recBannerContent}
        >
          {recommendations.map(({ block, dist }) => {
            const popularity = recPopularity[block.block_id] ?? 0;
            const isPopular = popularity >= 3;
            const isNew = block.block_id in recPopularity && popularity === 0;

            const card = (
              <TouchableOpacity
                key={block.block_id}
                style={[styles.recCard, { backgroundColor: isDark ? '#1F2937' : '#FFFFFF' }]}
                onPress={() => handleSelectSearchBlock(block)}
                activeOpacity={0.85}
              >
                {isNew && (
                  <View style={styles.recBadgeNew}>
                    <Text style={styles.recBadgeNewText}>NEW</Text>
                  </View>
                )}
                {isPopular && (
                  <View style={styles.recBadgePopular}>
                    <Ionicons name="flame" size={11} color="#FFFFFF" />
                    <Text style={styles.recBadgePopularText}>Popular</Text>
                  </View>
                )}
                <View style={[styles.recCardDot, { backgroundColor: HEIGHT_TIERS[tierIndex(block.storeys)].color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.recCardTitle, { color: isDark ? '#F9FAFB' : '#111827' }]} numberOfLines={1}>
                    Blk {block.blk_no} {block.street}
                  </Text>
                  <Text style={styles.recCardMeta}>
                    {block.storeys} storeys · {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`} away
                  </Text>
                </View>
              </TouchableOpacity>
            );

            return isPopular ? <PulsingBorder key={block.block_id}>{card}</PulsingBorder> : card;
          })}
        </ScrollView>
      )}

      {/* Placement mode: crosshair + confirm */}
      {placementType && (
        <>
          {/* Crosshair — thin lines */}
          <View style={styles.crosshair} pointerEvents="none">
            <View style={styles.crosshairLineH} />
            <View style={styles.crosshairLineV} />
          </View>
          {/* Confirm / Cancel buttons */}
          <View style={styles.placementBar}>
            <Text style={styles.placementLabel}>Place {placementType}</Text>
            <View style={styles.placementButtons}>
              <TouchableOpacity style={styles.placementCancel} onPress={() => setPlacementType(null)}>
                <Text style={styles.placementCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.placementConfirm} onPress={() => setDescModalVisible(true)}>
                <Text style={styles.placementConfirmText}>Confirm Location</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* Description modal — same rounded-card pattern as the alert/report and layers pop-ups */}
      <Modal visible={descModalVisible} transparent animationType="fade" onRequestClose={() => setDescModalVisible(false)}>
        <View style={styles.alertBackdrop}>
          <View style={[styles.alertGrid, isDark && { backgroundColor: '#1F2937' }]}>
            <Text style={[styles.alertGridTitle, { marginBottom: 8, textAlign: 'left' }, isDark && { color: '#F9FAFB' }]}>
              New {placementType}
            </Text>
            <Text style={[styles.descModalHint, isDark && { color: '#9CA3AF' }]}>
              This will appear as unverified until confirmed by the community.
            </Text>
            <TextInput
              style={[styles.descModalInput, isDark && { backgroundColor: '#111827', color: '#F9FAFB' }]}
              placeholder='e.g. "Level 1 void deck, near lift B"'
              placeholderTextColor="#9CA3AF"
              value={descText}
              onChangeText={setDescText}
              maxLength={120}
            />
            <View style={styles.descModalActions}>
              <TouchableOpacity
                style={[styles.descModalSkipBtn, isDark && { backgroundColor: '#374151' }]}
                onPress={() => { setDescModalVisible(false); setDescText(''); }}
              >
                <Text style={[styles.descModalSkipText, isDark && { color: '#D1D5DB' }]}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.descModalSubmitBtn}
                onPress={async () => {
                  const [lng, lat] = placementCenter;
                  const newReport = {
                    name: descText ? `${placementType}: ${descText.slice(0, 40)}` : (placementType ?? ''),
                    lat, lng,
                    type: placementType!,
                    desc: descText,
                    at: new Date().toISOString(),
                    status: 'pending',
                  };
                  // Store locally
                  const existing = await storage.getItem('pending_reports');
                  const reports: typeof pendingReports = existing ? JSON.parse(existing) : [];
                  reports.push(newReport);
                  await storage.setItem('pending_reports', JSON.stringify(reports));
                  setPendingReports(reports);
                  setPlacementType(null);
                  setDescModalVisible(false);
                  setDescText('');
                  Alert.alert('Reported', `${placementType} submitted as unverified. Visible immediately.`);
                }}
              >
                <Text style={styles.descModalSubmitText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Block Detail Sheet overlay */}
      <BlockDetailSheet
        block={selectedBlock}
        distanceKm={selectedBlockDist}
        onLogClimb={handleLogClimb}
        onViewDetails={handleViewDetails}
        tapY={tapY}
        isDark={isDark}
      />

      {/* Building Detail Sheet (expanded view) */}
      <BuildingDetailSheet
        block={detailBlock}
        visible={detailVisible}
        onClose={() => { setDetailVisible(false); setDetailBlock(null); }}
      />

      {/* Notifications modal */}
      <NotificationsModal
        visible={notifVisible}
        onClose={() => setNotifVisible(false)}
        isDark={isDark}
      />

      {/* Badge celebration toast — pops up right after a climb earns one */}
      {celebratingBadges.length > 0 && (
        <BadgeCelebration
          badgeKeys={celebratingBadges}
          onDismiss={() => setCelebratingBadges([])}
        />
      )}

      {/* Amenity info card — tiny, near tap, doesn't block panning */}
      {selectedWaterCooler && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }} pointerEvents="box-none">
          <View style={{
            position: 'absolute',
            top: Math.max(60, (tapY || 300) - 80),
            left: '50%',
            transform: [{ translateX: -100 }],
            width: 200,
            backgroundColor: 'rgba(255,255,255,0.92)',
            borderRadius: 12,
            padding: 10,
            alignItems: 'center',
            elevation: 6,
          }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color:
              selectedWaterCooler.type?.startsWith('unverified-') ? '#F59E0B' :
              selectedWaterCooler.type === 'toilet' ? '#8B5CF6' :
              selectedWaterCooler.type === 'shop' ? '#F59E0B' :
              selectedWaterCooler.type === 'verified' ? '#06B6D4' :
              selectedWaterCooler.type === 'unverified' ? '#EC4899' : '#F59E0B'
            }}>
              {selectedWaterCooler.type?.startsWith('unverified-') ? `✗ Unverified ${selectedWaterCooler.type.replace('unverified-', '')}` :
               selectedWaterCooler.type === 'toilet' ? 'Toilet' :
               selectedWaterCooler.type === 'shop' ? 'Food / Shop' :
               selectedWaterCooler.type === 'verified' ? '✓ Verified Water Cooler' :
               selectedWaterCooler.type === 'unverified' ? '✗ Unverified Water Cooler' : 'Water Cooler'}
            </Text>
            {selectedWaterCooler.name && (
              <Text style={{ fontSize: 10, color: '#6B7280', marginTop: 4, textAlign: 'center' }} numberOfLines={2}>
                {selectedWaterCooler.name}
              </Text>
            )}
            <TouchableOpacity style={{ marginTop: 6 }}
              onPress={() => {
                const { lat, lng } = selectedWaterCooler;
                if (lat && lng) {
                  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
                }
              }}>
              <Text style={{ fontSize: 11, color: '#2563EB', fontWeight: '600' }}>Get Directions ↗</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Search screen */}
      <SearchScreen
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSelectBlock={handleSelectSearchBlock}
        recentBlocks={recentBlocks}
        starredBlockIds={starredIds}
        onToggleStar={handleToggleStar}
        isDark={isDark}
        climbHistory={climbHistory}
      />

      {/* Alert/Report modal — centered icon grid */}
      <Modal visible={alertVisible} transparent animationType="fade" onRequestClose={() => setAlertVisible(false)}>
        <TouchableOpacity style={styles.alertBackdrop} onPress={() => setAlertVisible(false)} activeOpacity={1}>
          <View style={[styles.alertGrid, isDark && { backgroundColor: '#1F2937' }]}>
            <Text style={[styles.alertGridTitle, isDark && { color: '#F9FAFB' }]}>Report nearby...</Text>
            <View style={styles.alertGridItems}>
              {[
                { icon: 'water-outline', label: 'Water Cooler', color: '#06B6D4' },
                { icon: 'male-female-outline', label: 'Toilet', color: '#8B5CF6' },
                { icon: 'cafe-outline', label: 'Food / Shop', color: '#F59E0B' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.alertGridItem, { backgroundColor: item.color + (isDark ? '1F' : '15') }]}
                  onPress={() => {
                    setAlertVisible(false);
                    setPlacementType(item.label);
                  }}
                >
                  <Ionicons name={item.icon as any} size={26} color={item.color} />
                  <Text style={[styles.alertGridLabel, isDark && { color: '#D1D5DB' }]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Layers panel — amenity visibility toggles + building height legend/filter */}
      <Modal visible={layersVisible} transparent animationType="fade" onRequestClose={() => setLayersVisible(false)}>
        <TouchableOpacity style={styles.alertBackdrop} onPress={() => setLayersVisible(false)} activeOpacity={1}>
          <TouchableOpacity activeOpacity={1} style={[styles.layersPanel, isDark && { backgroundColor: '#1F2937' }]}>
            <Text style={[styles.alertGridTitle, isDark && { color: '#F9FAFB' }]}>Map Layers</Text>

            <Text style={[styles.layersSectionLabel, isDark && { color: '#9CA3AF' }]}>Amenities</Text>
            {[
              { key: 'water' as const, icon: 'water-outline', label: 'Water Coolers', color: '#06B6D4' },
              { key: 'toilet' as const, icon: 'male-female-outline', label: 'Toilets', color: '#8B5CF6' },
              { key: 'foodShop' as const, icon: 'cafe-outline', label: 'Food / Shop', color: '#F59E0B' },
            ].map((item) => (
              <View key={item.key} style={styles.layersRow}>
                <Ionicons name={item.icon as any} size={18} color={item.color} style={{ marginRight: 10 }} />
                <Text style={[styles.layersRowLabel, isDark && { color: '#F9FAFB' }]}>{item.label}</Text>
                <Switch
                  value={amenityVisibility[item.key]}
                  onValueChange={(val) => setAmenityVisibility((prev) => ({ ...prev, [item.key]: val }))}
                  trackColor={{ true: item.color }}
                />
              </View>
            ))}

            <Text style={[styles.layersSectionLabel, isDark && { color: '#9CA3AF' }, { marginTop: 16 }]}>Building Height</Text>
            <View style={styles.layersFilterRow}>
              {FILTER_OPTIONS.map((f) => (
                <TouchableOpacity
                  key={f.value}
                  style={[
                    styles.layersFilterChip,
                    { borderColor: FILTER_COLORS[f.value] },
                    minFilter === f.value && { backgroundColor: FILTER_COLORS[f.value] },
                  ]}
                  onPress={() => setMinFilter(f.value)}
                >
                  <Text style={[styles.layersFilterChipText, { color: minFilter === f.value ? '#FFFFFF' : FILTER_COLORS[f.value] }]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.legendWrap}>
              {HEIGHT_TIERS.map((t) => (
                <View key={t.label} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: t.color }]} />
                  <Text style={[styles.legendLabel, { color: isDark ? '#D1D5DB' : '#374151' }]}>{t.label} storeys</Text>
                </View>
              ))}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
    top: 52,
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
  // Strava-style top search bar
  topSearchBar: {
    position: 'absolute',
    top: 52,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    zIndex: 10,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  searchPlaceholder: {
    fontSize: 15,
    color: '#9CA3AF',
    flex: 1,
  },

  // Saved buildings row, directly under the search bar
  savedRow: {
    position: 'absolute',
    top: 104,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  savedRowContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  savedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  savedChipText: {
    fontSize: 12.5,
    fontWeight: '600',
  },

  // Cycling height filter chip text — button itself now lives in the right icon stack
  filterToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Right-side vertical icon stack (height filter / layers / alert / location)
  rightIconStack: {
    position: 'absolute',
    right: 16,
    bottom: 112,
    zIndex: 10,
    gap: 10,
  },
  stackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },

  // Suggested climbs banner, just above the tab bar
  recBanner: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 8,
    zIndex: 10,
  },
  recBannerContent: {
    paddingHorizontal: 16,
    paddingTop: 16, // room for the NEW/Popular badges overhanging the card's top edge
    gap: 12,
  },
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 210,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  recBadgeNew: {
    position: 'absolute',
    top: -9,
    left: 10,
    backgroundColor: '#10B981',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    elevation: 3,
  },
  recBadgeNewText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  recBadgePopular: {
    position: 'absolute',
    top: -9,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F59E0B',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    elevation: 3,
  },
  recBadgePopularText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  recCardDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  recCardTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  recCardMeta: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
    fontWeight: '500',
  },

  // Layers panel (modal)
  layersPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 360,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  layersSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  layersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  layersRowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  layersFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  layersFilterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  layersFilterChipText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  legendWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
    marginBottom: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendLabel: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Alert button — in bottom bar, amber to distinguish from blue location button
  alertBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },

  // Alert/report modal — centered icon grid
  alertBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertGrid: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '80%',
    maxWidth: 320,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  alertGridTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 20,
  },
  alertGridItems: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  alertGridItem: {
    width: 90,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  alertGridLabel: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    fontWeight: '500',
  },

  // Description modal (new amenity) — reuses alertGrid/alertBackdrop as the card shell
  descModalHint: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 16,
    lineHeight: 18,
  },
  descModalInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
    color: '#111827',
    marginBottom: 16,
  },
  descModalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  descModalSkipBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  descModalSkipText: {
    fontWeight: '600',
    color: '#6B7280',
  },
  descModalSubmitBtn: {
    flex: 2,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
  },
  descModalSubmitText: {
    fontWeight: '700',
    color: '#FFF',
  },

  // Placement mode
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    zIndex: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  crosshairLineH: {
    position: 'absolute',
    width: 24,
    height: 2,
    backgroundColor: '#EF4444',
    borderRadius: 1,
  },
  crosshairLineV: {
    position: 'absolute',
    width: 2,
    height: 24,
    backgroundColor: '#EF4444',
    borderRadius: 1,
  },
  placementBar: {
    position: 'absolute',
    top: 210,
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    zIndex: 15,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  placementLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
    textAlign: 'center',
  },
  placementButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  placementCancel: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  placementCancelText: {
    fontWeight: '600',
    color: '#6B7280',
    fontSize: 14,
  },
  placementConfirm: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
  },
  placementConfirmText: {
    fontWeight: '700',
    color: '#FFFFFF',
    fontSize: 14,
  },
});

// Shared marker styles — small fixed size, no zoom deps
const mStyles = StyleSheet.create({
  // Pulsing "Popular" border around a suggested-climb card
  pulsingWrap: {
    position: 'relative',
  },
  pulsingBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: '#F59E0B',
  },

  // Notification bell, inline at the right edge of the top search bar
  notifBellInline: {
    position: 'relative',
    marginLeft: 8,
    padding: 2,
  },
  notifBadge: {
    position: 'absolute',
    top: 0,
    right: -2,
    backgroundColor: '#EF4444',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
