import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Hoverchart workspace configuration.
 */
export interface HovechartConfig {
  spaceId: string;
  spaceOwnerId: string;
  spaceName?: string;
}

const CONFIG_RELATIVE = path.join(".github", "hoverchart.json");

/**
 * Returns the hoverchart config by reading `.github/hoverchart.json` from the
 * workspace root first (highest priority), then falling back to VS Code
 * settings `hoverchart.spaceId` / `hoverchart.spaceOwnerId`.
 *
 * Returns `undefined` if neither source provides a complete config.
 */
export function getConfig(): HovechartConfig | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const configPath = path.join(
      workspaceFolders[0].uri.fsPath,
      CONFIG_RELATIVE
    );
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<HovechartConfig>;
      if (parsed.spaceId && parsed.spaceOwnerId) {
        return {
          spaceId: parsed.spaceId,
          spaceOwnerId: parsed.spaceOwnerId,
          spaceName: parsed.spaceName,
        };
      }
    } catch {
      // File doesn't exist or is invalid — fall through to VS Code settings
    }
  }

  // Fall back to VS Code settings
  const vsConfig = vscode.workspace.getConfiguration("hoverchart");
  const spaceId = vsConfig.get<string>("spaceId") ?? "";
  const spaceOwnerId = vsConfig.get<string>("spaceOwnerId") ?? "";
  if (spaceId && spaceOwnerId) {
    return { spaceId, spaceOwnerId };
  }

  return undefined;
}

/**
 * Saves the given config to `.github/hoverchart.json` in the workspace root,
 * creating the `.github` directory if necessary.
 */
export async function saveConfig(config: HovechartConfig): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folder is open.");
  }

  const githubDir = path.join(workspaceFolders[0].uri.fsPath, ".github");
  if (!fs.existsSync(githubDir)) {
    fs.mkdirSync(githubDir, { recursive: true });
  }

  const configPath = path.join(githubDir, "hoverchart.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}
