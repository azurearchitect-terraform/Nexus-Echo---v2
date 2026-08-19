import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 1420);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!Number.isFinite(port) || port <= 0) {
  process.exit(0);
}

function killWindowsListeners(listeningPort) {
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          `$pids = Get-NetTCPConnection -LocalPort ${listeningPort} -State Listen -ErrorAction SilentlyContinue |`,
          "  Select-Object -ExpandProperty OwningProcess -Unique;",
          "if ($pids) { $pids | ForEach-Object { Write-Output $_ } }",
        ].join(" "),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );

    const pids = [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
    for (const pid of pids) {
      try {
        execFileSync("taskkill.exe", ["/PID", pid, "/T", "/F"], {
          stdio: "ignore",
        });
      } catch {
        // If the process vanished or we don't have permission, continue.
      }
    }
  } catch {
    // No listener found or PowerShell is unavailable. Either way, there is
    // nothing fatal to block dev startup.
  }
}

if (process.platform === "win32") {
  const targetRoot = path.join(repoRoot, "apps", "desktop", "src-tauri", "target");
  try {
    const escapedTargetRoot = targetRoot.replaceAll("'", "''");
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "Get-CimInstance Win32_Process -Filter \"Name = 'nexus-echo.exe'\" |",
          `  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${escapedTargetRoot}', [System.StringComparison]::OrdinalIgnoreCase) } |`,
          "  Select-Object -ExpandProperty ProcessId",
        ].join(" "),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );

    const pids = [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
    for (const pid of pids) {
      try {
        execFileSync("taskkill.exe", ["/PID", pid, "/T", "/F"], {
          stdio: "ignore",
        });
      } catch {
        // If the process vanished or we don't have permission, continue.
      }
    }
  } catch {
    // Process discovery is best-effort; the port cleanup can still proceed.
  }

  killWindowsListeners(port);
}
