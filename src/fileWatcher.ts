import * as vscode from "vscode";
import * as fs from "fs";
import { parsePlan } from "./planParser.js";
import { exportTasks, validateSpaceAccess } from "./hoverchartClient.js";
import { getIdToken, getUserId } from "./auth.js";
import { getConfig } from "./config.js";

/**
 * Registers a file-system watcher for `.github/plan.md` in the workspace.
 * On create or change the user is prompted to export tasks to hoverchart.
 */
export function registerFileWatcher(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/.github/plan.md"
  );

  const handlePlanFile = async (uri: vscode.Uri) => {
    let content: string;
    try {
      content = fs.readFileSync(uri.fsPath, "utf8");
    } catch (err) {
      vscode.window.showErrorMessage(
        `Hoverchart: Failed to read plan file: ${err}`
      );
      return;
    }

    const tasks = parsePlan(content);
    if (tasks.length === 0) {
      return;
    }

    const cfg = getConfig();
    if (!cfg) {
      const configure = await vscode.window.showWarningMessage(
        "Hoverchart: No space configured. Run 'Hoverchart: Configure' before exporting.",
        "Configure Now"
      );
      if (configure === "Configure Now") {
        await vscode.commands.executeCommand("hoverchart.configure");
      }
      return;
    }

    // Resolve the human-readable space name to display in the confirmation
    let spaceName = cfg.spaceName;
    if (!spaceName) {
      const idToken = await getIdToken(context);
      const userId = idToken ? await getUserId(context) : undefined;
      if (idToken && userId) {
        try {
          const access = await validateSpaceAccess(
            idToken,
            userId,
            cfg.spaceOwnerId,
            cfg.spaceId
          );
          spaceName = access.spaceName;
        } catch {
          // Non-fatal — proceed without a resolved name
        }
      }
    }

    const label = spaceName
      ? `'${spaceName}'`
      : `'${cfg.spaceId}'`;

    const answer = await vscode.window.showInformationMessage(
      `Hoverchart: Export ${tasks.length} task${tasks.length === 1 ? "" : "s"} to space ${label}?`,
      "Yes",
      "Change Space",
      "No"
    );

    if (answer === "Change Space") {
      await vscode.commands.executeCommand("hoverchart.configure");
      return;
    }

    if (answer !== "Yes") {
      return;
    }

    try {
      const idToken = await getIdToken(context);
      if (!idToken) {
        const loginAnswer = await vscode.window.showWarningMessage(
          "Hoverchart: You need to log in before exporting tasks.",
          "Login"
        );
        if (loginAnswer === "Login") {
          await vscode.commands.executeCommand("hoverchart.login");
        }
        return;
      }

      await exportTasks(context, tasks, idToken);
      vscode.window.showInformationMessage(
        `Hoverchart: Successfully exported ${tasks.length} task${tasks.length === 1 ? "" : "s"} to hoverchart space.`
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Hoverchart: Export failed — ${err}`);
    }
  };

  watcher.onDidCreate(handlePlanFile);
  watcher.onDidChange(handlePlanFile);

  context.subscriptions.push(watcher);
}
