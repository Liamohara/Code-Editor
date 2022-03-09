// * Imports *

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} = require("electron");
const createApplicationMenu = require("./application-menu");
const fs = require("fs");
const path = require("path");
const pty = require("node-pty");

// * Variable assignment *

const ptyProcesses = new Object();
const platform = process.platform;
const isDarwin = platform === "darwin";
const interpreter = platform === "windows" ? "python.exe" : "python3";

let docsWindow = null;
let runFileName = null;
let runFileCmd = null;
let runFileBuffer = "";
let darkMode = nativeTheme.shouldUseDarkColors;

// Squirrel launches the app multiple times with special arguments.
// This quits those instances.
if (require("electron-squirrel-startup")) {
  app.quit();
}

// * Functions *

function createEditorWindow() {
  const currentWindow = BrowserWindow.getFocusedWindow();

  // Calculate window start position
  let x, y;
  if (currentWindow) {
    const [currentWindowX, currentWindowY] = currentWindow.getPosition();
    x = currentWindowX + 10;
    y = currentWindowY + 10;
  }

  // Create new window instance
  let newWindow = new BrowserWindow({
    x,
    y,
    name: "Codey",
    width: 800,
    height: 600,
    minWidth: 405,
    minHeight: 405,
    titleBarStyle: !isDarwin ? true : "hidden",
    webPreferences: {
      preload: `${__dirname}/preload.js`,
    },
    show: false,
  });

  // Load index.html to window
  newWindow.loadURL(EDITOR_WINDOW_WEBPACK_ENTRY);

  // Show window once it has finished initialising
  newWindow.once("ready-to-show", () => {
    if (darkMode) {
      newWindow.webContents.send("dark-mode:toggle");
    }

    initPty(newWindow);

    newWindow.show();
  });

  newWindow.once("show", () => {
    if (!isDarwin) {
      newWindow.webContents.send("platform:not-darwin");
    }
  });

  newWindow.on("focus", () => createApplicationMenu(true));

  newWindow.on("close", async (event) => {
    event.preventDefault();

    let cancelled = 0;

    if (await isEdited(newWindow)) {
      cancelled = (
        await showWarningDialog(
          newWindow,
          "Quit with unsaved changes?",
          "Closing this window will lose all unsaved changes. Close anyways?"
        )
      ).response;
    }

    if (!cancelled) {
      delete ptyProcesses[newWindow.id];
      newWindow.destroy();
    }
  });

  // When a window is closed.
  // 1. Wipe the BrowserWindow instance
  // 2. Reload Application Menu
  newWindow.once("closed", () => {
    newWindow = null;

    createApplicationMenu();
  });

  return newWindow;
}

function initPty(newWindow) {
  // Initialise node-pty process
  const ptyProcess = pty.spawn(interpreter, [], { handleFlowControl: true });

  ptyProcess.onData((data) => {
    if (runFileName) {
      runFileBuffer += data;
      if (runFileBuffer === runFileCmd + "\n") {
        newWindow.webContents.send(
          "shell:stdout",
          `% RUN ${runFileName} %\r\n`
        );
        runFileName = null;
        runFileBuffer = "";
      }
    } else {
      newWindow.webContents.send("shell:stdout", data);
    }
  });

  ptyProcess.onExit(() => {
    newWindow.webContents.send("shell:clear");
    initPty(newWindow);
  });

  ptyProcesses[newWindow.id] = ptyProcess;
}

function openDocsWindow(section) {
  if (!docsWindow) {
    createDocsWindow(section);
  } else {
    docsWindow.focus();
    docsWindow.webContents.send("docs:jump", section);
  }
}

function createDocsWindow(section) {
  const currentWindow = BrowserWindow.getFocusedWindow();

  // Calculate window start position
  let x, y;
  if (currentWindow) {
    const [currentWindowX, currentWindowY] = currentWindow.getPosition();
    x = currentWindowX + 10;
    y = currentWindowY + 10;
  }

  // Create new window instance
  docsWindow = new BrowserWindow({
    x,
    y,
    name: "Codey",
    width: 800,
    height: 600,
    minWidth: 405,
    minHeight: 405,
    titleBarStyle: !isDarwin ? true : "hidden",
    webPreferences: {
      preload: `${__dirname}/preload.js`,
    },
    show: false,
  });

  // Load index.html to window
  docsWindow.loadURL(DOCS_WINDOW_WEBPACK_ENTRY);

  // Show window once it has finished initialising
  docsWindow.once("ready-to-show", () => {
    createApplicationMenu();

    docsWindow.show();
  });

  docsWindow.once("show", () => {
    if (darkMode) {
      docsWindow.webContents.send("dark-mode:toggle");
    }

    if (!isDarwin) {
      docsWindow.webContents.send("platform:not-darwin");
    }

    docsWindow.webContents.send("docs:jump", section);
  });

  docsWindow.on("browser-window-focus", createApplicationMenu);

  // When a window is closed.
  // 1. Remove it from the window set.
  // 2. Reload Application Menu
  docsWindow.once("closed", () => {
    docsWindow = null;
    createApplicationMenu();
  });
}

