// @ts-nocheck
// Entrypoint de la Serverless Function de Vercel para toda la API (/api/*).
// Importa el adaptador YA COMPILADO (apps/api/dist) para que @vercel/node no tenga
// que transpilar TypeScript fuera de este directorio. El build de `apps/api` corre
// en `buildCommand` de vercel.json antes de que Vercel procese esta función.
export { GET, POST, PUT, PATCH, DELETE, OPTIONS, config } from "../apps/api/dist/vercel.js";
