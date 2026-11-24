// たべたい帖 本体
import * as data from "./data.js";
import { fetchWeather, searchPlace } from "./weather.js";
import {
  LIMIT, CONDITIONS, GROUPS, KIND_LABEL, DEFAULT_SETTINGS,
  todayFlags, pickToday, weatherSentence, conditionText, monthDay, dateKey, sortByCreated,
} from "./logic.js";

const LS = { hid: "tabetaicho.hid", role: "tabetaicho.role" };
const APP_VERSION = "v7"; // 設定画面の下に表示。更新が届いたかの確認用
const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

const newDraft = () => ({ kind: "want", name: "", conditions: [], note: "", photo: null, link: "", showLink: false });

const state = {
  hid: lsGet(LS.hid),
  role: lsGet(LS.role) || "cook",
  household: {},
  cards: [],
  records: [],
  weather: undefined, // undefined: 取得中 / null: 取得できなかった
  weatherKey: "",
  view: "today",
  draft: newDraft(),
  sheet: null,
  setup: { step: 1, pass: "", role: "cook", query: "", results: [], place: null, payday: "", b1m: "", b1d: "", b2m: "", b2d: "", error: "" },
  confirmDelete: null,
  pendingRender: false,
  editId: null, // 書き直し中のページのID
  returnView: "today",
  savedDraft: null, // 書き直しの前に書きかけていた内容
};

function startEdit(card) {
  state.savedDraft = state.draft;
  state.returnView = state.view;
  state.editId = card.id;
  const conds = card.conditions && card.conditions.length ? [...card.conditions] : ["anytime"];
  state.draft = {
    kind: card.kind || "want", name: card.name || "", conditions: conds, note: card.note || "",
    photo: card.photo || null, link: card.link || "", showLink: Boolean(card.link),
  };
  state.sheet = null;
  state.confirmDelete = null;
  state.view = "write";
}

function endEdit() {
  state.editId = null;
  state.draft = state.savedDraft || newDraft();
  state.savedDraft = null;
}

/* ---------- 小さな道具 ---------- */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 使えない環境では保存しない */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 同上 */ } }

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

const ICON_PLUS = (color) => `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" fill="none" stroke="${color}" stroke-width="1.4"/></svg>`;
const ICON_MINUS = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10" fill="none" stroke="#22385A" stroke-width="1.4"/></svg>`;
const ICON_NEXT = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2l5 5-5 5" fill="none" stroke="#24221F" stroke-width="1.4"/></svg>`;
const ICON_BACK = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M8 1.5L3.5 6 8 10.5" fill="none" stroke="#DDE3EC" stroke-width="1.4"/></svg>`;
const ICON_AGAIN = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M11.5 7a4.5 4.5 0 1 1-1.3-3.2M11.5 1.8v2.6H8.9" fill="none" stroke="#22385A" stroke-width="1.3"/></svg>`;

function todayLabel(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日(${"日月火水木金土"[d.getDay()]})`;
}

function cardById(id) { return state.cards.find((c) => c.id === id); }

// 写真を長辺800pxのJPEGに縮める(Firestoreの1件1MBの上限に収めるため)
function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let q = 0.75;
      let out = canvas.toDataURL("image/jpeg", q);
      while (out.length > 600000 && q > 0.35) {
        q -= 0.1;
        out = canvas.toDataURL("image/jpeg", q);
      }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
}

function normalizeLink(s) {
  const t = (s || "").trim();
  if (!t) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : "https://" + t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch (e) {
    return "";
  }
}

// 誕生日は月と日をそれぞれ一覧から選ぶ(iPhoneの数字キーボードには「/」がないため)
function birthdayPicker(id, label, monthKey, dayKey) {
  const s = state.setup;
  const opts = (n, cur) => `<option value="">—</option>` +
    Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${String(i + 1) === cur ? " selected" : ""}>${i + 1}</option>`).join("");
  return `<div class="field"><span class="field__label" id="${id}">${label}(なくてもよい)</span>
    <div class="date-pick" role="group" aria-labelledby="${id}">
      <select class="select" aria-label="月" data-field="setup.${monthKey}">${opts(12, s[monthKey])}</select><span>月</span>
      <select class="select" aria-label="日" data-field="setup.${dayKey}">${opts(31, s[dayKey])}</select><span>日</span>
    </div></div>`;
}

