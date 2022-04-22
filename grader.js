const cv = require("opencv4nodejs");
const { Point2, Size } = cv;
const fs = require("fs");
const REFSIZE = 2000;
let last;
function tick(msg = "ms elapsed") {
    let now = new Date().getTime();
    if (last !== undefined) {
        console.log((now - last) + " " + msg);
    }
    last = now;
}
let noma = JSON.parse(fs.readFileSync("noma.json"));
let questions = JSON.parse(fs.readFileSync("questions.json"));


let image = cv.imread("./inputs/BRW405BD82617BE_000563.jpg");

let width = image.sizes[1];
let height = image.sizes[0];
if (height / width > 1.45 || height / width < 1.37) {
    console.error("Image ratio failed");
    process.exit(1);
}

image = image.resize(REFSIZE, Math.floor(REFSIZE / 1.4142));
width = image.sizes[1];
height = image.sizes[0];

let gray = image.bgrToGray();
let blurred = gray.gaussianBlur(new Size(5, 5), 0.0);
let edged = blurred.canny(75, 200);
let contours = edged.findContours(cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);
cv.imwrite("out1.jpg", edged);
let tl, tr, bl, br, tle, tre, ble, bre;
tick("preprocess");
// find corners
for (let i = 0; i < contours.length; i++) {
    let r = contours[i].boundingRect();
    if (r.height * r.width > 1000) continue;
    let sum = r.x + r.y;
    if (tl == undefined || sum < tl) {
        tl = sum;
        tle = contours[i];
    }
    sum = (width - (r.x + r.width)) + r.y;
    if (tr == undefined || sum < tr) {
        tr = sum;
        tre = contours[i];
    }
    sum = r.x + (height - (r.y + r.height));
    if (bl == undefined || sum < bl) {
        bl = sum;
        ble = contours[i];
    }
    sum = (width - (r.x + r.width)) + (height - (r.y + r.height));
    if (br == undefined || sum < br) {
        br = sum;
        bre = contours[i];
    }
}

function drawContours(target, contours, size = 2, color = new cv.Vec3(255, 255, 255)) {
    const imgContours = contours.map((contour) => {
        return contour.getPoints();
    });

    for (let i = 0; i < imgContours.length; i++) {
        target.drawContours(imgContours, i, contours[i].color || color, size);
    }

}


function midPoint(contour) {
    let r = contour.boundingRect();
    return new Point2(r.x + r.width / 2, r.y + r.height / 2);
}

let dst = [
    new Point2(0, 0),
    new Point2(width - 1, 0),
    new Point2(width - 1, height - 1),
    new Point2(0, height - 1)];

let M = cv.getPerspectiveTransform([midPoint(tle), midPoint(tre), midPoint(bre), midPoint(ble)], dst);
let paper = image.warpPerspective(M, new Size(width, height));

