/** 将用户口语地名规范为 Open-Meteo 更易命中的城市名 */
export function normalizeCityForWeather(input: string): string {
  let city = input.trim().replace(/\s+/g, '');

  if (!city) return city;

  city = city
    .replace(/(经济技术开发区|开发区|高新区|新区|市辖区)$/u, '')
    .replace(/(地区|盟|州)$/u, '');

  if (city && !city.endsWith('市') && !city.endsWith('县') && /^[\u4e00-\u9fa5]{2,6}$/u.test(city)) {
    city = `${city}市`;
  }

  return city;
}
