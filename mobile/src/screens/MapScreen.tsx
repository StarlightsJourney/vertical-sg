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
import type { Block, BoundsRect, ClimbLog, Challenge } from '../types';
import BlockDetailSheet from '../components/BlockDetailSheet';
import BuildingDetailSheet from '../components/BuildingDetailSheet';
import NotificationsModal from '../components/NotificationsModal';
import SearchScreen from '../components/SearchScreen';
import UserLocationRing from '../components/UserLocationRing';
import ChallengeDetailModal from '../components/ChallengeDetailModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import storage from '../utils/storage';
import * as Linking from 'expo-linking';
import { useAuth } from '../contexts/AuthContext';
import { displayChallengeTitle, displayChallengeDescription } from '../utils/challengeDisplay';

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

// Mirrors HEIGHT_TIERS[2..4] so the height-filter chips use the same ramp as
// the legend/map (0 = "All" stays neutral gray, it isn't part of the ramp).
const FILTER_COLORS: Record<number, string> = {
  21: HEIGHT_TIERS[2].color,
  31: HEIGHT_TIERS[3].color,
  40: HEIGHT_TIERS[4].color,
  0: '#6B7280',
};
const MAP_DIFFICULTY_COLOR: Record<string, string> = { easy: '#10B981', medium: '#F59E0B', hard: '#EF4444', insane: '#7C3AED' };

/**
 * A verifiable amenity pin shown in the detail/verify popup — either a
 * user-submitted report backed by the `amenity_reports` table (`report_id`
 * set, `static_key` unset), or a static/bundled JSON entry (e.g. from
 * assets/water-coolers.json) backed by `static_amenity_status` instead
 * (`static_key` set, `report_id` == '', `reporter_id` == null since nobody
 * "submitted" it — there's no self-verification case to guard for these).
 */
type AmenityReport = {
  report_id: string;
  static_key?: string;
  reporter_id: string | null;
  name: string;
  lat: number;
  lng: number;
  type: string;
  desc: string;
  status: string;
  verified_count: number;
  at: string;
};

/**
 * Deterministic, stable identifier for a *static* (bundled JSON) amenity —
 * these aren't DB rows and have no real UUID, so the key is derived from the
 * entry's own data instead: type + name + lat/lng rounded to 4dp (~11m),
 * which stays stable across app loads/reloads of the same JSON while still
 * being effectively unique per entry.
 */
