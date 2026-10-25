import { firebaseConfig } from "./firebase-config.js?v=40";

export const isCloud = !!(firebaseConfig && firebaseConfig.apiKey);

export const DEFAULT_SETTINGS = {
  members: ["貝俞", "思瑜", "乃懿", "綺雯", "景岳"],
  title: "Korea Trip",
  days: 5,
  startDate: "",
  rate: 0.023, // 1 韓元 = ? 新台幣
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ---------- 本機模式 ----------
function localStore(room) {
  const key = `kt:${room}`;
  const load = () => {
    try {
      const d = JSON.parse(localStorage.getItem(key)) || {};
      return { places: d.places || [], expenses: d.expenses || [], settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) }, ready: true };
    } catch {
      return { places: [], expenses: [], settings: { ...DEFAULT_SETTINGS }, ready: true };
    }
  };
  let data = load();
  const subs = new Set();
  const emit = () => subs.forEach((cb) => cb(data));
  const save = () => {
    localStorage.setItem(key, JSON.stringify(data));
    emit();
  };
  window.addEventListener("storage", (e) => {
    if (e.key === key) {
      data = load();
      emit();
    }
  });
  return {
    mode: "local",
    subscribe(cb) {
      subs.add(cb);
      cb(data);
    },
    async add(col, obj) {
      const id = uid();
      data[col].push({ ...obj, id, createdAt: Date.now() });
      save();
      return id;
    },
    async update(col, id, patch) {
      data[col] = data[col].map((x) => (x.id === id ? { ...x, ...patch } : x));
      save();
    },
    async remove(col, id) {
      data[col] = data[col].filter((x) => x.id !== id);
      save();
    },
    async setSettings(patch) {
      data.settings = { ...data.settings, ...patch };
      save();
    },
  };
}

// ---------- Firebase 模式 ----------
async function cloudStore(room) {
  const V = "10.12.2";
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const base = ["rooms", room];
  let data = { places: [], expenses: [], settings: { ...DEFAULT_SETTINGS }, ready: false, error: false };
  let pending = 3;
  const first = () => { if (pending > 0 && --pending === 0) data.ready = true; };
  const fail = () => { data.error = true; emit(); };
  const subs = new Set();
  const emit = () => subs.forEach((cb) => cb(data));

  for (const col of ["places", "expenses"]) {
    fs.onSnapshot(fs.collection(db, ...base, col), (snap) => {
      data[col] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      first();
      emit();
    }, fail);
  }
  const settingsRef = fs.doc(db, ...base, "meta", "settings");
  fs.onSnapshot(settingsRef, (snap) => {
    data.settings = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
    first();
    emit();
  }, fail);

  return {
    mode: "cloud",
    subscribe(cb) {
      subs.add(cb);
      cb(data);
    },
    async add(col, obj) {
      const ref = await fs.addDoc(fs.collection(db, ...base, col), { ...obj, createdAt: Date.now() });
      return ref.id;
    },
    async update(col, id, patch) {
      await fs.updateDoc(fs.doc(db, ...base, col, id), patch);
    },
    async remove(col, id) {
      await fs.deleteDoc(fs.doc(db, ...base, col, id));
    },
    async setSettings(patch) {
      await fs.setDoc(settingsRef, patch, { merge: true });
    },
  };
}

export async function createStore(room) {
  return isCloud ? cloudStore(room) : localStore(room);
}
