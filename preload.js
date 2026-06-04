const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // 메인 -> 렌더러: 시세 데이터 수신
  onData: (cb) => ipcRenderer.on("data", (_e, data) => cb(data)),
  // 설정 읽기/저장
  getConfig: () => ipcRenderer.invoke("get-config"),
  getDefaults: () => ipcRenderer.invoke("get-defaults"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  // 창 제어
  openDetail: () => ipcRenderer.send("open-detail"),
  showWidget: () => ipcRenderer.send("show-widget"),
  // 위젯 드래그 이동
  moveWidgetBy: (dx, dy) => ipcRenderer.send("move-widget-by", { dx, dy }),
  saveWidgetPos: () => ipcRenderer.send("save-widget-pos"),
  openSettings: () => ipcRenderer.send("open-settings"),
  closeSelf: () => ipcRenderer.send("close-self"),
});
