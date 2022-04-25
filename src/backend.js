const electron = require('electron');
const dialog = electron.dialog;
const omr = require("./omr");
const fs = require("fs");
const openExplorer = require('open-file-explorer');
const chokidar = require('chokidar');
const cv = omr.utils.cv;
const fspath = require("path");
const xl = require('excel4node');
const XLSX = require('xlsx');
const AdmZip = require("adm-zip");
const { AREA_GROUP } = require('./omr');
const IMAGETYPES = ["bmp", "pbm", "pgm", "ppm", "sr", "ras", "jpeg", "jpg", "jpe", "jp2", "tiff", "tif", "png"];

const AsyncFunction = (async () => { }).constructor;
const ZIPCUTSIZE = 30 * 1024 * 1024; // when exporting clear scans for Moodle, zip files are cut after 25 MB is reached

let mainWindow;

let watches = {};

let pageidcache = {};

function isImage(fn) {
    return IMAGETYPES.indexOf(fspath.extname(fn).substring(1).toLowerCase()) != -1;
}

function isPDF(fn) {
    return fn.toLowerCase().endsWith(".pdf");
}

function isXlsx(fn) {
    return fn.toLowerCase().endsWith(".xlsx");
}

async function readFile(path) {
    let dropDotIdx = path.indexOf(":", 3);
    if (dropDotIdx != -1) path = path.substring(0, dropDotIdx);
    let image;
    if (isImage(path)) {
        // cv.imread fails for path with utf8 characters
        let buffer = fs.readFileSync(path);
        image = cv.imdecode(buffer);
    } else {
        let sp = path.split("@");
        if (sp.length == 2 && isPDF(sp[0]) && sp[1] == "" + parseInt(sp[1])) {
            let buffer = await omr.pdf.exportPNG(sp[0], parseInt(sp[1]));
            image = cv.imdecode(buffer);
        } else {
            throw new Error("Invalid file " + path);
        }
    }
    return image;
}

async function getTemplatePageId(projectpath, template, res) {
    let path = fspath.join(fspath.join(projectpath, "template"), template.filename);
    if (path in pageidcache &&
        JSON.stringify(template.corners) == JSON.stringify(pageidcache[path].corners) &&
        JSON.stringify(template.pageid) == JSON.stringify(pageidcache[path].pageid)) {
        return pageidcache[path].image;
    } else {
        let entry = {};
        let image = await readFile(path);
        let denoised = omr.utils.imageDenoised(image);
        let edged = omr.utils.imageThreshold(denoised, true);
        entry.corners = template.corners;
        let warped = omr.utils.cropNormalizedCorners(entry.corners, edged);
        entry.pageid = template.pageid;
        entry.image = omr.utils.extractPageIdArea(warped, entry.pageid);
        pageidcache[path] = entry;
        return entry.image;
    }
}

