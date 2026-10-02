import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ExecFn } from "./tmux.js";
import { execCommand } from "./tmux-exec.js";

const execAsync = promisify(exec);

/** Version checks do not belong to a project. The executable's filesystem root
 * survives deletion of the directory from which the daemon was started. Keep
 * profile/config probes and all other commands in their existing context. */
export function runtimeVersionProbeCwd(cmd: string): string | undefined {
  return /^(pi|omp|codex|claude) --version$/.test(cmd)
    ? path.parse(process.execPath).root
    : undefined;
}

/** Production preflight only; callers still prefer an explicitly injected exec. */
export const execPreflightCommand: ExecFn = async (cmd) => {
  const cwd = runtimeVersionProbeCwd(cmd);
  if (cwd === undefined) return execCommand(cmd);
  const { stdout } = await execAsync(cmd, { cwd });
  return stdout;
};

/** Do not echo a runtime's arbitrary output, environment, paths or stack trace.
 * Retain only bounded process status and recognisable failure categories. */
export function runtimeProbeFailure(err: unknown): string {
  if (!err || typeof err !== "object") return "execution failed";
  const failure = err as { code?: unknown; status?: unknown; signal?: unknown; stderr?: unknown; message?: unknown };
  const code = failure.code ?? failure.status;
  const detail: string[] = [];
  if (typeof code === "number" && Number.isSafeInteger(code)) detail.push(`exit status ${code}`);
  else if (typeof code === "string" && ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"].includes(code)) detail.push(code);
  if (["SIGTERM", "SIGKILL", "SIGABRT"].includes(String(failure.signal))) detail.push(String(failure.signal));
  const stderr = Buffer.isBuffer(failure.stderr) ? failure.stderr.toString() : failure.stderr;
  const diagnostic = [stderr, failure.message].filter((value) => typeof value === "string").join("\n");
  if (/\b(?:uv_cwd|getcwd)\b/.test(diagnostic)) detail.push("working-directory lookup failed");
  else if (/(?:command not found|: (?:pi|omp|codex|claude): not found)/.test(diagnostic)) detail.push("executable not found on PATH");
  return detail.join("; ") || "execution failed";
}
