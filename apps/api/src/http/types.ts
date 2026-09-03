import type { Permission } from "@aguateria/shared";
import type { Database } from "../db/client.js";

export type AuthUser = {
  id: string;
  companyId: string;
  email: string;
  username: string;
  fullName: string;
  permissions: Permission[];
  roles: string[];
};

export type AppVariables = {
  db: Database;
  user?: AuthUser;
};

export type AppEnv = {
  Variables: AppVariables;
};
