const { actions, readFile, formatFilename } = require('./backend');
const path = require('path');
const omr = require("./omr");
const Point2 = omr.utils.cv.Point2;
const Size = omr.utils.cv.Size;
const cv = omr.utils.cv;
const fs = require('fs');
const xl = require('excel4node');

async function run(directory) {
    let nos=fs.readdirSync(directory);
    for(let i=0; i<nos.length; i++) {
        let img=cv.imread(path.join(directory,nos[i]));
        try {
            img=img.bgrToGray();
        } catch (_) {}
        let v=img.countNonZero();
        fs.renameSync(path.join(directory,nos[i]),path.join(directory,v+"_"+nos[i]));
    }
}


module.exports = {
    run
}