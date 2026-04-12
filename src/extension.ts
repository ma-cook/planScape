import * as vscode from "vscode";
import { registerFileWatcher } from "./fileWatcher.js";
import { login } from "./auth.js";
import { parsePlan } from "./planParser.js";
import { exportTasks, validateSpaceAccess } from "./hoverchartClient.js";
import { getIdToken, getUserId } from "./auth.js";
import { getConfig, saveConfig } from "./config.js";
import * as fs from "fs";
import * as path from "path";

export function activate(context: vscode.ExtensionContext): void {
  // Register the login command
  context.subscriptions.push(
    vscode.commands.registerCommand("hoverchart.login", async () => {
      try {
        await login(context);
      } catch (err) {
        vscode.window.showErrorMessage(`Hoverchart: Login failed — ${err}`);
      }
    })
  );

  // Register the configure command — guides the user through an InputBox flow
  // and saves the result to .github/hoverchart.json in the workspace root.
  context.subscriptions.push(
    vscode.commands.registerCommand("hoverchart.configure", async () => {
      const existing = getConfig();

      const spaceId = await vscode.window.showInputBox({
        title: "Hoverchart: Configure — Space ID",
        prompt: "Enter the hoverchart space ID to export tasks to",
        value: existing?.spaceId ?? "",
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? undefined : "Space ID cannot be empty"),
      });
      if (!spaceId) {
        return;
      }

      const spaceOwnerId = await vscode.window.showInputBox({
        title: "Hoverchart: Configure — Space Owner ID",
        prompt: "Enter the Firebase UID of the space owner",
        value: existing?.spaceOwnerId ?? "",
        ignoreFocusOut: true,
        validateInput: (v) =>
          v.trim() ? undefined : "Space owner ID cannot be empty",
      });
      if (!spaceOwnerId) {
        return;
      }

      const spaceName = await vscode.window.showInputBox({
        title: "Hoverchart: Configure — Space Name (optional)",
        prompt: "Enter a human-readable name for this space (optional)",
        value: existing?.spaceName ?? "",
        ignoreFocusOut: true,
      });

      try {
        await saveConfig({
          spaceId: spaceId.trim(),
          spaceOwnerId: spaceOwnerId.trim(),
          spaceName: spaceName?.trim() || undefined,
        });
        vscode.window.showInformationMessage(
          `Hoverchart: Configuration saved to .github/hoverchart.json.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Hoverchart: Failed to save configuration — ${err}`
        );
      }
    })
  );

  // Register the manual export command
  context.subscriptions.push(
    vscode.commands.registerCommand("hoverchart.exportPlan", async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
          "Hoverchart: No workspace folder is open."
        );
        return;
      }

      const planPath = path.join(
        workspaceFolders[0].uri.fsPath,
        ".github",
        "plan.md"
      );

      let content: string;
      try {
        content = fs.readFileSync(planPath, "utf8");
      } catch {
        vscode.window.showErrorMessage(
          "Hoverchart: Could not find .github/plan.md in the workspace."
        );
        return;
      }

      const tasks = parsePlan(content);
      if (tasks.length === 0) {
        vscode.window.showInformationMessage(
          "Hoverchart: No numbered tasks found in .github/plan.md."
        );
        return;
      }

      const cfg = getConfig();
      if (!cfg) {
        const configure = await vscode.window.showWarningMessage(
          "Hoverchart: No space configured. Run 'Hoverchart: Configure' first.",
          "Configure Now"
        );
        if (configure === "Configure Now") {
          await vscode.commands.executeCommand("hoverchart.configure");
        }
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

        // Resolve a human-readable space name for the confirmation dialog
        let spaceName = cfg.spaceName;
        if (!spaceName) {
          const userId = await getUserId(context);
          if (userId) {
            const access = await validateSpaceAccess(
              idToken,
              userId,
              cfg.spaceOwnerId,
              cfg.spaceId
            );
            spaceName = access.spaceName;
          }
        }

        const label = spaceName
          ? `"${spaceName}" (${cfg.spaceId})`
          : `"${cfg.spaceId}"`;

        const answer = await vscode.window.showInformationMessage(
          `Hoverchart: Export ${tasks.length} task${tasks.length === 1 ? "" : "s"} to space ${label}?`,
          "Yes",
          "Cancel"
        );
        if (answer !== "Yes") {
          return;
        }

        await exportTasks(context, tasks, idToken);
        vscode.window.showInformationMessage(
          `Hoverchart: Successfully exported ${tasks.length} task${tasks.length === 1 ? "" : "s"} to hoverchart space.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Hoverchart: Export failed — ${err}`);
      }
    })
  );

  // Register the automatic file watcher for .github/plan.md
  registerFileWatcher(context);
}

export function deactivate(): void {
  // Nothing to clean up — VS Code disposes subscriptions automatically.
}
