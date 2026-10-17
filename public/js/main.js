import { store } from "./store.js";
import { initGame } from "./game.js";
import { initHud } from "./hud.js";
import { initReports } from "./reports.js";
import { initAlerts } from "./alerts.js";
import { initProjects } from "./projects.js";
import { initConfig } from "./config.js";

async function bootstrap() {
  initHud();
  initAlerts();
  initProjects();
  initConfig();
  await store.init();
  initReports();
  await initGame("game-container");
  store.connectSSE();
}

bootstrap().catch((err) => {
  console.error("[main] failed to start Agent Village", err);
  document.getElementById("game-container").textContent = "起動に失敗しました。サーバーが起動しているか確認してください。";
});
