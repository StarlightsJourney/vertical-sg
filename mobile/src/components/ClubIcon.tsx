import Svg, { Path, Circle, Polygon, Line } from 'react-native-svg';
import type { OfficialClub } from '../types';

interface Props {
  category: OfficialClub['category'];
  color: string;
  size?: number;
}

// Custom hand-drawn vector icons per club category (react-native-svg) —
// standing in for "AI generated icons": not a stock Ionicons glyph, a
// distinct small illustration per category.
export default function ClubIcon({ category, color, size = 26 }: Props) {
  const c = size / 2;
  const r = size * 0.42;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {category === 'Trail Running' && (
        <>
          {/* winding trail with a runner dot at the front */}
          <Path
            d={`M ${c - r} ${c + r * 0.7} C ${c - r * 0.3} ${c + r * 0.7}, ${c - r * 0.5} ${c - r * 0.1}, ${c} ${c - r * 0.1} C ${c + r * 0.5} ${c - r * 0.1}, ${c + r * 0.2} ${c - r}, ${c + r * 0.9} ${c - r}`}
            fill="none"
            stroke={color}
            strokeWidth={size * 0.09}
            strokeLinecap="round"
            strokeDasharray={`${size * 0.02}, ${size * 0.14}`}
          />
          <Circle cx={c + r * 0.9} cy={c - r} r={size * 0.09} fill={color} />
        </>
      )}
      {category === 'Hiking' && (
        <>
          <Polygon points={`${c - r},${c + r * 0.7} ${c - r * 0.1},${c - r * 0.5} ${c + r * 0.35},${c + r * 0.1} ${c + r},${c + r * 0.7}`} fill={color} opacity={0.92} />
          <Polygon points={`${c - r * 0.1},${c - r * 0.5} ${c + r * 0.15},${c - r * 0.15} ${c - r * 0.35},${c + r * 0.05}`} fill={color} opacity={0.55} />
          <Line x1={c + r * 0.55} y1={c + r * 0.7} x2={c + r * 0.9} y2={c - r * 0.55} stroke={color} strokeWidth={size * 0.07} strokeLinecap="round" />
        </>
      )}
      {category === 'Climbing' && (
        <>
          <Path
            d={`M ${c - r * 0.5} ${c - r} a ${r * 0.5} ${r * 0.5} 0 1 0 0.01 0 z`}
            fill="none"
            stroke={color}
            strokeWidth={size * 0.09}
          />
          <Line x1={c} y1={c - r * 0.5} x2={c} y2={c + r} stroke={color} strokeWidth={size * 0.09} strokeLinecap="round" />
          <Circle cx={c - r * 0.55} cy={c + r * 0.15} r={size * 0.07} fill={color} />
          <Circle cx={c + r * 0.5} cy={c + r * 0.55} r={size * 0.07} fill={color} />
          <Circle cx={c + r * 0.15} cy={c - r * 0.15} r={size * 0.07} fill={color} />
        </>
      )}
      {category === 'Announcements' && (
        <>
          <Polygon points={`${c - r},${c - r * 0.25} ${c - r},${c + r * 0.25} ${c + r * 0.2},${c + r * 0.55} ${c + r * 0.2},${c - r * 0.55}`} fill={color} />
          <Polygon points={`${c + r * 0.2},${c - r * 0.55} ${c + r},${c - r} ${c + r},${c + r} ${c + r * 0.2},${c + r * 0.55}`} fill={color} opacity={0.85} />
          <Path d={`M ${c - r * 0.55} ${c + r * 0.25} L ${c - r * 0.35} ${c + r} `} stroke={color} strokeWidth={size * 0.07} strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}
