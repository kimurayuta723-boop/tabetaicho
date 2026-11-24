// 画面に依存しない判定処理(条件の判定・今日のカードの選び方・表示用の文字)

export const LIMIT = 15;

export const CONDITIONS = {
  cold: "寒い日",
  hot: "暑い日",
  rain: "雨の日",
  weekend: "週末",
  payday: "給料日",
  birthday: "誕生日",
  tired: "疲れた日",
  genki: "元気を出したい日",
  anytime: "いつでも",
};

export const GROUPS = [
  { label: "天気", keys: ["cold", "hot", "rain"] },
  { label: "日", keys: ["weekend", "payday", "birthday"] },
  { label: "気分", keys: ["tired", "genki"] },
  { label: "ほか", keys: ["anytime"] },
];

export const KIND_LABEL = { want: "食べたい", make: "作りたい" };

export const RAIN_THRESHOLD = 50; // 降水確率(%)。雨の日の基準は固定

export const DEFAULT_SETTINGS = { cold: 12, hot: 28 };

export function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function monthDay(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function lastDayOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// 今日あてはまる条件の一覧を返す
export function todayFlags(now, weather, household) {
  const flags = new Set();
  const hh = household || {};
  const cold = Number.isFinite(hh.cold) ? hh.cold : DEFAULT_SETTINGS.cold;
  const hot = Number.isFinite(hh.hot) ? hh.hot : DEFAULT_SETTINGS.hot;

  if (weather && Number.isFinite(weather.max)) {
    if (weather.max <= cold) flags.add("cold");
    if (weather.max >= hot) flags.add("hot");
  }
  if (weather && Number.isFinite(weather.rain) && weather.rain >= RAIN_THRESHOLD) {
    flags.add("rain");
  }

  const dow = now.getDay();
  if (dow === 0 || dow === 6) flags.add("weekend");

  const payday = Number(hh.payday);
  if (payday >= 1 && payday <= 31) {
    // 給料日が月末より後の日付(31日など)の月は、月末の日を給料日とみなす
    const target = Math.min(payday, lastDayOfMonth(now));
    if (now.getDate() === target) flags.add("payday");
  }

  const md = dateKey(now).slice(5);
  if (Array.isArray(hh.birthdays) && hh.birthdays.includes(md)) flags.add("birthday");

  const mood = hh.mood;
  if (mood && mood.date === dateKey(now) && Array.isArray(mood.list)) {
    mood.list.forEach((k) => {
      if (k === "tired" || k === "genki") flags.add(k);
    });
  }
  return flags;
}

// 条件に合うものは2、いつでもは1、合わないものは0
export function scoreCard(card, flags) {
  const conds = card.conditions && card.conditions.length ? card.conditions : ["anytime"];
  if (conds.some((c) => c !== "anytime" && flags.has(c))) return 2;
  if (conds.includes("anytime")) return 1;
  return 0;
}

// 今日の画面に出すカード(最大3枚)。予告済み→条件に合う→いつでも、同じなら書いた日が古い順
export function pickToday(cards, flags, max = 3) {
  return cards
    .map((c) => ({ card: c, score: scoreCard(c, flags) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (!!b.card.planned !== !!a.card.planned) return b.card.planned ? 1 : -1;
      if (b.score !== a.score) return b.score - a.score;
      return (a.card.createdAt || 0) - (b.card.createdAt || 0);
    })
    .slice(0, max)
    .map((x) => x.card);
}

// 今日の画面の帯に出す一文
export function weatherSentence(weather, flags) {
  if (!weather || !Number.isFinite(weather.max)) return "天気を取得できませんでした。";
  let s = `最高${weather.max}℃`;
  if (flags.has("cold")) s += "、寒い日です。";
  else if (flags.has("hot")) s += "、暑い日です。";
  else s += "です。";
  if (flags.has("rain")) s += "雨の予報があります。";
  return s;
}

export function conditionText(card) {
  const conds = card.conditions && card.conditions.length ? card.conditions : ["anytime"];
  return conds.map((c) => CONDITIONS[c] || c).join("・");
}

export function sortByCreated(cards) {
  return [...cards].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
