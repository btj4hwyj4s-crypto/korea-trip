import { createStore, isCloud, DEFAULT_SETTINGS } from "./store.js";

const TYPES = {
  spot: { label: "景點", icon: "🏛" },
  food: { label: "美食", icon: "🍖" },
  expo: { label: "展覽", icon: "🖼" },
  beauty: { label: "醫美", icon: "💆" },
};
const CATS = ["餐飲", "交通", "住宿", "門票", "購物", "醫美", "其他"];
const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const krwFmt = (n) => "₩" + Math.round(n).toLocaleString();
const twdFmt = (n) => "NT$" + Math.round(n).toLocaleString();

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

const state = {
  room: new URLSearchParams(location.search).get("room") || ls.get("kt:room") || "",
  me: ls.get("kt:me") === null ? null : Number(ls.get("kt:me")),
  tab: "list",
  type: "all",
  sort: "votes",
  data: { places: [], expenses: [], settings: { ...DEFAULT_SETTINGS } },
};
let store = null;

// ---------- 工具 ----------
const naverUrl = (p) => (p.url && /^https?:\/\//.test(p.url) ? p.url : `https://map.naver.com/p/search/${encodeURIComponent(p.name + (p.area ? " " + p.area : ""))}`);
const members = () => state.data.settings.members;
const nameOf = (i) => members()[i] ?? "?";
const votesOf = (p) => (p.votes || []).length;
const toKrw = (amount, cur) => (cur === "KRW" ? amount : amount / state.data.settings.rate);

function dayLabel(i) {
  const s = state.data.settings.startDate;
  if (!s) return `第 ${i} 天`;
  const d = new Date(s + "T00:00:00");
  d.setDate(d.getDate() + i - 1);
  return `D${i} · ${d.getMonth() + 1}/${d.getDate()}`;
}

function settlement() {
  const net = members().map(() => 0);
  for (const e of state.data.expenses) {
    const ps = e.participants?.length ? e.participants : members().map((_, i) => i);
    net[e.payer] += e.krw;
    ps.forEach((p) => (net[p] -= e.krw / ps.length));
  }
  const cr = [], db = [];
  net.forEach((v, i) => (v > 1 ? cr.push({ i, v }) : v < -1 ? db.push({ i, v: -v }) : 0));
  cr.sort((a, b) => b.v - a.v);
  db.sort((a, b) => b.v - a.v);
  const out = [];
  while (cr.length && db.length) {
    const t = Math.min(cr[0].v, db[0].v);
    out.push({ from: db[0].i, to: cr[0].i, amt: t });
    cr[0].v -= t;
    db[0].v -= t;
    if (cr[0].v < 1) cr.shift();
    if (db[0].v < 1) db.shift();
  }
  return { net, transfers: out };
}

// ---------- 畫面 ----------
function render() {
  const app = $("#app");
  if (!state.room) return (app.innerHTML = gateRoom());
  if (state.me === null || state.me >= members().length) return (app.innerHTML = gateMe());
  const body = { list: viewList, plan: viewPlan, money: viewMoney, set: viewSettings }[state.tab]();
  app.innerHTML = `
    <header class="top"><h1>🇰🇷 韓國之旅</h1><button class="me" data-a="switchMe">我是:${esc(nameOf(state.me))} ▾</button></header>
    ${isCloud ? "" : `<div class="banner">目前是「本機測試模式」:資料只存在這支手機/瀏覽器,尚未同步。填好 firebase-config.js 後就會變成共編。</div>`}
    ${body}
    ${state.tab === "list" ? `<button class="fab" data-a="addPlace" aria-label="新增">＋</button>` : ""}
    ${state.tab === "money" ? `<button class="fab" data-a="addExpense" aria-label="記一筆">＋</button>` : ""}
    <nav class="tabs">
      ${[["list", "📌", "清單"], ["plan", "🗓", "行程"], ["money", "💰", "記帳"], ["set", "⚙️", "設定"]]
        .map(([k, i, l]) => `<button data-a="tab" data-v="${k}" class="${state.tab === k ? "on" : ""}"><b>${i}</b>${l}</button>`).join("")}
    </nav>`;
}

function gateRoom() {
  return `<div class="gate"><h1>🇰🇷 韓國之旅</h1><p class="meta">輸入大家約好的邀請碼進入同一個房間</p>
    <input id="roomIn" placeholder="例如 seoul2026" autocapitalize="off" autocomplete="off">
    <div class="actions"><button class="btn pri" data-a="enterRoom">進入</button></div></div>`;
}
function gateMe() {
  return `<div class="gate"><h1>你是哪一位?</h1><div class="members">
    ${members().map((m, i) => `<button class="btn" data-a="pickMe" data-v="${i}">${esc(m)}</button>`).join("")}</div></div>`;
}

function placeCard(p, extra = "") {
  const t = TYPES[p.type] || TYPES.spot;
  const voted = (p.votes || []).includes(state.me);
  return `<div class="card">
    <div class="row between"><h3>${t.icon} ${esc(p.name)}</h3>
      <button class="btn sm vote ${voted ? "on" : ""}" data-a="vote" data-id="${p.id}">👍 ${votesOf(p)}/${members().length}</button></div>
    <div class="meta"><span class="tag">${t.label}</span> ${p.area ? "📍" + esc(p.area) : ""} ${p.cost ? " · 預估 " + krwFmt(p.cost) : ""}</div>
    ${p.note ? `<div class="note">${esc(p.note)}</div>` : ""}
    <div class="meta">${(p.votes || []).map((v) => esc(nameOf(v))).join("、")}${p.by !== undefined ? ` · 由 ${esc(nameOf(p.by))} 新增` : ""}</div>
    <div class="row" style="margin-top:8px">
      <a class="btn sm pri" href="${esc(naverUrl(p))}" target="_blank" rel="noopener" style="text-decoration:none">🗺 Naver Map</a>
      <button class="btn sm" data-a="editPlace" data-id="${p.id}">編輯</button>${extra}</div></div>`;
}

function viewList() {
  let ps = state.data.places.filter((p) => state.type === "all" || p.type === state.type);
  if (state.sort === "votes") ps.sort((a, b) => votesOf(b) - votesOf(a) || b.createdAt - a.createdAt);
  else if (state.sort === "area") ps.sort((a, b) => (a.area || "~").localeCompare(b.area || "~", "zh-Hant"));
  else ps.sort((a, b) => b.createdAt - a.createdAt);
  const chip = (k, l) => `<button class="chip ${state.type === k ? "on" : ""}" data-a="type" data-v="${k}">${l}</button>`;
  return `<div class="chips">${chip("all", "全部")}${Object.entries(TYPES).map(([k, t]) => chip(k, t.icon + t.label)).join("")}</div>
    <div class="row between" style="margin-bottom:8px"><span class="meta">${ps.length} 個地點</span>
      <select data-a="sort" style="width:auto"><option value="votes" ${state.sort === "votes" ? "selected" : ""}>最多人想去</option>
      <option value="area" ${state.sort === "area" ? "selected" : ""}>依區域</option><option value="new" ${state.sort === "new" ? "selected" : ""}>最新</option></select></div>
    ${ps.length ? ps.map((p) => placeCard(p)).join("") : `<div class="empty">還沒有收藏,按右下角 ＋ 新增第一個吧</div>`}`;
}

function viewPlan() {
  const { days } = state.data.settings;
  const un = state.data.places.filter((p) => !p.day).sort((a, b) => votesOf(b) - votesOf(a));
  const opts = (cur) => `<option value="">未排</option>` + Array.from({ length: days }, (_, i) => `<option value="${i + 1}" ${cur == i + 1 ? "selected" : ""}>${dayLabel(i + 1)}</option>`).join("");
  const item = (p) => {
    const t = TYPES[p.type] || TYPES.spot;
    return `<div class="card"><div class="row between"><h3>${t.icon} ${esc(p.name)}</h3><span class="meta">👍${votesOf(p)}</span></div>
      <div class="meta">${p.area ? "📍" + esc(p.area) : ""}</div>
      <div class="row" style="margin-top:8px">
        <input class="time" type="time" value="${p.time || ""}" data-a="time" data-id="${p.id}" ${p.day ? "" : "hidden"}>
        <select data-a="setDay" data-id="${p.id}">${opts(p.day)}</select>
        <a class="btn sm" href="${esc(naverUrl(p))}" target="_blank" rel="noopener" style="text-decoration:none">🗺</a></div></div>`;
  };
  let html = `<div class="row between"><h2 style="margin:0">待排清單(${un.length})</h2><button class="btn sm" data-a="autoPlan">✨ 自動建議</button></div>
    <div class="meta" style="margin:4px 0 8px">依票數高低、同區域排同一天,排完還可以手動調整</div>
    ${un.length ? un.map(item).join("") : `<div class="empty" style="padding:14px 0">沒有待排的地點</div>`}`;
  for (let d = 1; d <= days; d++) {
    const ps = state.data.places.filter((p) => p.day == d).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
    html += `<h2>${dayLabel(d)}(${ps.length})</h2>${ps.length ? ps.map(item).join("") : `<div class="meta">尚未安排</div>`}`;
  }
  return html;
}

function viewMoney() {
  const ex = [...state.data.expenses].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt);
  const total = ex.reduce((s, e) => s + e.krw, 0);
  const { net, transfers } = settlement();
  const r = state.data.settings.rate;
  return `<div class="card"><div class="meta">總支出</div><div class="big">${krwFmt(total)}</div><div class="meta">≈ ${twdFmt(total * r)} · 匯率 1₩ = NT$${r}</div></div>
    <h2>結算(誰該轉給誰)</h2>
    <div class="card">${transfers.length ? transfers.map((t) => `<div class="settle"><span>${esc(nameOf(t.from))} → ${esc(nameOf(t.to))}</span><b>${krwFmt(t.amt)} <span class="meta">(${twdFmt(t.amt * r)})</span></b></div>`).join("") : `<div class="meta">目前沒有需要結算的款項</div>`}</div>
    <h2>明細(${ex.length})</h2>
    ${ex.length ? ex.map((e) => `<div class="card"><div class="row between"><h3>${esc(e.title)}</h3><b>${krwFmt(e.krw)}</b></div>
      <div class="meta">${esc(e.date || "")} · ${esc(e.category || "")} · ${esc(nameOf(e.payer))} 付 · 分攤 ${e.participants?.length || members().length} 人${e.currency === "TWD" ? ` · 原幣 ${twdFmt(e.amount)}` : ""}</div>
      <div class="meta">≈ ${twdFmt(e.krw * r)}</div>
      <div class="row" style="margin-top:6px"><button class="btn sm" data-a="editExpense" data-id="${e.id}">編輯</button></div></div>`).join("") : `<div class="empty">還沒有支出紀錄</div>`}`;
}

