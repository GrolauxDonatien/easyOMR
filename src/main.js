const electron = require('electron');
const { app, BrowserWindow } = electron;
const fs=require("fs");
const DEBUG = true;
const VERSION = "1.0.25";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

// warning: code assume language name is coded exactly on two letters
let intlz=app.commandLine.getSwitchValue("lang");
if (!fs.existsSync(__dirname+"/www/index-"+intlz+".html")) intlz="en";

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title:"easyOMR - "+VERSION,
    icon: "icon.png",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nativeWindowOpen: true,
      webSecurity: false,
      enableRemoteModule: true
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL(`file://${__dirname}/www/index-${intlz}.html`);

  //  mainWindow.webContents.openDevTools();

  if (!DEBUG) { // if debug is enabled, just leave the default menu
    const menu = electron.Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            label: "Exit...",
            click() {
              app.quit();
            }
          }
        ]
      }]);

    electron.Menu.setApplicationMenu(menu);
  } else {
    mainWindow.webContents.openDevTools();
  }
  // Open the DevTools.

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

const engine = require('./backend.js').init({ mainWindow });