function toMonthDay(m, d) {
  if (!m && !d) return "";
  if (!m || !d) return null;
  const mm = Number(m); const dd = Number(d);
  const max = new Date(2024, mm, 0).getDate(); // うるう年の2月29日も選べるように2024年で数える
  if (dd > max) return null;
  return `${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/* ---------- 部品 ---------- */
function band({ title, aside = "", back = false }) {
  if (back) {
    return `<header class="band band--back">
      <button class="band__link" data-act="go" data-view="today">${ICON_BACK}今日にもどる</button>
      <h1 class="band__title">${esc(title)}</h1>
    </header>`;
  }
  return `<header class="band"><h1 class="band__title">${esc(title)}</h1><span class="band__aside">${esc(aside)}</span></header>`;
}

function nav() {
  const cur = (v) => (state.view === v || (v === "today" && state.view === "all") ? ' aria-current="page"' : "");
  const writeColor = "#F5F1E8";
  return `<nav class="nav" aria-label="画面の切り替え">
    <button data-act="go" data-view="today"${cur("today")}>今日</button>
    <button class="nav__write" data-act="go" data-view="write"${cur("write")}>${ICON_PLUS(writeColor)}書く</button>
    <button data-act="go" data-view="records"${cur("records")}>済んだページ</button>
  </nav>`;
}

// 押せることが分かるよう、右端に矢印を付ける
function cardRow(card) {
  const meta = `<b>${KIND_LABEL[card.kind] || ""}</b>${esc(conditionText(card))} ・ ${monthDay(card.createdAt)}に書いた`;
  return `<button class="row${card.planned ? " row--planned" : ""}" data-act="open-card" data-id="${esc(card.id)}" aria-label="${esc(card.name)}を開く">
    <span class="row__meta">${meta}</span>
    <span class="row__name">${esc(card.name)}</span>
    ${card.note ? `<span class="row__note">${esc(card.note)}</span>` : ""}
    ${card.planned ? '<span class="ribbon" aria-hidden="true">今週</span>' : ""}
    <span class="row__arrow" aria-hidden="true">${ICON_NEXT}</span>
  </button>`;
}

// しおりの形の小さな印。付いているときは朱で塗る
function ribbonMark(on) {
  return `<svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true"><path d="M1 0.7h8v12.2l-4-3.2-4 3.2z" fill="${on ? "#C0442C" : "none"}" stroke="${on ? "#C0442C" : "#22385A"}" stroke-width="1.3"/></svg>`;
}

function meter(count) {
  const bars = Array.from({ length: LIMIT }, (_, i) => `<span${i < count ? ' class="on"' : ""}></span>`).join("");
  return `<span class="meter"><span class="meter__bars" aria-hidden="true">${bars}</span><span class="meter__text">あと${Math.max(0, LIMIT - count)}枚</span></span>`;
}

/* ---------- 画面 ---------- */
function viewToday() {
  const now = new Date();
  const flags = todayFlags(now, state.weather, state.household);
  const sentence = state.weather === undefined ? "天気を確かめています。" : weatherSentence(state.weather, flags);
  const header = `<header class="band band--stack">
    <div class="band__row">
      <p class="band__date">${todayLabel(now)}</p>
      <button class="band__link" data-act="go" data-view="settings">設定</button>
    </div>
    <p class="band__sub">${esc(sentence)}</p>
  </header>`;

  let body;
  if (state.cards.length === 0) {
    body = `<h1 class="page__title">今日</h1>
      <div class="blank-lines" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="empty">
        <p class="empty__title">帖はまだ白いままです。</p>
        <p class="empty__text">食べたいもの、作りたいものを書いておくと、合う日にここに出てきます。</p>
      </div>
      <button class="outline-link" data-act="go" data-view="write">${ICON_PLUS("#22385A")}最初の1枚を書く</button>`;
  } else {
    const picked = pickToday(state.cards, flags);
    const rest = state.cards.length - picked.length;
    const title = picked.length ? "今日のおすすめ" : "今日に合うページはありません";
    body = `<h1 class="page__title">${title}</h1>
      ${picked.length ? picked.map(cardRow).join("") : '<p class="lead" style="margin-top:18px">今日の条件に合うページがありません。すべてのページから選べます。</p>'}
      <button class="more" data-act="go" data-view="all">
        <span class="more__line"><span>${picked.length && rest > 0 ? `ほかの${rest}枚を見る` : "すべてのページを見る"}</span>${ICON_NEXT}</span>
        ${meter(state.cards.length)}
      </button>`;
  }

  const mood = state.household.mood && state.household.mood.date === dateKey(now) ? state.household.mood.list || [] : [];
  const moodRow = `<div class="mood">
    <span class="small">今日の気分</span>
    <div class="chips">
      ${["tired", "genki"].map((k) => `<button class="chip" data-act="mood" data-key="${k}" aria-pressed="${mood.includes(k)}">${CONDITIONS[k]}</button>`).join("")}
    </div>
  </div>`;

  return header + `<main class="page">${body}${moodRow}</main>` + nav();
}