function viewSettings() {
  const s = state.data.settings;
  return `<h2>旅程</h2><div class="card">
      <label class="f">出發日期</label><input type="date" id="sStart" value="${esc(s.startDate)}">
      <label class="f">天數</label><input type="number" id="sDays" min="1" max="30" value="${s.days}">
      <label class="f">匯率:1 韓元 = ? 新台幣</label><input type="number" id="sRate" step="0.0001" value="${s.rate}">
      <div class="meta">新增支出時會用當下匯率換算並記下,之後改匯率不影響舊帳。</div></div>
    <h2>5 位成員名字</h2><div class="card">${s.members.map((m, i) => `<label class="f">成員 ${i + 1}</label><input data-m="${i}" value="${esc(m)}">`).join("")}</div>
    <div class="actions"><button class="btn pri" data-a="saveSettings">儲存設定</button></div>
    <h2>房間</h2><div class="card"><div class="meta">邀請碼:<b>${esc(state.room)}</b>(${isCloud ? "雲端同步" : "本機測試模式"})</div>
      <div class="actions"><button class="btn" data-a="leaveRoom">離開房間</button></div></div>`;
}

// ---------- 彈窗 ----------
function openModal(html) {
  const m = $("#modal");
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.hidden = false;
}
const closeModal = () => { $("#modal").hidden = true; render(); };

