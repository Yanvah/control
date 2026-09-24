import "server-only";
import { parseEnv, type ControlEnv } from "./schema";

export type { ControlEnv } from "./schema";

let environment: ControlEnv | undefined;

export function getEnv(): ControlEnv {
  environment ??= parseEnv(process.env);
  return environment;
}
