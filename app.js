import { createStore, isCloud, DEFAULT_SETTINGS } from "./store.js?v=9";

const TYPES = {
  spot: { label: "景點", icon: "" },
  food: { label: "美食", icon: "" },
  expo: { label: "展覽", icon: "" },
  beauty: { label: "醫美", icon: "" },
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
  q: "",
  day: 1,
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

// ---------- 提示 ----------
let toastTimer = null;
function toast(msg, undo) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button data-a="undo">復原</button>` : ""}`;
  t.className = "show";
  t._undo = undo || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), undo ? 6000 : 2200);
}
function warn(sel, msg) {
  toast(msg);
  const el = $(sel);
  if (el) { el.focus(); el.classList.add("bad"); el.addEventListener("input", () => el.classList.remove("bad"), { once: true }); }
}

// ---------- 畫面 ----------
function render() {
  const app = $("#app");
  if (!state.room) return (app.innerHTML = gateRoom());
  if (state.me === null || state.me >= members().length) return (app.innerHTML = gateMe());
  if (state.data.error) return (app.innerHTML = `<div class="gate"><h1>連不上資料庫</h1><p class="meta">請檢查網路,或確認 Firebase 的規則設定。</p><div class="actions"><button class="btn pri" onclick="location.reload()">重新整理</button></div></div>`);
  if (state.data.ready === false) return (app.innerHTML = `<div class="gate"><p class="meta">載入中…</p></div>`);
  const body = { list: viewList, plan: viewPlan, money: viewMoney, set: viewSettings }[state.tab]();
  app.innerHTML = `
    <header class="top"><h1>Korea Trip</h1><button class="me" data-a="switchMe" aria-label="切換成員">我是 ${esc(nameOf(state.me))}</button></header>
    ${isCloud ? "" : `<div class="banner">尚未連線雲端:目前的內容只存在這支手機,朋友看不到,也不會同步。</div>`}
    ${body}
    ${state.tab === "list" ? `<button class="fab" data-a="addPlace" aria-label="新增">新增</button>` : ""}
    ${state.tab === "money" ? `<button class="fab" data-a="addExpense" aria-label="記一筆">記一筆</button>` : ""}
    <nav class="tabs">
      ${[["list", "清單"], ["plan", "行程"], ["money", "記帳"], ["set", "設定"]].map(([k, l]) => `<button data-a="tab" data-v="${k}" class="${state.tab === k ? "on" : ""}">${l}</button>`).join("")}
    </nav>`;
}

function gateRoom() {
  return `<div class="gate"><h1>Korea Trip</h1><p class="meta">輸入邀請碼,進入你們 5 個人共用的房間。<br>第一次使用的人,自己取一組、再告訴其他人就可以。</p>
    <input id="roomIn" placeholder="邀請碼,例如 seoul-xk29q" autocapitalize="off" autocomplete="off" enterkeyhint="go">
    <div class="actions"><button class="btn pri" data-a="enterRoom">進入</button></div></div>`;
}
function gateMe() {
  return `<div class="gate"><h1>你是哪一位?</h1><p class="meta">選擇後,愛心和記帳會記在你的名字下。之後可以點右上角切換。</p><div class="members">
    ${members().map((m, i) => `<button class="btn" data-a="pickMe" data-v="${i}">${esc(m)}</button>`).join("")}</div></div>`;
}

const HEART = `<svg class="heart" viewBox="0 0 24 24" width="16" height="16"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.7 1.1 5.6 3.2C13.900 6.100 15.600 5 17.600 5 21 5 23.100 8.400 21.600 11.800 19.500 16.400 12 21 12 21z"/></svg>`;
const XICON = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const sheetHead = (title) => `<div class="shead"><h3>${title}</h3><button class="x" data-a="close" aria-label="關閉">${XICON}</button></div>`;

