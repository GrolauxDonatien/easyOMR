const { actions, readFile, formatFilename } = require('./backend');
const path = require('path');
const omr = require("./omr");
const Point2 = omr.utils.cv.Point2;
const Size = omr.utils.cv.Size;
const cv = omr.utils.cv;
const fs = require('fs');
const xl = require('excel4node');
const MAXLINE = 10000;

async function run(directory) {

    function createExcel(onNew = () => { }, onSave = () => { }) {
        let current = 0;
        let wb = null;
        let line = MAXLINE + 1;
        let worksheets = {};
        const self = {
            async pushLine(ws) {
                let trigger = false;
                if (line > MAXLINE) {
                    if (wb != null) {
                        let fn = path.join(directory, `result_${current}.xlsx`);
                        onSave(worksheets, line);
                        console.log(fn);
                        await wb.write(fn);
                    }
                    current++;
                    wb = new xl.Workbook();
                    worksheets = {};
                    trigger = true;
                    line = 1;
                } else {
                    line++;
                }
                if (!(ws in worksheets)) {
                    worksheets[ws] = wb.addWorksheet(ws);
                }
                worksheets[ws].row(line).setHeight(40);
                if (trigger) {
                    onNew(self);
                }
            },
            cell(ws, col) {
                if (!(ws in worksheets)) {
                    worksheets[ws] = wb.addWorksheet(ws);
                }
                return worksheets[ws].cell(line, col);
            },
            image(ws, col, buffer) {
                if (!(ws in worksheets)) {
                    worksheets[ws] = wb.addWorksheet(ws);
                }
                worksheets[ws].addImage({
                    image: buffer,
                    type: "picture",
                    position: {
                        type: "twoCellAnchor",
                        from: {
                            col: col,
                            colOff: 0,
                            row: line,
                            rowOff: 0
                        },
                        to: {
                            col: col + 1,
                            colOff: 0,
                            row: line + 1,
                            rowOff: 0
                        }
                    }
                });

            },
            async close() {
                line = MAXLINE + 1;
                return self.pushLine("dummy");
            }
        }
        return self;
    }

    await omr.omrmodel;
    let files = fs.readdirSync(directory);
    // randomize files
    files.sort(() => 0.5 - Math.random());
    let splits = [];
    while (files.length > 0) {
        let segment = files.splice(0, Math.min(MAXLINE + 2, files.length));
        segment.sort(); // sort again
        splits.push(segment);
    }
    files = splits.flat();

    let tsscores = {}

    function getts(ref, i) {
        let k = ref + i;
        if (k in tsscores) {
            return tsscores[k];
        } else {
            return [Number.MAX_VALUE, -Number.MAX_VALUE];
        }
    }

    function setts(ref, i, v) {
        let k = ref + i;
        tsscores[k] = v;
    }

    let excel = createExcel(() => {
        excel.cell("data", 1).string("filename");
        excel.cell('data', 2).string("image");
        excel.cell('data', 3).string("reference");
        excel.cell('data', 4).string("best");
        excel.cell('data', 5).string("tensorflow");
        excel.cell('data', 6).string("opencv");
        excel.cell('data', 7).string("cv");
        excel.cell('data', 8).string("ts1");
        excel.cell('data', 9).string("ts2");
        excel.cell('data', 10).string("ts3");
        excel.pushLine('data');
        //        tsscores={}; // reset min/max
    }, (wb, line) => {
        wb.data.cell(line + 2, 2).string("ts1min");
        wb.data.cell(line + 2, 3).string("ts1max");
        wb.data.cell(line + 2, 4).string("ts2min");
        wb.data.cell(line + 2, 5).string("ts2max");
        wb.data.cell(line + 2, 6).string("ts3min");
        wb.data.cell(line + 2, 7).string("ts3max");
        wb.data.cell(line + 3, 1).string("yes");
        wb.data.cell(line + 4, 1).string("no");
        wb.data.cell(line + 5, 1).string("full");
        let keys = ["yes", "no", "full"];
        for (let i = 0; i < keys.length; i++) {
            let k = keys[i];
            for (let j = 0; j < 3; j++) {
                let [min, max] = getts(k, j);
                wb.data.cell(line + 3 + i, 2 + j + j).number(min);
                wb.data.cell(line + 3 + i, 3 + j + j).number(max);
            }
        }
        console.log(JSON.stringify(tsscores));

        function pretty(v, up) {
            if (v < 0) up = !up;
            if (up) {
                return Math.round(v * 1.01 / 1000) * 1000;
            } else {
                return Math.round(v * 0.99 / 1000) * 1000;
            }
        }

        function process(what) {
            let i = 0;
            let out = [];
            out.push("let " + what + " = (");
            while ((what + i) in tsscores) {
                if (i > 0) out.push(" && ");
                let [min, max] = tsscores[what + i];
                out.push("v" + (i + 1) + " > " + pretty(min, false));
                out.push(" && ");
                out.push("v" + (i + 1) + " < " + pretty(min, true));
                i++;
            }
            out.push(");");
            return out.join('');
        }

        console.log(process("full"));
        console.log(process("yes"));
        console.log(process("no"));
    });

    function score(r) {
        if (r.failed.length > 0 && r.failed[0].length > 0) return r.failed[0][0];
        if (r.answers[0] == "a") return "true";
        if (r.answers[0] == "99") return "false";
        return "unknown";
    }

    for (let i = 0; i < files.length; i++) {
        if (files[i].endsWith(".jpg")) {
            console.log(files[i]);
            await excel.pushLine("data");
            let ref = files[i].split('_')[0];
            let im = cv.imread(path.join(directory, files[i]));
            try {
                im = im.bgrToGray();
            } catch (_) { };
            let coords = [[{ x: 0, y: 0, w: im.sizes[1], h: im.sizes[0] }]];
            let ts = omr.checker.getAnswers_tensorflow(im, coords, 0, 0);
            let ocv = omr.checker.getAnswers_opencv(im, coords, 0, 0);
            let best = omr.checker.getAnswers_best(im, coords, 0, 0);


            excel.cell('data', 1).string(files[i]);
            let str = cv.imencode('.jpg', im).toString('base64');
            let buffer = Buffer.from(str, 'base64');
            excel.image('data', 2, buffer);
            excel.cell('data', 3).string(ref);
            excel.cell('data', 4).string(score(best));
            excel.cell('data', 5).string(score(ts));
            excel.cell('data', 6).string(score(ocv));
            excel.cell('data', 7).number(ocv.read[0][0]);
            let scores = ts.read[0][0].split('/');
            for (let i = 0; i < scores.length; i++) {
                let v = parseFloat(scores[i]);
                let [min, max] = getts(ref, i);
                if (v < min) min = v;
                if (v > max) max = v;
                setts(ref, i, [min, max]);
                excel.cell('data', 8 + i).number(v);
            }
        }
    }
    await excel.close();
    return new Promise(() => { }); // suspend indefinitely so that the excel file has time to be written
}

module.exports = {
    run
}