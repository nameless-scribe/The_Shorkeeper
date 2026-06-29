import type { ToolDefinition } from '../types';

interface GeocodeResult {
  results?: Array<{ name: string; latitude: number; longitude: number; country?: string }>;
}

interface ForecastResult {
  current?: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
  };
}

const WEATHER_LABELS: Record<number, string> = {
  0: '晴',
  1: '大部晴朗',
  2: '局部多云',
  3: '多云',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  80: '阵雨',
  95: '雷暴',
};

function weatherLabel(code: number): string {
  return WEATHER_LABELS[code] ?? `天气码 ${code}`;
}

export const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: '查询指定城市的当前天气与未来 3 日预报',
  category: 'web',
  requiresPermission: ['network'],
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称，如「上海」「北京」',
      },
    },
    required: ['city'],
  },
  async execute(args, ctx) {
    const { city } = args as { city?: string };
    if (!city?.trim()) {
      return { success: false, output: '', error: '缺少 city 参数' };
    }

    if (ctx.signal.aborted) {
      return { success: false, output: '', error: '已取消' };
    }

    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1&language=zh`;
      const geoRes = await fetch(geoUrl, { signal: ctx.signal });
      if (!geoRes.ok) {
        return { success: false, output: '', error: `地理编码失败: HTTP ${geoRes.status}` };
      }

      const geo = (await geoRes.json()) as GeocodeResult;
      const place = geo.results?.[0];
      if (!place) {
        return { success: false, output: '', error: `未找到城市「${city}」` };
      }

      const forecastUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}` +
        `&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`;

      const forecastRes = await fetch(forecastUrl, { signal: ctx.signal });
      if (!forecastRes.ok) {
        return { success: false, output: '', error: `天气查询失败: HTTP ${forecastRes.status}` };
      }

      const data = (await forecastRes.json()) as ForecastResult;
      const lines: string[] = [`${place.name}${place.country ? `（${place.country}）` : ''} 天气`];

      if (data.current) {
        lines.push(
          `当前：${weatherLabel(data.current.weather_code)}，` +
            `${data.current.temperature_2m}°C，` +
            `湿度 ${data.current.relative_humidity_2m}%，` +
            `风速 ${data.current.wind_speed_10m} km/h`,
        );
      }

      if (data.daily?.time.length) {
        lines.push('未来预报：');
        for (let i = 0; i < Math.min(3, data.daily.time.length); i += 1) {
          const date = data.daily.time[i];
          const max = data.daily.temperature_2m_max[i];
          const min = data.daily.temperature_2m_min[i];
          const code = data.daily.weather_code[i];
          lines.push(`- ${date}：${weatherLabel(code)}，${min}°C ~ ${max}°C`);
        }
      }

      return { success: true, output: lines.join('\n') };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
