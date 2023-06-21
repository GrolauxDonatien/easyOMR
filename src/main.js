//const test=require('./test.js').init();

const electron = require('electron');
const { app, BrowserWindow, dialog } = electron;
const fs = require("fs");
const fspath = require("path");
const DEBUG = true;
const VERSION = "1.0.58";
const QR_code = "lkhglqksdlfd9876098HMLKJSDFH-1";


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

if (process.argv.length > 2) {
  async function runasync() {
    // cli run command
    let args = [...process.argv];
    args.splice(0, 2);
    try {
      let cmd = require("./" + args[0]);
      args.splice(0, 1);
      console.log(await cmd.run.apply(cmd.run, args));
      process.exit(0);
    } catch (_) {
      console.error(_);
      console.error("Cannot run command " + args.join(' '));
      process.exit(1);
    }
  }
  runasync();
} else {


  // Keep a global reference of the window object, if you don't, the window will
  // be closed automatically when the JavaScript object is garbage collected.
  let mainWindow;

  let languages = [];

  let files = fs.readdirSync(fspath.join(__dirname, "www"));
  for (let i = 0; i < files.length; i++) {
    let f = files[i];
    if (f.startsWith("index-") && f.endsWith(".html")) {
      let lang = f.substring(6, f.length - 5);
      languages.push({
        label: lang,
        click() {
          mainWindow.loadURL(`file://${__dirname}/www/index-${lang}.html`);
        }
      })
    }
  }

  let menuTemplate = {
    label: "File",
    submenu: [
      {
        label: "Language",
        submenu: languages
      },
      { type: "separator" },
      {
        label: "About...",
        click() {
          const options = {
            type: 'info',
            buttons: ['Close'],
            defaultId: 2,
            title: 'easyOMR',
            message: 'Developped by Donatien Grolaux under MIT license for ICHEC Brussels Management School',
          };

          dialog.showMessageBox(null, options, (response, checkboxChecked) => {
            console.log(response);
            console.log(checkboxChecked);
          });
        }
      },
      {
        label: "Exit",
        click() {
          app.quit();
        }
      }
    ]
  }

  let menu = electron.Menu.buildFromTemplate([menuTemplate]);

  const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      title: "easyOMR - " + VERSION,
      icon: "icon.png",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        nativeWindowOpen: true,
        webSecurity: false,
        enableRemoteModule: true
      },
    });

    // warning: code assume language name is coded exactly on two letters
    let intlz = app.commandLine.getSwitchValue("lang");
    if (fs.existsSync(__dirname + "/www/index-" + intlz + ".html")) {
      mainWindow.loadURL(`file://${__dirname}/www/index-${intlz}.html`);
    } else {
      mainWindow.loadURL(`file://${__dirname}/www/index.html`);
    }


    // and load the index.html of the app.

    //  mainWindow.webContents.openDevTools();


    if (!DEBUG) { // if debug is enabled, just leave the default menu
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

  const engine = require('./backend.js').init({
    menuTemplate, setMenu: (template) => {
      menuTemplate = template;
      menu = electron.Menu.buildFromTemplate([menuTemplate]);
      if (mainWindow) {
        mainWindow.setMenu(menu);
      }
    }, getWindow: () => {
      return mainWindow;
    }
  });

}
