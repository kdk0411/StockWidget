const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");

// ───────────────────────── 설정 (config.json) ─────────────────────────
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

// API 엔드포인트 기본값(템플릿). 토스가 주소를 바꾸면 개발자 설정에서 수정 가능.
//   {codes} = 콤마로 이어붙인 종목코드들,  {code} = 단일 종목코드,  {num} = 코드에서 A 제외
const DEFAULT_ENDPOINTS = {
  price: "https://wts-info-api.tossinvest.com/api/v3/stock-prices?productCodes={codes}",
  info: "https://wts-info-api.tossinvest.com/api/v2/stock-infos/{code}",
  logo: "https://static.toss.im/png-icons/securities/icn-sec-fill-{num}.png",
};
const DEFAULT_CONFIG = { stocks: [], intervalSec: 2, endpoints: { ...DEFAULT_ENDPOINTS } };

// 저장된 endpoints 에 빠진 키가 있으면 기본값으로 채운다.
function normalizeEndpoints(ep) {
  ep = ep || {};
  return {
    price: ep.price && ep.price.trim() ? ep.price.trim() : DEFAULT_ENDPOINTS.price,
    info: ep.info && ep.info.trim() ? ep.info.trim() : DEFAULT_ENDPOINTS.info,
    logo: ep.logo && ep.logo.trim() ? ep.logo.trim() : DEFAULT_ENDPOINTS.logo,
  };
}

function normalizeWidgetPos(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw);
    return {
      stocks: Array.isArray(cfg.stocks) ? cfg.stocks.slice(0, 4) : [],
      intervalSec: Number(cfg.intervalSec) > 0 ? Number(cfg.intervalSec) : 2,
      endpoints: normalizeEndpoints(cfg.endpoints),
      widgetPos: normalizeWidgetPos(cfg.widgetPos), // 사용자가 옮긴 위젯 위치 (없으면 우측 하단)
    };
  } catch {
    return { stocks: [], intervalSec: 2, endpoints: { ...DEFAULT_ENDPOINTS }, widgetPos: null };
  }
}

function writeConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function saveConfig(cfg) {
  config = {
    stocks: (cfg.stocks || []).slice(0, 4),
    intervalSec: Number(cfg.intervalSec) > 0 ? Number(cfg.intervalSec) : 2,
    endpoints: normalizeEndpoints(cfg.endpoints),
    widgetPos: config ? config.widgetPos : null, // 위젯 위치는 설정 저장 시 보존
  };
  writeConfig();
}

let config = loadConfig();

// ───────────────────────── 토스 API ─────────────────────────
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.tossinvest.com/",
  Origin: "https://www.tossinvest.com",
};

// 토스 URL 또는 코드 입력을 정규화 -> "A035420"
function normalizeCode(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("/")) s = s.split("/").filter(Boolean).pop();
  s = s.split("?")[0].toUpperCase();
  return s;
}

function iconUrlFromCode(code) {
  const num = code.replace(/^A/i, "");
  return config.endpoints.logo.replace("{num}", num);
}

// Electron 메인의 전역 fetch 는 Chromium 네트워크 스택을 써서
// User-Agent/Referer/Origin 같은 "금지된 헤더"를 무시한다(→ 토스 403/빈응답).
// 그래서 Node 의 https 모듈로 직접 요청해 헤더를 그대로 전송한다.
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = "";
      res.setEncoding("utf-8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", (e) => {
      if (process.env.DEBUG_STOCK) console.error("[HTTP ERR]", url, e.message);
      reject(e);
    });
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
}

const metaCache = new Map(); // code -> { name, logoImageUrl }

async function fetchMeta(code) {
  if (metaCache.has(code)) return metaCache.get(code);
  try {
    const json = await httpGetJson(config.endpoints.info.replace("{code}", code));
    const r = json.result || {};
    const meta = {
      name: r.name || code,
      logoImageUrl: r.logoImageUrl || iconUrlFromCode(code),
    };
    metaCache.set(code, meta);
    return meta;
  } catch (e) {
    if (process.env.DEBUG_STOCK) console.error("[META ERR]", code, e.message);
    return { name: code, logoImageUrl: iconUrlFromCode(code) };
  }
}

async function fetchPrices(codes) {
  if (!codes.length) return {};
  const url = config.endpoints.price.replace("{codes}", codes.join(","));
  const json = await httpGetJson(url);
  const map = {};
  for (const item of json.result || []) map[item.productCode] = item;
  return map;
}

let latestData = { stocks: [], updatedAt: null, error: null };

async function poll() {
  const codes = config.stocks.map((s) => normalizeCode(s.code)).filter(Boolean);
  try {
    const [prices] = await Promise.all([fetchPrices(codes)]);
    const stocks = [];
    for (const s of config.stocks) {
      const code = normalizeCode(s.code);
      if (!code) continue;
      const meta = await fetchMeta(code);
      const p = prices[code];
      const close = p ? p.close : null;
      const base = p ? p.base : null;
      const avg = Number(s.avgPrice) || 0;
      const qty = Number(s.qty) || 0; // 보유 수량 (소수점 허용, 0이면 미설정)
      const dayChangeRate = close != null && base ? ((close - base) / base) * 100 : null;
      const profitRate = close != null && avg > 0 ? ((close - avg) / avg) * 100 : null;
      // 평가손익(총액)은 수량을 알아야 계산 가능: (현재가 - 평단가) × 수량
      const profitAmount = close != null && avg > 0 && qty > 0 ? (close - avg) * qty : null;
      const evalAmount = close != null && qty > 0 ? close * qty : null; // 평가금액
      stocks.push({
        code,
        name: meta.name,
        logoImageUrl: meta.logoImageUrl,
        close,
        base,
        changeType: p ? p.changeType : null,
        dayChangeRate,
        avgPrice: avg,
        qty,
        profitRate,
        profitAmount,
        evalAmount,
      });
    }
    latestData = { stocks, updatedAt: Date.now(), error: null };
  } catch (e) {
    latestData = { ...latestData, error: e.message, updatedAt: Date.now() };
  }
  broadcast();
}

