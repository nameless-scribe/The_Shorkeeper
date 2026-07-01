import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { ThemeColorTokens } from '@/shared/types';
import { useTheme } from '../theme/use-theme';

export interface TokenDailyPoint {
  date: string;
  tokens: number;
  cached: number;
}

interface TokenUsageLineChartProps {
  data: TokenDailyPoint[];
  chartKey?: number;
}

const FALLBACK_COLORS: ThemeColorTokens = {
  navyDeep: '#0A1128',
  navy: '#274690',
  ice: '#E1E9F0',
  iceDeep: '#89BBFE',
  cyan: '#30BCED',
  cyanDim: '#00B4D8',
  silver: '#C0C0C0',
  silverLight: '#E8EEF5',
};

function withHexAlpha(hex: string, alpha: number): string {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function TokenUsageLineChart({ data, chartKey = 0 }: TokenUsageLineChartProps) {
  const theme = useTheme();
  const colors = theme?.colors ?? FALLBACK_COLORS;

  return (
    <div className="h-44 w-full min-w-0">
      <ResponsiveContainer key={chartKey} width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={withHexAlpha(colors.ice, 0.08)} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: withHexAlpha(colors.ice, 0.5), fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: withHexAlpha(colors.ice, 0.4), fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: withHexAlpha(colors.navyDeep, 0.92),
              border: `1px solid ${withHexAlpha(colors.cyan, 0.25)}`,
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: colors.ice }}
            formatter={(value: ValueType | undefined) =>
              typeof value === 'number' ? value.toLocaleString() : String(value ?? '')
            }
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="line"
            iconSize={10}
            wrapperStyle={{ fontSize: 10, color: withHexAlpha(colors.ice, 0.55), paddingBottom: 4 }}
          />
          <Line
            type="monotone"
            dataKey="tokens"
            name="总量"
            stroke={colors.cyan}
            strokeWidth={2}
            dot={{ r: 3, fill: colors.cyan, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="cached"
            name="缓存命中"
            stroke={colors.iceDeep}
            strokeWidth={2}
            dot={{ r: 3, fill: colors.iceDeep, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
