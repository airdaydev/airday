import { AirdayCore } from "../core";

export abstract class AuthAdapter {
  abstract core: AirdayCore;
  abstract credentials: RequestCredentials;
  abstract headers: (json?: boolean) => Record<string, string>;
}