async function getFile(targetWindow, isEdited) {
  const fileSelection = await showFileDialog(targetWindow);

  if (!fileSelection.cancelled) {
    let cancelled = 0;
    if (isEdited) {
      cancelled = (
        await showWarningDialog(
          targetWindow,
          "Overwrite Current Unsaved Changes?",
          "Opening a new file in this window will overwrite your unsaved changes. Open this file anyway?"
        )
      ).response;
    }

    if (!cancelled) {
      openFile(targetWindow, fileSelection.filePaths[0]);
    }
  }
}

function showFileDialog(targetWindow) {
  return dialog.showOpenDialog(targetWindow, {
    defaultPath: app.getPath("documents"),
    properties: ["openFile"],
    filters: [
      { name: "Python Files", extensions: ["py", "pyw"] },
      { name: "Text Files", extensions: ["txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
}

function showSaveDialog(targetWindow) {
  return dialog.showSaveDialog(targetWindow, {
    title: "Save File",
    defaultPath: app.getPath("documents"),
    filters: [
      { name: "Python Files", extensions: ["py", "pyw"] },
      { name: "Text Files", extensions: ["txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
}

function showWarningDialog(targetWindow, title, message) {
  return dialog.showMessageBox(targetWindow, {
    type: "warning",
    title,
    message,
    buttons: ["Yes", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
}

function openFile(targetWindow, filePath) {
  const content = fs.readFileSync(filePath).toString();
  app.addRecentDocument(filePath);
  targetWindow.webContents.send(
    "file:open",
    path.basename(filePath),
    path.dirname(filePath),
    content
  );

  createApplicationMenu(true);
}

async function saveFile(targetWindow, filePath, content) {
  if (!filePath) {
    filePath = (await showSaveDialog(targetWindow)).filePath;

    if (!filePath) return;

    fs.writeFileSync(filePath, content);
    openFile(targetWindow, filePath);
  } else {
    fs.writeFileSync(filePath, content);
  }

  targetWindow.webContents.send("title:update");

  return filePath;
}

async function runFile(targetWindow, filePath, content) {
  const ptyProcess = ptyProcesses[targetWindow.id];

  filePath = await saveFile(targetWindow, filePath, content);

  if (filePath) {
    runFileName = path.basename(filePath);
    runFileCmd = `exec(open("${filePath}").read())\r`;
    ptyProcess.write(runFileCmd);
  }
}

function isEdited(targetWindow) {
  return new Promise((resolve, _reject) => {
    targetWindow.webContents.send("file:is-edited");
    ipcMain.once("file:is-edited", (_event, isEdited) => {
      resolve(isEdited);
    });
  });
}

function isFileOpen(targetWindow) {
  return new Promise((resolve, _reject) => {
    if (targetWindow) {
      targetWindow.webContents.send("file:is-open");
      ipcMain.once("file:is-open", (_event, isFileOpen) => {
        resolve(isFileOpen);
      });
    } else {
      resolve(false);
    }
  });
}

function toggleDarkMode() {
  darkMode = !darkMode;

  if (darkMode) {
    nativeTheme.themeSource = "dark";
  } else {
    nativeTheme.themeSource = "light";
  }

  // editorWindows.forEach((value, window) => {
  //   window.webContents.send("dark-mode:toggle");
  // });

  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("dark-mode:toggle");
  });

  // if (docsWindow) {
  //   docsWindow.webContents.send("dark-mode:toggle");
  // }
}

// * Export modules *

module.exports.createEditorWindow = createEditorWindow;
module.exports.openDocsWindow = openDocsWindow;
module.exports.getFile = getFile;
module.exports.isEdited = isEdited;
module.exports.isFileOpen = isFileOpen;
module.exports.saveFile = saveFile;
// module.exports.runFile = runFile;

// * App API listeners *

// Create window and application menu onece electron has
// finished intialisation and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // * Window API listeners *

  ipcMain.handle("file:fetch", (event, isEdited) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    getFile(targetWindow, isEdited);
  });

  ipcMain.on("file:save", (event, filePath, content) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    saveFile(targetWindow, filePath, content);
  });

  ipcMain.on("file:run", (event, filePath, content) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    runFile(targetWindow, filePath, content);
  });

  ipcMain.on("file:show", (_event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("shell:stdin", (event, data) => {
    const targetWindowId = BrowserWindow.fromWebContents(event.sender).id;
    ptyProcesses[targetWindowId].write(data);
    // editorWindows.get(targetWindow).write(data);
  });

  ipcMain.handle("docs:open", (_event, section) => openDocsWindow(section));

  ipcMain.handle("dark-mode:toggle", () => {
    toggleDarkMode();
  });

  ipcMain.handle("platform", () => platform);

  createEditorWindow();

  // Quit when all windows are closed, except on macOS.
  // On MacOS, keep applications and menu bar active until the user quits
  // explicitly with Cmd + Q.
  app.on("window-all-closed", () => {
    if (!isDarwin) {
      app.quit();
    }
  });

  app.on("activate", () => {
    // Re-create a window on OS X when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createEditorWindow();
    }
  });
});