function placeCard(p) {
  const t = TYPES[p.type] || TYPES.spot;
  const voted = (p.votes || []).includes(state.me);
  return `<div class="sw" data-del="places" data-id="${p.id}"><div class="card">
    <div class="row between"><h3>${esc(p.name)}</h3>
      <button class="heartbtn ${voted ? "on" : ""}" data-a="vote" data-id="${p.id}" aria-pressed="${voted}" aria-label="${voted ? "取消感興趣" : "我有興趣"}">${HEART}<span>${votesOf(p)}</span></button></div>
    <div class="meta"><span class="tag">${t.label}</span> ${p.area ? esc(p.area) : ""}</div>
    ${p.note ? `<div class="note">${esc(p.note)}</div>` : ""}
    <div class="meta">${votesOf(p) ? "感興趣:" + (p.votes || []).map((v) => esc(nameOf(v))).join("、") : "還沒有人按愛心"}</div>
    <div class="row" style="margin-top:10px">
      <a class="btn sm pri" href="${esc(naverUrl(p))}" target="_blank" rel="noopener" style="text-decoration:none">Naver Map</a>
      <button class="btn sm" data-a="editPlace" data-id="${p.id}">編輯</button></div></div></div>`;
}

function filteredPlaces() {
  const q = state.q.trim().toLowerCase();
  return state.data.places
    .filter((p) => state.type === "all" || p.type === state.type)
    .filter((p) => !q || [p.name, p.area, p.note].some((x) => (x || "").toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt - a.createdAt);
}
function listBody() {
  const ps = filteredPlaces();
  return ps.length ? ps.map(placeCard).join("") + `<div class="meta" style="text-align:center;margin-top:6px">長按或向左滑卡片可刪除</div>` : (state.q ? `<div class="empty"><p>找不到「${esc(state.q)}」</p></div>` : `<div class="empty"><p><b>還沒有想去的地方</b></p><p class="meta">把想去的景點、美食、展覽、醫美加進來,大家按愛心,最多人想去的會排在上面。</p><button class="btn pri" data-a="addPlace">新增第一個地點</button></div>`);
}

function viewList() {
  const chip = (k, l) => `<button class="chip ${state.type === k ? "on" : ""}" data-a="type" data-v="${k}">${l}</button>`;
  const all = state.data.places;
  const st = state.data.settings;
  const rank = all.filter((p) => votesOf(p) > 0).sort((a, b) => votesOf(b) - votesOf(a)).slice(0, 3);
  const hero = `<div class="hero">
    <button class="blob b" data-a="tripInfo">${tripSummary(st)}</button>
    <div class="blob o"><span class="lbl">大家感興趣的排名</span>
      ${rank.length ? `<div class="rank">${rank.map((p, i) => `<div class="rk"><span class="n">${i + 1}</span><span class="t">${esc(p.name)}</span><span class="c">${votesOf(p)}</span></div>`).join("")}</div>` : `<span class="sub" style="margin-top:auto">按愛心表示感興趣,排名就會出現</span>`}</div></div>`;
  return `${hero}<input id="q" class="search" type="search" placeholder="搜尋名稱、區域、備註" value="${esc(state.q)}">
    <div class="chips">${chip("all", "全部")}${Object.entries(TYPES).map(([k, t]) => chip(k, t.label)).join("")}</div>
    <div id="plist">${listBody()}</div>`;
}

function viewPlan() {
  const { days } = state.data.settings;
  if (state.day > days) state.day = 1;
  const d = state.day;
  const ps = state.data.places.filter((p) => p.day == d).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  const tabs = Array.from({ length: days }, (_, i) => `<button class="chip ${d === i + 1 ? "on" : ""}" data-a="day" data-v="${i + 1}">${dayLabel(i + 1)}</button>`).join("");
  const item = (p) => `<div class="card">
      <div class="row between"><h3>${esc(p.name)}</h3><input class="time" type="time" value="${p.time || ""}" data-a="time" data-id="${p.id}"></div>
      <div class="meta">${(TYPES[p.type] || TYPES.spot).label}${p.area ? " · " + esc(p.area) : ""}</div>
      <div class="row" style="margin-top:10px">
        <a class="btn sm pri" href="${esc(naverUrl(p))}" target="_blank" rel="noopener" style="text-decoration:none">Naver Map</a>
        <button class="btn sm" data-a="unplan" data-id="${p.id}">移出</button></div></div>`;
  return `<div class="chips">${tabs}</div>
    <div class="row between" style="margin-bottom:10px"><span class="meta">${ps.length} 個行程</span>
      <div class="row"><button class="btn sm" data-a="autoPlan">自動排入</button><button class="btn sm pri" data-a="pickPlaces">從清單加入</button></div></div>
    ${ps.length ? ps.map(item).join("") : (state.data.places.length ? `<div class="empty"><p><b>這天還沒有行程</b></p><p class="meta">從大家收藏的清單挑地點加進來。</p><button class="btn pri" data-a="pickPlaces">從清單加入</button></div>` : `<div class="empty"><p><b>還沒有可以排的地點</b></p><p class="meta">先到清單新增想去的地方。</p><button class="btn pri" data-a="tab" data-v="list">前往清單</button></div>`)}`;
}

function viewMoney() {
  const ex = [...state.data.expenses].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt);
  const total = ex.reduce((s, e) => s + e.krw, 0);
  const { net, transfers } = settlement();
  const r = state.data.settings.rate;
  return `<div class="blob o wide"><span class="lbl">總支出</span><span class="num">${krwFmt(total)}</span><span class="sub">約 ${twdFmt(total * r)} · 匯率 1 韓元 = NT$${r}</span></div>
    <h2>結算</h2>
    <div class="card">${transfers.length ? transfers.map((t) => `<div class="settle"><span>${esc(nameOf(t.from))} 付給 ${esc(nameOf(t.to))}</span><b>${krwFmt(t.amt)} <span class="meta">(${twdFmt(t.amt * r)})</span></b></div>`).join("") : `<div class="meta">大家都結清了,不用互相轉帳</div>`}</div>
    <h2>明細(${ex.length})</h2>
    ${ex.length ? ex.map((e) => `<div class="sw" data-del="expenses" data-id="${e.id}"><div class="card"><div class="row between"><h3>${esc(e.title)}</h3><b>${krwFmt(e.krw)}</b></div>
      <div class="meta">${esc(e.date || "")} · ${esc(e.category || "")} · ${esc(nameOf(e.payer))} 付 · 分攤 ${e.participants?.length || members().length} 人${e.currency === "TWD" ? ` · 原幣 ${twdFmt(e.amount)}` : ""}</div>
      <div class="meta">≈ ${twdFmt(e.krw * r)}</div>
      <div class="row" style="margin-top:6px"><button class="btn sm" data-a="editExpense" data-id="${e.id}">編輯</button></div></div></div>`).join("") + `<div class="meta" style="text-align:center">長按或向左滑卡片可刪除</div>` : `<div class="empty"><p><b>還沒有支出</b></p><p class="meta">記下每一筆花費,最後自動算出誰該付給誰。</p><button class="btn pri" data-a="addExpense">記第一筆</button></div>`}`;
}

