const { actions, readFile, formatFilename } = require('./backend');
const path = require('path');
const omr = require("./omr");
const Point2 = omr.utils.cv.Point2;
const Size = omr.utils.cv.Size;
const cv = omr.utils.cv;
const fs = require('fs');
const xl = require('excel4node');

async function run() {
    let root=path.join(__dirname,'..','out');
    let files=fs.readdirSync(root);
    let wb = new xl.Workbook();
    let ws = wb.addWorksheet("data");
    let line=0;
    for(let i=0; i<files.length; i++) {
        if (files[i].endsWith(".jpg")) {
            line++;
            ws.row(line).setHeight(40);
            ws.cell(line,1).string(files[i]);
            let s=files[i].split('_');
            ws.cell(line,3).number(parseFloat(s[1]));
            ws.cell(line,4).number(parseFloat(s[2]));
            ws.cell(line,5).string(s[0]);
            let img=cv.imread(path.join(root, files[i]));
            let str = cv.imencode('.jpg', img).toString('base64');
            let buffer = Buffer.from(str, 'base64');
            ws.addImage({
                image: buffer,
                type: "picture",
                position: {
                    type: "twoCellAnchor",
                    from: {
                        col: 2,
                        colOff: 0,
                        row: line,
                        rowOff: 0
                    },
                    to: {
                        col: 3,
                        colOff: 0,
                        row: line+1,
                        rowOff: 0
                    }
                }
            });
            console.log(files[i]);
            if (line>5000) break;
        }
    }
    await wb.write(path.join(root,'..','short.xlsx'));
    console.log(path.join(root,'..','short.xlsx'));
    return new Promise(()=>{});
}

module.exports = {
    run
}