function viewAll() {
  const list = sortByCreated(state.cards);
  return band({ title: "すべてのページ", back: true }) +
    `<main class="page">
      <h2 class="page__title">${list.length} / ${LIMIT}枚(書いた日が古い順)</h2>
      ${list.length ? list.map(cardRow).join("") : '<p class="lead" style="margin-top:18px">まだ何も書かれていません。</p>'}
    </main>` + nav();
}

function viewWrite() {
  const editing = Boolean(state.editId);
  if (!editing && state.cards.length >= LIMIT) return viewFull();
  const d = state.draft;
  const groups = GROUPS.map((g) => `<div class="cond-group">
      <span class="cond-group__label">${g.label}</span>
      <div class="chips">${g.keys.map((k) => `<button type="button" class="chip" data-act="toggle-cond" data-key="${k}" aria-pressed="${d.conditions.includes(k)}">${CONDITIONS[k]}</button>`).join("")}</div>
    </div>`).join("");

  const photo = d.photo
    ? `<div class="inline-actions"><img class="thumb" src="${d.photo}" alt="添えた写真"><button type="button" class="text-btn text-btn--quiet" data-act="remove-photo">写真を外す</button></div>`
    : `<label class="text-btn">${ICON_PLUS("#22385A")}写真を添える<input class="visually-hidden" type="file" accept="image/*" data-file="draft"></label>`;
  const link = d.showLink
    ? `<div class="field"><label for="f-link">リンク</label><input id="f-link" class="input" type="url" inputmode="url" placeholder="https://" value="${esc(d.link)}" data-field="link"></div>`
    : `<button type="button" class="text-btn" data-act="show-link">${ICON_PLUS("#22385A")}リンクを添える</button>`;

  const head = editing
    ? band({ title: "書き直す", aside: "" })
    : band({ title: "書く", aside: `あと${LIMIT - state.cards.length}枚` });
  return head +
    `<main class="page">
      <form class="form" data-form="write" novalidate>
        <div class="seg" role="group" aria-label="種類">
          <button type="button" data-act="kind" data-kind="want" aria-pressed="${d.kind === "want"}">食べたい</button>
          <button type="button" data-act="kind" data-kind="make" aria-pressed="${d.kind === "make"}">作りたい</button>
        </div>
        <div class="field">
          <label for="f-name">${d.kind === "make" ? "作りたいもの" : "食べたいもの"}</label>
          <input id="f-name" class="input input--name" type="text" autocomplete="off" maxlength="40" value="${esc(d.name)}" data-field="name">
        </div>
        <fieldset>
          <legend>どんな日に${d.kind === "make" ? "作りたい" : "食べたい"}?(いくつでも)</legend>
          <div style="display:flex;flex-direction:column;gap:10px">${groups}</div>
        </fieldset>
        <div class="field">
          <label for="f-note">ひとこと(なくてもよい)</label>
          <input id="f-note" class="input" type="text" autocomplete="off" maxlength="60" value="${esc(d.note)}" data-field="note">
        </div>
        ${photo}
        ${link}
        <button type="submit" class="primary form__submit">${editing ? "保存する" : "帖に書き込む"}</button>
        ${editing ? '<button type="button" class="secondary" data-act="cancel-edit">やめる</button>' : ""}
      </form>
    </main>` + (editing ? "" : nav()); // 書き直し中は下のタブを出さず、保存かもどるかに絞る
}

function viewFull() {
  const list = sortByCreated(state.cards);
  return band({ title: "書く", aside: `${LIMIT} / ${LIMIT}枚` }) +
    `<main class="page">
      <div class="empty" style="padding-top:0;padding-bottom:22px">
        <p class="empty__title">帖がいっぱいです。</p>
        <p class="empty__text">新しく書くには、どれか1枚を取り下げてください。</p>
      </div>
      <div class="list">
        ${list.map((c) => `<div class="list-item">
          <div class="list-item__main">
            <span class="small">${KIND_LABEL[c.kind] || ""} ・ ${monthDay(c.createdAt)}に書いた</span>
            <span class="list-item__name">${esc(c.name)}</span>
          </div>
          <button class="underline-btn" data-act="withdraw" data-id="${esc(c.id)}">${state.confirmDelete === c.id ? "本当に取り下げる" : "取り下げる"}</button>
        </div>`).join("")}
      </div>
    </main>` + nav();
}