let warped = paper.bgrToGray().gaussianBlur(new Size(5, 5), 1.0).threshold(200, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

cv.imwrite("out2.jpg", paper);
cv.imwrite("out3.jpg", warped);

const delta = REFSIZE / 1000;

let white = new cv.Vec3(255, 255, 255);
let notEmptyThreshold = 0.4;
let fullThreshold = 0.8;



function findNoma(warped, coords) {
    let noma = ["?", "?", "?", "?", "?", "?"];
    for (let line = 0; line < coords.length; line++) {
        for (let col = 0; col < coords[line].length; col++) {
            let bb = coords[line][col];
            let rect = new cv.Rect(bb.x, bb.y, bb.w, bb.h);
            let mask = warped.getRegion(rect);
            let t = mask.countNonZero() / (bb.w * bb.h);
            if (t > notEmptyThreshold && t < fullThreshold) {
                if (noma[col] == "?") {
                    noma[col] = line;
                } else {
                    noma[col] = "X";
                }
            }
        }
    }
    return noma.join("");
}

let t2emptyThreshold = 0.1;
let t2notEmptyThreshold = 0.22;
let t2fullThreshold = 0.9;

function checkBox(mask) {
    let area = mask.sizes[1] * mask.sizes[0];
    // first ratio of printed stuff, including any residual box around the tick by the user
    let t1 = mask.countNonZero() / area;
    // to have an accurate reading, we will first remove the box
    let contours = mask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (t1 < 0.1 || contours.length == 0) { // mostly empty or no contours
        // we are missing a box
        return "empty";
    }
    /* we might capture only a portion of the box, say its top/left part, but anyway :
    * its area should be bigger than any other areas found
    * it should be roughly square
    * it should be quite close to the size of the whole box
    */
    contours.sort((a, b) => {
        let ba = a.boundingRect();
        let bb = b.boundingRect();
        return bb.width * bb.height - ba.width * ba.height;
    }); // the box contour should have the biggest area;
    bb = contours[0].boundingRect();
    let ar = bb.width / bb.height;
    if (ar < 0.8 || ar > 1.2) return "accuracy"; // the shape is too far away from a square
    if (bb.width < mask.sizes[1] * 0.75 || bb.height < mask.sizes[0] * 0.75) return "accuracy"; // too little

    rect = new cv.Rect(bb.x + 3, bb.y + 3, bb.width - 6, bb.height - 6); // shrinks the mask according to the box contour
    mask = mask.getRegion(rect); // keep only the inside of the box
    let t2 = mask.countNonZero() / (rect.width * rect.height); // ratio of printed stuff inside the box
    if (t2 > 0 && t2 < t2emptyThreshold) {
        return false; // just consider empty
    } else if (t2 >= t2emptyThreshold && t2 < t2notEmptyThreshold) {
        return "maybe"; // not empty, but not enough information to be sure it is ticked for real
    } else if (t2 >= t2notEmptyThreshold && t2 < t2fullThreshold) {
        return true; // definitely ticked
    } else if (t2 > t2fullThreshold) {
        return false; // definitely blackened
    }
}

function checkQuestions(warped, coords) {
    let failed = [];
    let answers = [];
    for (let line = 0; line < coords.length; line++) {
        let answer = [];
        for (let col = 0; col < coords[line].length; col++) {
            let bb = coords[line][col];
            let rect = new cv.Rect(bb.x, bb.y, bb.w, bb.h);
            let mask = warped.getRegion(rect);
            switch (checkBox(mask)) {
                case "empty":
                    if (failed[line] == undefined) failed[line] = [];
                    failed[line][col] = "missing box";
                    break;
                case "accuracy":
                    if (failed[line] == undefined) failed[line] = [];
                    failed[line][col] = "accuracy";
                    break;
                case "maybe":
                    answer.push("?" + String.fromCharCode(col + 97));
                    break;
                case true:
                    answer.push(String.fromCharCode(col + 97));
                    break;
                case false:
                    break;
            }
            //             let area = rect.width * rect.height;
            //             let t1 = mask.countNonZero() / area;
            //             let contours = mask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            //             if (t1 < 0.1 || contours.length == 0) {
            //                 // we are missing a box
            //                 if (failed[line] == undefined) failed[line] = [];
            //                 failed[line][col] = "missing box";
            //                 continue;
            //             }
            //             contours.sort((a, b) => {
            //                 let ba = a.boundingRect();
            //                 let bb = b.boundingRect();
            //                 return bb.width * bb.height - ba.width * ba.height;
            //             }); // the box contour should have the biggest area;
            //             bb = contours[0].boundingRect();
            //             rect = new cv.Rect(bb.x + 3, bb.y + 3, bb.width - 6, bb.height - 6); // shrunk the mask according to the box contour
            //             //            if( line==3 && col==3) debugger;
            //             mask = mask.getRegion(rect);
            //             let t2 = mask.countNonZero() / (rect.width * rect.height);
            //             //            contour=mask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE); // look up a contour back again
            // /*            if (t1 > notEmptyThreshold && t1 < fullThreshold && t2 > 0.1) { // correctly marked inside the box
            //                 answer.push(String.fromCharCode(col + 97));
            //             } else if (t1 < fullThreshold && t2 > 0.1) { // something seems present
            //                 answer.push("?" + String.fromCharCode(col + 97));
            //             }
            //             //            if (line==0 && col==0) debugger;
            //             console.log(`${line}/${col}:${t2} ${answer.join("")}`);*/
            //             if (t2>0 && t2<t2emptyThreshold) {
            //                 // just consider empty
            //             } else if (t2>=t2emptyThreshold && t2<t2notEmptyThreshold) {
            //                 answer.push("?" + String.fromCharCode(col + 97)); // not sure we put a ? in front
            // //                console.log(`${line+1}/${String.fromCharCode(col + 97)}:${t2} ${answer.join("")}`);
            //             } else if (t2>=t2notEmptyThreshold && t2<t2fullThreshold) {
            //                 answer.push(String.fromCharCode(col + 97));
            //             } else if (t2>t2fullThreshold) {
            //                 // just ignore
            //             }
        }
        if (answer.length == 0) {
            answers.push("99");
        } else {
            answers.push(answer.join("/"));
        }
    }
    return { answers, failed };
}
tick();
console.log(findNoma(warped, noma));
let a = checkQuestions(warped, questions);
for (let i = 0; i < a.answers.length; i++) {
    console.log((i + 1) + ":" + a.answers[i]);
}
console.log(JSON.stringify(a.failed));
tick();

