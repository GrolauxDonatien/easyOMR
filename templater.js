const cv = require("opencv4nodejs");
const { Point2, Size } = cv;
const REFSIZE = 2000;
const fs=require("fs");

let last;
function tick(msg = "ms elapsed") {
    let now = new Date().getTime();
    if (last !== undefined) {
        console.log((now - last) + " " + msg);
    }
    last = now;
}
tick();
//let image = cv.imread("./inputs/BRW405BD82617BE_000562.jpg");
let image = cv.imread("./hd2022project/template/page1.jpg");
// smaller memory footprint => normalize size
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

let cnts = warped.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
if (cnts.length == 1) {
    // assume a surrounding border, we will delete it
    drawContours(warped, cnts, 2, new cv.Vec3(0, 0, 0));
    cnts = warped.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
}

function getCoordsForNoma(cnts) {
    let boxes = [];
    for (let i = 0; i < cnts.length; i++) {
        let r = cnts[i].boundingRect();
        if (r.x > 483 * delta && r.x < 633 * delta && r.y < 335 * delta && r.y > 110 * delta) {
            let ar = r.width / r.height;
            if (r.width < 30 * delta && r.height < 30 * delta && ar > 0.7 && ar < 1.3) {
                let rect = new cv.Contour([new Point2(r.x, r.y), new Point2(r.x + r.width, r.y), new Point2(r.x + r.width, r.y + r.height), new Point2(r.x, r.y + r.height)]);
                rect.bb = r;
                boxes.push(rect);
            } else {
                console.log(`rejecting ${r.x},${r.y} - ${r.width}x${r.height}`);
            }
        }
    }

    boxes.sort((a, b) => a.bb.y - b.bb.y);

    if (boxes.length != 60) {
        console.error("Cannot figure out where student id is");
        return null;
    }

    let coords = [];

    for (let i = 0; i < boxes.length; i += 6) {
        let line = boxes.slice(i, i + 6);
        line.sort((a, b) => a.bb.x - b.bb.x);
        let cl = [];
        for (let j = 0; j < line.length; j++) {
            cl.push({ x: line[j].bb.x, y: line[j].bb.y, w: line[j].bb.width, h: line[j].bb.height });
        }
        coords.push(cl);
    }

    return coords;
}

function getQuestions(cnts) {
    let left=[];
    let right=[];
    for (let i = 0; i < cnts.length; i++) {
        let r = cnts[i].boundingRect();
        if (r.width*r.height<800) continue; // filter out elements too small
        let adder;
        if (r.x>30*delta && r.x<350*delta) {
            adder=left;
        } else if (r.x>386*delta) {
            adder=right;
        } else {
            continue;
        }
        if (r.y > 339 * delta) {
            let ar = r.width / r.height;
            if (r.width < 30 * delta && r.height < 30 * delta && ar > 0.7 && ar < 1.3) {
                let rect = new cv.Contour([new Point2(r.x, r.y), new Point2(r.x + r.width, r.y), new Point2(r.x + r.width, r.y + r.height), new Point2(r.x, r.y + r.height)]);
                rect.bb = r;
                adder.push(rect);
            } else {
                console.log(`rejecting ${r.x},${r.y} - ${r.width}x${r.height}`);
            }
        }
    }

    left.sort((a, b) => a.bb.y - b.bb.y);
    right.sort((a, b) => a.bb.y - b.bb.y);

    let coords=[];
    function add(boxes) {
        let line=[];
        let ref=null;
        function addLine() {
            if (line.length>0) {
                line.sort((a,b)=> a.x-b.x); // sort horizontally
                coords.push(line);
            }
            line=[];
        }
        for(let i=0; i<boxes.length; i++) {
            if (ref==null || boxes[i].bb.y>ref) {
                // start a new line
                addLine();
                ref=boxes[i].bb.y+boxes[i].bb.height;
            }
            line.push({ x: boxes[i].bb.x, y: boxes[i].bb.y, w: boxes[i].bb.width, h: boxes[i].bb.height });
        }
        addLine();
    }
    add(left);
    add(right);

    return coords;
}

function drawCoords(target, coords, width, color) {
    let random=!color;
    for (let i = 0; i < coords.length; i++) {
        if (random) color=new cv.Vec3(Math.random()*255, Math.random()*255, Math.random()*255);
        let line = coords[i];
        target.putText(""+(i+1),new Point2(line[0].x-40,line[0].y+line[0].h), cv.FONT_HERSHEY_PLAIN,2,color,2);

        for(let j=0; j<line.length; j++) {
            let c=line[j];
            let points = [
                new Point2(c.x, c.y),
                new Point2(c.x + c.w, c.y),
                new Point2(c.x + c.w, c.y + c.h),
                new Point2(c.x, c.y + c.h)];
            target.drawContours([points], 0, color, width);    
        }
    }
}

let noma = getCoordsForNoma(cnts);



let questions=getQuestions(cnts);

drawCoords(paper, noma, 2);

//drawContours(paper, line, 2, new cv.Vec3(255-10*i, Math.random()*255, Math.random()*255));

cv.imwrite("out4.jpg", paper);

fs.writeFileSync("noma.json",JSON.stringify(noma,null,2));
fs.writeFileSync("questions.json",JSON.stringify(questions,null,2));

console.log("DONE");