function viewRecords() {
  const list = [...state.records].sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  let html = "";
  let month = "";
  list.forEach((r) => {
    const d = new Date(r.doneAt);
    const m = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (m !== month) { html += `<h2 class="month">${m}</h2>`; month = m; }
    html += `<article class="record${r.photo ? "" : " record--text"}">
      ${r.photo ? `<img class="thumb" src="${r.photo}" alt="${esc(r.name)}の写真">` : ""}
      <div class="record__body">
        <p class="record__meta"><span>${monthDay(r.doneAt)}</span>${KIND_LABEL[r.kind] || ""}</p>
        <h3 class="record__name">${esc(r.name)}</h3>
        ${r.comment ? `<p class="record__note">${esc(r.comment)}</p>` : ""}
        <button class="text-btn" data-act="again" data-id="${esc(r.id)}">${ICON_AGAIN}また食べたい</button>
      </div>
    </article>`;
  });
  return band({ title: "済んだページ", aside: list.length ? `これまでに${list.length}回` : "" }) +
    `<main class="page">${html || '<div class="empty" style="padding-top:0"><p class="empty__title">まだ済んだページはありません。</p><p class="empty__text">食べたものは、ここに写真とひとことと一緒に残ります。</p></div>'}</main>` + nav();
}

function viewSettings() {
  const hh = state.household;
  const cold = Number.isFinite(hh.cold) ? hh.cold : DEFAULT_SETTINGS.cold;
  const hot = Number.isFinite(hh.hot) ? hh.hot : DEFAULT_SETTINGS.hot;
  let preview = "天気を取得できていません";
  if (state.weather && Number.isFinite(state.weather.max)) {
    const t = state.weather.max;
    preview = t <= cold ? "「寒い日」になります" : t >= hot ? "「暑い日」になります" : "「寒い日」でも「暑い日」でもありません";
  }
  const stepper = (key, name, desc, value) => `<div class="stepper-row">
    <div style="display:flex;flex-direction:column;gap:2px">
      <span class="stepper-row__name">${name}</span><span class="small">${desc}</span>
    </div>
    <div class="stepper">
      <button data-act="step" data-key="${key}" data-delta="-1" aria-label="${name}の基準を1℃下げる">${ICON_MINUS}</button>
      <output aria-live="polite">${value}℃</output>
      <button data-act="step" data-key="${key}" data-delta="1" aria-label="${name}の基準を1℃上げる">${ICON_PLUS("#22385A")}</button>
    </div>
  </div>`;
  return band({ title: "気温の基準", back: true }) +
    `<main class="page">
      <p class="lead">その日の最高気温で「寒い日」「暑い日」を決めます。</p>
      <div class="list">
        ${stepper("cold", "寒い日", "最高気温がこの温度以下", cold)}
        ${stepper("hot", "暑い日", "最高気温がこの温度以上", hot)}
      </div>
      <div class="preview"><span class="small">今日${state.weather && Number.isFinite(state.weather.max) ? `(最高${state.weather.max}℃)` : ""}は</span><strong>${preview}</strong></div>
      <div class="section-gap">
        <p class="small">地域:${esc(hh.placeName || "未設定")} ・ この端末は「${state.role === "cook" ? "作る人" : "頼む人"}」 ・ ${APP_VERSION}</p>
        <button class="text-btn text-btn--quiet" data-act="reset">最初の設定をやり直す(帖の中身は消えません)</button>
      </div>
    </main>`;
}

