import { handle } from "hono/vercel";
import { createApp } from "./app.js";

const app = createApp();

export const config = { runtime: "nodejs" };
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
