import { createMiddleware } from "hono/factory";

export const tokenAuth = createMiddleware(async (c, next) => {
  const token = process.env.OPENUI_TOKEN;
  if (!token) {
    // No token configured — pass through (localhost dev mode)
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const provided = authHeader.slice(7);
  if (provided !== token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return next();
});