function viewSheet() {
  const s = state.sheet;
  if (!s) return "";
  const card = cardById(s.id);
  if (!card) return "";
  let inner;
  if (s.type === "done") {
    inner = `<h2 class="sheet__name">${esc(card.name)}を食べた</h2>
      ${s.photo
        ? `<div class="inline-actions"><img class="thumb" src="${s.photo}" alt="食べたものの写真"><button class="text-btn text-btn--quiet" data-act="done-remove-photo">写真を外す</button></div>`
        : `<label class="text-btn">${ICON_PLUS("#22385A")}写真を添える<input class="visually-hidden" type="file" accept="image/*" data-file="done"></label>`}
      <div class="field"><label for="f-comment">ひとこと(なくてもよい)</label>
        <input id="f-comment" class="input" type="text" maxlength="60" value="${esc(s.comment || "")}" data-field="comment"></div>
      <div class="sheet__actions">
        <button class="primary" data-act="done-save">済んだページに移す</button>
        <button class="secondary" data-act="close">やめる</button>
      </div>`;
  } else {
    const cook = state.role === "cook";
    const confirming = state.confirmDelete === card.id;
    inner = `<div class="sheet__top">
        <p class="row__meta" style="margin:0"><b style="color:#24221F;margin-right:8px">${KIND_LABEL[card.kind] || ""}</b>${esc(conditionText(card))} ・ ${monthDay(card.createdAt)}に書いた</p>
        <button class="sheet__close" data-act="close">閉じる</button>
      </div>
      <h2 class="sheet__name">${esc(card.name)}</h2>
      ${card.planned && !cook ? `<p class="sheet__planned">${ribbonMark(true)}今週たべる予定</p>` : ""}
      ${card.note ? `<p class="sheet__note">${esc(card.note)}</p>` : ""}
      ${card.photo ? `<img class="sheet__photo" src="${card.photo}" alt="${esc(card.name)}の参考写真">` : ""}
      ${card.link ? `<a class="text-btn" href="${esc(card.link)}" target="_blank" rel="noopener noreferrer">リンクを開く</a>` : ""}
      <div class="sheet__actions">
        ${cook ? `<button class="primary" data-act="done-start">食べた</button>
        <div class="sheet__pair">
          <button class="toggle" data-act="plan" aria-pressed="${Boolean(card.planned)}">${ribbonMark(card.planned)}今週たべる</button>
          <button class="secondary" data-act="edit">書き直す</button>
        </div>` : `<button class="secondary" data-act="edit">書き直す</button>`}
        <button class="danger-btn" data-act="withdraw" data-id="${esc(card.id)}">${confirming ? "もう一度押すと取り下げます" : "取り下げる"}</button>
      </div>`;
  }
  return `<div class="backdrop" data-act="backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(card.name)}">${inner}</div></div>`;
}

function viewSetup() {
  const s = state.setup;
  const header = `<header class="band"><h1 class="band__title">たべたい帖</h1><span class="band__aside">はじめの設定</span></header>`;
  if (s.step === 1) {
    return header + `<main class="page">
      <form class="form" data-form="setup1" novalidate>
        <p class="lead" style="margin:0">二人で同じ合言葉を入れると、同じ帖を使えます。先に始めた人が決めた合言葉を、もう一人に伝えてください。</p>
        <div class="field"><label for="f-pass">家族の合言葉(8文字以上)</label>
          <input id="f-pass" class="input" type="text" autocomplete="off" autocapitalize="off" value="${esc(s.pass)}" data-field="setup.pass"></div>
        <div class="field"><span class="field__label">この端末を使うのは</span>
          <div class="seg" role="group" aria-label="この端末を使う人">
            <button type="button" data-act="setup-role" data-role="cook" aria-pressed="${s.role === "cook"}">作る人</button>
            <button type="button" data-act="setup-role" data-role="eater" aria-pressed="${s.role === "eater"}">頼む人</button>
          </div></div>
        ${s.error ? `<p class="error">${esc(s.error)}</p>` : ""}
        <button type="submit" class="primary">次へ</button>
      </form></main>`;
  }
  return header + `<main class="page">
    <form class="form" data-form="setup2" novalidate>
      <p class="lead" style="margin:0">新しい帖を作ります。ここで決めた内容は、もう一人にも使われます。</p>
      <div class="field"><label for="f-place">天気を調べる地域</label>
        <div class="search-row"><input id="f-place" class="input" type="text" placeholder="例 福岡" value="${esc(s.query)}" data-field="setup.query"><button type="button" data-act="search-place">探す</button></div>
      </div>
      ${s.results.length ? `<div class="place-results">${s.results.map((r, i) => `<button type="button" data-act="pick-place" data-index="${i}" aria-pressed="${s.place && s.place.label === r.label}">${esc(r.label)}</button>`).join("")}</div>` : ""}
      <div class="field"><label for="f-payday">給料日(なくてもよい)</label>
        <input id="f-payday" class="input" type="number" inputmode="numeric" min="1" max="31" placeholder="例 21" value="${esc(s.payday)}" data-field="setup.payday"></div>
      ${birthdayPicker("l-b1", "誕生日", "b1m", "b1d")}
      ${birthdayPicker("l-b2", "もう一人の誕生日", "b2m", "b2d")}
      ${s.error ? `<p class="error">${esc(s.error)}</p>` : ""}
      <button type="submit" class="primary">はじめる</button>
      <button type="button" class="text-btn text-btn--quiet" data-act="setup-back">合言葉を入れ直す</button>
    </form></main>`;
}

