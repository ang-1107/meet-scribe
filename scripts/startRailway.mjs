import { spawn } from "node:child_process";
import path from "node:path";

const port = process.env.PORT || "3000";
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBin, "start", "-H", "0.0.0.0", "-p", port], {
  stdio: "inherit",
  env: process.env
});

function forwardSignal(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGTERM", () => {
  forwardSignal("SIGTERM");
});

process.on("SIGINT", () => {
  forwardSignal("SIGINT");
});

child.on("exit", (code, signal) => {
  if (signal === "SIGTERM" || signal === "SIGINT") {
    process.exit(0);
    return;
  }

  if (signal) {
    process.exit(1);
    return;
  }

  process.exit(code ?? 0);
});