const FLIGHT_FIELDS = [["airline", "航空公司", "text"], ["no", "航班編號", "text"], ["from", "出發機場", "text"], ["to", "抵達機場", "text"], ["dep", "出發時間", "datetime-local"], ["arr", "抵達時間", "datetime-local"]];

function flightCard(key, title, f = {}) {
  return `<div class="card"><div class="meta" style="margin:0 0 4px">${title}</div>
    <div class="g2">${FLIGHT_FIELDS.map(([k, l, t]) => `<div><label class="f">${l}</label><input data-fl="${key}.${k}" type="${t}" value="${esc(f[k] || "")}"></div>`).join("")}</div></div>`;
}

function lodgingCard(l) {
  return `<div class="sw" data-del="lodgings" data-id="${l.id}"><div class="card">
    <h3>${esc(l.name)}</h3>
    <div class="meta">${esc(l.checkIn || "")}${l.checkIn || l.checkOut ? " → " : ""}${esc(l.checkOut || "")}</div>
    ${l.address ? `<div class="note">${esc(l.address)}</div>` : ""}
    ${l.booking || l.phone ? `<div class="meta">${l.booking ? "訂房編號 " + esc(l.booking) : ""}${l.booking && l.phone ? " · " : ""}${l.phone ? esc(l.phone) : ""}</div>` : ""}
    ${l.note ? `<div class="note">${esc(l.note)}</div>` : ""}
    <div class="row" style="margin-top:10px"><a class="btn sm pri" href="${esc(naverUrl({ name: l.name, url: l.url, area: l.address }))}" target="_blank" rel="noopener" style="text-decoration:none">Naver Map</a>
      <button class="btn sm" data-a="editLodging" data-id="${l.id}">編輯</button></div></div></div>`;
}