function viewMessage(title, text) {
  return `<header class="band"><h1 class="band__title">たべたい帖</h1></header>
    <main class="page"><div class="empty" style="padding-top:0"><p class="empty__title">${esc(title)}</p><p class="empty__text">${text}</p></div></main>`;
}

/* ---------- 描画 ---------- */
const VIEWS = { today: viewToday, all: viewAll, write: viewWrite, records: viewRecords, settings: viewSettings, setup: viewSetup };

function render(force = false) {
  const active = document.activeElement;
  if (!force && active && app.contains(active) && active.tagName === "INPUT" && active.type !== "file") {
    state.pendingRender = true; // 入力中は描き直さない(入力が途切れないように)
    return;
  }
  state.pendingRender = false;
  app.innerHTML = (VIEWS[state.view] || viewToday)() + viewSheet();
}

app.addEventListener("focusout", () => {
  setTimeout(() => {
    if (state.pendingRender && !(document.activeElement && document.activeElement.tagName === "INPUT")) render();
  }, 0);
});

function go(view) {
  if (state.editId) endEdit(); // 書き直しの途中でほかの画面へ移ったら、書き直しはやめる
  state.view = view;
  state.sheet = null;
  state.confirmDelete = null;
  render(true);
  window.scrollTo(0, 0);
}

/* ---------- 操作 ---------- */
app.addEventListener("input", (e) => {
  const f = e.target.dataset.field;
  if (!f) return;
  if (f.startsWith("setup.")) state.setup[f.slice(6)] = e.target.value;
  else if (f === "comment") { if (state.sheet) state.sheet.comment = e.target.value; }
  else state.draft[f] = e.target.value;
});

app.addEventListener("change", async (e) => {
  const which = e.target.dataset.file;
  if (!which || !e.target.files || !e.target.files[0]) return;
  try {
    const photo = await compressPhoto(e.target.files[0]);
    if (which === "draft") state.draft.photo = photo;
    else if (state.sheet) state.sheet.photo = photo;
    render(true);
  } catch (err) {
    toast("写真を読み込めませんでした。");
  }
});

app.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target.dataset.form;
  if (form === "write") submitWrite();
  if (form === "setup1") submitSetup1();
  if (form === "setup2") submitSetup2();
});

app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  if (act === "backdrop" && e.target !== t) return; // 紙の中を押したときは閉じない
  handlers[act] && handlers[act](t);
});

// 設定や気分は、続けて押されることがあるので少し待ってからまとめて保存する
const pending = {};
let saveTimer = null;
function saveLater(patch) {
  Object.assign(state.household, patch);
  Object.assign(pending, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const toSave = { ...pending };
    Object.keys(toSave).forEach((k) => delete pending[k]);
    data.saveHousehold(state.hid, toSave).catch(() => toast("保存できませんでした。通信を確かめてください。"));
  }, 600);
}