let actions = {
    "project-open"(_) {
        let fn = dialog.showOpenDialogSync(mainWindow, {
            properties: ['openDirectory']
        });
        return (fn === undefined ? null : fn[0]);
    },
    "project-load"(data) {
        // clear cache just in case
        pageidcache = {};

        return omr.project.load(data);
    },
    "project-save"(data) {
        return omr.project.save(data);
    },
    "directory-open"(path) {
        openExplorer(path);
        return null;
    },
    "directory-watch": async function (path, cb, error = () => { }) {
        async function notify() {
            try {
                let files = fs.readdirSync(path, { withFileTypes: true });
                let prep = [];
                for (let i = 0; i < files.length; i++) {
                    if (!files[i].isFile()) continue;
                    if (isImage(files[i].name)) {
                        let stat = fs.statSync(fspath.join(path, files[i].name));
                        prep.push(files[i].name + ":" + stat.size + ":" + stat.mtimeMs);
                    } else if (isPDF(files[i].name)) {
                        let stat = fs.statSync(fspath.join(path, files[i].name));
                        let count;
                        try {
                            count = await omr.pdf.getPagesCount(fspath.join(path, files[i].name));
                        } catch (e) {
                            count = 0;
                        }
                        for (let j = 0; j < count; j++) {
                            prep.push(files[i].name + "@" + (j + 1) + ":" + stat.size + ":" + stat.mtimeMs);
                        }
                    } else if (isXlsx(files[i].name)) {
                        let stat = fs.statSync(fspath.join(path, files[i].name));
                        prep.push(files[i].name + ":" + stat.size + ":" + stat.mtimeMs);
                    }
                }
                cb(prep);
            } catch (e) {
                error(e.message);
            }
        }
        const watcher = chokidar.watch(path, { persistent: true, awaitWriteFinish: true });
        watcher
            .on('add', notify)
            .on('change', notify)
            .on('unlink', notify)
            .on('ready', notify);
        watches[path] = watcher;
    },
    "directory-unwatch"(path) {
        let c = watches[path];
        delete watches[path];
        c.close();
    },
    "file-template": async function (path) {
        // clear cache just in case
        pageidcache = {};

        let image = await readFile(path);
        let ret = {
            width: image.sizes[1],
            height: image.sizes[0],
        }
        if (!omr.utils.isImageA4(image)) return false;
        let denoised = omr.utils.imageDenoised(image);
        let edged = omr.utils.imageThreshold(denoised, true);
        ret.corners = omr.utils.findCornerPositions(edged);
        if ((ret.corners.br.x - ret.corners.tl.x) * (ret.corners.br.y - ret.corners.tl.y) / (ret.width * ret.height) < 0.5) {
            // corners seem wacky, try again with more sensitivity
            edged = omr.utils.imageThreshold(denoised, false);
            ret.corners = omr.utils.findCornerPositions(edged);
        }
        let warped = omr.utils.cropNormalizedCorners(ret.corners, edged);
        ret.type = omr.templater.typeOfTemplate(warped);
        ret.pageid = omr.utils.findPageIdArea(warped);
        let cnts = omr.utils.findContoursExceptBorder(warped);
        ret.filename = fspath.basename(path);
        ret.logs = [];
        let logger = (m) => ret.logs.push(m);
        ret.noma = omr.templater.getNoma(cnts, logger);
        switch (ret.type) {
            case "moodle":
            case "grid":
                ret.group = omr.templater.getGroup(cnts, logger);
                ret.questions = omr.templater.getQuestions(cnts, 2, warped, logger);
                let a = omr.checker.getAnswers(warped, ret.group);
                ret.thisgroup = a.answers[0][0];
                break;
            case "custom":
                ret.thisgroup = "a"; // only group a for mixed templates
                ret.questions = omr.templater.getQuestions(cnts, 1, warped, logger);
                break;
        }
        return ret;
    },
    "file-scan": async function ({ path, template, strings, corners = null }) {
        //        console.log(path);
        function outer(r1, r2) {
            let x1 = Math.min(r1.x, r2.x);
            let y1 = Math.min(r1.y, r2.y);
            let x2 = Math.max(r1.x + r1.w, r2.x + r2.w);
            let y2 = Math.max(r1.y + r1.h, r2.y + r2.h);
            return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        }
        let projectpath = fspath.dirname(fspath.dirname(path));
        let image = await readFile(path);
        let ret = {
            width: image.sizes[1],
            height: image.sizes[0],
        }
        if (!omr.utils.isImageA4(image)) {
            ret.error = strings.A4Error;
            ret.group = "99";
            ret.noma = "XXXXXX";
            return ret;
        };
        let denoised = omr.utils.imageDenoised(image);
        let edged = omr.utils.imageThreshold(denoised, true);
        if (corners == null) {
            ret.corners = omr.utils.findCornerPositions(edged);
        } else {
            ret.corners = corners;
        }
        if ((ret.corners.br.x - ret.corners.tl.x) * (ret.corners.br.y - ret.corners.tl.y) / (ret.width * ret.height) < 0.5) {
            // corners seem wacky, try again with more sensitivity
            edged = omr.utils.imageThreshold(denoised, false);
            ret.corners = omr.utils.findCornerPositions(edged);
        }
        let warped = omr.utils.cropNormalizedCorners(ret.corners, edged);
        let group;
        if (template[0].type == "custom") { // no group management for custom templates, just assume group "a"
            group = {
                x: AREA_GROUP.x1,
                y: AREA_GROUP.y1,
                group: "a"
            }
        } else {
            group = omr.checker.getGroup(warped);
        }
        ret.pageid = omr.utils.findPageIdArea(warped, AREA_GROUP.x1 - group.x, AREA_GROUP.y1 - group.y);
        ret.filename = fspath.basename(path);

        // figure out the group coordinates of the scan:
        // 1. so that we can read his group
        // 2. so that we can figure out a deltas between the scan on the template, and get a more accurate reading afterwards

        if (group.group == null) {
            ret.error = strings.groupError;
            ret.group = "99";
            ret.noma = "XXXXXX";
            return ret;
        }
        let dx = 0;
        let dy = 0;

        let scores = [];
        let idx;
        for (let i = 0; i < template.length; i++) {
            idx = i;
            if (group.group != template[i].thisgroup) continue; // wrong group
            let pageid = omr.utils.extractPageIdArea(warped, outer(ret.pageid, template[i].pageid));
            let thisid = await getTemplatePageId(projectpath, template[i]);
            let score = omr.utils.pagesSimilarity(pageid, thisid);
            scores.push({
                score, template: template[i], pageid, thisid
            });
        }
        // we just take the template with the higher similarity
        // first we score remaining templates
        if (scores.length == 0) {
            ret.error = strings.templateError + group.group;
            ret.group = "99";
            ret.noma = "XXXXXX";
            return ret;
        }
        scores.sort((a, b) => b.score.maxVal - a.score.maxVal); // sort scores, higher first
        let answers = [];
        // attempt getting the answers, using best scoring template first
        let best = -1;
        for (let j = 0; j < scores.length; j++) {
            let righttemplate = scores[j].template;
            if (righttemplate.type !== "custom") { // no group for custom templates => no group position shift
                dx = righttemplate.group[0][0].x - group.x;
                dy = righttemplate.group[0][0].y - group.y;
            }
            // shift warped dx and dy
            let answer = omr.checker.getAnswers(warped, righttemplate.questions, -dx, -dy);
            answers.push(answer);
            if (answer.errors < answer.answers.length * 0.1) { // low level of errors, just go for it
                best = j;
                break;
            }
        }
        if (best == -1) {
            best = 0;
            let max = answers[0].errors / answers[0].answers.length;
            for (let j = 1; j < scores.length; j++) {
                let cmax = answers[j].errors / answers[j].answers.length;
                if (cmax < max) {
                    best = j;
                    max = cmax;
                }
            }
        }
        let righttemplate = scores[best].template;
        if (righttemplate.type !== "custom") { // no group for custom templates => no group position shift
            dx = righttemplate.group[0][0].x - group.x;
            dy = righttemplate.group[0][0].y - group.y;
        }

        ret.answers = answers[best].answers;
        ret.noma = omr.checker.getNoma(warped, righttemplate.noma, -dx, -dy);
        ret.group = group.group;
        ret.failed = answers[best].failed;
        ret.errors = answers[best].errors;
        ret.template = righttemplate.filename;
        ret.dx = dx;
        ret.dy = dy;
        return ret;
    },
    "file-scan-fixed": async function ({ path, template, strings, corners = null }) {
        //        console.log(path);
        let image = await readFile(path);
        let ret = {
            width: image.sizes[1],
            height: image.sizes[0],
        }
        if (!omr.utils.isImageA4(image)) {
            ret.error = strings.A4Error;
            ret.group = "99";
            ret.noma = "XXXXXX";
            return ret;
        };
        let denoised = omr.utils.imageDenoised(image);
        let edged = omr.utils.imageThreshold(denoised, true);
        if (corners) {
            ret.corners = corners;
        } else {
            ret.corners = omr.utils.findCornerPositions(edged);
        }

        if ((ret.corners.br.x - ret.corners.tl.x) * (ret.corners.br.y - ret.corners.tl.y) / (ret.width * ret.height) < 0.5) {
            // corners seem wacky, try again with more sensitivity
            edged = omr.utils.imageThreshold(denoised, false);
            ret.corners = omr.utils.findCornerPositions(edged);
        }
        let warped = omr.utils.cropNormalizedCorners(ret.corners, edged);
        ret.filename = fspath.basename(path);

        // this time, template is not the list of templates, but the single one that has to be used. Group is provided though template.thisgroup.
        // we still call getGroup to obtain a dx/dy shift

        let group = omr.checker.getGroup(warped);
        group.group = template.thisgroup;
        let dx = 0;
        let dy = 0;

        let righttemplate = template;
        dx = righttemplate.group[0][0].x - group.x;
        dy = righttemplate.group[0][0].y - group.y;
        // shift warped dx and dy

        let result = omr.checker.getResult(warped, righttemplate, -dx, -dy);
        ret.noma = result.noma;
        ret.answers = result.answers;
        ret.failed = result.failed;
        ret.group = group.group;
        ret.errors = result.errors;
        ret.template = righttemplate.filename;
        ret.dx = dx;
        ret.dy = dy;
        return ret;
    },
    "file-image": async function ({ path, corners }) {
        let ret = {};
        let image = await readFile(path);
        let cropped = omr.utils.cropNormalizedCorners(corners, image);
        ret.image = cv.imencode(".jpg", cropped).toString("base64");
        return ret;
    },
    "file-original": async function ({ path, corners }) {
        let ret = {};
        let image = await readFile(path);
        ret.image = cv.imencode(".jpg", image).toString("base64");
        return ret;
    },
    "file-users": async function (path) {
        let users = {};
        let workbook = XLSX.readFile(formatFilename(path));
        let sheet_name_list = workbook.SheetNames;
        let xlData = XLSX.utils.sheet_to_json(workbook.Sheets[sheet_name_list[0]]);
        for (let i = 0; i < xlData.length; i++) {
            let keys = Object.keys(xlData[i]);
            let noma;
            let v = [];
            for (let j = 0; j < keys.length && j < 3; j++) {
                let k = keys[j];
                if (parseInt(xlData[i][k]) + "" == xlData[i][k]) {
                    noma = xlData[i][k];
                    if (j > 0) break; // stop looking at right of noma except if on first column
                } else {
                    v.push(xlData[i][k]);
                }
            }
            if (noma && v.length > 0) {
                users[noma] = v.join(" ");
            }
        }
        return users.length == 0 ? null : users;
    },
    "export-csv"({ path, indexes, lines, strings, separator = ";", users }) {
        let { title, data } = flattenExport({ indexes, lines, strings, users });
        let out = [];
        out.push(title.join(separator));
        for (let i = 0; i < data.length; i++) out.push(data[i].join(separator));
        fs.writeFileSync(path, out.join('\n'));
        return true;
    },
    "export-moodlexml"({ path, indexes, template }) {
        let buffer = [];
        buffer.push("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n");
        buffer.push("<quiz>\n");
        buffer.push("    <!-- question: 0 -->\n");
        buffer.push("    <question type=\"category\">\n");
        buffer.push("        <category>\n");
        buffer.push("            <text>$course$/easyOMR " + fspath.dirname(fspath.dirname(path)) + "</text>\n");
        buffer.push("        </category>\n");
        buffer.push("    </question>\n");
        for (let i = 0; i < template.length; i++) {
            if (template[i].thisgroup != "a") continue; // other groups are supposedly the same questions but mixed
            for (let j = 0; j < template[i].questions.length; j++) {
                let n = indexes[template[i].filename] + j + 1;
                buffer.push("    <question type=\"multichoice\">\n");
                buffer.push("        <name>\n");
                buffer.push("            <text>" + n + ")</text>\n");
                buffer.push("        </name>\n");
                buffer.push("        <questiontext format=\"html\">\n");
                buffer.push("            <text>\n");
                buffer.push("                <![CDATA[\n");
                buffer.push("                    <p>" + n + ")</p>\n");
                buffer.push("                ]]>\n");
                buffer.push("            </text>\n");
                buffer.push("        </questiontext>\n");
                buffer.push("        <generalfeedback format=\"html\">\n");
                buffer.push("            <text/>\n");
                buffer.push("        </generalfeedback>\n");
                buffer.push("        <defaultgrade>1.0000000</defaultgrade>\n");
                buffer.push("        <penalty>0.3333333</penalty>\n");
                buffer.push("        <hidden>0</hidden>\n");
                buffer.push("        <single>false</single>\n");
                buffer.push("        <shuffleanswers>false</shuffleanswers>\n");
                buffer.push("        <answernumbering>none</answernumbering>\n");
                buffer.push("        <correctfeedback format=\"html\">\n");
                buffer.push("            <text></text>\n");
                buffer.push("        </correctfeedback>\n");
                buffer.push("        <partiallycorrectfeedback format=\"html\">\n");
                buffer.push("            <text></text>\n");
                buffer.push("        </partiallycorrectfeedback>\n");
                buffer.push("        <incorrectfeedback format=\"html\">\n");
                buffer.push("            <text></text>\n");
                buffer.push("        </incorrectfeedback>\n");
                buffer.push("        <shownumcorrect/>\n");
                for (let k = 0; k < template[i].questions[j].length; k++) {
                    buffer.push("        <answer format=\"html\" fraction=\"" + (k == 0 ? "100" : "0") + "\">\n");
                    buffer.push("            <text><![CDATA[<p>" + String.fromCharCode(65 + k) + "</p>]]></text>\n");
                    buffer.push("            <feedback format=\"html\">\n");
                    buffer.push("                <text><![CDATA[<p>" + String.fromCharCode(65 + k) + "</p>]]></text>\n");
                    buffer.push("            </feedback>\n");
                    buffer.push("        </answer>\n");
                }
                buffer.push("    </question>\n");
            }
        }
        buffer.push("</quiz>\n");
        fs.writeFileSync(path, buffer.join(""), "utf-8");
        return true;
    },
    "export-excel": async function ({ path, indexes, lines, images, strings, users }) {
        let scansPath = fspath.join(fspath.dirname(fspath.dirname(path)), "scans");
        let { title, data, scans } = flattenExport({ indexes, lines, strings, users });
        let wb = new xl.Workbook();
        // raw data sheet
        let ws = wb.addWorksheet(strings.scans);
        let userShift = users ? 1 : 0;
        if (images) {
            for (let i = 0; i < title.length; i++) {
                ws.cell(1, (i < 3 + userShift ? i + 1 : i + 3)).string(title[i] + (i + userShift > 2 ? ")" : ""));
            }
            ws.cell(1, 4 + userShift).string(strings.name);
            ws.cell(1, 5 + userShift).string(strings.noma);
            ws.column(4 + userShift).setWidth(50);
            ws.column(5 + userShift).setWidth(20);
            for (let i = 0; i < data.length; i++) {
                for (let j = 0; j < data[i].length; j++) {
                    ws.cell(2 + i, (j < 3 + userShift ? j + 1 : j + 3)).string("" + data[i][j]);
                }
                let scanpath = fspath.join(scansPath, data[i][2 + userShift].split(",")[0]);
                let scan = scans[i][0]; // we only take the first one
                let full = omr.utils.cropNormalizedCorners(scan.corners, await readFile(scanpath));
                let name = omr.templater.grabName(full);
                let noma = omr.templater.grabNoma(full);
                let str = cv.imencode('.jpg', name).toString('base64');
                let buffer = Buffer.from(str, 'base64');
                ws.row(i + 2).setHeight(50);
                ws.addImage({
                    image: buffer,
                    type: "picture",
                    position: {
                        type: "twoCellAnchor",
                        from: {
                            col: 4 + userShift,
                            colOff: 0,
                            row: i + 2,
                            rowOff: 0
                        },
                        to: {
                            col: 5 + userShift,
                            colOff: 0,
                            row: i + 3,
                            rowOff: 0
                        }
                    }
                });
                str = cv.imencode('.jpg', noma).toString('base64');
                buffer = Buffer.from(str, 'base64');
                ws.addImage({
                    image: buffer,
                    type: "picture",
                    position: {
                        type: "twoCellAnchor",
                        from: {
                            col: 5 + userShift,
                            colOff: 0,
                            row: i + 2,
                            rowOff: 0
                        },
                        to: {
                            col: 6 + userShift,
                            colOff: 0,
                            row: i + 3,
                            rowOff: 0
                        }
                    }
                });
            }
        } else {
            for (let i = 0; i < title.length; i++) {
                ws.cell(1, i + 1).string(title[i] + (i > 2 ? ")" : ""));
            }
            for (let i = 0; i < data.length; i++) {
                for (let j = 0; j < data[i].length; j++) {
                    ws.cell(2 + i, j + 1).string("" + data[i][j]);
                }
            }
        }
        // correction worksheets where each occurence of response must be graded by the teacher
        ws = wb.addWorksheet(strings.corrections);
        ws.cell(1, 1).string(strings.pointsInstruction);
        let style = wb.createStyle({
            numberFormat: "###.00;-###.00;0"
        });
        let groups = {};
        for (let i = 0; i < data.length; i++) {
            groups[data[i][1 + userShift]] = [];
        }
        let top = 2;
        for (let g in groups) {
            ws.cell(top, 1).string(strings.group + " " + g);
            let ntop = 0;
            for (let i = 3 + userShift; i < title.length; i++) {
                ws.cell(top + 1, (i - userShift) * 2 - 5).string((i - 2 - userShift) + ")");
                ws.cell(top + 1, (i - userShift) * 2 - 4).string(strings.points);
                let answers = {};
                for (let j = 0; j < data.length; j++) {
                    if (data[j][1 + userShift] == g) {
                        answers[data[j][i]] = true; // store answers in object to remove duplicates
                    }
                }
                answers = Object.keys(answers);
                answers.sort();
                for (let j = 0; j < answers.length; j++) {
                    ws.cell(j + top + 2, (i - userShift) * 2 - 5).string(answers[j]);
                    ws.cell(j + top + 2, (i - userShift) * 2 - 4).number(0).style(style);
                }
                if (answers.length > ntop) ntop = answers.length;
                groups[g][i - 3 - userShift] = strings.corrections + "!" + xl.getExcelCellRef(top + 2, (i - userShift) * 2 - 5) + ":" + xl.getExcelCellRef(answers.length + top + 1, (i - userShift) * 2 - 4);
            }
            top += ntop + 2;
        }
        // points worksheets where each response is matched to its correction
        ws = wb.addWorksheet(strings.points);
        ws.cell(1, 1).string(strings.noma);
        ws.cell(1, 2).string(strings.points);
        for (let i = 3 + userShift; i < title.length; i++) {
            ws.cell(1, i - userShift).string((i - 2 - userShift) + ")");
        }
        for (let j = 0; j < data.length; j++) {
            ws.cell(j + 2, 1).formula(strings.scans + "!" + xl.getExcelCellRef(j + 2, 1));
            ws.cell(j + 2, 2).formula("SUM(" + xl.getExcelCellRef(j + 2, 3) + ":" + xl.getExcelCellRef(j + 2, title.length - 1) + ")").style(style);
            for (let i = 3 + userShift; i < title.length; i++) {
                ws.cell(j + 2, i - userShift).formula("VLOOKUP(" + strings.scans + "!" + xl.getExcelCellRef(j + 2, images ? i + 3 : i + 1) + "," + groups[data[j][1 + userShift]][i - 3 - userShift] + ",2,FALSE)").style(style);
            }
        }
        wb.write(path);
        return true;
    },
    "clear-scan": async function ({ path, scan, template }) {
        let scanimage = await readFile(fspath.join(path, "scans", formatFilename(scan.filename)));
        let tplimage = await readFile(fspath.join(path, "template", formatFilename(template.filename)));
        // bring both to grayscale
        try {
            scanimage=scanimage.bgrToGray();
        } catch (_) {};
        try {
            tplimage=tplimage.bgrToGray();
        } catch (_) {};

        let exportpath = fspath.join(path, "export", formatFilename(scan.filename));
        const Point2 = omr.utils.cv.Point2;
        const Size = omr.utils.cv.Size;
        let src = [
            new Point2(scan.corners.tl.x, scan.corners.tl.y),
            new Point2(scan.corners.tr.x, scan.corners.tr.y),
            new Point2(scan.corners.br.x, scan.corners.br.y),
            new Point2(scan.corners.bl.x, scan.corners.bl.y)
        ]
        let dst = [
            new Point2(template.corners.tl.x, template.corners.tl.y),
            new Point2(template.corners.tr.x, template.corners.tr.y),
            new Point2(template.corners.br.x, template.corners.br.y),
            new Point2(template.corners.bl.x, template.corners.bl.y)
        ]
        let matrix = cv.getPerspectiveTransform(src, dst);
        // warp scan to match template
        let warpedScan = scanimage.warpPerspective(matrix, new Size(tplimage.sizes[1], tplimage.sizes[0]));

        // compute matrix from adjusted template back to original template image
        matrix = omr.utils.cropCornersMatrix(template.corners, tplimage).inv(); // inverse matrix

        // utility function to warp coordinates according to transformation matrix, returning Point2
        function warpCoordinates(x, y, matrix) {
            let ah = 1.4142 * tplimage.sizes[1] / omr.REFSIZE;
            let av = tplimage.sizes[0] / omr.REFSIZE;
            const matData = [
                [[x * ah, y * av]]
            ];
            const src = new cv.Mat(matData, cv.CV_32FC2);
            let result = src.perspectiveTransform(matrix).getDataAsArray();
            return new Point2(result[0][0][0], result[0][0][1]);
        }

        function toPoly({ x1, y1, x2, y2 }, matrix) {
            let p1 = warpCoordinates(x1, y1, matrix);
            let p2 = warpCoordinates(x2, y1, matrix);
            let p3 = warpCoordinates(x2, y2, matrix);
            let p4 = warpCoordinates(x1, y2, matrix);
            return [p1, p2, p3, p4];
        }

        // create mask covering NOMA and NAME area
        let mask = new cv.Mat(warpedScan.sizes[0], warpedScan.sizes[1], cv.CV_8UC1);

        mask.drawFillPoly([toPoly(omr.templater.IMG_NAME, matrix)], omr.colors.WHITE);
        mask.drawFillPoly([toPoly(omr.templater.IMG_NOMA, matrix)], omr.colors.WHITE);

        // copy over these areas from the adjusted scan onto the template image
        warpedScan.copyTo(tplimage, mask);

        let lineWidth = Math.floor(3 * tplimage.sizes[0] / omr.REFSIZE); // width is proportional to actual image size, for REFSIZE, width is 6
        // tick noma boxes
        for (let i = 0; i < scan.noma.length; i++) {
            let s = scan.noma.charCodeAt(i) - 48;
            let c = template.noma[i][s];
            if (c) {
                let p1 = warpCoordinates(c.x + 2, c.y + 2, matrix);
                let p2 = warpCoordinates(c.x + c.w - 4, c.y + c.h - 4, matrix);
                let p3 = warpCoordinates(c.x + 2, c.y + c.h - 4, matrix);
                let p4 = warpCoordinates(c.x + c.w - 4, c.y + 2, matrix);
                tplimage.drawLine(p1, p2, omr.colors.BLACK, lineWidth);
                tplimage.drawLine(p3, p4, omr.colors.BLACK, lineWidth);
            }
        }

        // tick answer boxes
        for (let i = 0; i < scan.answers.length; i++) {
            let a = scan.answers[i];
            if (a == "99") continue;
            a = a.split("/");
            for (let j = 0; j < a.length; j++) {
                let s = a[j].charCodeAt(0) - 97;
                let c = template.questions[i][s];
                let p1 = warpCoordinates(c.x + 2, c.y + 2, matrix);
                let p2 = warpCoordinates(c.x + c.w - 4, c.y + c.h - 4, matrix);
                let p3 = warpCoordinates(c.x + 2, c.y + c.h - 4, matrix);
                let p4 = warpCoordinates(c.x + c.w - 4, c.y + 2, matrix);
                tplimage.drawLine(p1, p2, omr.colors.BLACK, lineWidth);
                tplimage.drawLine(p3, p4, omr.colors.BLACK, lineWidth);
            }
        }

        if (exportpath.indexOf('@') != -1) { // template is a pdf file, we should export to a jpg anyway
            let s = exportpath.split('@');
            if (isPDF(s[0])) s[0] = s[0].substring(0, s[0].length - 4);
            exportpath = s.join("_") + ".jpg";
        } else { // enforces .jpg export
            exportpath = exportpath.substring(0, exportpath.length - fspath.extname(exportpath).length) + ".jpg";
        }

/*        try {
            tplimage=tplimage.bgrToGray(); // if scans are in color, put back in gray
        } catch (_) {}*/

        cv.imwrite(exportpath, tplimage, [cv.IMWRITE_JPEG_QUALITY, 25]);
        return true;
    },
    "export-deletejpg": function ({ path }) {
        let files = fs.readdirSync(path, { withFileTypes: true });
        for (let i = 0; i < files.length; i++) {
            if (!files[i].isFile() || !files[i].name.toLowerCase().endsWith(".jpg")) continue;
            try {
                fs.rmSync(fspath.join(path, files[i].name));
            } catch (_) { } // ignore failed file deletion attempt
        }
    },
    "export-deletezip": function ({ path }) {
        let files = fs.readdirSync(path, { withFileTypes: true });
        for (let i = 0; i < files.length; i++) {
            if (!files[i].isFile() || !files[i].name.toLowerCase().endsWith(".zip")) continue;
            try {
                fs.rmSync(fspath.join(path, files[i].name));
            } catch (_) { } // ignore failed file deletion attempt
        }
    },
    "export-zipjpg": function ({ path }) {
        let count = 0;
        let current = null;
        let currentSize = 0;
        let files = fs.readdirSync(path, { withFileTypes: true });
        for (let i = 0; i < files.length; i++) {
            if (!files[i].isFile() || !files[i].name.toLowerCase().endsWith(".jpg")) continue;
            let p = fspath.join(path, files[i].name);
            try {
                let size = fs.statSync(p).size;
                if (current == null) {
                    current = new AdmZip();
                    count++;
                }
                current.addLocalFile(p);
                currentSize += size;
                if (currentSize > ZIPCUTSIZE) {
                    current.writeZip(fspath.join(path, "export_" + count + ".zip"));
                    current = null;
                    currentSize = 0;
                }
            } catch (e) {
                console.error(e);
            }
        }
        if (currentSize > 0) {
            current.writeZip(fspath.join(path, "export_" + count + ".zip"));
        }
    },
    "template-create": async function ({ path, groups, strings }) {
        // clear cache just in case
        pageidcache = {};
        // delete all template files in path
        let config = [];
        path = fspath.join(path, "template"); // template directory in project
        for (let k in groups) {
            let group = groups[k];
            for (let p = 0; p < group.length; p += 48) {
                let tpl = {
                    thisgroup: k,
                    questions: []
                }
                for (let i = 0; i < 48 && i + p < group.length; i++) {
                    let q = [];
                    for (let j = 0; j < group[i]; j++) {
                        q.push({});
                    }
                    tpl.questions.push(q);
                }
                config.push(tpl);
            }
        }
        let bytes = await omr.pdf.templateToPDF(config, strings);
        // delete jpg and pdf from template directory
        let files = fs.readdirSync(path, { withFileTypes: true });
        for (let i = 0; i < files.length; i++) {
            if (!files[i].isFile()) return;
            if (isImage(files[i].name) || isPDF(files[i].name)) {
                fs.rmSync(fspath.join(path, files[i].name));
            }
        }
        fs.writeFileSync(fspath.join(path, 'template.pdf'), bytes);
        return true;
    },
    "template-custom-copy": async function ({ path, lang }) {
        let src = fspath.resolve(__dirname, "../resources");
        let files = fs.readdirSync(src);
        for (let i = 0; i < files.length; i++) {
            let idx = files[i].indexOf("-" + lang + ".");
            if (idx != -1 && (files[i].toLowerCase().endsWith(".docx") || files[i].toLowerCase().endsWith(".pdf"))) {
                let dest = files[i].substring(0, idx) + files[i].substring(idx + 3);
                fs.copyFileSync(fspath.join(src, files[i]), fspath.join(path, dest));
            }
        }
        return true;
    }
}
function formatFilename(fn) {
    let dropDotIdx = fn.indexOf(":", 3);
    if (dropDotIdx != -1) return fn.substring(0, dropDotIdx);
    return fn;
}

