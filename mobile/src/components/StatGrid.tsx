import { View, Text, StyleSheet } from 'react-native';

interface CellProps {
  value: string | number;
  label: string;
  isDark: boolean;
  /** 'lg' for the hero triplet (climbs/floors/tallest), 'md' for secondary metrics. */
  size?: 'lg' | 'md';
}

/** A single number-forward cell — huge bold value, small uppercase label
 *  underneath. No background, no icon, no color: the whole point of this grid
 *  is that scale and whitespace carry the hierarchy instead of card tinting. */
export function StatCell({ value, label, isDark, size = 'md' }: CellProps) {
  return (
    <View style={styles.cell}>
      <Text
        style={[size === 'lg' ? styles.valueLg : styles.valueMd, isDark && styles.valueDark]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[styles.label, isDark && styles.labelDark]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Hairline separator between cells — vertical between columns, horizontal
 *  between rows. This is the "Coros dense grid" separator instead of gaps
 *  between colored tiles. */
export function GridDivider({ isDark, horizontal }: { isDark: boolean; horizontal?: boolean }) {
  return (
    <View
      style={[
        horizontal ? styles.hDivider : styles.vDivider,
        isDark && styles.dividerDark,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 2,
  },
  valueLg: {
    fontSize: 25,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  valueMd: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#111827',
  },
  valueDark: {
    color: '#F9FAFB',
  },
  label: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 5,
  },
  labelDark: {
    color: '#6B7280',
  },
  vDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: '#E5E7EB',
  },
  hDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginVertical: 14,
  },
  dividerDark: {
    backgroundColor: '#374151',
  },
});
