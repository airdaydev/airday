import { v } from "suretype";

export const v_session_cookie = v.object({
  id: v.string(),
  token: v.string(),
  expires: v.string(),
  refresh_token: v.string(),
  refresh_expires: v.string(),
});

export const v_session_bearer = v.object({
  id: v.string(),
  expires: v.string(),
  refresh_expires: v.string(),
});
