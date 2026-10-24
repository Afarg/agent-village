import { store } from "./store.js";
import { initGame } from "./game.js";
import { initHud } from "./hud.js";
import { initReports } from "./reports.js";
import { initAlerts } from "./alerts.js";
import { initProjects } from "./projects.js";
import { initConfig } from "./config.js";
import { initUnread } from "./unread.js";
import { initLayoutControls } from "./layout.js";
import { initGlossary } from "./glossary.js";
import { initSetup } from "./setup.js";

async function bootstrap() {
  initLayoutControls();
  initGlossary();
  initHud();
  initAlerts();
  initProjects();
  initConfig();
  await initUnread();
  await store.init();
  await store.loadDisplaySettings();
  store.startStaleTimer();
  initReports();
  await initGame("game-container");
  store.connectSSE();
  initSetup();
}

bootstrap().catch((err) => {
  console.error("[main] failed to start Agent Village", err);
  document.getElementById("game-container").textContent = "起動に失敗しました。サーバーが起動しているか確認してください。";
});
