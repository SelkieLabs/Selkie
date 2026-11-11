/**
 * Make the VAPID key pair Web Push needs, once.
 *
 *   npm run push:keys
 *
 * Writes WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY to .env if they are not
 * there yet, and never prints the private half. Keep the pair: browsers
 * subscribe against the public key, so a new pair silently stops every
 * existing subscription.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import webpush from "web-push";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split("\n") : [];
const has = (name: string) => lines.some((line) => line.startsWith(`${name}=`) && line.length > name.length + 1);

if (has("WEB_PUSH_PUBLIC_KEY") && has("WEB_PUSH_PRIVATE_KEY")) {
  console.log("WEB_PUSH keys already in .env; keeping them.");
} else {
  const keys = webpush.generateVAPIDKeys();
  const kept = lines.filter((line) => !line.startsWith("WEB_PUSH_PUBLIC_KEY=") && !line.startsWith("WEB_PUSH_PRIVATE_KEY="));
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  kept.push("", "# Web Push (npm run push:keys). The private key is a secret.");
  kept.push(`WEB_PUSH_PUBLIC_KEY=${keys.publicKey}`, `WEB_PUSH_PRIVATE_KEY=${keys.privateKey}`);
  writeFileSync(ENV_PATH, `${kept.join("\n")}\n`, { mode: 0o600 });
  console.log(`Wrote WEB_PUSH_PUBLIC_KEY (${keys.publicKey.slice(0, 12)}…) and WEB_PUSH_PRIVATE_KEY to .env. Restart the API.`);
}
