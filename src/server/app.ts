import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type {
  LinePicker,
  ResolvedConfig,
  Storage,
  Synthesizer,
  Transcriber,
} from "../types/index.ts";
import { registerRoutes } from "./routes.ts";
import { messagePage } from "./views.ts";

export interface BuildAppOptions {
  config: ResolvedConfig;
  storage: Storage;
  transcriber: Transcriber;
  synthesizer: Synthesizer;
  picker: LinePicker;
  now?: () => Date;
}

export function buildApp(options: BuildAppOptions): Hono {
  const { config } = options;
  const demo = config.mode === "demo";
  const app = new Hono();

  app.use(
    "/static/*",
    serveStatic({ root: "./public", rewriteRequestPath: (p) => p.replace(/^\/static/, "") }),
  );
  registerRoutes(app, { ...options, now: options.now ?? (() => new Date()) });

  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
    return c.html(await messagePage("Not found", "There is nothing at this address.", demo), 404);
  });
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