const handlers = {
  go: (t) => go(t.dataset.view),
  kind: (t) => { state.draft.kind = t.dataset.kind; render(true); },
  "toggle-cond": (t) => {
    const k = t.dataset.key;
    const list = state.draft.conditions;
    state.draft.conditions = list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
    render(true);
  },
  "remove-photo": () => { state.draft.photo = null; render(true); },
  "show-link": () => { state.draft.showLink = true; render(true); const el = document.getElementById("f-link"); if (el) el.focus(); },
  "open-card": (t) => { toastEl.classList.remove("show"); state.sheet = { type: "card", id: t.dataset.id }; state.confirmDelete = null; render(true); }, // 前の知らせがボタンに重ならないよう消す
  close: () => { state.sheet = null; state.confirmDelete = null; render(true); },
  backdrop: () => { state.sheet = null; state.confirmDelete = null; render(true); },
  plan: async () => {
    const card = cardById(state.sheet && state.sheet.id);
    if (!card) return;
    try {
      await data.updateCard(state.hid, card.id, { planned: !card.planned }); // ボタンの見た目が変わるので知らせは出さない
    } catch (err) { toast("保存できませんでした。通信を確かめてください。"); }
  },
  edit: () => {
    const card = cardById(state.sheet && state.sheet.id);
    if (!card) return;
    startEdit(card);
    render(true);
    window.scrollTo(0, 0);
  },
  "cancel-edit": () => {
    const back = state.returnView || "today";
    endEdit();
    go(back);
  },
  "done-start": () => { state.sheet = { type: "done", id: state.sheet.id, photo: null, comment: "" }; render(true); },
  "done-remove-photo": () => { state.sheet.photo = null; render(true); },
  "done-save": async () => {
    const s = state.sheet;
    const card = cardById(s && s.id);
    if (!card) return;
    const record = {
      name: card.name, kind: card.kind, conditions: card.conditions || [], note: card.note || "",
      link: card.link || "", photo: s.photo || card.photo || null, comment: (s.comment || "").trim(),
      writtenAt: card.createdAt || null, doneAt: Date.now(),
    };
    try {
      await data.addRecord(state.hid, record);
      await data.deleteCard(state.hid, card.id);
      state.sheet = null;
      toast("済んだページに移しました");
      render(true);
    } catch (err) { toast("保存できませんでした。通信を確かめてください。"); }
  },
  withdraw: async (t) => {
    const id = t.dataset.id;
    if (state.confirmDelete !== id) { state.confirmDelete = id; render(true); return; }
    try {
      await data.deleteCard(state.hid, id);
      state.confirmDelete = null;
      state.sheet = null;
      toast("取り下げました");
      render(true);
    } catch (err) { toast("取り下げられませんでした。通信を確かめてください。"); }
  },
  again: async (t) => {
    const r = state.records.find((x) => x.id === t.dataset.id);
    if (!r) return;
    if (state.cards.length >= LIMIT) { toast("帖がいっぱいです。1枚取り下げてから戻してください。"); return; }
    try {
      await data.addCard(state.hid, {
        kind: r.kind || "want", name: r.name, conditions: r.conditions || [], note: r.note || "",
        link: r.link || "", photo: null, planned: false, createdAt: Date.now(), from: state.role,
      });
      toast("帖に戻しました");
    } catch (err) { toast("保存できませんでした。通信を確かめてください。"); }
  },
  mood: (t) => {
    const today = dateKey(new Date());
    const cur = state.household.mood && state.household.mood.date === today ? state.household.mood.list || [] : [];
    const k = t.dataset.key;
    const list = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    saveLater({ mood: { date: today, list } });
    render(true);
  },
  step: (t) => {
    const hh = state.household;
    const cold = Number.isFinite(hh.cold) ? hh.cold : DEFAULT_SETTINGS.cold;
    const hot = Number.isFinite(hh.hot) ? hh.hot : DEFAULT_SETTINGS.hot;
    const delta = Number(t.dataset.delta);
    if (t.dataset.key === "cold") saveLater({ cold: Math.max(-5, Math.min(hot - 2, cold + delta)) });
    else saveLater({ hot: Math.min(40, Math.max(cold + 2, hot + delta)) });
    render(true);
  },
  reset: () => {
    lsDel(LS.hid);
    lsDel(LS.role);
    location.reload();
  },
  "setup-role": (t) => { state.setup.role = t.dataset.role; render(true); },
  "setup-back": () => { state.setup.step = 1; state.setup.error = ""; render(true); },
  "search-place": async () => {
    const q = state.setup.query.trim();
    if (!q) return;
    try {
      state.setup.results = await searchPlace(q);
      state.setup.error = state.setup.results.length ? "" : "見つかりませんでした。「福岡」のように市の名前だけで探してみてください。";
    } catch (err) {
      state.setup.error = "地域を探せませんでした。通信を確かめてください。";
    }
    render(true);
  },
  "pick-place": (t) => { state.setup.place = state.setup.results[Number(t.dataset.index)]; render(true); },
};

async function submitWrite() {
  const d = state.draft;
  const name = d.name.trim();
  if (!name) { toast(d.kind === "make" ? "作りたいものを書いてください" : "食べたいものを書いてください"); return; }
  const link = normalizeLink(d.link);
  if (d.link.trim() && !link) { toast("リンクの形が正しくありません。"); return; }
  if (state.editId) {
    const id = state.editId;
    if (!cardById(id)) { toast("このページは取り下げられたか、済んだページに移っています。"); return; }
    try {
      await data.updateCard(state.hid, id, {
        kind: d.kind, name, conditions: d.conditions.length ? d.conditions : ["anytime"],
        note: d.note.trim(), photo: d.photo || null, link,
      });
      const back = state.returnView || "today";
      endEdit();
      toast("書き直しました");
      go(back);
    } catch (err) {
      toast("保存できませんでした。写真が大きすぎるか、通信が切れています。");
    }
    return;
  }
  if (state.cards.length >= LIMIT) { render(true); return; }
  const card = {
    kind: d.kind, name, conditions: d.conditions.length ? d.conditions : ["anytime"],
    note: d.note.trim(), photo: d.photo || null, link, planned: false, createdAt: Date.now(), from: state.role,
  };
  try {
    await data.addCard(state.hid, card);
    state.draft = newDraft();
    toast("書き込みました");
    go("today");
  } catch (err) {
    toast("書き込めませんでした。写真が大きすぎるか、通信が切れています。");
  }
}

