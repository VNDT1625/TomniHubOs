/** Maps provider WMO weather codes to translated human-readable weather groups. */
export const weatherGroupOf = (
  value: number | undefined
): 'clear' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'thunderstorm' | 'unknown' => {
  if (value === undefined || !Number.isInteger(value)) return 'unknown';
  if (value === 0) return 'clear';
  if (value === 1 || value === 2) return 'cloudy';
  if (value === 3) return 'overcast';
  if (value === 45 || value === 48) return 'fog';
  if (value >= 51 && value <= 57) return 'drizzle';
  if (value >= 61 && value <= 67) return 'rain';
  if (value >= 71 && value <= 77) return 'snow';
  if (value >= 80 && value <= 86) return 'showers';
  if (value >= 95 && value <= 99) return 'thunderstorm';
  return 'unknown';
};
