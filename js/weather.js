// 天気(Open-Meteo)と地域の検索。登録や認証キーは不要
import { dateKey } from "./logic.js";

const CACHE_KEY = "tabetaicho.weather";

// その日の最高気温と降水確率。同じ日・同じ地域なら端末に保存した値を使う
export async function fetchWeather(lat, lon, now = new Date()) {
  const key = `${dateKey(now)}:${lat.toFixed(2)},${lon.toFixed(2)}`;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && cached.key === key) return cached.value;
  } catch (e) {
    /* 保存領域が使えない場合は毎回取りに行く */
  }
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&daily=temperature_2m_max,precipitation_probability_max" +
    "&timezone=Asia%2FTokyo&forecast_days=1";
  const res = await fetch(url);
  if (!res.ok) throw new Error("weather " + res.status);
  const json = await res.json();
  const max = json.daily && json.daily.temperature_2m_max ? json.daily.temperature_2m_max[0] : null;
  const rain = json.daily && json.daily.precipitation_probability_max ? json.daily.precipitation_probability_max[0] : null;
  const value = {
    max: Number.isFinite(max) ? Math.round(max) : null,
    rain: Number.isFinite(rain) ? rain : null,
  };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key, value }));
  } catch (e) {
    /* 保存できなくても動作には影響しない */
  }
  return value;
}

export async function searchPlace(name) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search" +
    `?name=${encodeURIComponent(name)}&count=6&language=ja&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("geocoding " + res.status);
  const json = await res.json();
  return (json.results || []).map((r) => ({
    label: [r.name, r.admin1, r.country].filter(Boolean).join("、"),
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
  }));
}
