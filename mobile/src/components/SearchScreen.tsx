import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  FlatList,
  SafeAreaView,
} from 'react-native';
import { supabase } from '../config/supabase';
import type { Block } from '../types';

interface SearchScreenProps {
  visible: boolean;
  onClose: () => void;
  onSelectBlock: (block: Block) => void;
  recentBlocks: Block[];
  starredBlockIds: Set<string>;
  onToggleStar: (block: Block) => void;
  isDark?: boolean;
}

function getTier(storeys: number) {
  if (storeys <= 10) return { label: 'Low-rise', color: '#4A90D9' };
  if (storeys <= 20) return { label: 'Mid-rise', color: '#FF9500' };
  if (storeys <= 30) return { label: 'High-rise', color: '#FF3B30' };
  return { label: 'Sky-high', color: '#8B0000' };
}

export default function SearchScreen({
  visible,
  onClose,
  onSelectBlock,
  recentBlocks,
  starredBlockIds,
  onToggleStar,
  isDark = false,
}: SearchScreenProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Block[]>([]);
  const [searching, setSearching] = useState(false);
  const [starredBlocks, setStarredBlocks] = useState<Block[]>([]);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);

  // Debounce search query (300ms)
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  // Perform search when debounced query changes
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const requestId = ++searchRequestRef.current;
    setSearching(true);

    supabase
      .from('blocks')
      .select('*')
      .or(`blk_no.ilike.%${trimmed}%,street.ilike.%${trimmed}%`)
      .order('storeys', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (requestId !== searchRequestRef.current) return;
        if (error) {
          console.error('Search error:', error);
          setSearchResults([]);
        } else {
          setSearchResults(data ?? []);
        }
        if (requestId === searchRequestRef.current) {
          setSearching(false);
        }
      });
  }, [debouncedQuery]);

  // Fetch starred blocks when starred IDs change
  useEffect(() => {
    if (starredBlockIds.size === 0) {
      setStarredBlocks([]);
      return;
    }
    const ids = Array.from(starredBlockIds);
    supabase
      .from('blocks')
      .select('*')
      .in('block_id', ids)
      .order('storeys', { ascending: false })
      .then(({ data }) => {
        if (data) setStarredBlocks(data);
      });
  }, [starredBlockIds]);

  // Reset search state when modal opens
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSearchResults([]);
      setDebouncedQuery('');
      setSearching(false);
    }
  }, [visible]);

  const handleSelectBlock = useCallback(
    (block: Block) => {
      onSelectBlock(block);
      onClose();
    },
    [onSelectBlock, onClose],
  );

  const renderBlockRow = useCallback(
    (block: Block) => {
      const tier = getTier(block.storeys);
      const isStarred = starredBlockIds.has(block.block_id);

      return (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.6}
          onPress={() => handleSelectBlock(block)}
        >
          <View style={[styles.tierDot, { backgroundColor: tier.color }]} />
          <View style={styles.rowContent}>
            <Text style={[styles.rowAddress, isDark && { color: '#F9FAFB' }]} numberOfLines={1}>
              Blk {block.blk_no} {block.street}
            </Text>
            {block.town && (
              <Text style={[styles.rowTown, isDark && { color: '#9CA3AF' }]} numberOfLines={1}>
                {block.town}
              </Text>
            )}
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowStoreys, isDark && { color: '#F9FAFB' }]}>{block.storeys}</Text>
            <Text style={styles.rowStoreysLabel}>fl</Text>
          </View>
          <TouchableOpacity
            style={styles.starButton}
            onPress={() => onToggleStar(block)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              style={[styles.starIcon, isStarred && styles.starIconActive]}
            >
              {isStarred ? '★' : '☆'}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [starredBlockIds, handleSelectBlock, onToggleStar],
  );

  const hasQuery = query.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.safeArea, isDark && { backgroundColor: '#111827' }]}>
        <View style={[styles.container, { paddingTop: 52 }, isDark && { backgroundColor: '#111827' }]}>
          {/* Search bar */}
          <View style={[styles.searchBarContainer, isDark && { borderBottomColor: '#374151' }]}>
            <View style={[styles.searchInputWrapper, isDark && { backgroundColor: '#1F2937' }]}>
              <TextInput
                style={[styles.searchInput, isDark && { color: '#F9FAFB' }]}
                placeholder="Search HDB blocks..."
                placeholderTextColor="#9CA3AF"
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>
            <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {/* Content area */}
          {hasQuery ? (
            searching && searchResults.length === 0 ? (
              <View style={styles.centerContent}>
                <ActivityIndicator size="large" color="#2563EB" />
              </View>
            ) : searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.block_id}
                renderItem={({ item }) => renderBlockRow(item)}
                ItemSeparatorComponent={() => <Separator isDark={isDark} />}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.listContent}
              />
            ) : (
              !searching && (
                <View style={styles.centerContent}>
                  <Text style={[styles.emptyText, isDark && { color: '#D1D5DB' }]}>No results found</Text>
                </View>
              )
            )
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              {/* Recent section */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, isDark && { color: '#D1D5DB' }]}>Recent</Text>
                {recentBlocks.length > 0 ? (
                  recentBlocks.slice(0, 10).map((block, i, arr) => (
                    <View key={block.block_id}>
                      {renderBlockRow(block)}
                      {i < arr.length - 1 && <Separator isDark={isDark} />}
                    </View>
                  ))
                ) : (
                  <Text style={[styles.emptyText, isDark && { color: '#D1D5DB' }]}>No recent blocks</Text>
                )}
              </View>

              {/* Starred section */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, isDark && { color: '#D1D5DB' }]}>Starred</Text>
                {starredBlocks.length > 0 ? (
                  starredBlocks.map((block, i, arr) => (
                    <View key={block.block_id}>
                      {renderBlockRow(block)}
                      {i < arr.length - 1 && <Separator isDark={isDark} />}
                    </View>
                  ))
                ) : (
                  <Text style={[styles.emptyText, isDark && { color: '#D1D5DB' }]}>
                    Star blocks to save them here.
                  </Text>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Separator({ isDark }: { isDark?: boolean }) {
  return <View style={[styles.separator, isDark ? { backgroundColor: '#374151' } : undefined]} />;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  searchInputWrapper: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 40,
    justifyContent: 'center',
  },
  searchInput: {
    fontSize: 16,
    color: '#111827',
    padding: 0,
  },
  cancelButton: {
    marginLeft: 12,
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 16,
    color: '#2563EB',
    fontWeight: '500',
  },
  section: {
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  tierDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  rowContent: {
    flex: 1,
    marginRight: 8,
  },
  rowAddress: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  rowTown: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginRight: 12,
  },
  rowStoreys: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  rowStoreysLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    marginLeft: 2,
  },
  starButton: {
    padding: 4,
  },
  starIcon: {
    fontSize: 22,
    color: '#D1D5DB',
  },
  starIconActive: {
    color: '#F59E0B',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
  },
  listContent: {
    paddingBottom: 16,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 20,
  },
});
