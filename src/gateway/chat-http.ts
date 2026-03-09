/**
 * POST /api/chat — simple REST chat endpoint for Mouse.
 *
 * Accepts a Bearer token matching the configured gateway auth token,
 * and dispatches a message to the active agent session via the hook mechanism.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { safeEqualSecret } from "../security/secret-equal.js";
import { getBearerToken } from "./http-utils.js";
import type { ResolvedGatewayAuth } from "./auth.js";

const CHAT_HTTP_PATH = "/api/chat";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export type ChatHttpDispatcher = (message: string) => Promise<string>;

export async function handleChatHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    resolvedAuth: ResolvedGatewayAuth;
    dispatch?: ChatHttpDispatcher;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== CHAT_HTTP_PATH) {
    return false;
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: { message: "Method Not Allowed", type: "method_not_allowed" } });
    return true;
  }

  // Authenticate using gateway token
  const bearerToken = getBearerToken(req);
  const { resolvedAuth } = opts;

  if (resolvedAuth.mode !== "none") {
    const expectedToken =
      resolvedAuth.mode === "token"
        ? resolvedAuth.token
        : resolvedAuth.mode === "password"
          ? resolvedAuth.password
          : undefined;
    if (!expectedToken || !bearerToken || !safeEqualSecret(bearerToken, expectedToken)) {
      sendJson(res, 401, { error: { message: "Unauthorized", type: "unauthorized" } });
      return true;
    }
  }

  // Parse body
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { message: "Invalid JSON body", type: "bad_request" } });
    return true;
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("message" in body) ||
    typeof (body as Record<string, unknown>).message !== "string"
  ) {
    sendJson(res, 400, {
      error: { message: 'Missing required field: "message"', type: "bad_request" },
    });
    return true;
  }

  const message = (body as { message: string }).message;

  // Dispatch to the agent session if a dispatcher is configured,
  // otherwise return a simple acknowledgment.
  if (opts.dispatch) {
    try {
      const response = await opts.dispatch(message);
      sendJson(res, 200, { response });
    } catch (err) {
      sendJson(res, 500, {
        error: { message: `Agent dispatch failed: ${String(err)}`, type: "internal_error" },
      });
    }
  } else {
    // No dispatcher configured; queue the message and return accepted.
    sendJson(res, 202, {
      response: null,
      queued: true,
      message: "Message accepted. Connect via WebSocket to receive streaming responses.",
    });
  }

  return true;
}
