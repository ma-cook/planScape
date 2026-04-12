import * as vscode from "vscode";
import { registerFileWatcher } from "./fileWatcher.js";
import { login } from "./auth.js";
import { parsePlan } from "./planParser.js";
import { exportTasks } from "./hoverchartClient.js";
import { getIdToken } from "./auth.js";
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

  // Register the configure command — opens the settings UI filtered to hoverchart
  context.subscriptions.push(
    vscode.commands.registerCommand("hoverchart.configure", () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:planeexport hoverchart"
      );
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
    })
  );

  // Register the automatic file watcher for .github/plan.md
  registerFileWatcher(context);
}

export function deactivate(): void {
  // Nothing to clean up — VS Code disposes subscriptions automatically.
}