function lodgingForm(l = {}) {
  openModal(`${sheetHead(l.id ? "編輯住宿" : "新增住宿")}
    <label class="f">名稱</label><input id="lName" value="${esc(l.name || "")}" placeholder="民宿 / 飯店名稱">
    <label class="f">地址</label><input id="lAddr" value="${esc(l.address || "")}">
    <label class="f">Naver Map 連結(選填)</label><input id="lUrl" value="${esc(l.url || "")}">
    <div class="row"><div style="flex:1"><label class="f">入住日期</label><input id="lIn" type="date" value="${esc(l.checkIn || "")}"></div>
      <div style="flex:1"><label class="f">退房日期</label><input id="lOut" type="date" value="${esc(l.checkOut || "")}"></div></div>
    <label class="f">訂房編號</label><input id="lBook" value="${esc(l.booking || "")}">
    <label class="f">聯絡電話</label><input id="lPhone" value="${esc(l.phone || "")}">
    <label class="f">備註(入住時間、門鎖密碼、房東聯絡方式)</label><textarea id="lNote">${esc(l.note || "")}</textarea>
    <div class="actions"><button class="btn pri" data-a="saveLodging" data-id="${l.id || ""}">儲存</button></div>`);
}

const dm = (v) => (v ? v.slice(5, 10).replace("-", "/") : "");
const dtm = (v) => (v ? v.slice(5, 10).replace("-", "/") + " " + v.slice(11, 16) : "");
function tripSummary(st) {
  let range = "日期未設定";
  if (st.startDate) {
    const e = new Date(st.startDate + "T00:00:00");
    e.setDate(e.getDate() + st.days - 1);
    range = `${dm(st.startDate)} – ${e.getMonth() + 1}/${e.getDate()}`;
  }
  const out = st.flights?.out || {};
  const lod = st.lodgings || [];
  return `<span class="lbl">本次旅遊資訊</span>
    <span class="num sm">${range}</span>
    <span class="line">去程 ${out.no || out.dep ? esc([out.no, dtm(out.dep)].filter(Boolean).join(" · ")) : "未填"}</span>
    <span class="line">住宿 ${lod.length ? esc(lod[0].name) + (lod.length > 1 ? ` 等 ${lod.length} 間` : "") : "未填"}</span>
    <span class="line" style="opacity:.75">點擊查看與編輯</span>`;
}

function collectFlights() {
  const flights = { out: {}, back: {} };
  document.querySelectorAll("[data-fl]").forEach((i) => { const [k, f] = i.dataset.fl.split("."); flights[k][f] = i.value.trim(); });
  return flights;
}

function tripInfo() {
  const s = state.data.settings;
  const fl = s.flights || {};
  const lods = s.lodgings || [];
  openModal(`${sheetHead("本次旅遊基本資訊")}
    <h2>機票</h2>${flightCard("out", "去程", fl.out)}${flightCard("back", "回程", fl.back)}
    <div class="row between"><h2 style="margin:22px 2px 10px">住宿</h2><button class="btn sm pri" data-a="addLodging">新增</button></div>
    ${lods.length ? lods.map(lodgingCard).join("") + `<div class="meta" style="text-align:center">長按或向左滑卡片可刪除</div>` : `<div class="meta" style="margin:0 2px 10px">尚未新增住宿</div>`}
    <div class="actions"><button class="btn pri" data-a="saveFlights">儲存</button></div>`);
}

