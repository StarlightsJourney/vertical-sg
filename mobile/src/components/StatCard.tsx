import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

interface Props {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: string | number;
  label: string;
  /** Optional secondary line under the label — e.g. "Blk 123 Example St" for a favorite-building record. */
  caption?: string;
  isDark: boolean;
  /** Hides the bottom divider — set on the last row in a group. */
  isLast?: boolean;
}

/** Strava-"Records"-style flat list row: a neutral icon chip, label/caption on
 *  the left, the hero number on the right. Deliberately has no per-row tint —
 *  every row looks the same; hierarchy comes from type scale, not color. Rows
 *  stack inside a single bordered card and separate with a hairline divider. */
export default function StatCard({ icon, value, label, caption, isDark, isLast }: Props) {
  return (
    <View style={[styles.row, !isLast && styles.rowBorder, !isLast && isDark && styles.rowBorderDark]}>
      <View style={[styles.iconWrap, isDark && styles.iconWrapDark]}>
        <Ionicons name={icon} size={16} color={isDark ? '#9CA3AF' : '#6B7280'} />
      </View>
      <View style={styles.textCol}>
        <Text style={[styles.label, isDark && styles.labelDark]} numberOfLines={1}>
          {label}
        </Text>
        {caption && (
          <Text style={[styles.caption, isDark && styles.captionDark]} numberOfLines={1}>
            {caption}
          </Text>
        )}
      </View>
      <Text style={[styles.value, isDark && styles.valueDark]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  rowBorderDark: {
    borderBottomColor: '#374151',
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: '#F3F4F6',
  },
  iconWrapDark: {
    backgroundColor: '#111827',
  },
  textCol: {
    flex: 1,
    marginRight: 10,
  },
  label: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#111827',
  },
  labelDark: {
    color: '#F9FAFB',
  },
  caption: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#9CA3AF',
    marginTop: 2,
  },
  captionDark: {
    color: '#6B7280',
  },
  value: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#111827',
  },
  valueDark: {
    color: '#F9FAFB',
  },
});