function flattenExport({ indexes, lines, strings, users }) {
    let out = {};
    let outscans = {};
    let max = 0;
    for (let k in lines) {
        let r = lines[k];
        let l = out[r.noma + "_" + r.group];
        if (l === undefined) {
            l = [];
            out[r.noma + "_" + r.group] = l;
            outscans[r.noma + "_" + r.group] = [r];
        } else {
            outscans[r.noma + "_" + r.group].push(r);
        }
        l[0] = r.noma;
        let idx = 1;
        if (users) {
            l[idx++] = users[r.noma] || "";
        }
        l[idx++] = r.group;
        if (l[idx] === undefined) {
            l[idx] = formatFilename(r.filename);
        } else {
            l[idx] += "," + formatFilename(r.filename);
        }
        let start = indexes[r.template] - 1;
        for (let i = l.length; i < start + 3; i++) { // fill in the blanks
            l[i] = "";
        }
        if (start + r.answers.length > max) max = start + r.answers.length;
        for (let i = 0; i < r.answers.length; i++) {
            l[start + 3 + i + idx - 2] = r.answers[i]; // fill answers
        }
    }
    let l = [];
    l.push(strings.noma);
    if (users) l.push(strings.name);
    l.push(strings.group);
    l.push(strings.scanFiles);
    for (let i = 0; i < max; i++) {
        l.push(i + 1);
    }
    let outl = [];
    let scans = [];
    for (let k in out) {
        outl.push(out[k]);
        scans.push(outscans[k]);
    }
    return {
        title: l,
        data: outl,
        scans
    }
}

module.exports = {
    init({ mainWindow: mw }) {
        mainWindow = mw;
        electron.ipcMain.on('ajax-message', async (event, arg) => {
            try {
                if (arg.action in actions) {
                    if (arg.type == "push") {
                        // this is a push
                        let cb = (msg) => {
                            delete arg.error;
                            arg.success = msg;
                            event.sender.send("ajax-reply", arg);
                        }
                        let error = (e) => {
                            delete arg.success;
                            arg.error = e.message;
                            event.sender.send("ajax-reply", arg);
                        }
                        actions[arg.action](arg.data, cb, error);
                    } else {
                        arg.success = await actions[arg.action](arg.data);
                        event.sender.send("ajax-reply", arg);
                    }
                } else {
                    throw new Error("Invalid request " + arg.action);
                }
            } catch (e) {
                console.error(e);
                arg.error = e.message;
                event.sender.send("ajax-reply", arg);
            }
        });
    }
}
