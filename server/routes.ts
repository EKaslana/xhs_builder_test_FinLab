import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import http from "node:http";

const PY_PORT = 8765;
const PY_HOST = "127.0.0.1";
let pyProc: ChildProcess | null = null;

function startPython() {
  if (pyProc) return;
  const cwd = path.resolve(process.cwd(), "python_backend");
  console.log(`[python] starting backend in ${cwd} on :${PY_PORT}`);
  pyProc = spawn("python3", ["-m", "uvicorn", "main:app", "--host", PY_HOST, "--port", String(PY_PORT)], {
    cwd,
    env: { ...process.env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  pyProc.on("exit", (code) => {
    console.log(`[python] exited with code ${code}`);
    pyProc = null;
  });
}

function waitForPython(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: PY_HOST, port: PY_PORT, path: "/api/py/health", timeout: 1000 }, (r) => {
        r.resume();
        if (r.statusCode === 200) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error("python startup timeout"));
        setTimeout(tick, 500);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) return reject(new Error("python startup timeout"));
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

function proxyToPython(req: Request, res: Response) {
  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];

  const options: http.RequestOptions = {
    host: PY_HOST,
    port: PY_PORT,
    path: req.originalUrl,
    method: req.method,
    headers,
  };
  const upstream = http.request(options, (uRes) => {
    res.status(uRes.statusCode || 502);
    Object.entries(uRes.headers).forEach(([k, v]) => {
      if (v !== undefined) res.setHeader(k, v as any);
    });
    uRes.pipe(res);
  });
  upstream.on("error", (err) => {
    console.error("[proxy] error:", err.message);
    if (!res.headersSent) res.status(502).json({ message: "Python backend unavailable", error: err.message });
  });

  // For multipart uploads or json bodies, pipe raw stream
  if (req.readable) {
    req.pipe(upstream);
  } else if (req.body && Object.keys(req.body).length) {
    const data = JSON.stringify(req.body);
    upstream.setHeader("content-type", "application/json");
    upstream.setHeader("content-length", Buffer.byteLength(data));
    upstream.write(data);
    upstream.end();
  } else {
    upstream.end();
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  startPython();
  // Try to wait for python but do not block server start
  waitForPython(30000).then(() => console.log("[python] ready")).catch((e) => console.warn("[python]", e.message));

  // Proxy all /api/py/* to FastAPI on 127.0.0.1:8765
  app.all(/^\/api\/py\/.*/, (req, res) => proxyToPython(req, res));

  app.get("/api/health", async (_req, res) => {
    res.json({ ok: true, py_alive: !!pyProc });
  });

  return httpServer;
}
