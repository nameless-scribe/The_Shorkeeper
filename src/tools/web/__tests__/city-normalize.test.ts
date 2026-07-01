import { describe, expect, it } from 'vitest';
import { normalizeCityForWeather } from '../city-normalize';

describe('normalizeCityForWeather', () => {
  it('maps development zone to parent city', () => {
    expect(normalizeCityForWeather('大连开发区')).toBe('大连市');
    expect(normalizeCityForWeather('大连经济技术开发区')).toBe('大连市');
  });

  it('adds 市 suffix for short chinese names', () => {
    expect(normalizeCityForWeather('大连')).toBe('大连市');
    expect(normalizeCityForWeather('上海')).toBe('上海市');
  });
});
