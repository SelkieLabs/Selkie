import { loadBotConfig } from "./config";
import { SelkieClient } from "./selkie";
import { FileStateStore } from "./state";
import { XClient } from "./x/client";
import { XWorker } from "./x/worker";

/**
 * Wiring, and nothing else.
 *
 * Each surface starts only if its credentials are there, so adding Telegram is
 * another six lines here and a transport beside x/, with the parser and the
 * replies already shared.
 */
async function main() {
  const config = loadBotConfig();
  const selkie = new SelkieClient({ baseUrl: config.apiUrl, botSecret: config.botSecret });

  const workers: { stop(): void }[] = [];

  if (config.x) {
    const worker = new XWorker({
      client: new XClient(config.x),
      selkie,
      handle: config.x.handle,
      webUrl: config.webUrl,
      chain: config.chain,
      // On NEAR the secret only exists to send from X pockets.
      pocket: config.chain === "near" && Boolean(config.botSecret),
      state: new FileStateStore(config.statePath),
      pollMs: config.x.pollMs,
      activeMs: config.x.activeMs,
      dryRun: config.dryRun,
    });
    workers.push(worker);
    void worker.start();
  }

  if (workers.length === 0) {
    throw new Error("No surface is configured. Set the X credentials to run the X worker.");
  }

  console.log(
    config.chain !== "near"
      ? `Selkie bot talking to ${config.apiUrl}`
      : config.botSecret
        ? `Selkie bot on NEAR: sends from X pockets through ${config.apiUrl}, links to ${config.webUrl} otherwise`
        : `Selkie bot on NEAR: replies with links to ${config.webUrl}; it never moves money (no SELKIE_BOT_SECRET)`,
  );
  if (config.chain === "near" && config.botSecret && config.dryRun) {
    console.log("DRY RUN: no pocket money moves either, since no receipt would be posted.");
  }
  if (config.dryRun) {
    console.log("DRY RUN: replies are worked out and logged, and nothing is posted.");
    console.log("Set SELKIE_BOT_DRY_RUN=0 when you want it to post for real.");
  }

  // Stop cleanly, so a restart does not leave a half-written state file behind.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`\n${signal}: stopping`);
      for (const worker of workers) worker.stop();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
