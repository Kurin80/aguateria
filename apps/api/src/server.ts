import "./load-env-file.js";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = createApp();

serve({ fetch: app.fetch, hostname: env.API_HOST, port: env.API_PORT }, (info) => {
  console.log(`API escuchando en http://${info.address}:${info.port} (PostgreSQL local)`);
});
