// reference: https://ourcodeworld.com/articles/read/927/how-to-create-a-msi-installer-in-windows-for-an-electron-framework-application
// to run: node build_installer.js
const { MSICreator } = require('electron-wix-msi');
const path = require('path');
const fs = require("fs");
const child_process = require('child_process');

let packages = JSON.parse(fs.readFileSync("package.json"));
let versions = packages.version.split(".");
let last = parseInt(versions[versions.length - 1]);
versions.pop();
versions.push(last + 1);
versions = versions.join(".");
packages.version = versions;
fs.writeFileSync("package.json", JSON.stringify(packages, null, 4));

// turn off debug

function setConstant(fn, constant, value) {
    let source = fs.readFileSync(fn, "utf-8");
    let idx = source.indexOf(constant);
    if (idx != -1) {
        idx += constant.length;
        while (idx < source.length && (source[idx] == " " || source[idx] == "\n")) idx++;
        if (source[idx] == "=") {
            idx++;
            while (idx < source.length && (source[idx] == " " || source[idx] == "\n")) idx++;
            let start = idx;
            while (idx < source.length && (source[idx] != ";" && source[idx] != "\n")) idx++;
            source = source.substring(0, start) + value + source.substring(idx);
            fs.writeFileSync(fn, source);
        }
    }
}

setConstant('src/main.js', "DEBUG", "false");
setConstant('src/omr.js', "DEBUG", "false");
setConstant('src/main.js', "VERSION", '"' + versions + '"');

console.log("Creatin version " + versions);

const APP_NAME = "easyOMR"
const APP_DIR = path.resolve(__dirname, './' + APP_NAME + '-win32-x64');
const OUT_DIR = path.resolve(__dirname, './windows_installer');
const APP_ICON = path.resolve(__dirname, './icon.ico');
const REPACKAGE = true;
const BUILDMSI = true;

if (REPACKAGE) {
    // clear things up
    if (fs.existsSync(APP_DIR)) fs.rmSync(APP_DIR, { recursive: true, force: true });
    if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true, force: true });
    console.log("Former build directories were deleted");

    child_process.execSync("electron-packager . --platform=win32 --arch=x64 --icon=" + APP_ICON + " " + APP_NAME);
    console.log("Stuff is packaged");
    // clean up packaged stuff to make installer much smaller
    const OPENCV_DIR = path.resolve(APP_DIR, './resources/app/node_modules/opencv-build/opencv/build');
    let keep = ["bin", "win-install"];
    for (let f of fs.readdirSync(OPENCV_DIR, { withFileTypes: true })) {
        if (!f.isDirectory()) continue;
        if (keep.indexOf(f.name) == -1) {
            fs.rmSync(path.resolve(OPENCV_DIR, "./" + f.name), { recursive: true, force: true })
        }
    }
    const APP_NODE_MODULES = path.resolve(APP_DIR, './resources/app');
    child_process.execSync("modclean -n default:safe -r -p " + APP_NODE_MODULES);
    child_process.execSync("modclean -n default:caution -r -p " + APP_NODE_MODULES);


    console.log("Opencv stuff is cleaned for smaller package");
}

// Instantiate the MSICreator
const msiCreator = new MSICreator({
    appDirectory: APP_DIR,
    outputDirectory: OUT_DIR,
    appIconPath: APP_ICON,

    // Configure metadata
    description: 'easyOMR scans Moodle',
    exe: APP_NAME,
    name: APP_NAME,
    manufacturer: 'ICHEC Brussels Management School, Donatien Grolaux',
    version: versions,

    // Configure installer User Interface
    ui: {
        chooseDirectory: true
    },
});

if (BUILDMSI) {
    // 4. Create a .wxs template file
    msiCreator.create().then(function () {
        // Step 5: Compile the template to a .msi file
        msiCreator.compile().then(function () {
            // Step 6: rename the .msi to include the version number.
            let files = fs.readdirSync(OUT_DIR);
            for (let i = 0; i < files.length; i++) {
                if (files[i].endsWith(".msi")) {
                    fs.renameSync(path.join(OUT_DIR, files[i]), path.join(OUT_DIR, files[i].substring(0, files[i].length - 4) + "-" + versions + ".msi"));
                }
            }
            console.log("MSI is ready");
        });
    });

}

