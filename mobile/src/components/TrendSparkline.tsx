import { View, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Circle, Line } from 'react-native-svg';

interface Props {
  values: number[];
  color: string;
  isDark: boolean;
  height?: number;
  /** Faint horizontal reference lines, like a real analytics chart's gridlines. Default on. */
  gridlines?: boolean;
}

// Virtual coordinate space the path is authored in — the <Svg> then stretches
// this to whatever width it's actually rendered at (preserveAspectRatio="none"),
// so callers don't need to measure their own container.
const VBOX_WIDTH = 300;

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x},${points[i].y} ${xc},${yc}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/** Clean single-color trend line, styled after Strava/Coros analytics charts:
 *  a crisp line in one accent color, a faint area fill, and restrained
 *  gridlines for axis context — no rainbow, no decorative blob. */
export default function TrendSparkline({ values, color, isDark, height = 64, gridlines = true }: Props) {
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = Math.max(1, max - min);
  const padY = 6;
  const innerH = height - padY * 2;
  const stepX = values.length > 1 ? VBOX_WIDTH / (values.length - 1) : 0;

  const points = values.map((v, i) => ({
    x: i * stepX,
    y: padY + innerH - ((v - min) / range) * innerH,
  }));

  const linePath = smoothPath(points);
  const baseline = padY + innerH;
  const areaPath = linePath
    ? `${linePath} L ${points[points.length - 1].x},${baseline} L ${points[0].x},${baseline} Z`
    : '';

  const lastPoint = points[points.length - 1];
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,24,39,0.07)';
  const gridYs = [padY, padY + innerH / 2, padY + innerH];

  return (
    <View style={[styles.wrap, { height }]}>
      <Svg width="100%" height={height} viewBox={`0 0 ${VBOX_WIDTH} ${height}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={isDark ? 0.22 : 0.16} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {gridlines && gridYs.map((y, i) => (
          <Line key={i} x1={0} y1={y} x2={VBOX_WIDTH} y2={y} stroke={gridColor} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {areaPath && <Path d={areaPath} fill="url(#trendFill)" stroke="none" />}
        {linePath && <Path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
        {lastPoint && <Circle cx={lastPoint.x} cy={lastPoint.y} r={4} fill={color} stroke={isDark ? '#1F2937' : '#FFFFFF'} strokeWidth={2} />}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
});
