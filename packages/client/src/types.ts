import { v } from "suretype";

export const v_session_cookie = v.object({
  id: v.string().required(),
  expires: v.string().required(),
  refreshExpires: v.string().required(),
  user_id: v.string().required(),
});

export const v_session_bearer = v.object({
  id: v.string().required(),
  token: v.string().required(),
  expires: v.string().required(),
  refreshToken: v.string().required(),
  refreshExpires: v.string().required(),
  user_id: v.string().required(),
});
