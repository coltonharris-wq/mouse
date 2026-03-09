/**
 * POST /api/onboard-config — write USER.md and MEMORY.md to the workspace.
 *
 * Called by the Mouse dashboard after the customer completes the onboarding
 * interview. Stores the business profile so King Mouse knows who he works for.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { safeEqualSecret } from "../security/secret-equal.js";
import { getBearerToken } from "./http-utils.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { resolveStateDir } from "../config/paths.js";

const ONBOARD_CONFIG_PATH = "/api/onboard-config";

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
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function buildUserMd(params: {
  owner_name: string;
  company_name: string;
  industry: string;
  needs: string[];
  custom_instructions?: string;
}): string {
  const needsList = params.needs
    .map((n) => n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(", ");
  return [
    `# About Your Owner`,
    ``,
    `- **Name:** ${params.owner_name}`,
    `- **Company:** ${params.company_name}`,
    `- **Industry:** ${params.industry}`,
    `- **Needs:** ${needsList}`,
    params.custom_instructions
      ? [``, `## Custom Instructions`, params.custom_instructions].join("\n")
      : "",
  ]
    .join("\n")
    .trim();
}

function buildMemoryMd(params: {
  owner_name: string;
  company_name: string;
  industry: string;
  needs: string[];
  custom_instructions?: string;
}): string {
  const needsList = params.needs
    .map((n) => n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(", ");
  return [
    `# King Mouse Memory — ${params.company_name}`,
    ``,
    `## Business Profile`,
    `- **Company:** ${params.company_name}`,
    `- **Owner:** ${params.owner_name}`,
    `- **Industry:** ${params.industry}`,
    `- **Services needed:** ${needsList}`,
    ``,
    `## Owner Instructions`,
    params.custom_instructions ?? "(none provided)",
    ``,
    `## Learned Patterns`,
    `(King Mouse will fill this in over time as he learns the owner's preferences)`,
  ].join("\n");
}

export async function handleOnboardConfigHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { resolvedAuth: ResolvedGatewayAuth },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== ONBOARD_CONFIG_PATH) {
    return false;
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "POST") {
    sendJson(res, 405, { error: { message: "Method Not Allowed", type: "method_not_allowed" } });
    return true;
  }

  // Authenticate
  const { resolvedAuth } = opts;
  if (resolvedAuth.mode !== "none") {
    const bearerToken = getBearerToken(req);
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

  if (!body || typeof body !== "object") {
    sendJson(res, 400, { error: { message: "Request body must be a JSON object", type: "bad_request" } });
    return true;
  }

  const b = body as Record<string, unknown>;
  const company_name = typeof b.company_name === "string" ? b.company_name.trim() : "";
  const owner_name = typeof b.owner_name === "string" ? b.owner_name.trim() : "";
  const industry = typeof b.industry === "string" ? b.industry.trim() : "";
  const needs = Array.isArray(b.needs) ? (b.needs as unknown[]).filter((n): n is string => typeof n === "string") : [];
  const custom_instructions = typeof b.custom_instructions === "string" ? b.custom_instructions.trim() : undefined;
  const force = b.force === true;

  if (!company_name || !owner_name || !industry) {
    sendJson(res, 400, {
      error: { message: "company_name, owner_name, and industry are required", type: "bad_request" },
    });
    return true;
  }

  const stateDir = resolveStateDir();
  const workspaceDir = path.join(stateDir, "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });

  const userMdPath = path.join(workspaceDir, "USER.md");
  const memoryMdPath = path.join(workspaceDir, "MEMORY.md");

  const filesWritten: string[] = [];

  const params = { company_name, owner_name, industry, needs, custom_instructions };

  // USER.md
  let writeUser = force;
  if (!writeUser) {
    try { await fs.access(userMdPath); } catch { writeUser = true; }
  }
  if (writeUser) {
    await fs.writeFile(userMdPath, buildUserMd(params), "utf-8");
    filesWritten.push("USER.md");
  }

  // MEMORY.md
  let writeMemory = force;
  if (!writeMemory) {
    try { await fs.access(memoryMdPath); } catch { writeMemory = true; }
  }
  if (writeMemory) {
    await fs.writeFile(memoryMdPath, buildMemoryMd(params), "utf-8");
    filesWritten.push("MEMORY.md");
  }

  sendJson(res, 200, {
    status: "ok",
    message: `King Mouse configured for ${company_name}`,
    files_written: filesWritten,
  });
  return true;
}
