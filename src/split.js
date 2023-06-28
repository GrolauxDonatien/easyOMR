const { actions, readFile, formatFilename } = require('./backend');
const path = require('path');
const omr = require("./omr");
const Point2 = omr.utils.cv.Point2;
const Size = omr.utils.cv.Size;
const cv = omr.utils.cv;
const fs = require('fs');
const xl = require('excel4node');

async function run(directory) {
    let nos=fs.readdirSync(path.join(directory,"no"));
    for(let i=0; i<nos.length; i++) {
        let img=cv.imread(path.join(directory,"no",nos[i]));
        try {
            img=img.bgrToGray();
        } catch (_) {}
        let v=img.countNonZero();
        if (v>900) {
            console.log(nos[i]+"="+v);
            fs.renameSync(path.join(directory,"no",nos[i]),path.join(directory,"full",nos[i]))
        }
    }
}


module.exports = {
    run
}