function placeForm(p = {}) {
  openModal(`<h3>${p.id ? "編輯地點" : "新增想去的地方"}</h3>
    <label class="f">名稱 *</label><input id="fName" value="${esc(p.name || "")}" placeholder="例如 本家烤肉">
    <label class="f">類型</label><div class="chips" id="fType">${Object.entries(TYPES).map(([k, t]) => `<button type="button" class="chip ${(p.type || "spot") === k ? "on" : ""}" data-k="${k}">${t.icon}${t.label}</button>`).join("")}</div>
    <label class="f">位置/區域</label><input id="fArea" value="${esc(p.area || "")}" placeholder="例如 聖水洞、江南">
    <label class="f">Naver Map 連結(選填,留空會自動用名稱搜尋)</label><input id="fUrl" value="${esc(p.url || "")}" placeholder="貼上 Naver Map 分享連結">
    <label class="f">預估花費(韓元,選填)</label><input id="fCost" type="number" value="${p.cost || ""}">
    <label class="f">備註</label><textarea id="fNote" placeholder="營業時間、必點、預約資訊…">${esc(p.note || "")}</textarea>
    <div class="actions">${p.id ? `<button class="btn danger" data-a="delPlace" data-id="${p.id}">刪除</button>` : ""}
      <button class="btn" data-a="close">取消</button><button class="btn pri" data-a="savePlace" data-id="${p.id || ""}">儲存</button></div>`);
}

