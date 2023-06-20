const { actions, readFile, formatFilename } = require('./backend');
const path = require('path');
const omr = require("./omr");
const Point2 = omr.utils.cv.Point2;
const Size = omr.utils.cv.Size;
const cv = omr.utils.cv;
const fs = require('fs');

async function run(projectPath) {
    let files=fs.readdirSync(projectPath);
    for(let i=0; i<files.length; i++) {
        if (files[i].endsWith(".jpg")) {
            let im=cv.imread(path.join(projectPath,files[i]));
            im=omr.utils.imageThreshold(im);
            cv.imwrite(path.join(projectPath,files[i]), im);
            console.log(files[i]);
        }
    }

    return "Finished";
}

module.exports = {
    run
}