import type { WeatherData } from './types';
/** Missing readings are shown as unavailable rather than fabricated weather. */
export const getWeatherData = (): WeatherData => ({ hourlyForecast: [] });