function broadcast() {
  for (const w of [widgetWin, detailWin]) {
    if (w && !w.isDestroyed()) w.webContents.send("data", latestData);
  }
}

let pollTimer = null;
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, config.intervalSec * 1000);
}

// ───────────────────────── 창 ─────────────────────────
let tray = null;
let widgetWin = null;
let detailWin = null;
let settingsWin = null;

function positionWidget() {
  if (!widgetWin) return;
  const [w, h] = widgetWin.getSize();

  // 사용자가 옮긴 위치가 있으면 그 위치로 (화면 밖으로 나가지 않게 보정)
  if (config.widgetPos) {
    const { x, y } = clampToVisible(config.widgetPos.x, config.widgetPos.y, w, h);
    widgetWin.setPosition(x, y);
    return;
  }

  // 기본값: 주 모니터 우측 하단
  const { workArea } = screen.getPrimaryDisplay();
  const margin = 12;
  widgetWin.setPosition(
    Math.round(workArea.x + workArea.width - w - margin),
    Math.round(workArea.y + workArea.height - h - margin)
  );
}

// 위젯이 보이는 화면 영역 안에 있도록 좌표 보정
function clampToVisible(x, y, w, h) {
  const area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  const cx = Math.min(Math.max(x, area.x), area.x + area.width - w);
  const cy = Math.min(Math.max(y, area.y), area.y + area.height - h);
  return { x: Math.round(cx), y: Math.round(cy) };
}

function saveWidgetPos() {
  if (!widgetWin || widgetWin.isDestroyed()) return;
  const [x, y] = widgetWin.getPosition();
  config.widgetPos = { x, y };
  writeConfig();
}

function createWidget() {
  widgetWin = new BrowserWindow({
    width: 285,
    height: 96,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  widgetWin.setAlwaysOnTop(true, "screen-saver");
  widgetWin.loadFile(path.join(__dirname, "renderer", "widget.html"));
  widgetWin.once("ready-to-show", positionWidget);
  widgetWin.webContents.on("did-finish-load", () => {
    widgetWin.webContents.send("data", latestData);
  });
}

// 위젯 보기 ↔ 자세히 보기는 한 번에 하나만 표시한다.
function openDetail() {
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide(); // 위젯 숨김
  if (detailWin && !detailWin.isDestroyed()) {
    detailWin.show();
    detailWin.focus();
    return;
  }
  detailWin = new BrowserWindow({
    width: 380,
    height: 460,
    title: "StockWidget",
    resizable: false,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  detailWin.setMenuBarVisibility(false);
  detailWin.loadFile(path.join(__dirname, "renderer", "detail.html"));
  detailWin.webContents.on("did-finish-load", () => {
    detailWin.webContents.send("data", latestData);
  });
  detailWin.on("closed", () => {
    detailWin = null;
    // 자세히 보기를 닫으면 다시 위젯으로 돌아간다 (종료 중이 아닐 때)
    if (!app.isQuitting && widgetWin && !widgetWin.isDestroyed()) widgetWin.show();
  });
}

// 자세히 보기를 닫고 위젯으로 전환
function showWidget() {
  if (detailWin && !detailWin.isDestroyed()) detailWin.close(); // closed 핸들러가 위젯을 다시 보여줌
  else if (widgetWin && !widgetWin.isDestroyed()) widgetWin.show();
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 560,
    title: "StockWidget 설정",
    resizable: false,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.on("closed", () => (settingsWin = null));
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png"));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const menu = Menu.buildFromTemplate([
    { label: "자세히 보기", click: openDetail },
    { label: "위젯으로 보기", click: showWidget },
    { label: "설정", click: openSettings },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip("StockWidget");
  tray.setContextMenu(menu);
  tray.on("click", openDetail);
}

// ───────────────────────── IPC ─────────────────────────
ipcMain.handle("get-config", () => config);
ipcMain.handle("get-defaults", () => ({ endpoints: { ...DEFAULT_ENDPOINTS } }));
ipcMain.handle("save-config", (_e, newCfg) => {
  saveConfig(newCfg);
  metaCache.clear();
  startPolling();
  return config;
});
ipcMain.on("open-detail", openDetail);
ipcMain.on("show-widget", showWidget);
// 위젯 드래그 이동 (delta 만큼 창 이동)
ipcMain.on("move-widget-by", (_e, { dx, dy }) => {
  if (!widgetWin || widgetWin.isDestroyed()) return;
  const [x, y] = widgetWin.getPosition();
  widgetWin.setPosition(Math.round(x + dx), Math.round(y + dy));
});
ipcMain.on("save-widget-pos", saveWidgetPos);
ipcMain.on("open-settings", openSettings);
ipcMain.on("close-self", (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.close();
});

// ───────────────────────── 앱 라이프사이클 ─────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    buildTray();
    createWidget();
    startPolling();
    if (config.stocks.length === 0) openSettings(); // 최초 실행 안내
  });

  app.on("window-all-closed", (e) => {
    // 트레이 상주: 창 다 닫혀도 종료하지 않음
  });
}