function viewSettings() {
  const s = state.data.settings;
  return `<h2>旅程</h2><div class="card">
      <label class="f">出發日期</label><input type="date" id="sStart" value="${esc(s.startDate)}">
      <label class="f">旅遊天數(行程頁會有幾個分頁)</label><input type="number" id="sDays" min="1" max="30" value="${s.days}">
      <label class="f">匯率:1 韓元 = ? 新台幣</label><input type="number" id="sRate" step="0.0001" value="${s.rate}">
      <div class="meta">新增支出時會用當下匯率換算並記下,之後改匯率不影響舊帳。</div></div>
    <h2>5 位成員名字</h2><div class="card">${s.members.map((m, i) => `<label class="f">成員 ${i + 1}</label><input data-m="${i}" value="${esc(m)}">`).join("")}</div>
    <div class="meta" style="margin:10px 2px 0">修改後請按「儲存」</div><div class="actions"><button class="btn pri" data-a="saveSettings">儲存</button></div>
    <h2>邀請朋友</h2><div class="card"><div class="meta">邀請碼:<b>${esc(state.room)}</b></div><div class="note">把連結傳給朋友,開啟後就會進到同一個房間。</div><div class="actions"><button class="btn pri" data-a="copyInvite">複製邀請連結</button></div></div>
    <h2>房間</h2><div class="card">
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
  openModal(`${sheetHead(p.id ? "編輯地點" : "新增想去的地方")}
    <label class="f">名稱</label><input id="fName" value="${esc(p.name || "")}" placeholder="例如 本家烤肉" enterkeyhint="done">
    <label class="f">類型</label><div class="chips" id="fType">${Object.entries(TYPES).map(([k, t]) => `<button type="button" class="chip ${(p.type || "spot") === k ? "on" : ""}" data-k="${k}">${t.label}</button>`).join("")}</div>
    <label class="f">區域(用來把同區域的地點排在同一天)</label><input id="fArea" value="${esc(p.area || "")}" placeholder="例如 聖水洞、江南">
    <label class="f">Naver Map 連結(選填)</label><input id="fUrl" type="url" value="${esc(p.url || "")}" placeholder="貼上分享連結"><div class="hint">在 Naver Map 點地點的分享,複製連結後貼上。沒貼的話,會用名稱搜尋。</div>
    <label class="f">備註</label><textarea id="fNote" placeholder="營業時間、必點、要不要預約">${esc(p.note || "")}</textarea>
    <div class="actions"><button class="btn pri" data-a="savePlace" data-id="${p.id || ""}">${p.id ? "儲存變更" : "加入清單"}</button></div>`);
  if (!p.id) $("#fName").focus();
}

function pickPlaces() {
  const d = state.day;
  const cand = state.data.places.filter((p) => p.day != d).sort((a, b) => (a.day ? 1 : 0) - (b.day ? 1 : 0) || votesOf(b) - votesOf(a));
  openModal(`${sheetHead("加入 " + dayLabel(d))}
    ${cand.length ? `<div id="pickList">${cand.map((p) => `<label class="pick"><input type="checkbox" value="${p.id}"><span class="pt">${esc(p.name)}<span class="meta">${(TYPES[p.type] || TYPES.spot).label}${p.area ? " · " + esc(p.area) : ""}${p.day ? " · 目前在 " + dayLabel(p.day) : ""}</span></span><span class="meta">${votesOf(p)} 人</span></label>`).join("")}</div>
    <div class="actions"><button class="btn pri" data-a="addPicked">加入所選地點</button></div>` : `<div class="empty">清單裡沒有其他地點可以加入</div>`}`);
}

function expenseForm(e = {}) {
  const ps = e.participants || members().map((_, i) => i);
  openModal(`${sheetHead(e.id ? "編輯支出" : "記一筆")}
    <label class="f">項目</label><input id="eTitle" value="${esc(e.title || "")}" placeholder="例如 蔘雞湯">
    <div class="row"><div style="flex:2"><label class="f">金額</label><input id="eAmt" type="number" inputmode="decimal" value="${e.amount || ""}"></div>
      <div style="flex:1"><label class="f">幣別</label><select id="eCur"><option value="KRW" ${e.currency !== "TWD" ? "selected" : ""}>韓元</option><option value="TWD" ${e.currency === "TWD" ? "selected" : ""}>新台幣</option></select></div></div>
    <div class="row"><div style="flex:1"><label class="f">日期</label><input id="eDate" type="date" value="${esc(e.date || new Date().toISOString().slice(0, 10))}"></div>
      <div style="flex:1"><label class="f">類別</label><select id="eCat">${CATS.map((c) => `<option ${e.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div></div>
    <label class="f">誰付的</label><select id="ePayer">${members().map((m, i) => `<option value="${i}" ${(e.payer ?? state.me) === i ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>
    <div class="row between"><label class="f">誰要分攤</label><button type="button" class="btn sm" data-a="allParts" style="margin-top:8px">全選 / 清除</button></div><div class="checks" id="eParts">${members().map((m, i) => `<label><input type="checkbox" value="${i}" ${ps.includes(i) ? "checked" : ""}>${esc(m)}</label>`).join("")}</div>
    <div class="actions"><button class="btn pri" data-a="saveExpense" data-id="${e.id || ""}">${e.id ? "儲存變更" : "記下這筆"}</button></div>`);
  if (!e.id) $("#eTitle").focus();
}

// ---------- 事件 ----------
function autoPlan() {
  const { days } = state.data.settings;
  const cand = state.data.places.filter((p) => !p.day && votesOf(p) > 0);
  if (!cand.length) return toast("沒有「有人按愛心、又還沒排進行程」的地點");
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
  toast(`已把 ${cand.length} 個地點依區域排進 ${days} 天`, () => cand.forEach((p) => store.update("places", p.id, { day: 0, time: "" })));
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
    if (!name) return warn("#fName", "請輸入名稱");
    const obj = {
      name, type: $("#fType .on").dataset.k, area: $("#fArea").value.trim(), url: $("#fUrl").value.trim(),
      note: $("#fNote").value.trim(),
    };
    const id = el.dataset.id;
    if (id) await store.update("places", id, obj);
    else await store.add("places", { ...obj, by: state.me, votes: [state.me], day: 0, time: "" });
    closeModal();
    toast(id ? "已儲存" : "已加入清單");
  },
  async vote(el) {
    const p = byId("places", el.dataset.id);
    const v = new Set(p.votes || []);
    v.has(state.me) ? v.delete(state.me) : v.add(state.me);
    await store.update("places", p.id, { votes: [...v] });
  },
  autoPlan,
  day(el) { state.day = Number(el.dataset.v); render(); },
  pickPlaces,
  async addPicked() {
    const ids = [...document.querySelectorAll("#pickList input:checked")].map((c) => c.value);
    if (!ids.length) return toast("請先勾選要加入的地點");
    const prev = ids.map((id) => [id, byId("places", id).day || 0]);
    await Promise.all(ids.map((id) => store.update("places", id, { day: state.day })));
    closeModal();
    toast(`已加入 ${ids.length} 個地點`, () => prev.forEach(([id, d]) => store.update("places", id, { day: d })));
  },
  unplan(el) {
    const p = byId("places", el.dataset.id), prev = { day: p.day, time: p.time || "" };
    store.update("places", p.id, { day: 0, time: "" });
    toast(`已將「${p.name}」移出`, () => store.update("places", p.id, prev));
  },
  addExpense: () => expenseForm(),
  editExpense: (el) => expenseForm(byId("expenses", el.dataset.id)),
  async saveExpense(el) {
    const title = $("#eTitle").value.trim();
    const amount = Number($("#eAmt").value);
    if (!title) return warn("#eTitle", "請輸入項目");
    if (!(amount > 0)) return warn("#eAmt", "請輸入金額");
    const participants = [...document.querySelectorAll("#eParts input:checked")].map((c) => Number(c.value));
    if (!participants.length) return toast("至少選一位分攤的人");
    const currency = $("#eCur").value;
    const id = el.dataset.id;
    const old = id ? byId("expenses", id) : null;
    // 編輯時若金額與幣別沒變,沿用當初匯率換算的韓元,避免舊帳被改動
    const krw = old && old.amount === amount && old.currency === currency ? old.krw : Math.round(toKrw(amount, currency));
    const obj = { title, amount, currency, krw, date: $("#eDate").value, category: $("#eCat").value, payer: Number($("#ePayer").value), participants };
    id ? await store.update("expenses", id, obj) : await store.add("expenses", obj);
    closeModal();
    toast(id ? "已儲存" : "已記下這筆");
  },
  async saveSettings() {
    const ms = [...document.querySelectorAll("[data-m]")].map((i, k) => i.value.trim() || `成員${k + 1}`);
    await store.setSettings({
      startDate: $("#sStart").value, days: Math.max(1, Math.min(30, Number($("#sDays").value) || 5)),
      rate: Number($("#sRate").value) > 0 ? Number($("#sRate").value) : DEFAULT_SETTINGS.rate, members: ms,
    });
    toast("已儲存");
  },
  tripInfo,
  async saveFlights() { await store.setSettings({ flights: collectFlights() }); closeModal(); toast("已儲存"); },
  async addLodging() { await store.setSettings({ flights: collectFlights() }); lodgingForm(); },
  editLodging: (el) => lodgingForm((state.data.settings.lodgings || []).find((l) => l.id === el.dataset.id)),
  async saveLodging(el) {
    const name = $("#lName").value.trim();
    if (!name) return warn("#lName", "請輸入住宿名稱");
    const obj = { name, address: $("#lAddr").value.trim(), url: $("#lUrl").value.trim(), checkIn: $("#lIn").value, checkOut: $("#lOut").value, booking: $("#lBook").value.trim(), phone: $("#lPhone").value.trim(), note: $("#lNote").value.trim() };
    const list = state.data.settings.lodgings || [];
    const id = el.dataset.id;
    await store.setSettings({ lodgings: id ? list.map((l) => (l.id === id ? { ...l, ...obj } : l)) : [...list, { ...obj, id: Date.now().toString(36) }] });
    tripInfo();
  },
  allParts() {
    const boxes = [...document.querySelectorAll("#eParts input")];
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !all));
  },
  async copyInvite() {
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.room)}`;
    try { await navigator.clipboard.writeText(url); toast("已複製邀請連結"); } catch { prompt("複製這個連結傳給朋友", url); }
  },
  undo() { const t = $("#toast"); const f = t?._undo; t?.classList.remove("show"); if (f) f(); },
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
document.addEventListener("keydown", (e) => {
  const open = !$("#modal").hidden;
  if (e.key === "Escape" && open) closeModal();
  if (e.key === "Enter" && e.target.matches("#modal input:not([type=checkbox]):not([type=date]), #roomIn")) {
    e.preventDefault();
    (e.target.id === "roomIn" ? $("[data-a=enterRoom]") : $("#modal .actions .pri"))?.click();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "q") { state.q = e.target.value; $("#plist").innerHTML = listBody(); }
});

// 長按 / 向左滑 刪除
let gest = null, suppress = false;
const COLS_LABEL = { places: "地點", expenses: "支出", lodgings: "住宿" };
async function askDelete(sw) {
  const col = sw.dataset.del, id = sw.dataset.id;
  if (col === "lodgings") {
    const prev = state.data.settings.lodgings || [];
    await store.setSettings({ lodgings: prev.filter((l) => l.id !== id) });
    if (!$("#modal").hidden) tripInfo();
    toast("已刪除住宿", async () => { await store.setSettings({ lodgings: prev }); if (!$("#modal").hidden) tripInfo(); });
  } else {
    const { id: _i, ...snap } = byId(col, id);
    await store.remove(col, id);
    toast(`已刪除${COLS_LABEL[col]}`, () => store.add(col, snap));
  }
}
document.addEventListener("pointerdown", (e) => {
  const sw = e.target.closest(".sw");
  if (!sw || e.target.closest("a,button,input,select")) return;
  const card = sw.querySelector(".card");
  gest = { sw, card, x: e.clientX, y: e.clientY, dx: 0, moved: false, timer: setTimeout(() => { if (gest && !gest.moved) { suppress = true; clearSuppress(); const g = gest; gest = null; g.card.style.transform = ""; askDelete(g.sw); } }, 600) };
});
document.addEventListener("pointermove", (e) => {
  if (!gest) return;
  const dx = e.clientX - gest.x, dy = e.clientY - gest.y;
  if (!gest.moved && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(gest.timer); gest = null; return; }
  if (Math.abs(dx) > 8) { gest.moved = true; clearTimeout(gest.timer); }
  if (gest.moved) { gest.dx = Math.min(0, dx); gest.card.style.transform = `translateX(${gest.dx}px)`; gest.sw.classList.add("drag"); }
});
const clearSuppress = () => setTimeout(() => { suppress = false; }, 350);
const endGest = () => {
  if (!gest) return;
  clearTimeout(gest.timer);
  const g = gest; gest = null;
  g.card.style.transform = ""; g.sw.classList.remove("drag");
  if (g.moved) { suppress = true; clearSuppress(); }
  if (g.dx < -90) askDelete(g.sw);
};
document.addEventListener("pointerup", endGest);
document.addEventListener("pointercancel", endGest);
document.addEventListener("contextmenu", (e) => { if (e.target.closest(".sw")) e.preventDefault(); });
document.addEventListener("click", (e) => { if (suppress) { suppress = false; e.stopPropagation(); e.preventDefault(); } }, true);

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.a === "time") store.update("places", el.dataset.id, { time: el.value });
});

async function boot() {
  if (!state.room) { store = null; return render(); }
  store = await createStore(state.room);
  store.subscribe((d) => {
    state.data = d;
    if (document.activeElement?.id === "q") { $("#plist").innerHTML = listBody(); return; }
    if (!$("#modal").hidden || (state.tab === "set" && document.activeElement?.matches?.("#app input"))) return; // 編輯中不重繪
    render();
  });
}
boot();
