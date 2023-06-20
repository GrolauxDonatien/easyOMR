const { actions, readFile, formatFilename } = require('./backend');
const path = require('path');
const omr = require("./omr");
const Point2 = omr.utils.cv.Point2;
const Size = omr.utils.cv.Size;
const cv = omr.utils.cv;
const fs = require('fs');

async function run(projectPath, outPath) {
    let count = 0;


    function write(scanimage, category, rect) {
        count++;
        /*let w = br.x - tl.x;
        if (w < 40) {
            tl.x -= Math.ceil((40 - w) / 2);
            br.x = tl.x + 40;
        }
        let h = br.y - tl.y;
        if (h < 40) {
            tl.y -= Math.ceil((40 - h) / 2);
            br.y = tl.y + 40;
        }*/
        cv.imwrite(path.join(outPath, category, count + ".jpg"), scanimage.getRegion(rect));
        console.log(JSON.stringify(arguments));
    }

    let project = actions["project-load"](projectPath);
    
    if (!fs.existsSync(path.join(outPath, "yes"))) {
        fs.mkdirSync(path.join(outPath, "yes"));
    }

    if (!fs.existsSync(path.join(outPath, "no"))) {
        fs.mkdirSync(path.join(outPath, "no"));
    }

    console.log(project);
    let templates = {};
    for (let j = 0; j < project.template.length; j++) {
        templates[project.template[j].filename] = {
            tpl: project.template[j],
            //            tplimage: await readFile(path.join(project.path, "template", formatFilename(project.template[j].filename)))
        }
    }
    for (let i = 0; i < project.scans.length; i++) {
        let scan = project.scans[i];
        let tpl = templates[project.scans[i].template];
        if (tpl == undefined) continue;
        let template = tpl.tpl;
        let scanimage = await readFile(path.join(project.path, "scans", formatFilename(scan.filename)));
        try {
            scanimage = scanimage.bgrToGray();
        } catch (_) { };
        let warped = omr.utils.cropNormalizedCorners(scan.corners, scanimage);
        warped=omr.utils.imageThreshold(warped);
        let dx = 0;
        let dy = 0;
        if ("dx" in scan) {
            dx=scan.dx;
        }
        if ("dy" in scan) {
            dy=scan.dy;
        }


        // tick answer boxes
        let coords = template.questions;
        for (let line = 0; line < coords.length; line++) {
            let a = scan.answers[line];
            let answers = [];
            for (let col = 0; col < coords[line].length; col++) answers.push("no");
            if (a != "99") {
                for (let j = 0; j < a.length; j++) {
                    let s = a[j].charCodeAt(0) - 97;
                    answers[s] = "yes";
                }
            }
            for (let col = 0; col < coords[line].length; col++) {
                let bb = coords[line][col];
                let ox = bb.x - 5 + dx;
                if (ox < 0) ox = 0;
                let oy = bb.y - 5 + dy;
                if (oy < 0) oy = 0;
                if (ox + 40 >= warped.sizes[1]) {
                    ox = warped.sizes[1] - 41;
                }
                if (oy + 40 >= warped.sizes[0]) {
                    oy = warped.sizes[0] - 41;
                }
                let rect = new cv.Rect(ox, oy, 40, 40); // take more space, gives a better chance to checkBox to find the actual box
                write(warped, answers[col], rect);
            }
        }


        /*        let src = [
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
        
                if (!fs.existsSync(path.join(outPath, "yes"))) {
                    fs.mkdirSync(path.join(outPath, "yes"));
                }
        
                if (!fs.existsSync(path.join(outPath, "no"))) {
                    fs.mkdirSync(path.join(outPath, "no"));
                }
        
        

                // ignore noma as it may contains inacurrate ticks
        
                // tick answer boxes
                for (let i = 0; i < scan.answers.length; i++) {
                    let a = scan.answers[i];
                    let answers = [];
                    for (let j = 0; j < template.questions[i].length; j++) answers.push("no");
                    if (a != "99") {
                        for (let j = 0; j < a.length; j++) {
                            let s = a[j].charCodeAt(0) - 97;
                            answers[s] = "yes";
                        }
                    }
                    for (let j = 0; j < template.questions[i].length; j++) {
                        let c = template.questions[i][j];
                        let tl = warpCoordinates(c.x + 2, c.y + 2, matrix);
                        let br = warpCoordinates(c.x + c.w - 4, c.y + c.h - 4, matrix);
                        write(answers[j], tl, br);
                    }
                }*/

    }

    return "Finished";
}

module.exports = {
    run
}