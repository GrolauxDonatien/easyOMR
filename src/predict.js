const { actions, readFile, formatFilename } = require('./backend');
const path = require('path');
const omr = require("./omr");
const Point2 = omr.utils.cv.Point2;
const Size = omr.utils.cv.Size;
const cv = omr.utils.cv;
const fs = require('fs');
const xl = require('excel4node');

async function run(directory) {
    let data = [];
    await omr.omrmodel;
    let files = fs.readdirSync(directory);
    let wb = new xl.Workbook();
    let ws = wb.addWorksheet("data");
    let line = 1;
    ws.cell(1, 1).string("filename");
    ws.cell(1, 2).string("image");
    ws.cell(1, 3).string("reference");
    ws.cell(1, 4).string("best");
    ws.cell(1, 5).string("tensorflow");
    ws.cell(1, 6).string("opencv");
    ws.cell(1, 7).string("ts1");
    ws.cell(1, 8).string("ts2");
    ws.cell(1, 9).string("cv");

    function score(r) {
        if (r.failed.length > 0 && r.failed[0].length > 0) return r.failed[0][0];
        if (r.answers[0] == "a") return "true";
        if (r.answers[0] == "99") return "false";
        return "unknown";
    }

    for (let i = 0; i < files.length; i++) {
        if (files[i].endsWith(".jpg")) {
            console.log(files[i]);
            line++;
            let ref = files[i].split('_')[0];
            let im = cv.imread(path.join(directory, files[i]));
            try {
                im = im.bgrToGray();
            } catch (_) { };
            let coords = [[{ x: 0, y: 0, w: im.sizes[1], h: im.sizes[0] }]];
            let ts = omr.checker.getAnswers_tensorflow(im, coords, 0, 0);
            if (line==128) debugger;
            let ocv = omr.checker.getAnswers_opencv(im, coords, 0, 0);
            let best = omr.checker.getAnswers_best(im, coords, 0, 0);


            ws.row(line).setHeight(40);
            ws.cell(line, 1).string(files[i]);
            let str = cv.imencode('.jpg', im).toString('base64');
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
                        row: line + 1,
                        rowOff: 0
                    }
                }
            });
            ws.cell(line, 3).string(ref);
            ws.cell(line, 4).string(score(best));
            ws.cell(line, 5).string(score(ts));
            ws.cell(line, 6).string(score(ocv));

            ws.cell(line, 7).number(parseFloat(files[i].split('_')[1]));
            ws.cell(line, 8).number(parseFloat(files[i].split('_')[2]));

            ws.cell(line, 9).number(ocv.read[0][0]);


        }
    }

    await wb.write(path.join(directory, 'result.xlsx'));
    console.log(path.join(directory, 'result.xlsx'));
    return new Promise(() => { }); // suspend indefinitely so that the excel file has time to be written
}

module.exports = {
    run
}