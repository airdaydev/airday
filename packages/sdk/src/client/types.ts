import { v } from "suretype";

export const v_session_cookie = v.object({
  id: v.string().required(),
  expires: v.string().format("date-time").required(),
  refreshExpires: v.string().format("date-time").required(),
  userId: v.string().required(),
});

export const v_session_bearer = v.object({
  id: v.string().required(),
  token: v.string().required(),
  expires: v.string().format("date-time").required(),
  refreshToken: v.string().required(),
  refreshExpires: v.string().format("date-time").required(),
  userId: v.string().required(),
});
