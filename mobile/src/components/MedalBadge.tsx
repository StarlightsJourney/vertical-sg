import Svg, { Defs, LinearGradient, Stop, Circle, Path, Polygon, Rect } from 'react-native-svg';

export type MedalEmblem = 'mountain' | 'lightning' | 'flag' | 'infinity' | 'rocket' | 'flame' | 'trophy' | 'star';

interface Props {
  color: string;
  emblem: MedalEmblem;
  size?: number;
  /** Ribbon tails below the medal disc — turn off when the medal sits inside a small circular slot. */
  ribbon?: boolean;
}

// Custom-drawn vector medals (react-native-svg) rather than a flat icon glyph
// — a gradient disc, a raised rim, a ribbon, and a hand-built emblem shape
// per challenge archetype (mountain = elevation, lightning = sprint pace,
// flag = dated/limited-time, infinity = endurance/long-haul, rocket =
// momentum, flame = intensity, trophy = the two "beat Everest" specials).
export default function MedalBadge({ color, emblem, size = 52, ribbon = false }: Props) {
  const s = size;
  const c = s / 2;
  const r = s * 0.46;
  const gradId = `medalGrad-${color.replace('#', '')}`;
  const shineId = `medalShine-${color.replace('#', '')}`;

  const renderEmblem = () => {
    const stroke = '#FFFFFF';
    switch (emblem) {
      case 'mountain':
        return (
          <>
            <Circle cx={c + r * 0.32} cy={c - r * 0.32} r={r * 0.14} fill="#FDE68A" />
            <Polygon points={`${c - r * 0.5},${c + r * 0.3} ${c - r * 0.05},${c - r * 0.35} ${c + r * 0.25},${c + r * 0.05} ${c + r * 0.55},${c + r * 0.3}`} fill={stroke} opacity={0.95} />
            <Polygon points={`${c - r * 0.05},${c - r * 0.35} ${c + r * 0.2},${c + r * 0.02} ${c - r * 0.15},${c + r * 0.15}`} fill="#FFFFFF" opacity={0.6} />
          </>
        );
      case 'lightning':
        return <Polygon points={`${c - r * 0.05},${c - r * 0.55} ${c - r * 0.4},${c + r * 0.1} ${c - r * 0.05},${c + r * 0.1} ${c - r * 0.2},${c + r * 0.55} ${c + r * 0.4},${c - r * 0.15} ${c},${c - r * 0.15}`} fill={stroke} />;
      case 'flag':
        return (
          <>
            <Rect x={c - r * 0.32} y={c - r * 0.5} width={r * 0.1} height={r} rx={r * 0.05} fill={stroke} />
            <Polygon points={`${c - r * 0.22},${c - r * 0.48} ${c + r * 0.45},${c - r * 0.3} ${c - r * 0.22},${c - r * 0.02}`} fill={stroke} opacity={0.95} />
          </>
        );
      case 'infinity':
        return (
          <Path
            d={`M ${c - r * 0.5} ${c} c 0,-${r * 0.34} ${r * 0.34},-${r * 0.34} ${r * 0.5},0 c ${r * 0.16},${r * 0.34} ${r * 0.5},${r * 0.34} ${r * 0.5},0 c 0,-${r * 0.34} -${r * 0.34},-${r * 0.34} -${r * 0.5},0 c -${r * 0.16},${r * 0.34} -${r * 0.5},${r * 0.34} -${r * 0.5},0 z`}
            fill="none"
            stroke={stroke}
            strokeWidth={r * 0.22}
            strokeLinecap="round"
          />
        );
      case 'rocket':
        return (
          <>
            <Path d={`M ${c} ${c - r * 0.55} C ${c + r * 0.28} ${c - r * 0.15}, ${c + r * 0.22} ${c + r * 0.35}, ${c} ${c + r * 0.55} C ${c - r * 0.22} ${c + r * 0.35}, ${c - r * 0.28} ${c - r * 0.15}, ${c} ${c - r * 0.55} Z`} fill={stroke} opacity={0.95} />
            <Circle cx={c} cy={c - r * 0.05} r={r * 0.14} fill={color} />
            <Polygon points={`${c - r * 0.18},${c + r * 0.32} ${c - r * 0.42},${c + r * 0.55} ${c - r * 0.08},${c + r * 0.42}`} fill={stroke} opacity={0.85} />
            <Polygon points={`${c + r * 0.18},${c + r * 0.32} ${c + r * 0.42},${c + r * 0.55} ${c + r * 0.08},${c + r * 0.42}`} fill={stroke} opacity={0.85} />
          </>
        );
      case 'flame':
        return (
          <Path
            d={`M ${c} ${c - r * 0.55} C ${c + r * 0.5} ${c - r * 0.1}, ${c + r * 0.35} ${c + r * 0.15}, ${c + r * 0.32} ${c + r * 0.3} C ${c + r * 0.32} ${c + r * 0.55}, ${c - r * 0.32} ${c + r * 0.55}, ${c - r * 0.32} ${c + r * 0.3} C ${c - r * 0.35} ${c + r * 0.1}, ${c - r * 0.1} ${c + r * 0.05}, ${c - r * 0.05} ${c - r * 0.1} C ${c - r * 0.15} ${c + r * 0.05}, ${c - r * 0.28} ${c - r * 0.05}, ${c} ${c - r * 0.55} Z`}
            fill={stroke}
            opacity={0.95}
          />
        );
      case 'star':
        return <StarShape cx={c} cy={c} r={r * 0.5} fill={stroke} />;
      case 'trophy':
      default:
        return (
          <>
            <Path d={`M ${c - r * 0.36} ${c - r * 0.42} h ${r * 0.72} v ${r * 0.32} a ${r * 0.36} ${r * 0.36} 0 0 1 -0.72,0 z`.replace('0.72,0', `${r * 0.72},0`)} fill={stroke} opacity={0.95} />
            <Path d={`M ${c - r * 0.36} ${c - r * 0.38} c -${r * 0.28} 0 -${r * 0.28} ${r * 0.4} 0 ${r * 0.42}`} fill="none" stroke={stroke} strokeWidth={r * 0.1} />
            <Path d={`M ${c + r * 0.36} ${c - r * 0.38} c ${r * 0.28} 0 ${r * 0.28} ${r * 0.4} 0 ${r * 0.42}`} fill="none" stroke={stroke} strokeWidth={r * 0.1} />
            <Rect x={c - r * 0.08} y={c - r * 0.02} width={r * 0.16} height={r * 0.22} fill={stroke} opacity={0.95} />
            <Rect x={c - r * 0.3} y={c + r * 0.2} width={r * 0.6} height={r * 0.14} rx={r * 0.04} fill={stroke} opacity={0.95} />
          </>
        );
    }
  };

  return (
    <Svg width={s} height={s * (ribbon ? 1.32 : 1)} viewBox={`0 0 ${s} ${s * (ribbon ? 1.32 : 1)}`}>
      <Defs>
        <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor={color} stopOpacity={1} />
          <Stop offset="100%" stopColor={color} stopOpacity={0.65} />
        </LinearGradient>
        <LinearGradient id={shineId} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.35} />
          <Stop offset="60%" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>

      {ribbon && (
        <>
          <Polygon points={`${c - r * 0.42},${c + r * 0.75} ${c - r * 0.14},${c + r * 0.75} ${c - r * 0.26},${s * 1.28} ${c - r * 0.5},${s * 1.1}`} fill={color} opacity={0.85} />
          <Polygon points={`${c + r * 0.42},${c + r * 0.75} ${c + r * 0.14},${c + r * 0.75} ${c + r * 0.26},${s * 1.28} ${c + r * 0.5},${s * 1.1}`} fill={color} opacity={0.85} />
        </>
      )}

      <Circle cx={c} cy={c} r={r} fill={`url(#${gradId})`} stroke="#FFFFFF" strokeWidth={s * 0.035} />
      <Circle cx={c} cy={c} r={r * 0.86} fill="none" stroke="#FFFFFF" strokeWidth={1} strokeOpacity={0.5} />
      <Circle cx={c} cy={c * 0.9} r={r} fill={`url(#${shineId})`} />
      {renderEmblem()}
    </Svg>
  );
}

function StarShape({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.42;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return <Polygon points={points.join(' ')} fill={fill} />;
}

/** Maps a challenge's reward_icon (legacy Ionicons name) or badge key to a medal emblem. */
export function medalEmblemFor(rewardIcon: string, badgeKey?: string | null, generic?: boolean): MedalEmblem {
  if (badgeKey === 'everest_gauntlet_challenge' || badgeKey === 'double_eightthousander_challenge') return 'trophy';
  // Generic "just a numbers game" monthly elevation badges deliberately all
  // share one emblem — they're meant to read as tiers of the same badge, not
  // unique achievements. Only their medal color (by target size) varies.
  if (generic) return 'mountain';
  if (rewardIcon.includes('flash')) return 'lightning';
  if (rewardIcon.includes('flag')) return 'flag';
  if (rewardIcon.includes('infinite')) return 'infinity';
  if (rewardIcon.includes('rocket')) return 'rocket';
  if (rewardIcon.includes('flame')) return 'flame';
  if (rewardIcon.includes('trending')) return 'mountain';
  return 'star';
}
