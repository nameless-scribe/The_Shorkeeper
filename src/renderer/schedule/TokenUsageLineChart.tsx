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

export interface TokenDailyPoint {
  date: string;
  tokens: number;
  cached: number;
}

interface TokenUsageLineChartProps {
  data: TokenDailyPoint[];
  chartKey?: number;
}

export function TokenUsageLineChart({ data, chartKey = 0 }: TokenUsageLineChartProps) {
  return (
    <div className="h-44 w-full min-w-0">
      <ResponsiveContainer key={chartKey} width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(225,233,240,0.08)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'rgba(225,233,240,0.5)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'rgba(225,233,240,0.4)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(10,17,40,0.92)',
              border: '1px solid rgba(48,188,237,0.25)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: '#E1E9F0' }}
            formatter={(value: ValueType | undefined) =>
              typeof value === 'number' ? value.toLocaleString() : String(value ?? '')
            }
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="line"
            iconSize={10}
            wrapperStyle={{ fontSize: 10, color: 'rgba(225,233,240,0.55)', paddingBottom: 4 }}
          />
          <Line
            type="monotone"
            dataKey="tokens"
            name="总量"
            stroke="#30BCED"
            strokeWidth={2}
            dot={{ r: 3, fill: '#30BCED', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="cached"
            name="缓存命中"
            stroke="#A78BFA"
            strokeWidth={2}
            dot={{ r: 3, fill: '#A78BFA', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