function staticAmenityKey(type: string, name: string, lat: number, lng: number): string {
  return `${type}|${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
}

/** Top (most-liked, tie-broken by most recent) comment on an amenity report. */
type AmenityComment = {
  comment_id: string;
  user_id: string;
  body: string;
  like_count: number;
  created_at: string;
};

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

export default function MapScreen({ isDark: isDarkProp, onNavigateToSocial, isActive }: { isDark?: boolean; onNavigateToSocial?: () => void; isActive?: boolean }) {
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
  const [pendingReports, setPendingReports] = useState<AmenityReport[]>([]);
  // Live verification state for static/bundled amenity entries (keyed by
  // staticAmenityKey), loaded from static_amenity_status — small table,
  // loaded in full the same way pendingReports is. Absence of a key here
  // just means "no one has verified it yet", so the JSON's own baked-in
  // status is used as the fallback (see amenitiesGeojson below).
  const [staticAmenityStatus, setStaticAmenityStatus] = useState<Map<string, { verified_count: number; status: string }>>(new Map());

  // Amenity report detail popup — tapping a reported (DB-backed) amenity pin
  // opens this instead of the plain read-only selectedWaterCooler card, since
  // reports support verification + comments.
  const [selectedReport, setSelectedReport] = useState<AmenityReport | null>(null);
  const [hasVerifiedSelected, setHasVerifiedSelected] = useState(false);
  const [reportTopComment, setReportTopComment] = useState<AmenityComment | null>(null);
  // Total comment count on the currently open report — shown alongside the
  // single top comment so "most helpful" is a legible, verifiable claim
  // ("+N more comments") rather than just one comment appearing from nowhere.
  const [reportCommentCount, setReportCommentCount] = useState(0);
  const [hasLikedTopComment, setHasLikedTopComment] = useState(false);
  const [reportCommentText, setReportCommentText] = useState('');
  const [reportActionLoading, setReportActionLoading] = useState(false);
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
  const [amenityVisibility, setAmenityVisibility] = useState({ water: true, toilet: true, foodShop: true, unverified: true });

  // Challenges the user has joined and not yet completed — surfaced here too,
  // not just on Social/Groups, so progress is visible while you're actually
  // out climbing.
  const [myActiveChallenges, setMyActiveChallenges] = useState<(Challenge & { progressFloors: number })[]>([]);
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);

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
        // This curated dataset (assets/water-coolers.json) predates the
        // user-submitted amenity_reports table and has its own unverified
        // entries too (scraped, never confirmed). Its *effective* status
        // prefers the live static_amenity_status row (populated once anyone
        // taps "Verify this exists" on it) over the JSON's own baked-in
        // status, so a static entry doesn't stay unverified forever.
        const key = staticAmenityKey('Water Cooler', wc.name, wc.lat, wc.lng);
        const live = staticAmenityStatus.get(key);
        const effectiveStatus = live?.status ?? wc.status;
        const isVerified = effectiveStatus === 'verified';
        // The "Unverified Reports" Layers toggle below needs to hide these
        // the same way it hides unverified community reports, not just the
        // new DB-backed ones.
        if (!isVerified && !amenityVisibility.unverified) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [wc.lng, wc.lat] },
          properties: {
            amenity_type: effectiveStatus,
            icon: 'water-outline',
            color: isVerified ? '#06B6D4' : '#EC4899',
            pending: !isVerified,
            name: wc.name,
            lat: wc.lat,
            lng: wc.lng,
            static_key: key,
            static_type: 'Water Cooler',
            status: effectiveStatus,
            verified_count: live?.verified_count ?? 0,
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
      const isVerified = r.status === 'verified';
      // Hide/show unverified toggle only affects reports still awaiting the
      // 3 corroborating verifications — verified ones stay on regardless.
      if (!isVerified && !amenityVisibility.unverified) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          // Preserve the existing `unverified-` prefixed amenity_type styling
          // hook, now driven by the real `status` column instead of always
          // being unverified.
          amenity_type: isVerified ? r.type : `unverified-${r.type}`,
          icon: r.type === 'Toilet' ? 'male-female-outline' : r.type === 'Food / Shop' ? 'cafe-outline' : 'water-outline',
          color: isVerified
            ? (r.type === 'Toilet' ? '#8B5CF6' : r.type === 'Food / Shop' ? '#F59E0B' : '#06B6D4')
            : '#9CA3AF',
          pending: !isVerified,
          name: r.name,
          lat: r.lat,
          lng: r.lng,
          report_id: r.report_id,
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }, [pendingReports, amenityVisibility, staticAmenityStatus]);

  // Tall buildings (21+ storeys) across all of Singapore, fetched once —
  // `blocks` is scoped to whatever's currently on screen, so if there's no
  // 31-39 or 40+ storey block in the visible viewport, recommendations would
  // never surface one even though plenty exist elsewhere in the country.
  // This gives the picker something to fall back on regardless of where the
  // user currently has the map panned to.
  const [tallBlocksPool, setTallBlocksPool] = useState<Block[]>([]);
  useEffect(() => {
    fetchBlocksInBounds({
      minLat: SG_BOUNDS.sw[1], minLng: SG_BOUNDS.sw[0],
      maxLat: SG_BOUNDS.ne[1], maxLng: SG_BOUNDS.ne[0],
      sortBy: 'storeys', limit: 300,
    }).then((data) => setTallBlocksPool(data.filter((b) => b.storeys >= 21))).catch(() => {});
  }, []);

  // Suggested climbs banner — nearest buildings, but guaranteeing at least one
  // each from the 21-30/31-39/40+ tiers (using the nationwide pool above if
  // none are in the current viewport), and otherwise avoiding same-storeys
  // duplicates so the 5 suggestions actually vary instead of clustering.
  const recommendations = useMemo(() => {
    if (location.loading || location.latitude == null) return [];
    const seen = new Set<string>();
    const pool = [...blocks, ...tallBlocksPool].filter((b) => {
      if (seen.has(b.block_id) || b.lat == null || b.lng == null) return false;
      seen.add(b.block_id);
      return true;
    });
    if (pool.length === 0) return [];

    const withDist = pool
      .map((b) => ({ block: b, dist: haversineKm(location.latitude, location.longitude, b.lat!, b.lng!) }))
      .sort((a, b) => a.dist - b.dist);

    const picked: typeof withDist = [];
    const usedStoreys = new Set<number>();
    const alreadyPicked = (id: string) => picked.some((p) => p.block.block_id === id);

    // Reserve a slot each for 21-30, 31-39, and 40+ storeys first (the
    // buildings actually worth suggesting a climb for) — otherwise nearby
    // 1-10 storey blocks tend to crowd out the taller ones entirely.
    for (const tier of [2, 3, 4]) {
      const nearest = withDist.find((c) => tierIndex(c.block.storeys) === tier && !alreadyPicked(c.block.block_id));
      if (nearest) { picked.push(nearest); usedStoreys.add(nearest.block.storeys); }
    }
    // Fill remaining slots (up to 5), preferring a storeys count not already used.
    for (const cand of withDist) {
      if (picked.length === 5) break;
      if (alreadyPicked(cand.block.block_id) || usedStoreys.has(cand.block.storeys)) continue;
      picked.push(cand);
      usedStoreys.add(cand.block.storeys);
    }
    // Still short (e.g. very little variety nearby)? Allow duplicates to fill out.
    for (const cand of withDist) {
      if (picked.length === 5) break;
      if (alreadyPicked(cand.block.block_id)) continue;
      picked.push(cand);
    }

    return picked.sort((a, b) => a.dist - b.dist);
  }, [blocks, tallBlocksPool, location.loading, location.latitude, location.longitude]);

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

  // Load (or reload) all shared amenity reports from Supabase. Small,
  // Singapore-scoped dataset — fetched in full on mount and after any
  // report/verify/comment mutation, the same way the static water-cooler
  // and amenities JSON is loaded wholesale rather than bounds-filtered.
  const loadAmenityReports = useCallback(async () => {
    const { data, error } = await supabase
      .from('amenity_reports')
      .select('report_id, reporter_id, name, lat, lng, type, desc, status, verified_count, created_at');
    if (error) {
      console.error('Error fetching amenity reports:', error.message);
      return;
    }
    setPendingReports(
      (data ?? []).map((r: any) => ({
        report_id: r.report_id,
        reporter_id: r.reporter_id,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        type: r.type,
        desc: r.desc,
        status: r.status,
        verified_count: r.verified_count,
        at: r.created_at,
      })),
    );
  }, []);

  // Load (or reload) live verification state for static/bundled amenity
  // entries. Small table (only ever has a row once someone's verified that
  // entry at least once) — fetched in full, same as loadAmenityReports.
  const loadStaticAmenityStatus = useCallback(async () => {
    const { data, error } = await supabase
      .from('static_amenity_status')
      .select('amenity_key, verified_count, status');
    if (error) {
      console.error('Error fetching static amenity status:', error.message);
      return;
    }
    setStaticAmenityStatus(
      new Map((data ?? []).map((r: any) => [r.amenity_key, { verified_count: r.verified_count, status: r.status }])),
    );
  }, []);

  // Open the verify popup for a tapped *static* (bundled JSON) amenity —
  // same shape as openReportDetail below, minus the comment fetch, since
  // static entries aren't backed by an amenity_reports row and have no
  // amenity_comments to load.
  const openStaticAmenityDetail = useCallback(async (entry: AmenityReport) => {
    setSelectedReport(entry);
    setReportCommentText('');
    setReportTopComment(null);
    setReportCommentCount(0);
    setHasVerifiedSelected(false);
    setHasLikedTopComment(false);

    if (user && entry.static_key) {
      const { data: verifRow } = await supabase
        .from('static_amenity_verifications')
        .select('amenity_key')
        .eq('amenity_key', entry.static_key)
        .eq('user_id', user.id)
        .maybeSingle();
      setHasVerifiedSelected(!!verifRow);
    }
  }, [user]);

  // Open the verify/comment popup for a tapped amenity report, fetching the
  // caller's own verification/like state plus the single highest-liked
  // comment (ties broken by most recent) for that report.
  const openReportDetail = useCallback(async (report: AmenityReport) => {
    setSelectedReport(report);
    setReportCommentText('');
    setReportTopComment(null);
    setReportCommentCount(0);
    setHasVerifiedSelected(false);
    setHasLikedTopComment(false);

    if (user) {
      const { data: verifRow } = await supabase
        .from('amenity_report_verifications')
        .select('report_id')
        .eq('report_id', report.report_id)
        .eq('user_id', user.id)
        .maybeSingle();
      setHasVerifiedSelected(!!verifRow);
    }

    // Fetch the single highest-liked comment (ties broken by most recent)
    // alongside a plain count(*) of every comment on this report — the
    // count is what makes "most helpful comment" a legible, checkable claim
    // in the UI instead of one comment appearing with no context.
    const [{ data: comments }, { count }] = await Promise.all([
      supabase
        .from('amenity_comments')
        .select('comment_id, user_id, body, like_count, created_at')
        .eq('report_id', report.report_id)
        .order('like_count', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('amenity_comments')
        .select('comment_id', { count: 'exact', head: true })
        .eq('report_id', report.report_id),
    ]);

    const top = (comments?.[0] as AmenityComment | undefined) ?? null;
    setReportTopComment(top);
    setReportCommentCount(count ?? 0);

    if (top && user) {
      const { data: likeRow } = await supabase
        .from('amenity_comment_likes')
        .select('comment_id')
        .eq('comment_id', top.comment_id)
        .eq('user_id', user.id)
        .maybeSingle();
      setHasLikedTopComment(!!likeRow);
    }
  }, [user]);

  const handleVerifyReport = useCallback(async () => {
    if (!selectedReport || !user || reportActionLoading) return;
    setReportActionLoading(true);
    try {
      // Static (bundled JSON) entries route to verify_static_amenity instead
      // of verify_amenity_report — same 3-confirmation mechanism, different
      // backing tables since static entries have no amenity_reports row.
      const isStatic = !!selectedReport.static_key;
      const { error } = isStatic
        ? await supabase.rpc('verify_static_amenity', { p_amenity_key: selectedReport.static_key })
        : await supabase.rpc('verify_amenity_report', { p_report_id: selectedReport.report_id });
      if (error) {
        Alert.alert('Could not verify', error.message);
        return;
      }
      setHasVerifiedSelected(true);
      setSelectedReport((prev) => {
        if (!prev) return prev;
        const verified_count = prev.verified_count + 1;
        return { ...prev, verified_count, status: verified_count >= 3 ? 'verified' : prev.status };
      });
      if (isStatic) {
        await loadStaticAmenityStatus();
      } else {
        await loadAmenityReports();
      }
    } finally {
      setReportActionLoading(false);
    }
  }, [selectedReport, user, reportActionLoading, loadAmenityReports, loadStaticAmenityStatus]);

  const handleSubmitReportComment = useCallback(async () => {
    if (!selectedReport || !user || !reportCommentText.trim() || reportActionLoading) return;
    setReportActionLoading(true);
    try {
      const { error } = await supabase.from('amenity_comments').insert({
        report_id: selectedReport.report_id,
        user_id: user.id,
        body: reportCommentText.trim(),
      });
      if (error) {
        Alert.alert('Could not post comment', error.message);
        return;
      }
      await openReportDetail(selectedReport);
    } finally {
      setReportActionLoading(false);
    }
  }, [selectedReport, user, reportCommentText, reportActionLoading, openReportDetail]);

  const handleToggleCommentLike = useCallback(async () => {
    if (!reportTopComment || !user || !selectedReport || reportActionLoading) return;
    setReportActionLoading(true);
    try {
      const { error } = await supabase.rpc('toggle_amenity_comment_like', { p_comment_id: reportTopComment.comment_id });
      if (error) {
        Alert.alert('Could not update like', error.message);
        return;
      }
      await openReportDetail(selectedReport);
    } finally {
      setReportActionLoading(false);
    }
  }, [reportTopComment, user, selectedReport, reportActionLoading, openReportDetail]);

  // Let a user remove a report they created themselves — asks for
  // confirmation first since this can't be undone, then relies on the
  // "auth.uid() = reporter_id" delete policy in phase2a_addendum24.sql to
  // enforce server-side that only the reporter can actually delete it.
  const handleDeleteReport = useCallback(() => {
    if (!selectedReport || !user || selectedReport.reporter_id !== user.id) return;
    const reportId = selectedReport.report_id;
    Alert.alert(
      'Remove this report?',
      'This removes it for everyone, along with any verifications and comments on it. This can\'t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setReportActionLoading(true);
            try {
              const { error } = await supabase.from('amenity_reports').delete().eq('report_id', reportId);
              if (error) {
                Alert.alert('Could not remove report', error.message);
                return;
              }
              setSelectedReport(null);
              await loadAmenityReports();
            } finally {
              setReportActionLoading(false);
            }
          },
        },
      ],
    );
  }, [selectedReport, user, loadAmenityReports]);

  // Handle tap on map: show block detail sheet for tapped pin
  const handleMapPress = useCallback(async (event: any) => {
    const point = event.nativeEvent?.point;
    if (!point) return;

    // Scope the hit-test to our own interactive layers only. Querying with
    // no `layers` filter (the old behaviour) hits every rendered layer,
    // including the base map style's own building-footprint/POI/label
    // layers underneath — those can easily win the top slot at the tapped
    // pixel and silently swallow a tap that was clearly aimed at an
    // amenity/report pin (this was the root cause of "tapping an unverified
    // pin doesn't reliably open the popup"). Also scan the whole result
    // array rather than just features[0]: the amenity source renders two
    // stacked layers per point (circle background + icon), and whichever
    // one happens to sort first shouldn't matter.
    const features = await mapRef.current?.queryRenderedFeatures(point, {
      layers: ['block-pins', 'amenity-bg', 'amenity-icon'],
    });
    if (!features || features.length === 0) return;

    const byBlockId = features.find((f) => f.properties?.block_id)?.properties;
    const byReportId = features.find((f) => f.properties?.report_id)?.properties;
    // Static (bundled JSON) amenities carry both `static_key` and
    // `amenity_type` — check static_key first so these route to the
    // verify popup rather than falling through to the plain read-only card.
    const byStaticKey = features.find((f) => f.properties?.static_key)?.properties;
    const byAmenityType = features.find((f) => f.properties?.amenity_type)?.properties;
    const props = byBlockId ?? byReportId ?? byStaticKey ?? byAmenityType ?? {};
    if (props.block_id) {
      const block = blocksRef.current.find(
        (b) => b.block_id === props.block_id,
      );
      if (block) {
        setSelectedBlock(block);
        setSelectedWaterCooler(null); // deselect any water cooler
        setSelectedReport(null); // deselect any amenity report
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
    } else if (props.report_id) {
      // Community-reported amenity (backed by amenity_reports) — open the
      // verify/comment detail popup instead of the plain read-only card.
      const report = pendingReports.find((r) => r.report_id === props.report_id);
      if (report) openReportDetail(report);
      setSelectedBlock(null);
      setSelectedWaterCooler(null);
    } else if (props.static_key) {
      // Static (bundled JSON) amenity, e.g. water-coolers.json — same verify
      // popup as a community report, minus comments, since there's no
      // amenity_reports row and no reporter to restrict self-verification
      // against. Built straight from the feature's properties (already
      // carrying the effective status/verified_count computed in
      // amenitiesGeojson) rather than re-deriving them here.
      openStaticAmenityDetail({
        report_id: '',
        static_key: props.static_key,
        reporter_id: null,
        name: props.name,
        lat: props.lat,
        lng: props.lng,
        type: props.static_type ?? 'Water Cooler',
        desc: '',
        status: props.status,
        verified_count: props.verified_count ?? 0,
        at: '',
      });
      setSelectedBlock(null);
      setSelectedWaterCooler(null);
    } else if (props.amenity_type) {
      setSelectedWaterCooler({
        name: props.name,
        type: props.amenity_type,
        lat: props.lat,
        lng: props.lng,
      });
      setSelectedBlock(null); // deselect any building
      setSelectedReport(null); // deselect any amenity report
    }
  }, [location.latitude, location.longitude, pendingReports, openReportDetail, openStaticAmenityDetail]);

  const handleCloseDetail = useCallback(() => {
    setSelectedBlock(null);
    setSelectedBlockDist(null);
    setSelectedWaterCooler(null);
    setSelectedReport(null);
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

  const handleLogClimb = useCallback(async (
    block: Block, qty: number, partialFloors: number, caption?: string, photoPath?: string,
    trackingMethod?: 'barometer' | 'pedometer' | 'manual', durationSeconds?: number,
  ) => {
    if (!user) return undefined;

    const result = await logClimb(
      user.id,
      block.block_id,
      block.blk_no,
      block.street,
      block.storeys,
      qty,
      partialFloors,
      caption,
      photoPath,
      trackingMethod,
      durationSeconds,
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

    return result.climbId;
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

  // Load shared amenity reports from Supabase on mount
  useEffect(() => {
    loadAmenityReports();
  }, [loadAmenityReports]);

  // Load live verification state for static/bundled amenity entries on mount
  useEffect(() => {
    loadStaticAmenityStatus();
  }, [loadStaticAmenityStatus]);

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

  // Load challenges the user has joined but not yet completed, with progress
  // computed against whichever window each one uses (rolling weekly/monthly,
  // or a fixed dated window for limited-time challenges).
  const loadMyActiveChallenges = useCallback(async () => {
    if (!user) { setMyActiveChallenges([]); return; }
    const [{ data: joined }, { data: climbs }] = await Promise.all([
      supabase.from('challenge_participants').select('challenge_id').eq('user_id', user.id).is('completed_at', null),
      supabase.from('climbs').select('floors_climbed, created_at').eq('user_id', user.id).gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()),
    ]);
    if (!joined || joined.length === 0) { setMyActiveChallenges([]); return; }

    const { data: challenges } = await supabase.from('challenges').select('*').in('challenge_id', joined.map((j: any) => j.challenge_id));
    if (!challenges) { setMyActiveChallenges([]); return; }

    const now = Date.now();
    const withProgress = (challenges as Challenge[]).map((ch) => {
      let progressFloors = 0;
      if (ch.starts_at && ch.ends_at) {
        const start = new Date(ch.starts_at).getTime();
        const end = new Date(ch.ends_at).getTime();
        progressFloors = (climbs ?? []).filter((c: any) => { const t = new Date(c.created_at).getTime(); return t >= start && t <= end; }).reduce((s, c: any) => s + c.floors_climbed, 0);
      } else if (ch.period === 'monthly') {
        progressFloors = (climbs ?? []).filter((c: any) => now - new Date(c.created_at).getTime() < 30 * 86400000).reduce((s, c: any) => s + c.floors_climbed, 0);
      } else {
        progressFloors = (climbs ?? []).filter((c: any) => now - new Date(c.created_at).getTime() < 7 * 86400000).reduce((s, c: any) => s + c.floors_climbed, 0);
      }
      return { ...ch, progressFloors };
    });
    setMyActiveChallenges(withProgress);
  }, [user]);

  useEffect(() => { loadMyActiveChallenges(); }, [loadMyActiveChallenges]);

  // This tab stays mounted (hidden, not unmounted) after the first visit, so
  // without this, a challenge joined in the Groups tab wouldn't show up here
  // in the "My Challenges" banner until the app fully reloaded — refetch
  // silently whenever Map becomes the active tab again. Doesn't reset any
  // loading flag, so this is a background refresh, not a spinner flash —
  // same pattern as SocialScreen.tsx/ProfileScreen.tsx's isActive effects.
  useEffect(() => {
    if (isActive) loadMyActiveChallenges();
  }, [isActive, loadMyActiveChallenges]);

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
          if (selectedReport) setSelectedReport(null);
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
                // Reads straight from HEIGHT_TIERS so the on-map fill can
                // never drift out of sync with the Layers panel legend.
                'step',
                ['get', 'storeys'],
                HEIGHT_TIERS[0].color, // 1-10
                11,
                HEIGHT_TIERS[1].color, // 11-20
                21,
                HEIGHT_TIERS[2].color, // 21-30
                31,
                HEIGHT_TIERS[3].color, // 31-39
                40,
                HEIGHT_TIERS[4].color, // 40+
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

      {/* Challenges you've joined but haven't finished — visible while you're
          actually out climbing, not just tucked away on Social/Groups. */}
      {myActiveChallenges.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.challengeRow, savedBlocks.length === 0 && styles.challengeRowNoSaved]}
          contentContainerStyle={styles.savedRowContent}
        >
          {myActiveChallenges.map((ch) => {
            const pct = Math.min(100, Math.round((ch.progressFloors / ch.target_floors) * 100));
            const color = MAP_DIFFICULTY_COLOR[ch.difficulty] ?? '#6B7280';
            return (
              <TouchableOpacity
                key={ch.challenge_id}
                style={[styles.myChallengeChip, { backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)' }]}
                onPress={() => setSelectedChallenge(ch)}
                activeOpacity={0.8}
              >
                <Ionicons name={ch.reward_icon as any} size={14} color={color} />
                <Text style={[styles.myChallengeChipText, { color: isDark ? '#F9FAFB' : '#111827' }]} numberOfLines={1}>
                  {displayChallengeTitle(ch)}
                </Text>
                <View style={styles.myChallengeTrack}>
                  <View style={[styles.myChallengeFill, { width: `${pct}%`, backgroundColor: color }]} />
                </View>
              </TouchableOpacity>
            );
          })}
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
                  if (!user) {
                    Alert.alert('Sign in required', 'You need to be signed in to report a new amenity.');
                    return;
                  }
                  const [lng, lat] = placementCenter;
                  const name = descText ? `${placementType}: ${descText.slice(0, 40)}` : (placementType ?? '');
                  const { error } = await supabase.from('amenity_reports').insert({
                    reporter_id: user.id,
                    name,
                    lat, lng,
                    type: placementType!,
                    desc: descText,
                  });
                  if (error) {
                    // Anti-spam RLS check in phase2a_addendum24.sql rejects
                    // the insert (a raw row-level-security policy error,
                    // code 42501) once this user already has 5+ unverified
                    // reports outstanding — surface that as a friendly
                    // message instead of the raw Postgres error text.
                    if (error.code === '42501') {
                      Alert.alert(
                        'Too many pending reports',
                        'You already have 5 unverified reports awaiting confirmation. Wait for the community to verify some before adding more.',
                      );
                    } else {
                      Alert.alert('Failed to report', error.message);
                    }
                    return;
                  }
                  await loadAmenityReports();
                  setPlacementType(null);
                  setDescModalVisible(false);
                  setDescText('');
                  Alert.alert('Reported', `${placementType} submitted as unverified. Visible immediately, shared with everyone.`);
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
        onNavigateToSocial={onNavigateToSocial}
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

      <ChallengeDetailModal
        challenge={selectedChallenge}
        visible={!!selectedChallenge}
        onClose={() => setSelectedChallenge(null)}
        joined
        progressFloors={myActiveChallenges.find((c) => c.challenge_id === selectedChallenge?.challenge_id)?.progressFloors ?? 0}
        onJoin={() => {}}
        isDark={isDark}
        displayTitleOverride={selectedChallenge ? displayChallengeTitle(selectedChallenge) : undefined}
        displayDescriptionOverride={selectedChallenge ? displayChallengeDescription(selectedChallenge) : undefined}
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

      {/* Amenity report detail — verify / comment popup for a community-
          reported (DB-backed) amenity pin, or a static/bundled JSON amenity
          (e.g. water-coolers.json) once `openStaticAmenityDetail` is used
          instead — that variant just hides the comment section since static
          entries have no amenity_reports row to hang comments off. Only the
          single highest-liked comment is shown (ties broken by most
          recent), not a full list. */}
      <Modal visible={!!selectedReport} transparent animationType="fade" onRequestClose={() => setSelectedReport(null)}>
        <TouchableOpacity style={styles.alertBackdrop} onPress={() => setSelectedReport(null)} activeOpacity={1}>
          <TouchableOpacity activeOpacity={1} style={[styles.alertGrid, isDark && { backgroundColor: '#1F2937' }, { width: '88%' }]}>
            {selectedReport && (
              <>
                <Text style={[styles.alertGridTitle, { marginBottom: 6 }, isDark && { color: '#F9FAFB' }]}>
                  {selectedReport.type}
                </Text>
                <Text style={[
                  styles.reportStatusBadge,
                  selectedReport.status === 'verified' ? styles.reportStatusVerified : styles.reportStatusUnverified,
                ]}>
                  {selectedReport.status === 'verified' ? '✓ Verified' : `Unverified · ${selectedReport.verified_count}/3 verified`}
                </Text>
                {!!selectedReport.name && (
                  <Text style={[styles.reportDetailName, isDark && { color: '#F9FAFB' }]}>{selectedReport.name}</Text>
                )}
                {!!selectedReport.desc && (
                  <Text style={[styles.reportDetailDesc, isDark && { color: '#9CA3AF' }]}>{selectedReport.desc}</Text>
                )}

                {/* Verify button — an obvious call-to-action (icon + explicit
                    "Verify this exists" label + live X/3 count on the button
                    itself, not just in the status badge above), plus a
                    always-visible hint line explaining *why* the button is
                    disabled rather than leaving that silent. */}
                <TouchableOpacity
                  style={[
                    styles.reportVerifyBtn,
                    (selectedReport.reporter_id === user?.id || hasVerifiedSelected) && styles.reportVerifyBtnDisabled,
                  ]}
                  disabled={selectedReport.reporter_id === user?.id || hasVerifiedSelected || reportActionLoading || !user}
                  onPress={handleVerifyReport}
                >
                  <Ionicons
                    name={hasVerifiedSelected ? 'checkmark-circle' : 'checkmark-circle-outline'}
                    size={18}
                    color={(selectedReport.reporter_id === user?.id || hasVerifiedSelected) ? '#9CA3AF' : '#FFFFFF'}
                  />
                  <Text style={[
                    styles.reportVerifyBtnText,
                    (selectedReport.reporter_id === user?.id || hasVerifiedSelected) && { color: '#9CA3AF' },
                  ]}>
                    {hasVerifiedSelected ? 'Verified by you' : 'Verify this exists'}
                  </Text>
                  {!hasVerifiedSelected && (
                    <View style={styles.reportVerifyCountPill}>
                      <Text style={styles.reportVerifyCountPillText}>{selectedReport.verified_count}/3</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <Text style={[styles.reportVerifyHint, isDark && { color: '#9CA3AF' }]}>
                  {!user
                    ? 'Sign in to verify this report.'
                    : selectedReport.reporter_id === user.id
                      ? "You reported this — verification has to come from someone else."
                      : hasVerifiedSelected
                        ? "You've already verified this — thanks for confirming it."
                        : `${3 - selectedReport.verified_count} more verification${3 - selectedReport.verified_count === 1 ? '' : 's'} needed to mark this verified.`}
                </Text>

                {/* Only the reporter can remove their own report — enforced
                    server-side by the delete policy in
                    phase2a_addendum24.sql, this is just the entry point. */}
                {selectedReport.reporter_id === user?.id && (
                  <TouchableOpacity
                    style={styles.reportRemoveBtn}
                    disabled={reportActionLoading}
                    onPress={handleDeleteReport}
                  >
                    <Ionicons name="trash-outline" size={13} color="#EF4444" />
                    <Text style={styles.reportRemoveBtnText}>Remove my report</Text>
                  </TouchableOpacity>
                )}

                {/* Comments are only meaningful for DB-backed reports (they
                    live in amenity_comments, keyed by report_id) — static
                    (bundled JSON) entries have no report row to hang a
                    comment off, so this whole section is skipped for them. */}
                {!selectedReport.static_key && (
                  <>
                    <Text style={[styles.layersSectionLabel, isDark && { color: '#9CA3AF' }, { marginTop: 16 }]}>
                      Most helpful comment
                    </Text>
                    {reportTopComment ? (
                      <View style={[styles.reportTopComment, isDark && { backgroundColor: '#111827' }]}>
                        <Text style={[styles.reportTopCommentBody, isDark && { color: '#F9FAFB' }]}>{reportTopComment.body}</Text>
                        <View style={styles.reportTopCommentFooter}>
                          {/* Makes the "most helpful" ranking legible/checkable —
                              without this, one comment shown alone with no count
                              looks arbitrary rather than genuinely top-liked. */}
                          <Text style={[styles.reportMostHelpfulCaption, isDark && { color: '#9CA3AF' }]}>
                            👍 {reportTopComment.like_count} · most helpful
                          </Text>
                          <TouchableOpacity
                            style={styles.reportLikeBtn}
                            disabled={!user || reportActionLoading}
                            onPress={handleToggleCommentLike}
                          >
                            <Ionicons
                              name={hasLikedTopComment ? 'heart' : 'heart-outline'}
                              size={16}
                              color={hasLikedTopComment ? '#EF4444' : (isDark ? '#9CA3AF' : '#6B7280')}
                            />
                          </TouchableOpacity>
                        </View>
                        {reportCommentCount > 1 && (
                          <Text style={[styles.reportMoreComments, isDark && { color: '#6B7280' }]}>
                            +{reportCommentCount - 1} more comment{reportCommentCount - 1 === 1 ? '' : 's'}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <Text style={[styles.reportNoComments, isDark && { color: '#6B7280' }]}>
                        No comments yet — be the first to add a note.
                      </Text>
                    )}

                    <View style={styles.reportCommentInputRow}>
                      <TextInput
                        style={[styles.reportCommentInput, isDark && { backgroundColor: '#111827', color: '#F9FAFB' }]}
                        placeholder='e.g. "Entrance is round the back, use the side door"'
                        placeholderTextColor="#9CA3AF"
                        value={reportCommentText}
                        onChangeText={setReportCommentText}
                        maxLength={200}
                      />
                      <TouchableOpacity
                        style={[styles.reportCommentPostBtn, (!reportCommentText.trim() || !user) && { opacity: 0.5 }]}
                        disabled={!reportCommentText.trim() || !user || reportActionLoading}
                        onPress={handleSubmitReportComment}
                      >
                        <Ionicons name="send" size={16} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                <TouchableOpacity style={styles.reportCloseBtn} onPress={() => setSelectedReport(null)}>
                  <Text style={[styles.reportCloseBtnText, isDark && { color: '#9CA3AF' }]}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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

      {/* Alert/Report modal — centered icon grid. Styled to match the Layers
          panel's design system: same card sizing, the same uppercase
          section-label treatment above its content, and bordered chip
          buttons (like layersFilterChip) instead of flat borderless tiles. */}
      <Modal visible={alertVisible} transparent animationType="fade" onRequestClose={() => setAlertVisible(false)}>
        <TouchableOpacity style={styles.alertBackdrop} onPress={() => setAlertVisible(false)} activeOpacity={1}>
          <View style={[styles.alertGrid, isDark && { backgroundColor: '#1F2937' }]}>
            <Text style={[styles.alertGridTitle, isDark && { color: '#F9FAFB' }]}>Report nearby...</Text>
            <Text style={[styles.layersSectionLabel, styles.alertGridSectionLabel, isDark && { color: '#9CA3AF' }]}>Select a type</Text>
            <View style={styles.alertGridItems}>
              {[
                { icon: 'water-outline', label: 'Water Cooler', color: '#06B6D4' },
                { icon: 'male-female-outline', label: 'Toilet', color: '#8B5CF6' },
                { icon: 'cafe-outline', label: 'Food / Shop', color: '#F59E0B' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={[
                    styles.alertGridItem,
                    { backgroundColor: item.color + (isDark ? '1F' : '15'), borderColor: item.color },
                  ]}
                  onPress={() => {
                    setAlertVisible(false);
                    setPlacementType(item.label);
                  }}
                >
                  <Ionicons name={item.icon as any} size={26} color={item.color} />
                  <Text style={[styles.alertGridLabel, isDark && { color: '#F9FAFB' }]}>{item.label}</Text>
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
            {/* Filters anything unverified — DB-backed community reports
                still awaiting their 3 corroborating verifications, AND the
                curated water-coolers.json entries that were scraped but
                never confirmed — so users can cut clutter down to only
                verified pins from either source. Verified pins from both
                sources stay visible regardless — this only hides the
                `status !== 'verified'` ones. */}
            <View style={styles.layersRow}>
              <Ionicons name="help-circle-outline" size={18} color="#9CA3AF" style={{ marginRight: 10 }} />
              <Text style={[styles.layersRowLabel, isDark && { color: '#F9FAFB' }]}>Unverified Reports</Text>
              <Switch
                value={amenityVisibility.unverified}
                onValueChange={(val) => setAmenityVisibility((prev) => ({ ...prev, unverified: val }))}
                trackColor={{ true: '#9CA3AF' }}
              />
            </View>

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

  // "My Challenges" row, directly under the saved row (or under the search
  // bar directly if there's no saved row to push it down)
  challengeRow: {
    position: 'absolute',
    top: 156,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  challengeRowNoSaved: {
    top: 104,
  },
  myChallengeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    width: 150,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  myChallengeChipText: { fontSize: 11.5, fontWeight: '600', flexShrink: 1 },
  myChallengeTrack: { width: 24, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.1)', overflow: 'hidden' },
  myChallengeFill: { height: '100%', borderRadius: 2 },

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
    // Same card chrome + sizing as layersPanel (width/maxWidth included) so
    // the two pop-ups read as the same design system.
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
  alertGridTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 20,
  },
  // Centered variant of layersSectionLabel (which is left-aligned for the
  // Layers panel's row lists) — same uppercase/muted eyebrow treatment above
  // this grid's content instead.
  alertGridSectionLabel: {
    textAlign: 'center',
    marginBottom: 14,
  },
  alertGridItems: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  alertGridItem: {
    // Bordered chip, matching layersFilterChip's button language, instead of
    // a flat borderless tinted tile.
    width: 90,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  alertGridLabel: {
    // Same weight/prominence as layersRowLabel (dark, semi-bold) rather than
    // low-emphasis gray, matching the Layers panel's row labels.
    fontSize: 11,
    color: '#111827',
    textAlign: 'center',
    fontWeight: '600',
    marginTop: 6,
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

  // Amenity report detail popup — verify / comment / most-helpful-comment
  reportStatusBadge: {
    alignSelf: 'center',
    fontSize: 11.5,
    fontWeight: '700',
    marginBottom: 12,
  },
  reportStatusVerified: {
    color: '#059669',
  },
  reportStatusUnverified: {
    color: '#9CA3AF',
  },
  reportDetailName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 4,
  },
  reportDetailDesc: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 18,
  },
  reportVerifyBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 12,
  },
  reportVerifyBtnDisabled: {
    backgroundColor: '#F3F4F6',
  },
  reportVerifyBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // X/3 pill on the verify button itself — the count needs to be visible on
  // the CTA, not just tucked into the status badge above it.
  reportVerifyCountPill: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  reportVerifyCountPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // Always-visible explanation of the verify button's current state — why
  // it's disabled (own report / already verified / signed out), or how many
  // more verifications are still needed.
  reportVerifyHint: {
    fontSize: 11.5,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 15,
  },
  reportRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 10,
    paddingVertical: 6,
  },
  reportRemoveBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
  },
  reportTopComment: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
  },
  reportTopCommentBody: {
    fontSize: 13,
    color: '#111827',
    lineHeight: 18,
    marginBottom: 8,
  },
  reportTopCommentFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // "👍 12 · most helpful" — makes the single-shown-comment's ranking
  // legible instead of an unverifiable claim.
  reportMostHelpfulCaption: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  reportMoreComments: {
    fontSize: 11.5,
    color: '#9CA3AF',
    marginTop: 6,
    fontStyle: 'italic',
  },
  reportLikeBtn: {
    padding: 2,
  },
  reportNoComments: {
    fontSize: 12.5,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  reportCommentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  reportCommentInput: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#111827',
  },
  reportCommentPostBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportCloseBtn: {
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 6,
  },
  reportCloseBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
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
