// https://www.npmjs.com/package/opencv4nodejs#quick-start

// https://www.pyimagesearch.com/2016/10/03/bubble-sheet-multiple-choice-scanner-and-test-grader-using-omr-python-and-opencv/

// https://github.com/PyImageSearch/imutils/tree/master/imutils

const cv = require("opencv4nodejs");
const nj = require("numjs");
const { Point2, Size } = cv;

let keys = [1, 4, 2, 0, 3];

let image = cv.imread("./inputs/MobileCamera/omr_test_01.png");
let gray = image.bgrToGray();
let blurred = gray.gaussianBlur(new cv.Size(5, 5), 0.0);
let edged = blurred.canny(75, 200);


let contours = edged.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
contours.sort((a, b) => b.area - a.area);

let docCnt = null;

for (let i = 0; i < contours.length; i++) {
    let c = contours[i];
    let peri = c.arcLength(true);
    let approx = c.approxPolyDP(0.02 * peri, true);
    if (approx.length == 4) {
        docCnt = approx;
        break;
    }
}

function order_points(pts) {
    pts = [[pts[0].x, pts[0].y], [pts[1].x, pts[1].y], [pts[2].x, pts[2].y], [pts[3].x, pts[3].y]];
    let rect = [];
    let min, max;
    let mini, maxi;
    // the top - left point will have the smallest sum, whereas
    // the bottom - right point will have the largest sum

    for (let i = 0; i < pts.length; i++) {
        let sum = pts[i][0] + pts[i][1];
        if (min == undefined || sum < min) {
            min = sum;
            mini = i;
        }
        if (max == undefined || sum > max) {
            max = sum;
            maxi = i;
        }
    }
    rect[0] = pts[mini];
    rect[2] = pts[maxi];

    min = undefined; max = undefined;
    for (let i = 0; i < pts.length; i++) {
        let sum = pts[i][1] - pts[i][0];
        if (min == undefined || sum < min) {
            min = sum;
            mini = i;
        }
        if (max == undefined || sum > max) {
            max = sum;
            maxi = i;
        }
    }
    rect[1] = pts[mini];
    rect[3] = pts[maxi];
    // return the ordered coordinates
    return rect;
}

function four_point_transform(image, pts) {
    // obtain a consistent order of the points and unpack them
    // individually
    let rect = order_points(pts)
    let tl = rect[0];
    let tr = rect[1];
    let br = rect[2];
    let bl = rect[3];

    // compute the width of the new image, which will be the
    let widthA = Math.sqrt(((br[0] - bl[0]) * (br[0] - bl[0])) + ((br[1] - bl[1]) * (br[1] - bl[1])));
    let widthB = Math.sqrt(((tr[0] - tl[0]) * (tr[0] - tl[0])) + ((tr[1] - tl[1]) * (tr[1] - tl[1])));

    let maxWidth = Math.max(Math.floor(widthA), Math.floor(widthB))
    // maxWidth = max(int(np.linalg.norm(br-bl)), int(np.linalg.norm(tr-tl)))

    // compute the height of the new image, which will be the
    let heightA = Math.sqrt(((tr[0] - br[0]) * (tr[0] - br[0])) + ((tr[1] - br[1]) * (tr[1] - br[1])))
    let heightB = Math.sqrt(((tl[0] - bl[0]) * (tl[0] - bl[0])) + ((tl[1] - bl[1]) * (tl[1] - bl[1])))
    let maxHeight = Math.max(Math.floor(heightA), Math.floor(heightB))
    // maxHeight = max(int(np.linalg.norm(tr-br)), int(np.linalg.norm(tl-br)))

    /*# now that we have the dimensions of the new image, construct
    # the set of destination points to obtain a "birds eye view",
    # (i.e. top-down view) of the image, again specifying points
    # in the top-left, top-right, bottom-right, and bottom-left
    # order*/
    let dst = [
        new Point2(0, 0),
        new Point2(maxWidth - 1, 0),
        new Point2(maxWidth - 1, maxHeight - 1),
        new Point2(0, maxHeight - 1)];

    // compute the perspective transform matrix and then apply it
    let M = cv.getPerspectiveTransform([new Point2(rect[0][0], rect[0][1]), new Point2(rect[1][0], rect[1][1]), new Point2(rect[2][0], rect[2][1]), new Point2(rect[3][0], rect[3][1])], dst);
    let warped = image.warpPerspective(M, new Size(maxWidth, maxHeight));

    // return the warped image
    return warped;
}

cv.imwrite("./step1.jpg", image);

let paper = four_point_transform(image, docCnt);
let warped = four_point_transform(gray, docCnt);

cv.imwrite("./step2.jpg", paper);

let thresh = warped.threshold(0, 255,
    cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

cv.imwrite("./step3.jpg", thresh);

let cnts = thresh.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

let questionCnts = [];

for (let i = 0; i < cnts.length; i++) {
    // compute the bounding box of the contour, then use the
    // bounding box to derive the aspect ratio
    let r = cnts[i].boundingRect();
    let h = r.height;
    let w = r.width;
    let ar = w / h;
    // in order to label the contour as a question, region
    // should be sufficiently wide, sufficiently tall, and
    // have an aspect ratio approximately equal to 1
    if (w >= 20 && h >= 20 && ar >= 0.9 && ar <= 1.1) {
        cnts[i].bbox = r;
        questionCnts.push(cnts[i]);
    }
}

// opencv4nodejs lacks sort_contours, let's implement it by hand
questionCnts.sort((a, b) => a.bbox.y - b.bbox.y);

function drawContours(target, contours, size = 2) {
    const imgContours = contours.map((contour) => {
        return contour.getPoints();
    });

    for (let i = 0; i < imgContours.length; i++) {
        target.drawContours(imgContours, i, contours[i].color || new cv.Vec3(255, 255, 255), size);
    }

}

// check & draw contours
for (let i = 0; i < questionCnts.length; i += 5) {
    let key = keys[i / 5];
    let slice = questionCnts.slice(i, i + 5);
    slice.sort((a, b) => a.bbox.x - b.bbox.x);
    let max = 0;
    let maxi = -1;
    for (let j = 0; j < slice.length; j++) {
        let mask = new cv.Mat(thresh.sizes[0], thresh.sizes[1], cv.CV_8UC1, 0);
        drawContours(mask, [slice[j]], -1);
        mask = thresh.bitwiseAnd(mask);
        let total = mask.countNonZero();
        if (total > max) {
            max = total;
            maxi = j;
        }
        drawContours(paper, [slice[j]],2);
    }
    if (maxi != key) {
        slice[maxi].color = new cv.Vec3(0, 0, 255);
    }
    slice[key].color = new cv.Vec3(0, 255, 0);
    drawContours(paper, slice);
}




cv.imwrite("./step4.jpg", paper);

debugger;