async function submitSetup1() {
  const s = state.setup;
  const pass = s.pass.trim();
  if (pass.length < 8) { s.error = "合言葉は8文字以上にしてください。"; render(true); return; }
  try {
    const hid = await data.householdId(pass);
    const existing = await data.getHousehold(hid);
    if (existing) { finishSetup(hid, s.role); return; }
    s.hid = hid;
    s.step = 2;
    s.error = "";
    render(true);
  } catch (err) {
    s.error = "つながりませんでした。通信を確かめてください。";
    render(true);
  }
}

async function submitSetup2() {
  const s = state.setup;
  if (!s.place) { s.error = "天気を調べる地域を探して、一覧から選んでください。"; render(true); return; }
  const payday = s.payday ? Number(s.payday) : null;
  if (payday !== null && !(payday >= 1 && payday <= 31)) { s.error = "給料日は1〜31の数字で入れてください。"; render(true); return; }
  const birthdays = [];
  for (const [m, d] of [[s.b1m, s.b1d], [s.b2m, s.b2d]]) {
    const md = toMonthDay(m, d);
    if (md === "") continue;
    if (md === null) { s.error = "誕生日は、月と日の両方を正しく選んでください。"; render(true); return; }
    birthdays.push(md);
  }
  try {
    await data.saveHousehold(s.hid, {
      cold: DEFAULT_SETTINGS.cold, hot: DEFAULT_SETTINGS.hot,
      placeName: s.place.name, lat: s.place.lat, lon: s.place.lon,
      payday, birthdays, createdAt: Date.now(),
    });
    finishSetup(s.hid, s.role);
  } catch (err) {
    s.error = "保存できませんでした。通信を確かめてください。";
    render(true);
  }
}

function finishSetup(hid, role) {
  lsSet(LS.hid, hid);
  lsSet(LS.role, role);
  state.hid = hid;
  state.role = role;
  state.view = "today";
  subscribe();
  render(true);
}

/* ---------- データの受け取り ---------- */
function loadWeather() {
  const hh = state.household;
  if (!Number.isFinite(hh.lat) || !Number.isFinite(hh.lon)) return;
  const key = `${dateKey(new Date())}:${hh.lat},${hh.lon}`;
  if (state.weatherKey === key && state.weather !== null) return;
  state.weatherKey = key;
  fetchWeather(hh.lat, hh.lon)
    .then((w) => { state.weather = w; })
    .catch(() => { state.weather = null; })
    .finally(() => render());
}

function subscribe() {
  data.watchHousehold(state.hid, (hh) => {
    // 自分が変えて保存待ちの値は、受け取った値で上書きしない
    state.household = { ...hh, ...pendingPatch() };
    loadWeather();
    render();
  });
  data.watchCards(state.hid, (cards) => { state.cards = cards; render(); });
  data.watchRecords(state.hid, (records) => { state.records = records; render(); });
}

function pendingPatch() {
  return { ...pending };
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.hid) {
    loadWeather(); // 日付が変わっていれば取り直す
    render();
  }
});

/* ---------- 起動 ---------- */
async function init() {
  if ("serviceWorker" in navigator) {
    // 新しい版が届いたら、開いている画面も自動で読み込み直す
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      // ホーム画面のアプリは閉じずに戻ってくることが多いので、戻るたびに新しい版を確かめる
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch(() => { /* 登録できなくても動作する */ });
  }
  if (!data.isConfigured()) {
    app.innerHTML = viewMessage("Firebaseの設定がまだです。", "js/config.js に、Firebaseコンソールの設定値を貼り付けてください。手順は README.md にあります。");
    return;
  }
  try {
    await data.start();
  } catch (err) {
    app.innerHTML = viewMessage("つながりませんでした。", "通信を確かめてから、開き直してください。Firebaseの匿名ログインが有効になっているかも確かめてください。");
    return;
  }
  if (!state.hid) {
    state.view = "setup";
    render(true);
    return;
  }
  subscribe();
  render(true);
}

init();
