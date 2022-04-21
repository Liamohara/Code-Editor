// * Imports *

import { exec, execSync } from "child_process";
import { app, BrowserWindow } from "electron";

import WindowManager from "./window-manager";
import createHandlers from "./api-handlers";

// * Variable assignment *

const platform: string = process.platform;
const isMac = platform === "darwin";

// Finding the path of the local python version.
const cmd = platform === "win32" ? "where python" : "which python3";
const paths = execSync(cmd);
const interpreter = paths.toString().split("\r\n")[0];

// Set the path of the Python interpreter.
WindowManager.interpreter = interpreter;

// Install the Hexapod Python library globally.
exec(`${interpreter} -m pip install -e ${__dirname}/client/`);

// Squirrel launches the app multiple times with special arguments. This quits those instances.
if (require("electron-squirrel-startup")) {
  app.quit();
}

// * App API listeners *

// Create the windows and application menu once Electron has finished intialisation.
app.whenReady().then(() => {
  // Get WindowManager instance.
  const windowManager = WindowManager.getInstance();

  // Define API listeners for main and renderer processes communication.
  createHandlers(windowManager);

  // Create editor window.
  windowManager.createEditorWindow();

  // App event listener on App activation.
  app.on("activate", () => {
    windowManager.createApplicationMenu();

    // Re-create a window on OS X when the dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createEditorWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
// On MacOS, keep applications and menu bar active until the user quits explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});
