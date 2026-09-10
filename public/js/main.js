import { store } from "./store.js";
import { initGame } from "./game.js";
import { initHud } from "./hud.js";

async function bootstrap() {
  initHud();
  await store.init();
  await initGame("game-container");
  store.connectSSE();
}

bootstrap().catch((err) => {
  console.error("[main] failed to start Agent Village", err);
  document.getElementById("game-container").textContent = "起動に失敗しました。サーバーが起動しているか確認してください。";
});
