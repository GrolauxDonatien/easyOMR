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
            if (im.sizes[0]!=40 || im.sizes[1]!=40) {
                try {
                    im=im.bgrToGray();
                } catch (_) {};
                let temp=new cv.Mat(40,40,cv.IMREAD_GRAYSCALE);
                temp.drawFillPoly([[new cv.Point2(0,0), new cv.Point2(39,0), new cv.Point2(39,39), new cv.Point2(0,39), new cv.Point2(0,0)]],new cv.Vec3(255, 255, 255));
                if (im.sizes[0]>40 || im.sizes[1]>40) {
                    im=im.getRegion(new cv.Rect(0,0,Math.min(40,im.sizes[1]),Math.min(40,im.sizes[0])));
                }
                let tgt=new cv.Rect(40-im.sizes[1], 40-im.sizes[0],im.sizes[1],im.sizes[0]);
                im.copyTo(temp.getRegion(tgt));
                cv.imwrite(path.join(projectPath,files[i]), temp);
                console.log(files[i]);
            }
        }
    }

    return "Finished";
}

module.exports = {
    run
}