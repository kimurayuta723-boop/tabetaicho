// Firebase(匿名ログインとFirestore)とのやりとり
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  deleteDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

let db = null;

export function isConfigured() {
  return Boolean(firebaseConfig.apiKey) && !firebaseConfig.apiKey.startsWith("ここに");
}

export async function start() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache() });
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
}

// 合言葉から、二人で共有する帖のIDを作る(合言葉そのものは保存しない)
export async function householdId(passphrase) {
  const text = "tabetaicho:" + passphrase.normalize("NFKC").trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

const hhRef = (hid) => doc(db, "households", hid);
const cardsRef = (hid) => collection(db, "households", hid, "cards");
const recordsRef = (hid) => collection(db, "households", hid, "records");

export async function getHousehold(hid) {
  const snap = await getDoc(hhRef(hid));
  return snap.exists() ? snap.data() : null;
}

export function saveHousehold(hid, patch) {
  return setDoc(hhRef(hid), patch, { merge: true });
}

function watchList(ref, cb) {
  return onSnapshot(ref, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function watchHousehold(hid, cb) {
  return onSnapshot(hhRef(hid), (snap) => cb(snap.exists() ? snap.data() : {}));
}
export const watchCards = (hid, cb) => watchList(cardsRef(hid), cb);
export const watchRecords = (hid, cb) => watchList(recordsRef(hid), cb);

export const addCard = (hid, data) => addDoc(cardsRef(hid), data);
export const updateCard = (hid, id, patch) =>
  setDoc(doc(db, "households", hid, "cards", id), patch, { merge: true });
export const deleteCard = (hid, id) => deleteDoc(doc(db, "households", hid, "cards", id));
export const addRecord = (hid, data) => addDoc(recordsRef(hid), data);
