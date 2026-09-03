import { eq, and, isNull } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { permissions, rolePermissions, roles, userRoles, users } from "../db/schema.js";
import { jsonError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/jwt.js";
import type { AppEnv } from "./types.js";
import type { Permission } from "@aguateria/shared";

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw jsonError("UNAUTHORIZED", "Sesión requerida", 401);
  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw jsonError("UNAUTHORIZED", "Token inválido o expirado", 401);
  }
  const db = c.get("db");
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, claims.sub), isNull(users.deletedAt)))
    .limit(1);
  if (!user || !user.active) throw jsonError("UNAUTHORIZED", "Usuario inactivo", 401);

  const assigned = await db
    .select({ permission: permissions.code, role: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, user.id));

  const permSet = new Set(assigned.map((r) => r.permission));
  const roleSet = new Set(assigned.map((r) => r.role));

  c.set("user", {
    id: user.id,
    companyId: user.companyId,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    permissions: [...permSet] as Permission[],
    roles: [...roleSet],
  });
  await next();
};

export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw jsonError("UNAUTHORIZED", "Sesión requerida", 401);
    if (!user.permissions.includes(permission)) {
      throw jsonError("FORBIDDEN", "Permiso insuficiente", 403);
    }
    await next();
  };
}