function expenseForm(e = {}) {
  const ps = e.participants || members().map((_, i) => i);
  openModal(`<h3>${e.id ? "編輯支出" : "記一筆"}</h3>
    <label class="f">項目 *</label><input id="eTitle" value="${esc(e.title || "")}" placeholder="例如 蔘雞湯">
    <div class="row"><div style="flex:2"><label class="f">金額 *</label><input id="eAmt" type="number" inputmode="decimal" value="${e.amount || ""}"></div>
      <div style="flex:1"><label class="f">幣別</label><select id="eCur"><option value="KRW" ${e.currency !== "TWD" ? "selected" : ""}>韓元</option><option value="TWD" ${e.currency === "TWD" ? "selected" : ""}>新台幣</option></select></div></div>
    <div class="row"><div style="flex:1"><label class="f">日期</label><input id="eDate" type="date" value="${esc(e.date || new Date().toISOString().slice(0, 10))}"></div>
      <div style="flex:1"><label class="f">類別</label><select id="eCat">${CATS.map((c) => `<option ${e.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div></div>
    <label class="f">誰付的</label><select id="ePayer">${members().map((m, i) => `<option value="${i}" ${(e.payer ?? state.me) === i ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>
    <label class="f">誰要分攤</label><div class="checks" id="eParts">${members().map((m, i) => `<label><input type="checkbox" value="${i}" ${ps.includes(i) ? "checked" : ""}>${esc(m)}</label>`).join("")}</div>
    <div class="actions">${e.id ? `<button class="btn danger" data-a="delExpense" data-id="${e.id}">刪除</button>` : ""}
      <button class="btn" data-a="close">取消</button><button class="btn pri" data-a="saveExpense" data-id="${e.id || ""}">儲存</button></div>`);
}

// ---------- 事件 ----------
function autoPlan() {
  const { days } = state.data.settings;
  const cand = state.data.places.filter((p) => !p.day && votesOf(p) > 0);
  if (!cand.length) return alert("待排清單裡還沒有被投票的地點,請先大家投票 👍");
  if (!confirm(`要把 ${cand.length} 個有票的地點自動分配到 ${days} 天嗎?`)) return;
  const groups = {};
  cand.forEach((p) => (groups[p.area?.trim() || "未分區"] ||= []).push(p));
  const gs = Object.values(groups).sort((a, b) => b.reduce((s, p) => s + votesOf(p), 0) - a.reduce((s, p) => s + votesOf(p), 0));
  const load = Array.from({ length: days }, (_, i) => state.data.places.filter((p) => p.day == i + 1).length);
  for (const g of gs) {
    g.sort((a, b) => votesOf(b) - votesOf(a));
    for (let i = 0; i < g.length; i += 4) {
      const d = load.indexOf(Math.min(...load));
      g.slice(i, i + 4).forEach((p) => { store.update("places", p.id, { day: d + 1 }); load[d]++; });
    }
  }
}

const byId = (col, id) => state.data[col].find((x) => x.id === id);

const actions = {
  enterRoom() {
    const v = $("#roomIn").value.trim().toLowerCase();
    if (!v) return;
    state.room = v;
    ls.set("kt:room", v);
    boot();
  },
  pickMe(el) { state.me = Number(el.dataset.v); ls.set("kt:me", state.me); render(); },
  switchMe() { state.me = null; render(); },
  tab(el) { state.tab = el.dataset.v; render(); window.scrollTo(0, 0); },
  type(el) { state.type = el.dataset.v; render(); },
  close: closeModal,
  addPlace: () => placeForm(),
  editPlace: (el) => placeForm(byId("places", el.dataset.id)),
  async savePlace(el) {
    const name = $("#fName").value.trim();
    if (!name) return alert("請輸入名稱");
    const obj = {
      name, type: $("#fType .on").dataset.k, area: $("#fArea").value.trim(), url: $("#fUrl").value.trim(),
      cost: Number($("#fCost").value) || 0, note: $("#fNote").value.trim(),
    };
    const id = el.dataset.id;
    if (id) await store.update("places", id, obj);
    else await store.add("places", { ...obj, by: state.me, votes: [state.me], day: 0, time: "" });
    closeModal();
  },
  async delPlace(el) { if (confirm("確定刪除這個地點?")) { await store.remove("places", el.dataset.id); closeModal(); } },
  async vote(el) {
    const p = byId("places", el.dataset.id);
    const v = new Set(p.votes || []);
    v.has(state.me) ? v.delete(state.me) : v.add(state.me);
    await store.update("places", p.id, { votes: [...v] });
  },
  autoPlan,
  addExpense: () => expenseForm(),
  editExpense: (el) => expenseForm(byId("expenses", el.dataset.id)),
  async saveExpense(el) {
    const title = $("#eTitle").value.trim();
    const amount = Number($("#eAmt").value);
    if (!title || !(amount > 0)) return alert("請輸入項目與金額");
    const participants = [...document.querySelectorAll("#eParts input:checked")].map((c) => Number(c.value));
    if (!participants.length) return alert("至少選一位分攤的人");
    const currency = $("#eCur").value;
    const id = el.dataset.id;
    const old = id ? byId("expenses", id) : null;
    // 編輯時若金額與幣別沒變,沿用當初匯率換算的韓元,避免舊帳被改動
    const krw = old && old.amount === amount && old.currency === currency ? old.krw : Math.round(toKrw(amount, currency));
    const obj = { title, amount, currency, krw, date: $("#eDate").value, category: $("#eCat").value, payer: Number($("#ePayer").value), participants };
    id ? await store.update("expenses", id, obj) : await store.add("expenses", obj);
    closeModal();
  },
  async delExpense(el) { if (confirm("確定刪除這筆支出?")) { await store.remove("expenses", el.dataset.id); closeModal(); } },
  async saveSettings() {
    const ms = [...document.querySelectorAll("[data-m]")].map((i, k) => i.value.trim() || `成員${k + 1}`);
    await store.setSettings({
      startDate: $("#sStart").value, days: Math.max(1, Math.min(30, Number($("#sDays").value) || 5)),
      rate: Number($("#sRate").value) > 0 ? Number($("#sRate").value) : DEFAULT_SETTINGS.rate, members: ms,
    });
    alert("已儲存");
  },
  leaveRoom() { if (confirm("離開這個房間?(資料不會被刪除)")) { ls.set("kt:room", ""); state.room = ""; state.me = null; boot(); } },
};

document.addEventListener("click", (e) => {
  const chip = e.target.closest("#fType .chip");
  if (chip) {
    document.querySelectorAll("#fType .chip").forEach((c) => c.classList.toggle("on", c === chip));
    return;
  }
  if (e.target.id === "modal") return closeModal();
  const el = e.target.closest("[data-a]");
  if (el && actions[el.dataset.a] && !["SELECT", "INPUT"].includes(el.tagName)) actions[el.dataset.a](el);
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.a === "sort") { state.sort = el.value; render(); }
  else if (el.dataset.a === "setDay") store.update("places", el.dataset.id, { day: Number(el.value) || 0 });
  else if (el.dataset.a === "time") store.update("places", el.dataset.id, { time: el.value });
});

async function boot() {
  if (!state.room) { store = null; return render(); }
  store = await createStore(state.room);
  store.subscribe((d) => {
    state.data = d;
    if (!$("#modal").hidden || (state.tab === "set" && document.activeElement?.matches?.("#app input"))) return; // 編輯中不重繪
    render();
  });
}
boot();
