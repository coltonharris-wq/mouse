/**
 * Employee CLI commands for Mouse.
 *
 * mouse deploy-employee "<Name>" "<Task>"
 * mouse list-employees
 * mouse kill-employee "<Name>"
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Command } from "commander";
import { resolveStateDir } from "../config/paths.js";

type EmployeeRecord = {
  name: string;
  task: string;
  status: "deploying" | "running" | "completed" | "terminated";
  created_at: string;
  last_active: string;
  session_id: string;
};

function getEmployeesDir(): string {
  return path.join(resolveStateDir(), "employees");
}

function employeeFilePath(dir: string, name: string): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  return path.join(dir, `${safeName}.json`);
}

async function ensureEmployeesDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function registerEmployeeCommands(program: Command): void {
  // deploy-employee
  program
    .command("deploy-employee <name> <task>")
    .description("Deploy an employee sub-agent with a given task")
    .action(async (name: string, task: string) => {
      const dir = getEmployeesDir();
      await ensureEmployeesDir(dir);

      const now = new Date().toISOString();
      const record: EmployeeRecord = {
        name,
        task,
        status: "deploying",
        created_at: now,
        last_active: now,
        session_id: crypto.randomUUID(),
      };

      const filePath = employeeFilePath(dir, name);
      await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");

      process.stdout.write(`🐭 Deploying employee ${name}...\n`);
      process.stdout.write(`   Task: ${task}\n`);
      process.stdout.write(`   Session: ${record.session_id}\n`);
      process.stdout.write(`   Record: ${filePath}\n`);
    });

  // list-employees
  program
    .command("list-employees")
    .description("List all deployed employees")
    .action(async () => {
      const dir = getEmployeesDir();
      let entries: string[] = [];
      try {
        entries = await fs.readdir(dir);
      } catch {
        process.stdout.write("No employees deployed yet.\n");
        return;
      }

      const jsonFiles = entries.filter((f) => f.endsWith(".json"));
      if (jsonFiles.length === 0) {
        process.stdout.write("No employees deployed yet.\n");
        return;
      }

      const records: EmployeeRecord[] = [];
      for (const file of jsonFiles) {
        try {
          const raw = await fs.readFile(path.join(dir, file), "utf-8");
          const parsed = JSON.parse(raw) as EmployeeRecord;
          records.push(parsed);
        } catch {
          // Skip malformed files
        }
      }

      // Print table header
      const nameW = 20;
      const taskW = 40;
      const statusW = 12;
      const dateW = 20;

      const row = (name: string, task: string, status: string, date: string) =>
        `${name.padEnd(nameW)} ${task.padEnd(taskW)} ${status.padEnd(statusW)} ${date}\n`;

      process.stdout.write(row("NAME", "TASK", "STATUS", "CREATED"));
      process.stdout.write(row("-".repeat(nameW), "-".repeat(taskW), "-".repeat(statusW), "-".repeat(dateW)));

      for (const r of records) {
        const task = r.task.length > taskW - 3 ? r.task.slice(0, taskW - 4) + "..." : r.task;
        process.stdout.write(
          row(r.name.slice(0, nameW - 1), task, r.status, r.created_at.slice(0, 19)),
        );
      }
    });

  // kill-employee
  program
    .command("kill-employee <name>")
    .description("Terminate a deployed employee")
    .action(async (name: string) => {
      const dir = getEmployeesDir();
      const filePath = employeeFilePath(dir, name);

      let record: EmployeeRecord;
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        record = JSON.parse(raw) as EmployeeRecord;
      } catch {
        process.stderr.write(`Employee "${name}" not found.\n`);
        process.exit(1);
        return;
      }

      record.status = "terminated";
      record.last_active = new Date().toISOString();
      await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");

      process.stdout.write(`✓ ${name} terminated\n`);
    });
}
