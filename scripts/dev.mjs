/**
 * Starts both services with one command.
 *
 * Spawns Node directly rather than going through a shell, so it does not depend
 * on cmd.exe or /bin/sh being resolvable from PATH — which is not guaranteed on
 * every machine, and a judge's setup is not something we control.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// npm may hoist vite to the workspace root or keep it nested; check both rather
// than relying on package exports, which do not expose the bin path.
function findVite() {
  const candidates = [
    resolve(root, "node_modules", "vite", "bin", "vite.js"),
    resolve(root, "web", "node_modules", "vite", "bin", "vite.js"),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    console.error("Could not find vite. Run `npm install` first.");
    process.exit(1);
  }
  return found;
}

const services = [
  {
    name: "api",
    colour: "\x1b[36m",
    cwd: resolve(root, "api"),
    args: [
      "--experimental-strip-types",
      "--no-warnings",
      "--watch",
      "src/server.ts",
    ],
  },
  {
    name: "web",
    colour: "\x1b[35m",
    cwd: resolve(root, "web"),
    args: [findVite()],
  },
];

const RESET = "\x1b[0m";
const children = [];

for (const service of services) {
  const child = spawn(process.execPath, service.args, {
    cwd: service.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const prefix = `${service.colour}[${service.name}]${RESET} `;
  const forward = (stream, out) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };

  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on("exit", (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    shutdown();
  });

  children.push(child);
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  process.exitCode = 1;
}

process.on("SIGINT", () => {
  shuttingDown = true;
  for (const child of children) child.kill();
  process.exit(0);
});
