const cv = require("opencv4nodejs");
const fs = require("fs");
const fspath = require("path");
const { Point2, Size } = cv;
const { Poppler } = require("node-poppler");
const { PDFDocument, StandardFonts, rgb, PDFImage } = require("pdf-lib");
const tf = require('@tensorflow/tfjs')
const tfn = require("@tensorflow/tfjs-node");
const jsQR = require("jsqr");

const PREDICTIONMODE = "best";

const LO_OPENCVTHRESHOLD_NO = 0.02;
const LO_OPENCVTHRESHOLD_LOWMAYBE = 0.27;
const LO_OPENCVTHRESHOLD_YES = 0.80;
const LO_OPENCVTHRESHOLD_HIGHMAYBE = 0.94;

const HI_OPENCVTHRESHOLD_NO = 0.01;
const HI_OPENCVTHRESHOLD_LOWMAYBE = 0.20;
const HI_OPENCVTHRESHOLD_YES = 0.70;
const HI_OPENCVTHRESHOLD_HIGHMAYBE = 0.97;

const TEMPLATEQRCODE = "lkhglqksdlfd9876098HMLKJSDFH-1";

let omrmodel;

let asyncomrmodel = new Promise(async (resolve, reject) => {
    const handler = tfn.io.fileSystem(fspath.resolve(__dirname, "../resources/model.json"));
    omrmodel = await tf.loadLayersModel(handler);
    resolve(omrmodel);
})

const REFSIZE = 2000;

let DEBUG = false; // turning on will create jpg files for each box scanned

const AREA_NOMA = { x1: 972, y1: 229, x2: 1273, y2: 670 };
const AREA_GROUP = { x1: 194, y1: 319, x2: 627, y2: 371 };
const AREA_LEFTANSWERS = { x1: 61, y1: 708, x2: 701, y2: 1931 };
const AREA_RIGHTANSWERS = { x1: 764, y1: 708, x2: 1374, y2: 1931 };
const AREA_CENTERANSWERS = { x1: 14, y1: 708, x2: 1374, y2: 1931 };
const AREA_BIGCENTERANSWERS = { x1: 14, y1: 200, x2: 1374, y2: 1931 };
const IMG_NOMA = { x1: 959, y1: 155, x2: 1273, y2: 223 };
const IMG_NAME = { x1: 14, y1: 117, x2: 724, y2: 290 };
const BOX_MAX = 40; // each box is roughly 30 pixels wide/height
const BOX_MIN = 20;
const QR1 = { x: 728, y: 97 };
const QRS = { x: 1201, y: 3 };


const colors = {
    BLACK: new cv.Vec3(0, 0, 0),
    WHITE: new cv.Vec3(255, 255, 255),
    RED: new cv.Vec3(0, 0, 255),
    BLUE: new cv.Vec3(255, 0, 0),
    GREEN: new cv.Vec3(0, 255, 0)
}

const utils = (() => {

    function distance(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    }

    function isImageA4(image) {
        // A4 ratio is 1.4142
        let width = image.sizes[1];
        let height = image.sizes[0];
        return !(height / width > 1.45 || height / width < 1.37);
    }

    function normalizeImageSize(image) {
        return image.resize(REFSIZE, Math.floor(REFSIZE / 1.4142));
    }

    function drawContours(target, contours, size = 2, color = new cv.Vec3(255, 255, 255)) {
        const imgContours = contours.map((contour) => {
            return contour.getPoints();
        });

        for (let i = 0; i < imgContours.length; i++) {
            target.drawContours(imgContours, i, contours[i].color || color, size);
        }
    }

    function drawCoords(target, coords, width, color, withText = true) {
        let random = (color === undefined);
        for (let i = 0; i < coords.length; i++) {
            if (random) color = new cv.Vec3(Math.random() * 255, Math.random() * 255, Math.random() * 255);
            let line = coords[i];
            if (withText) target.putText("" + (i + 1), new Point2(line[0].x - 40, line[0].y + line[0].h), cv.FONT_HERSHEY_PLAIN, 2, color, 2);

            for (let j = 0; j < line.length; j++) {
                let c = line[j];
                let points = [
                    new Point2(c.x, c.y),
                    new Point2(c.x + c.w, c.y),
                    new Point2(c.x + c.w, c.y + c.h),
                    new Point2(c.x, c.y + c.h)];
                target.drawContours([points], 0, color, width);
            }
        }
    }


    function midPoint(contour) {
        let r = contour.boundingRect();
        return new Point2(r.x + r.width / 2, r.y + r.height / 2);
    }

    function findContoursCorners(contours, width, height) {
        let ref = width / 45; // the cross should be at maximum a 1/60 of the width
        let ref2 = ref * ref;
        let tl, tr, bl, br, tle, tre, ble, bre;
        for (let i = 0; i < contours.length; i++) {
            let r = contours[i].boundingRect();
            if (r.height * r.width > ref2 || r.height * r.width < ref2 / 4) continue;
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

        return { tl: tle, tr: tre, bl: ble, br: bre };
    }

    function findCornerPositions(image) {
        const SHRINKAGE = 50 * image.sizes[1] / 2480; // SHRINKAGE is a proportion of the width of the image to is skipped to avoid residual scan artifacts
        // avoid border of 10 pixels, some scanners may have residual lines there
        image = image.getRegion(new cv.Rect(SHRINKAGE, SHRINKAGE, image.sizes[1] - SHRINKAGE * 2, image.sizes[0] - SHRINKAGE * 2));
        let contours = image.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        let width = image.sizes[1];
        let height = image.sizes[0];
        let { tl, tr, bl, br } = findContoursCorners(contours, width, height);
        if (tl == null || tr == null || bl == null || br == null) return null;
        function getCoords(p) {
            p = p.boundingRect();
            return { x: p.x + p.width / 2 + SHRINKAGE, y: p.y + p.height / 2 + SHRINKAGE } // { x: p.x + p.width * dx, y: p.y + p.height * dy }
        }
        return { // get middle point, corrected wrt original size
            tl: getCoords(tl),
            tr: getCoords(tr),
            bl: getCoords(bl),
            br: getCoords(br)
        }
    }

    function findPageIdArea(warped, dx = 0, dy = 0) {
        let r = new cv.Rect(Math.max(0, 5 + dx), Math.max(712 + dy, 0), 69 - 5, 1926 - 712);
        let mask = warped.getRegion(r);
        function findInside(x1, x2, y1, y2, dx, dy, max) {
            let area = (x2 - x1) * (y2 - y1);
            for (let step = 0; step < max; step++) {
                let count = mask.getRegion(new cv.Rect(x1 + dx * step, y1 + dy * step, x2 - x1, y2 - y1)).countNonZero();
                let ratio = count / area;
                if (ratio > 0.1) {
                    return step;
                }
            }
            return 0; // no end found, if a full line was detected, skip 4 pixels, otherwise nothing was detected at all
        }

        let top = findInside(0, mask.sizes[1], 0, 1, 0, 1, mask.sizes[0] * 0.7);
        let bottom = mask.sizes[0] - findInside(0, mask.sizes[1], mask.sizes[0] - 2, mask.sizes[0] - 1, 0, -1, mask.sizes[0] * 0.7) - 1;
        let left = findInside(0, 1, 0, mask.sizes[0], 1, 0, mask.sizes[1] * 0.7);
        let right = mask.sizes[1] - findInside(mask.sizes[1] - 2, mask.sizes[1] - 1, 0, mask.sizes[0], -1, 0, mask.sizes[1] * 0.7) - 1;
        return {
            x: Math.max(0, r.x + left - 2),
            y: Math.max(0, r.y + top - 2),
            w: right - left + 4,
            h: bottom - top + 4
        }
    }

    function extractPageIdArea(warped, area) {
        return warped.getRegion(new cv.Rect(area.x, area.y, area.w, area.h));
    }

    function pagesSimilarity(image1, image2) {
        try {
            let score = image1.matchTemplate(image2, cv.TM_CCOEFF_NORMED).minMaxLoc();
            return score;
        } catch (_) {
            return 0;
        }
    }

    function score(src, dst) {
        let mask = new cv.Mat(src.sizes[0], src.sizes[1], cv.CV_8UC1);
        mask.drawRectangle(new cv.Point2(0, 0), new cv.Point2(src.sizes[1] - 1, src.sizes[0] - 1), new cv.Vec3(255, 255, 255), -1); // fill white
        dst = shrink(dst, src).resize(mask.sizes[0], mask.sizes[1]);
        mask = mask.bitwiseXor(dst);
        src = src.bitwiseAnd(mask);
        return { maxVal: -src.countNonZero() };
    }

    function cropNormalizedCorners(corners, image) {
        let width = Math.floor(REFSIZE / 1.4142);
        let height = REFSIZE;
        let src = [
            new Point2(corners.tl.x, corners.tl.y),
            new Point2(corners.tr.x, corners.tr.y),
            new Point2(corners.br.x, corners.br.y),
            new Point2(corners.bl.x, corners.bl.y)
        ]
        let dst = [
            new Point2(0, 0),
            new Point2(width - 1, 0),
            new Point2(width - 1, height - 1),
            new Point2(0, height - 1)];
        if (corners.pivot === true) {
            image = image.rotate(cv.ROTATE_180);
        }
        let matrix = cv.getPerspectiveTransform(src, dst);
        return image.warpPerspective(matrix, new Size(width, height));
    }

    function cropCorners(corners, image) {
        let matrix = cropCornersMatrix(corners, image);
        return image.warpPerspective(matrix, new Size(image.sizes[1], image.sizes[0]));
    }

    function cropCornersMatrix(corners, image) {
        let width = image.sizes[1];
        let height = image.sizes[0];
        let src = [
            new Point2(corners.tl.x, corners.tl.y),
            new Point2(corners.tr.x, corners.tr.y),
            new Point2(corners.br.x, corners.br.y),
            new Point2(corners.bl.x, corners.bl.y)
        ]
        let dst = [
            new Point2(0, 0),
            new Point2(width - 1, 0),
            new Point2(width - 1, height - 1),
            new Point2(0, height - 1)];

        return cv.getPerspectiveTransform(src, dst);
    }

    function getCropPerspectiveTransform(image) {
        // drop a bit of the margin, avoids residual dotted pixels from image manipulation
        image = image.getRegion(new cv.Rect(10, 10, image.sizes[1] - 20, image.sizes[0] - 20));
        let contours = image.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        let width = image.sizes[1];
        let height = image.sizes[0];
        let { tl, tr, bl, br } = findContoursCorners(contours, width, height);
        let dst = [
            new Point2(0, 0),
            new Point2(width - 1, 0),
            new Point2(width - 1, height - 1),
            new Point2(0, height - 1)];

        return cv.getPerspectiveTransform([midPoint(tl), midPoint(tr), midPoint(br), midPoint(bl)], dst);
    }


    function warpPerspective(image, target) {
        let matrix = utils.getCropPerspectiveTransform(image);
        if (target === undefined) target = image;
        return target.warpPerspective(matrix, new Size(image.sizes[1], image.sizes[0]));
    }

    function imageDenoised(image, level = 1.0) {
        if (PREDICTIONMODE == "opencv") { // only denoise for opencv, tensorflow works better if denoised is avoided
            return image.gaussianBlur(new Size(5, 5), level);
        } else {
            return image;
        }
    }

    function imageEdged(image) {
        return image.canny(75, 200);
    }

    function imageThreshold(image, clear = false) {
        let tmp = image.threshold(clear ? 160 : 200, 255, cv.THRESH_BINARY_INV);
        try {
            return tmp.bgrToGray(); // switching to gray after the threshold greatly enhances the precision when using a blue marker
        } catch (_) {
            return tmp; // already gray
        }
    }

    function findContoursExceptBorder(image) {
        let cnts = image.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        if (cnts.length == 1) {
            // assume a surrounding border, we will delete it
            drawContours(image, cnts, 2, colors.BLACK);
            cnts = warped.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        }
        return cnts;
    }


    function isInRect(x, y, rect) {
        return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
    }

    return {
        cv, distance, cropNormalizedCorners, isImageA4, normalizeImageSize, drawContours, findContoursCorners, getCropPerspectiveTransform, imageDenoised, imageEdged, imageThreshold, drawCoords, findContoursExceptBorder, warpPerspective, isInRect, findCornerPositions, cropCorners, findPageIdArea, pagesSimilarity, extractPageIdArea, cropCornersMatrix
    }
})();


const templater = (() => {

    function readQR(warped, x, y, inv = true) {
        let rect = new cv.Rect(x, y, 935 - 728, 295 - 97);
        let region = warped.getRegion(rect);

        function attemptRead(mat, invert) {
            let data = mat.getData();
            let rgbadata = new Uint8ClampedArray(data.length * 4);
            for (let i = 0; i < data.length; i++) {
                let j = i * 4;
                rgbadata[j] = data[i];
                rgbadata[j + 1] = data[i];
                rgbadata[j + 2] = data[i];
                rgbadata[j + 3] = 255;
            }
            return jsQR(rgbadata, region.sizes[1], region.sizes[0], { inversionAttempts: invert });
        }
        let ret = attemptRead(region.gaussianBlur(new cv.Size(0, 0), 0.1), inv ? "invertFirst" : "attemptBoth");
        if (ret == null) {
            if (inv) {
                region = region.threshold(0, 255, cv.THRESH_BINARY_INV);
            } else {
                region = region.threshold(196, 255, cv.THRESH_BINARY);
            }
            ret = attemptRead(region, 'attemptBoth');
        }
        return ret;
    }

    function typeOfTemplate(warped) {
        let rect = new cv.Rect(1225, 1941, 1370 - 1225, 1970 - 1941);
        let region = warped.getRegion(rect);
        let verticalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, rect.height - 4));
        mask = region.erode(verticalStructure, new cv.Point(-1, -1));
        mask = mask.dilate(verticalStructure, new cv.Point(-1, -1));
        contours = mask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        if (contours.length < 5) {
            if (region.countNonZero() < rect.width * rect.height * 0.5) {
                // check for QR code presence
                let qr = readQR(warped, QR1.x, QR1.y);
                if (qr === null) {
                    qr = readQR(warped, QRS.x, QRS.y);
                    if (qr === null) {
                        return "custom";
                    } else {
                        return "customqr*";
                    }
                } else { // qr.data="lkhglqksdlfd9876098HMLKJSDFH-1"
                    return "customqr";
                }
            } else {
                return "grid"; // this is a response grid created by easyOMR
            }
        } else {
            return "moodle"; // this is a template created by Moodle
        }
    }

    function grabName(img) {
        return img.getRegion(new cv.Rect(IMG_NAME.x1, IMG_NAME.y1, IMG_NAME.x2 - IMG_NAME.x1, IMG_NAME.y2 - IMG_NAME.y1));
    }

    function grabNoma(img) {
        return img.getRegion(new cv.Rect(IMG_NOMA.x1, IMG_NOMA.y1, IMG_NOMA.x2 - IMG_NOMA.x1, IMG_NOMA.y2 - IMG_NOMA.y1));
    }

    function getNoma(cnts, logger = console.log) {
        let boxes = [];
        let rejects = [];
        for (let i = 0; i < cnts.length; i++) {
            let r = cnts[i].boundingRect();
            if (utils.isInRect(r.x, r.y, AREA_NOMA)) {
                let ar = r.width / r.height;
                let rect = new cv.Contour([new Point2(r.x, r.y), new Point2(r.x + r.width, r.y), new Point2(r.x + r.width, r.y + r.height), new Point2(r.x, r.y + r.height)]);
                rect.bb = r;
                if (r.width > BOX_MIN && r.height > BOX_MIN && r.width < BOX_MAX && r.height < BOX_MAX && ar > 0.7 && ar < 1.42) {
                    boxes.push(rect);
                }
            }
        }

        if (boxes.length < 54) { // cannot figure out boxes for student ID
            return null;
        }

        // organize boxes vertically
        boxes.sort((a, b) => a.bb.y - b.bb.y);


        let coords = [[], [], [], [], [], []];
        let rx = [];
        for (let i = 0; i < boxes.length; i++) {
            rx.push(boxes[i].bb.x);
        }
        rx.sort((a, b) => a - b);
        for (let i = rx.length - 1; i >= 0; i--) {
            if (Math.abs(rx[i] - rx[i + 1]) < 20) {
                rx.splice(i, 1);
            }
        }

        if (rx.length != 6) {
            return null;
        }

        for (let i = 0; i < boxes.length; i++) {
            let r = { x: boxes[i].bb.x, y: boxes[i].bb.y, w: boxes[i].bb.width, h: boxes[i].bb.height }
            for (let j = 0; j < rx.length; j++) {
                if (Math.abs(rx[j] - r.x) < 20) {
                    coords[j].push(r);
                    break;
                }
            }
        }

        for (let i = 0; i < coords.length; i++) {
            if (coords[i].length == 9) {
                let c = coords[i][0];
                coords[i].splice(0, 0, { x: c.x, y: coords[i][0].y - (coords[i][1].y - coords[i][0].y), w: c.w, h: c.h });
            }
        }

        if (rejects.length > 0) {
            // top line is troublesome because of the gray underline below the boxes
            let y = null;
            for (let i = 0; i < rejects.length; i++) {
                if (y == null || rejects[i] < y) y = rejects[i];
            }

        }

        return coords;
    }

    function getGroup(cnts, logger = console.log) {
        let boxes = [];
        for (let i = 0; i < cnts.length; i++) {
            let r = cnts[i].boundingRect();
            if (utils.isInRect(r.x, r.y, AREA_GROUP)) {
                let ar = r.width / r.height;
                if (r.width > BOX_MIN && r.height > BOX_MIN && r.width < BOX_MAX && r.height < BOX_MAX && ar > 0.7 && ar < 1.3) {
                    let rect = new cv.Contour([new Point2(r.x, r.y), new Point2(r.x + r.width, r.y), new Point2(r.x + r.width, r.y + r.height), new Point2(r.x, r.y + r.height)]);
                    rect.bb = r;
                    boxes.push(rect);
                } else {
                    logger(`rejecting ${r.x},${r.y} - ${r.width}x${r.height}`);
                }
            }
        }

        boxes.sort((a, b) => a.bb.x - b.bb.x);

        let coords = [];

        for (let i = 0; i < boxes.length; i++) {
            coords.push({ x: boxes[i].bb.x, y: boxes[i].bb.y, w: boxes[i].bb.width, h: boxes[i].bb.height });
        }

        return [coords];
    }

    function getQuestions(cnts, nucolumns, warped, logger = console.log) {
        let left = [];
        let right = [];
        const area_min = BOX_MIN * BOX_MIN;
        for (let i = 0; i < cnts.length; i++) {
            let r = cnts[i].boundingRect();

            if (r.width * r.height < area_min) continue; // elements should be roughly 30x30
            let adder;
            if (nucolumns == 2) {
                if (utils.isInRect(r.x, r.y, AREA_LEFTANSWERS)) {
                    adder = left;
                } else if (utils.isInRect(r.x, r.y, AREA_RIGHTANSWERS)) {
                    adder = right;
                } else {
                    continue;
                }
            } else if (nucolumns == 1) {
                if (utils.isInRect(r.x, r.y, AREA_CENTERANSWERS)) {
                    adder = left;
                } else {
                    continue;
                }
            } else if (nucolumns == 0) {
                if (utils.isInRect(r.x, r.y, AREA_BIGCENTERANSWERS)) {
                    adder = left;
                } else {
                    continue;
                }
            } else continue;

            let ar = r.width / r.height;

            if (r.width > BOX_MIN && r.height > BOX_MIN && r.width < BOX_MAX && r.height < BOX_MAX && ar > 0.7 && ar < 1.3) {
                // check if a box which may be empty or ticked (default group)
                let verticalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, r.height * 0.8));
                let box = warped.getRegion(r);
                let mask = box.erode(verticalStructure, new cv.Point(-1, -1));
                mask = mask.dilate(verticalStructure, new cv.Point(-1, -1));
                contours = mask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
                if (contours.length != 2) {
                    logger(`rejecting ${r.x},${r.y} - ${r.width}x${r.height}`);
                    continue;
                }
                let b1 = contours[0].boundingRect();
                let b2 = contours[1].boundingRect();
                if (b2.x < b1.x) { // swap
                    let c = b1;
                    b1 = b2;
                    b2 = c;
                }
                // check that corners of b1 and b2 are close to corners of r
                if (utils.distance(0, 0, b1.x, b1.y) > 4 || utils.distance(0, 0 + r.height, b1.x, b1.y + b1.height) > 4 |
                    utils.distance(0 + r.width, 0, b2.x + b2.width, b2.y) > 4 || utils.distance(0 + r.width, 0 + r.height, b2.x + b2.width, b2.y + b2.height) > 4) {
                    logger(`rejecting ${r.x},${r.y} - ${r.width}x${r.height}`);
                    continue;
                }
                // by symmetry check horizontally
                let horizontalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(r.width * 0.8, 1));
                mask = box.erode(horizontalStructure, new cv.Point(-1, -1));
                mask = mask.dilate(horizontalStructure, new cv.Point(-1, -1));
                contours = mask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
                if (contours.length != 2) {
                    logger(`rejecting ${r.x},${r.y} - ${r.width}x${r.height}`);
                    continue;
                }
                b1 = contours[0].boundingRect();
                b2 = contours[1].boundingRect();
                if (b2.y < b1.y) { // swap
                    let c = b1;
                    b1 = b2;
                    b2 = c;
                }
                // check that corners of b1 and b2 are close to corners of r
                if (utils.distance(0, 0, b1.x, b1.y) > 4 || utils.distance(0 + r.width, 0, b1.x + b1.width, b1.y) > 4 |
                    utils.distance(0, 0 + r.height, b2.x, b2.y + b2.height) > 4 || utils.distance(0 + r.width, 0 + r.height, b2.x + b2.width, b2.y + b2.height) > 4) {
                    logger(`rejecting ${r.x},${r.y} - ${r.width}x${r.height}`);
                    continue;
                }
                // found 2 vertical and horizontal bars on the border of r => that's a check box
                let rect = new cv.Contour([new Point2(r.x, r.y), new Point2(r.x + r.width, r.y), new Point2(r.x + r.width, r.y + r.height), new Point2(r.x, r.y + r.height)]);
                rect.bb = r;
                adder.push(rect);
            } else {
                logger(`rejecting ${r.x},${r.y} - ${r.width}x${r.height}`);
            }
        }

        left.sort((a, b) => a.bb.y - b.bb.y);
        right.sort((a, b) => a.bb.y - b.bb.y);

        let coords = [];
        function add(boxes) {
            let line = [];
            let ref = null;
            function addLine() {
                if (line.length > 0) {
                    line.sort((a, b) => a.x - b.x); // sort horizontally
                    coords.push(line);
                }
                line = [];
            }
            for (let i = 0; i < boxes.length; i++) {
                if (ref == null || boxes[i].bb.y > ref) {
                    // start a new line
                    addLine();
                    ref = boxes[i].bb.y + boxes[i].bb.height;
                }
                line.push({ x: boxes[i].bb.x, y: boxes[i].bb.y, w: boxes[i].bb.width, h: boxes[i].bb.height });
            }
            addLine();
        }
        add(left);
        add(right);

        return coords;
    }

    function getImageTemplate(image, logger = console.log) {
        if (!utils.isImageA4(image)) return false;
        let denoised = utils.imageDenoised(image);
        let edged = utils.imageWarped(denoised, true);
        let warped = utils.normalizeImageSize(utils.warpPerspective(edged));
        let cropedimage = utils.normalizeImageSize(utils.warpPerspective(edged, image));
        warped = utils.normalizeImageSize(warped);
        let cnts = utils.findContoursExceptBorder(warped);
        let noma = getNoma(cnts, logger);
        let questions = getQuestions(cnts, logger);
        let group = getGroup(cnts, logger);
        utils.drawCoords(cropedimage, noma, 2, colors.BLUE);
        utils.drawCoords(cropedimage, questions, 2, colors.GREEN);
        utils.drawCoords(cropedimage, group, 2, colors.RED);
        let grabs = [
            [{ x: IMG_NAME.x1, y: IMG_NAME.y1, w: IMG_NAME.x2 - IMG_NAME.x1, h: IMG_NAME.y2 - IMG_NAME.y1 }],
            [{ x: IMG_NOMA.x1, y: IMG_NOMA.y1, w: IMG_NOMA.x2 - IMG_NOMA.x1, h: IMG_NOMA.y2 - IMG_NOMA.y1 }]
        ];
        utils.drawCoords(cropedimage, grabs, 2, colors.RED);
        return {
            noma, questions, group, grabs, image: cropedimage
        }
    }

    function getTemplate(path, logger = console.log) {
        let templates = [];
        let images = {};
        let files = fs.readdirSync(path + "/template");
        files.sort();
        for (let i = 0; i < files.length; i++) {
            if (files[i].toLocaleLowerCase().endsWith(".jpg")) {
                let image = cv.imread(path + "/template/" + files[i]);
                let result = getImageTemplate(image, logger);
                result.name = files[i];
                images[files[i]] = result.image;
                delete result.image;
                templates.push(result);
            }
        }
        return { templates, images };
    }

    function processTemplate(path) {
        let logs = [];
        let result = getTemplate(path, (m) => { logs.push(m) });
        result.logs = logs;
        if (!fs.existsSync(path + "/template.out")) {
            fs.mkdirSync(path + "/template.out");
        }
        for (let i = 0; i < result.templates.length; i++) {
            cv.imwrite(path + "/template.out/" + result.templates[i].name, result.images[result.templates[i].name]);
        }
        let backup = result.images;
        delete result.images;
        fs.writeFileSync(path + "/template.out/templates.json", JSON.stringify(result.templates, null, 2));
        result.images = backup;
        return result;
    }

    function hasTemplate(path) {
        return fs.existsSync(path + "/template.out/templates.json");
    }

    function readTemplate(path) {
        return {
            logs: [],
            templates: JSON.parse(fs.readFileSync(path + "/template.out/templates.json"))
        };
    }

    function readTemplateImages(path, template) {
        if (template == undefined) template = readTemplate(path);
        template.images = {};
        for (let i = 0; i < template.templates.length; i++) {
            let n = template.templates[i].name;
            template.images[n] = cv.imread(path + "/template.out/" + n);
        }
        return template;
    }

    return {
        typeOfTemplate, grabName, grabNoma, getNoma, getQuestions, getGroup, getTemplate, getImageTemplate, processTemplate, hasTemplate, readTemplate, readTemplateImages, IMG_NAME, IMG_NOMA, REFSIZE, readQR
    }
})();


const checker = (() => {

    let count = 0;

    function checkBox(warped) {
        if (DEBUG) cv.imwrite('box_' + (count) + ".jpg", warped);

        warped = warped.threshold(10, 255, cv.THRESH_BINARY); // filter out aliasing

        // figure out horizontal bars
        let horizontal_size = warped.sizes[1] / 2;
        let horizontalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(horizontal_size, 1));
        let mask = warped.erode(horizontalStructure, new cv.Point(-1, -1));
        mask = mask.dilate(horizontalStructure, new cv.Point(-1, -1));
        // contours horizontal bars
        let contours = mask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < contours.length; i++) contours[i].bb = contours[i].boundingRect();
        let top = warped.sizes[0] - 1, bottom = 0; // figure out top & bottom
        let cleft = warped.sizes[1] - 1, cright = 0; // maybe figure out left & right
        let foundhoriz = false, foundvert = false;
        for (let i = 0; i < contours.length; i++) {
            if (contours[i].bb.width > 25 && contours[i].bb.height > 25) { // a big complete horizontal structure => mostly full
                // check density
                let t = mask.getRegion(contours[i].bb).countNonZero() / (contours[i].bb.width * contours[i].bb.height);
                if (t > LO_OPENCVTHRESHOLD_HIGHMAYBE) {
                    return { t, guess: false };
                }
            }
            if (contours[i].bb.width > 12) { // horizontal bar
                top = Math.min(top, contours[i].bb.y + contours[i].bb.height + 1);
                bottom = Math.max(bottom, contours[i].bb.y - 1);
                cleft = Math.min(cleft, contours[i].bb.x);
                cright = Math.max(cright, contours[i].bb.x + contours[i].bb.width);
                foundhoriz = true;
            }
        }

        // figure out vertical bars
        let vertical_size = warped.sizes[0] / 2;
        let verticalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vertical_size));
        mask = warped.erode(verticalStructure, new cv.Point(-1, -1));
        mask = mask.dilate(verticalStructure, new cv.Point(-1, -1));
        // contours vertical bars
        contours = mask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < contours.length; i++) contours[i].bb = contours[i].boundingRect();
        let ctop = warped.sizes[0] - 1, cbottom = 0;
        let left = warped.sizes[1] - 1, right = 0;
        for (let i = 0; i < contours.length; i++) {
            if (contours[i].bb.width > 25 && contours[i].bb.height > 25) { // a big complete horizontal structure => mostly full
                // check density
                let t = mask.getRegion(contours[i].bb).countNonZero() / (contours[i].bb.width * contours[i].bb.height);
                if (t > LO_OPENCVTHRESHOLD_HIGHMAYBE) {
                    return { t, guess: false };
                }
            }
            if (contours[i].bb.height > 12) { // vertical bar
                if (Math.abs(contours[i].bb.x - cleft) < 5 || Math.abs(contours[i].bb.x + contours[i].bb.width - cleft) < 5
                    || Math.abs(contours[i].bb.x - cright) < 5 || Math.abs(contours[i].bb.x + contours[i].bb.width - cright) < 5) {
                    foundvert = true;
                    ctop = Math.min(ctop, contours[i].bb.y);
                    cbottom = Math.max(cbottom, contours[i].bb.y + contours[i].bb.height);
                    left = Math.min(left, contours[i].bb.x + contours[i].bb.width + 1);
                    right = Math.max(right, contours[i].bb.x - 1);
                }
            }
        }

        if (!foundhoriz || !foundvert) {
            return { t: -1.0, guess: "maybe" };
        }

        // box position may be inaccurate due to several factors. In particular, pdf rendering by cairo
        // is often a bit different from the renderer engines of adobe and so. This introduces a shift of the
        // box targeting in the scans, and the full box is not captured completely.
        // This effect is partly mitigated because the input box for this function is artificially made bigger than
        // in the scan. However, in practice, it is quite frequent that some sides of the box are still not captured.
        // This is the reason why we have ctop, cbottom, cleft, and cright : in the absence of the proper side of the box,
        // we use the endings of other captured sides as reference points.

        // when one of the edges is not found, use the candidate instead
        if (top == warped.sizes[0] - 1) top = ctop;
        if (bottom == 0) bottom = cbottom;
        if (left == warped.sizes[1] - 1) left = cleft;
        if (right == 0) right = cright;

        // top or bottom not properly captured ? Find the better ctop/cbottom candidate
        if (top + 15 > bottom) {
            if (Math.abs(top - ctop) > Math.abs(bottom - cbottom)) {
                top = ctop;
            } else {
                bottom = cbottom;
            }
        }

        // left or right not properly captured ? Find the better cleft/cright candidate
        // we use a margin of 15 pixels, at the normalized resolution this is roughly half the size a box should have
        if (left + 15 > right) {
            if (Math.abs(left - cleft) > Math.abs(right - cright)) {
                left = cleft;
            } else {
                right = cright;
            }
        }

        if (top + 15 >= bottom || left + 15 >= right) {
            // even though we attempted to mitigate for a missing side, the information at this stage is still incomplete
            // this can happen in three cases: 
            // 1. a mostly empty box weirdly captured
            // 2. a mostly full box weirdly captured.
            // 3. a silly student that decides that erasing the box is a good idea, and then ticking the box anyway
            // 
            // let's just be careful and return we don't know
            let t = warped.countNonZero() / (warped.sizes[1] * warped.sizes[0]);
            return { t, guess: "maybe" };
            /*            if (t > 0.5) { // more than half is drawn => assume full box
                            if (DEBUG) cv.imwrite('autofull_' + (count++) + ".jpg", warped);
                            return false;
                        } else { // is it empty ?
                            if (t < HI_OPENCVTHRESHOLD_NO) {
                                if (DEBUG) cv.imwrite('empty_' + (count++) + ".jpg", warped);
                            } else { // run checkDensity as usual
                                return checkDensity(warped);
                            }
                        }*/
        }

        let rect = new cv.Rect(left + 1, top + 1, right - left - 2, bottom - top - 2);

        return checkDensity(warped.getRegion(rect));

        function checkDensity(warped, high = false) {
            let t = warped.countNonZero() / (warped.sizes[0] * warped.sizes[1]);
            function checkStable(proposal) {
                return proposal;
                // does not really work
                /*                let verticalStructure = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, warped.sizes[0] * 0.75));
                                mask = warped.erode(verticalStructure, new cv.Point(-1, -1));
                                let t2 = mask.countNonZero() / (mask.sizes[0] * mask.sizes[1]);
                                if (t2 / t > 1.2 || t / t2 > 1.2) {
                                    return { t, t2, guess: "maybe" };
                                } else return proposal;*/
            }
            if (t < (high ? HI_OPENCVTHRESHOLD_NO : LO_OPENCVTHRESHOLD_NO)) {
                if (DEBUG) cv.imwrite('no_' + (count++) + ".jpg", warped);
                return checkStable({ t, guess: false });
            } else if (t < (high ? HI_OPENCVTHRESHOLD_LOWMAYBE : LO_OPENCVTHRESHOLD_LOWMAYBE)) {
                if (DEBUG) cv.imwrite('maybe_' + (count++) + ".jpg", warped);
                return { t, guess: "maybe" };
            } else if (t < (high ? HI_OPENCVTHRESHOLD_YES : LO_OPENCVTHRESHOLD_YES)) {
                if (DEBUG) cv.imwrite('yes_' + (count++) + ".jpg", warped);
                return checkStable({ t, guess: true });
            } else if (t < (high ? HI_OPENCVTHRESHOLD_HIGHMAYBE : LO_OPENCVTHRESHOLD_HIGHMAYBE)) {
                if (DEBUG) cv.imwrite('maybefull_' + (count++) + ".jpg", warped);
                return { t, guess: "maybe" };
            } else {
                if (DEBUG) cv.imwrite('nofull_' + (count++) + ".jpg", warped);
                return { t, guess: false };
            }
        }

    }

    function getNoma(image, coords, dx, dy) {
        // the vertical version of getNoma relies on getAnswers
        let resp = getAnswers(image, coords, dx, dy);
        let noma = [];
        for (let i = 0; i < resp.answers.length; i++) {
            let fl = resp.failed[i] || [];
            let r = resp.answers[i].split("/");
            if (r == "99") {
                noma.push("_");
            } else if (r.length == 1) { // this one for sure
                noma.push(String.fromCharCode(r[0].charCodeAt(0) - 49));
            } else { // more than one, remove maybes and check if only one remains
                // remove maybes
                for (let j = r.length - 1; j >= 0; j--) {
                    let code = r[j].charCodeAt(0) - 97;
                    if (fl[code] === "maybe") {
                        r.splice(j, 1);
                    }
                }
                if (r.length == 1) {
                    noma.push(String.fromCharCode(r[0].charCodeAt(0) - 49));
                } else {
                    noma.push("X"); // all maybes or several non maybes
                }
            }
        }

        return noma.join("");
    }

    function predict(images, opencv = false) {
        tf.engine().startScope();
        let tss = [];
        for (let i = 0; i < images.length; i++) {
            let im = images[i];
            tss[i] = tf.tensor(im.getData(), [im.rows, im.cols, 1]);
        }
        let ts = tf.stack(tss);
        let res = omrmodel.predict(ts).dataSync();
        tf.engine().endScope();
        let ret = [];

        /* how to figure out next part:
            in terminal, run:
                .\node_modules\.bin\electron.cmd . tstoexcel
            open short.xslx (limited to 5k lines otherwise Excel tends to become incredibly slow)
                find conditions based on the two scores that safely filter out all true, false, and maybe situations
                in the code below, I sorted by score2, then found limits that made sense, filtering out everything except true
                which is the reason why this is the last case
        */

        for (let i = 0; i < images.length; i++) {
            let v3 = res[i * 3];
            let v2 = res[i * 3 + 1];
            let v1 = res[i * 3 + 2];
            let score = {
                t: v1 + "/" + v2 + "/" + v3,
            }
            ret.push(score);
            let full = (v1 > 1023000 && v1 < 1044000 && v2 > -1268000 && v2 < -1243000 && v3 > -5789000 && v3 < -5675000);
            let yes = (v1 > 325000 && v1 < 331000 && v2 > -904000 && v2 < -887000 && v3 > -3990000 && v3 < -3911000);
            let no = (v1 > -405000 && v1 < -397000 && v2 > -429000 && v2 < -421000 && v3 > -1911000 && v3 < -1873000);

            if (full && !yes && !no) {
                score.guess = false; // full in fact
            } else if (!full && yes && !no) {
                score.guess = true;
            } else if (!full && !yes && no) {
                score.guess = false;
            } else {
                if (opencv) {
                    // should be maybe, but opencv may guess better
                    let ocv = checkBox(images[i]).guess;
                    if (ocv === true && yes) {
                        score.guess = true;
                    } else if (ocv == false && (no || full)) {
                        score.guess = false;
                    } else if (!no && !yes && !full) { // tensorflow does not have a guess => accept the one from opencv
                        score.guess = ocv;
                    } else {
                        score.guess = 'maybe'; // contradictory decisions => maybe
                    }
                } else {
                    score.guess = 'maybe';
                }
            }
        }

        return ret;
    }

    function getAnswers_best(image, coords, dx = 0, dy = 0) {
        return getAnswers_tensorflow(image, coords, dx, dy, true);
    }

    function getAnswers_tensorflow(image, coords, dx = 0, dy = 0, opencv = false) {
        let failed = [];
        let answers = [];
        let errors = 0;
        let images = [];
        let read = [];
        for (let line = 0; line < coords.length; line++) {
            for (let col = 0; col < coords[line].length; col++) {
                let bb = coords[line][col];
                let ox = bb.x - 5 + dx;
                let oy = bb.y - 5 + dy;
                if (ox + 40 >= image.sizes[1]) {
                    ox = image.sizes[1] - 41;
                }
                if (oy + 40 >= image.sizes[0]) {
                    oy = image.sizes[0] - 41;
                }
                if (ox < 0) ox = 0;
                if (oy < 0) oy = 0;
                let rect = new cv.Rect(ox, oy, 40, 40); // take more space, gives a better chance to checkBox to find the actual box
                let img = image.getRegion(rect).copy();
                images.push(img);
            }
        }
        let all = predict(images, opencv);
        let idx = 0;
        for (let line = 0; line < coords.length; line++) {
            let answer = [];
            let ret = all.slice(idx, idx + coords[line].length);
            idx += ret.length;
            if (read[line] == undefined) read[line] = [];
            for (let col = 0; col < ret.length; col++) {
                read[line][col] = ret[col].t;
                if (ret[col].guess == "unknown") { // maybe it is empty empty ?
                    if (failed[line] == undefined) failed[line] = [];
                    let density = images[col].countNonZero() / (images[col].sizes[0] * images[col].sizes[1]);
                    if (density < 0.01) {
                        failed[line][col] = 'empty';
                    } else {
                        failed[line][col] = 'maybe';
                    }
                } else if (ret[col].guess == "maybe") {
                    answer.push(String.fromCharCode(col + 97));
                    if (failed[line] == undefined) failed[line] = [];
                    failed[line][col] = "maybe";
                } else if (ret[col].guess == true) {
                    answer.push(String.fromCharCode(col + 97));
                }
            }
            if (failed[line]) {
                let allempty = true;
                for (let col = 0; col < coords[line].length; col++) {
                    if (ret[col].guess !== "empty") {
                        allempty = false;
                        break;
                    }
                }
                if (allempty) {
                    for (let col = 0; col < coords[line].length; col++) {
                        failed[line][col] = "maybe"; // tag whole line as inacurate
                    }
                }
            }
            if (answer.length == 0) {
                answers.push("99");
            } else {
                answers.push(answer.join("/"));
            }
        }

        return { answers, failed, errors, read };
    }

    function getAnswers_opencv(image, coords, dx = 0, dy = 0) {
        // get questions in normalized image according to given coords
        let failed = [];
        let answers = [];
        let errors = 0;
        let read = [];
        for (let line = 0; line < coords.length; line++) {
            let answer = [];
            for (let col = 0; col < coords[line].length; col++) {
                let bb = coords[line][col];
                let ox = bb.x - 5 + dx;
                let oy = bb.y - 5 + dy;
                if (ox + bb.w + 10 >= image.sizes[1]) {
                    ox = image.sizes[1] - bb.w - 11;
                }
                if (oy + bb.h + 10 >= image.sizes[0]) {
                    oy = image.sizes[0] - bb.h - 11;
                }
                if (ox < 0) ox = 0;
                if (oy < 0) oy = 0;
                let rect = new cv.Rect(ox, oy, Math.min(ox + image.sizes[1], bb.w + 10), Math.min(ox + image.sizes[0], bb.h + 10)); // take more space, gives a better chance to checkBox to find the actual box
                let mask = image.getRegion(rect);
                let readbox = checkBox(mask);
                if (read[line] == undefined) read[line] = [];
                read[line][col] = readbox.t;
                let state = readbox.guess;
                switch (state) {
                    case "empty": // empty means no box found at all, just ignore and consider not ticked
                        if (failed[line] == undefined) failed[line] = [];
                        failed[line][col] = "empty";
                        errors++; // count these boxes
                        break;
                    case "accuracy":
                        if (failed[line] == undefined) failed[line] = [];
                        failed[line][col] = "accuracy";
                        break;
                    case "maybe":
                        answer.push(String.fromCharCode(col + 97));
                        if (failed[line] == undefined) failed[line] = [];
                        failed[line][col] = "maybe";
                        break;
                    case true:
                        answer.push(String.fromCharCode(col + 97));
                        break;
                    case false:
                        break;
                }
            }
            if (failed[line]) {
                let allempty = true;
                for (let col = 0; col < coords[line].length; col++) {
                    if (failed[line][col] !== "empty") {
                        allempty = false;
                        break;
                    }
                }
                if (allempty) {
                    for (let col = 0; col < coords[line].length; col++) {
                        failed[line][col] = "maybe"; // tag whole line as inacurate
                    }
                }
            }
            if (answer.length == 0) {
                answers.push("99");
            } else {
                answers.push(answer.join("/"));
            }
        }
        return { answers, failed, errors, read };
    }

    const getAnswers = PREDICTIONMODE == "opencv" ? getAnswers_opencv : (PREDICTIONMODE == "best" ? getAnswers_best : getAnswers_tensorflow);


    function getResult(image, template, dx, dy) {
        // process according to this single template
        let noma = template.noma == null ? null : getNoma(image, template.noma, dx, dy);
        let answers = getAnswers(image, template.questions, dx, dy);
        let group;
        if ("thisgroup" in template) {
            group = template.thisgroup;
        } else {
            group = getAnswers(image, template.group, dx, dy).answers[0];
        }
        return {
            noma: noma,
            answers: answers.answers,
            failed: answers.failed,
            read: answers.read,
            group: group,
            errors: answers.errors + group.errors
        }
    }

    function getResults(path, templates) {
        // read each image, and process according to templates
        // when several templates are present, 
        // pick the one with the least failures
        // for that one, also grab image content to save along
        let results = {};
        let files = fs.readdirSync(path + "/scans");
        files.sort();
        for (let i = 0; i < files.length; i++) {
            if (files[i].toLocaleLowerCase().endsWith(".jpg")) {
                let image = cv.imread(path + "/scans/" + files[i]);
                let denoised = utils.imageDenoised(image);
                let edged = utils.imageWarped(denoised);
                let warped = utils.normalizeImageSize(utils.warpPerspective(edged));
                warped = utils.normalizeImageSize(warped);
                let temps = [];
                for (let j = 0; j < templates.templates.length; j++) {
                    temps.push({ index: j, fn: files[i], result: getResult(warped, templates.templates[j]) });
                }
                temps.sort((a, b) => a.result.errors - b.result.errors);
                let result = temps[0].result;
                result.filename = temps[0].fn;
                if (!(result.noma in results)) {
                    results[result.noma] = [];
                }
                results[result.noma][temps[0].index] = result;
            }
        }
        return results;
    }

    function createImageResults(path, template, results) {
        if (!fs.existsSync(path + "/results.out")) {
            fs.mkdirSync(path + "/results.out");
        }
        let dn = path + "/results.out/";
        for (let k in results) {
            for (let i = 0; i < results[k].length; i++) {
                let page = results[k][i];
                if (page == undefined) continue; // missing page
                let tpl = template.templates[i];
                // read original image
                let image = cv.imread(path + "/scans/" + page.filename);
                let denoised = utils.imageDenoised(image);
                let edged = utils.imageWarped(denoised);
                let warped = utils.normalizeImageSize(utils.warpPerspective(edged, image));
                let p = tpl.noma[0][0];
                warped.putTxt(page.noma, new Point2(p.x - 5, p.y - 50), cv.FONT_HERSHEY_PLAIN, 2, colors.BLUE, 2);
                for (let j = 0; j < page.noma.length; j++) {
                    switch (page.noma.charAt(j)) {
                        case "_":
                        case "X":
                            utils.drawCoords(warped, [tpl.noma[j]], colors.RED, false);
                            break;
                        default:
                            let v = page.noma.charCodeAt(j) - 48;
                            let coords = [[tpl.noma[j][v]]];
                            utils.drawCoords(warped, coords, 2, colors.GREEN, false);
                    }
                }
                let greencoords = [];
                let bluecoords = [];
                let redcoords = [];
                for (let j = 0; j < tpl.questions.length; j++) {
                    let coords = tpl.questions[j];
                    let answer = page.answers[j];
                    let fail = page.failed[j] || [];
                    for (let k in fail) {
                        if (fail[k] == 'maybe') {
                            bluecoords.push(coords[k]);
                        } else if (fail[k] == 'missing box') {
                            redcoords.push(coords[k]);
                        }
                    }
                    if (answer == "99") continue; // empty line
                    answer = answer.split("/");
                    for (let k = 0; k < answer.length; k++) {
                        let v = answer[k].charCodeAt(0) - 97;
                        greencoords.push(coords[v]);
                    }
                }
                utils.drawCoords(warped, [greencoords], 2, colors.GREEN, false);
                utils.drawCoords(warped, [bluecoords], 2, colors.BLUE, false);
                utils.drawCoords(warped, [redcoords], 2, colors.RED, false);

                cv.imwrite(dn + page.noma + "_" + (i + 1) + "_" + page.filename, warped);
            }
        }
    }


    function getGroup(warped, logger = () => { }) {
        let sub = warped.getRegion(new cv.Rect(AREA_GROUP.x1, AREA_GROUP.y1, AREA_GROUP.x2 - AREA_GROUP.x1, AREA_GROUP.y2 - AREA_GROUP.y1));
        let cnts = sub.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        let boxes = [];
        for (let i = 0; i < cnts.length; i++) {
            let r = cnts[i].boundingRect();
            let ar = r.width / r.height;
            if (r.width > BOX_MIN && r.height > BOX_MIN && r.width < BOX_MAX && r.height < BOX_MAX && ar > 0.7 && ar < 1.3) {
                let rect = new cv.Contour([new Point2(r.x, r.y), new Point2(r.x + r.width, r.y), new Point2(r.x + r.width, r.y + r.height), new Point2(r.x, r.y + r.height)]);
                rect.bb = r;
                boxes.push(rect);
            } else {
                logger(`rejecting ${r.x},${r.y} - ${r.width}x${r.height}`);
            }
        }

        boxes.sort((a, b) => a.bb.x - b.bb.x);

        let coords = [];

        for (let i = 0; i < boxes.length; i++) {
            coords.push({ x: boxes[i].bb.x, y: boxes[i].bb.y, w: boxes[i].bb.width, h: boxes[i].bb.height });
        }

        if (coords.length < 6 && coords.length > 1) {
            // some students sign so out of their box, they overwrite the group area which prevents from discovering the boxes correctly
            // we will extrapolate out of the existing data, hopefully this is good enough
            let delta = AREA_GROUP.x2 - AREA_GROUP.x1;
            for (let i = 0; i < coords.length - 1; i++) {
                if (coords[i + 1].x - coords[i].x < delta && coords[i + 1].x - coords[i].x > BOX_MIN) {
                    delta = coords[i + 1].x - coords[i].x;
                }
            }
            // add coords at the right
            while (coords[coords.length - 1].x + delta < AREA_GROUP.x2 - AREA_GROUP.x1) {
                coords.push({ x: coords[coords.length - 1].x + delta, y: coords[0].y, w: coords[0].w, h: coords[0].h });
            }
            // while still missing coords
            while (coords.length < 6) {
                // go from right to left, find empty spaces and add box
                let found = false;
                for (let i = coords.length - 2; i >= 0; i--) {
                    if (coords[i].x + BOX_MAX < coords[i + 1].x - delta) {
                        coords.splice(i + 1, 0, { x: coords[i].x + delta, y: coords[0].y, w: coords[0].w, h: coords[0].h })
                        found = true;
                        break;
                    }
                }
                // could not find an empty space, add at first place
                if (!found) {
                    if (coords[0].x - delta > 0) {
                        coords.splice(0, 0, { x: coords[0].x - delta, y: coords[0].y, w: coords[0].w, h: coords[0].h })
                    } else {
                        break; // just give up, we fall outside the area for boxes
                    }
                }
            }
        }

        if (coords.length != 6) {
            return {
                group: null,
                x: AREA_GROUP.x1,
                y: AREA_GROUP.y1
            }
        } else {
            let g = getAnswers(sub, [coords]);
            if (g.answers.length != 1 || g.answers[0].length != 1) {
                return {
                    group: null,
                    x: AREA_GROUP.x1,
                    y: AREA_GROUP.y1
                }
            } else {
                return {
                    group: g.answers[0],
                    x: coords[0].x + AREA_GROUP.x1,
                    y: coords[0].y + AREA_GROUP.y1
                }
            }
        }
    }

    return {
        getNoma, getAnswers, getResult, getResults, createImageResults, getGroup, getAnswers_opencv, getAnswers_tensorflow, getAnswers_best
    }
})();

const project = (() => {

    function load(path) {
        if (!fs.existsSync(path)) {
            throw new Error("Missing: " + path);
        }
        if (!fs.existsSync(path + "/template")) {
            fs.mkdirSync(path + "/template");
        }
        if (!fs.existsSync(path + "/scans")) {
            fs.mkdirSync(path + "/scans");
        }
        if (!fs.existsSync(path + "/export")) {
            fs.mkdirSync(path + "/export");
        }
        let ret = {
            path
        };
        function read(key) {
            if (fs.existsSync(path + "/" + key + ".json")) {
                try {
                    ret[key] = JSON.parse(fs.readFileSync(path + "/" + key + ".json"));
                } catch (_) {
                    try {
                        ret[key] = JSON.parse(fs.readFileSync(path + "/" + key + ".back"));
                        fs.copyFileSync(path + "/" + key + ".back", path + "/" + key + ".json");
                    } catch (_) {
                        throw new Error("Read error: " + path + "/" + key + ".json");
                    }
                }
            }
        }
        read("template");
        read("scans");
        read("corrections");
        read("users");
        return ret;
    }

    function save(project) {
        if (!fs.existsSync(project.path)) {
            throw new Error("Missing: " + project.path);
        }
        function write(key) {
            if (key in project) {
                if (fs.existsSync(project.path + "/" + key + ".json")) {
                    fs.copyFileSync(project.path + "/" + key + ".json", project.path + "/" + key + ".back");
                }
                fs.writeFileSync(project.path + "/" + key + ".json", JSON.stringify(project[key]));
            } else {
                if (fs.existsSync(project.path + "/" + key + ".back")) fs.rmSync(project.path + "/" + key + ".back");
                if (fs.existsSync(project.path + "/" + key + ".json")) fs.rmSync(project.path + "/" + key + ".json");
            }
        }
        write("template");
        write("scans");
        write("corrections");
        write("users");
    }

    return {
        load, save
    }
})();

const pdf = (() => {

    async function templateToPDF(offlinequizconfig, strings) {
        function wrapper(page) {
            let thicknessratio = 0.5;
            let ar = 2.835;
            let w = 210 * ar;
            page.setSize(w, w * 1.4142);
            let width = 210;
            let height = 210 * 1.4142;
            let dx = 0;
            let dy = 0;
            let thickness = thicknessratio;
            let font = freeSansFont;
            let style;
            let ptTomm = 0.352778;
            let size;
            let marginleft = 0;
            let margintop = 0;
            let textar = 0.5; // don't know why, but text aspect ratio is wrong otherwise
            let color = rgb(0, 0, 0);
            function x(lx) {
                return (lx + marginleft) * ar;
            }
            function y(ly) {
                return (height - (ly + margintop)) * ar;
            }
            let self = {
                setFont(lfont, lstyle, lsize) {
                    switch (lstyle) {
                        case 'B':
                            lfont = freeSansFontBold;
                            break
                        default:
                            lfont = freeSansFont;
                    }
                    size = lsize * ptTomm * ar;
                },
                setXY(ldx, ldy) {
                    dx = ldx;
                    dy = ldy;
                },
                setY(ldy) {
                    dy = ldy;
                },
                setX(ldx) {
                    dx = ldx;
                },
                getX() {
                    return dx;
                },
                getY() {
                    return dy;
                },
                drawLine(x1, y1, x2, y2) {
                    page.drawLine({
                        start: { x: x(x1), y: y(y1) },
                        end: { x: x(x2), y: y(y2) },
                        thickness,
                        color
                    });
                },
                drawRect(x1, y1, w, h, full) {
                    if (full !== "F") {
                        self.drawLine(x1, y1, x1 + w, y1);
                        self.drawLine(x1 + w, y1, x1 + w, y1 + h);
                        self.drawLine(x1 + w, y1 + h, x1, y1 + h);
                        self.drawLine(x1, y1 + h, x1, y1);
                    } else {
                        page.drawRectangle({
                            x: x(x1),
                            y: y(y1),
                            width: w * ar,
                            height: h * ar,
                            color
                        });
                    }
                },
                drawCell(w, h, text, withBorder, lineFeed, centering = "L") {
                    if (withBorder) {
                        //                    h*=1.1;
                    }
                    const textWidth = font.widthOfTextAtSize(text, size) * ptTomm;
                    const textHeight = font.heightAtSize(size) * ptTomm;
                    let padx = 0;
                    let pady = h - textHeight;
                    switch (centering) {
                        case "C":
                            padx = (w - textWidth) / 2;
                            break;
                        case "R":
                            padx = w - textWidth;
                            break;
                    }
                    if (withBorder) {
                        self.drawRect(dx, dy, w, h);
                    }
                    page.drawText(text, {
                        x: x(padx + dx), y: y(pady + dy),
                        "font": font,
                        "size": size
                    });
                    if (lineFeed == 1) {
                        dy += h;
                    } else {
                        dx += w;
                    }
                },
                drawMultiCell(w, h, text, withBorder, centering) {
                    let s = text.split("\n");
                    for (let i = 0; i < s.length; i++) {
                        self.drawCell(w, h, s[i], withBorder, 1, centering);
                    }
                },
                drawImage() {

                },
                setDrawColor(graylevel) {
                    color = rgb(graylevel / 256, graylevel / 256, graylevel / 256);
                }, ln() { },
                setThickness(lthickness) {
                    thickness = lthickness * thicknessratio;
                }
            }
            return self;
        }


        // https://pdf-lib.js.org/


        const pdfDoc = await PDFDocument.create()
        const freeSansFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const freeSansFontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        function header(page, template) {
            const letterstr = 'ABCDEF';

            page.drawLine(11, 12, 14, 12);
            page.drawLine(12.5, 10.5, 12.5, 13.5);
            page.drawLine(193, 12, 196, 12);
            page.drawLine(194.5, 10.5, 194.5, 13.5);
            page.setFont('FreeSans', 'B', 14);
            page.setXY(15, 20);
            page.drawCell(90, 4, strings['answerform'], 0, 1, 'C');
            page.setFont('FreeSans', '', 10);
            page.setY(page.getY() - 2);
            page.drawCell(90, 6, strings['forautoanalysis'], 0, 1, 'C');
            page.setFont('FreeSans', '', 8);
            // (width,height,text,withBox,lineFeed,align);
            page.setY(page.getY() + 1);
            page.drawCell(90, 7, ' ' + strings['firstname'] + ":", 1, 0, 'L');
            page.drawCell(29, 7, ' ' + strings['invigilator'], 0, 1, 'C');
            page.setX(15);
            page.drawCell(90, 7, ' ' + strings['lastname'] + ":", 1, 1, 'L');
            page.drawCell(90, 7, ' ' + strings['signature'] + ":", 1, 1, 'L');
            page.setY(page.getY() + 5);
            page.drawCell(20, 7, strings['group'] + ":", 0, 0, 'L');
            page.setXY(34.4, 57.4);
            // Print boxes for groups.
            for (let i = 0; i <= 5; i++) {
                page.setY(page.getY() + 2);
                page.drawCell(6, 3.5, letterstr[i], 0, 0, 'R');
                page.setY(page.getY() - 2);
                page.drawCell(0.85, 1, '', 0, 0, 'R');
                page.drawRect(page.getX(), page.getY(), 3.5, 3.5);
                page.drawCell(2.7, 1, '', 0, 0, 'C');
                if (template.thisgroup == letterstr[i].toLowerCase()) {
                    let x1 = page.getX() - 2.7;
                    let y1 = page.getY();
                    let d = 3.5;
                    page.setThickness(2);
                    page.drawLine(x1, y1, x1 + d, y1 + d);
                    page.drawLine(x1 + d, y1, x1, y1 + d);
                    page.setThickness(1);
                }
            }
            page.setXY(15, 70);
            page.drawMultiCell(115, 3, strings['instruction1'], 0, 'L');
            page.ln(1);
            page.setY(78);
            page.drawCell(42, 8, "", 0, 0, 'C');
            page.drawRect(page.getX(), page.getY(), 3.5, 3.5);
            page.drawCell(2.7, 1, '', 0, 0, 'C');
            let x1 = page.getX() - 2.7;
            let y1 = page.getY();
            let d = 3.5;
            page.setThickness(2);
            page.drawLine(x1, y1, x1 + d, y1 + d);
            page.drawLine(x1 + d, y1, x1, y1 + d);
            page.setThickness(1);
            page.setXY(15, 85);

            page.drawMultiCell(115, 3, strings['instruction2'], 0, 'L');

            page.setY(93.1);
            page.drawCell(42, 8, "", 0, 0, 'C');
            page.drawRect(page.getX(), page.getY() + 3.5, 3.5, 3.5, "F");
            page.drawCell(3.5, 3.5, '', 1, 1, 'C');


            page.setXY(15, 100);
            page.drawMultiCell(115, 3, strings['instruction3'], 0, 'L');

            page.drawLine(109, 29, 130, 29);                                 // Rectangle for the teachers to sign.
            page.drawLine(109, 50, 130, 50);
            page.drawLine(109, 29, 109, 50);
            page.drawLine(130, 29, 130, 50);

            page.setFont('FreeSans', 'B', 10);
            page.setXY(137, 27);
            let ID_digits = 6;
            page.drawCell(ID_digits * 6.5, 7, strings["idnumber"], 0, 1, 'C');
            page.setXY(137, 34);
            page.drawCell(ID_digits * 6.5, 7, '', 1, 1, 'C');  // Box for ID number.

            for (let i = 1; i < ID_digits; i++) {      // Little lines to separate the digits.
                page.drawLine(137 + i * 6.5, 39, 137 + i * 6.5, 41);
            }

            // Print boxes for the user ID number.
            page.setFont('FreeSans', '', 12);
            for (let i = 0; i < ID_digits; i++) {
                let x = 139 + 6.5 * i;
                for (let j = 0; j <= 9; j++) {
                    let y = 44 + j * 6;
                    page.drawRect(x, y, 3.5, 3.5);
                }
            }

            // Print the digits for the user ID number.
            page.setFont('FreeSans', '', 10);
            for (let y = 0; y <= 9; y++) {
                page.setXY(134, (y * 6 + 44 + 3));
                page.drawCell(3.5, 3.5, "" + y, 0, 1, 'C');
                page.setXY(138 + ID_digits * 6.5, (y * 6 + 44 + 3));
                page.drawCell(3.5, 3.5, "" + y, 0, 1, 'C');
            }

            page.ln();
        }

        function footer(page, template, nu, total) {
            page.drawLine(11, 285, 14, 285);
            page.drawLine(12.5, 283.5, 12.5, 286.5);
            page.drawLine(193, 285, 196, 285);
            page.drawLine(194.5, 283.5, 194.5, 286.5);
            page.drawRect(15, 281, 174, 0.5, 'F');                   // Bold line on bottom.
            page.drawRect(169, 281, 20, 5, 'F');                   // Black rectangle to mark this kind of template.
            page.setFont('FreeSans', '', 8);
            page.setXY(15, 283);
            page.drawCell(165, 5, "Page " + nu + "/" + total, 0, 0, "C");
        }

        function questions(page, template, start) {
            let offsetx = 17.3;
            let offsety = 105.5;
            let colWidth = 5;
            let lineHeight = 6.3;
            let max = 0;
            for (let i = 0; i < template.questions.length; i++) max = Math.max(max, template.questions[i].length);
            for (let i = 0; i < template.questions.length; i++) {
                if (i % 8 == 0) {
                    page.setFont('FreeSans', '', 8);
                    page.setXY(offsetx + colWidth + 1, offsety + 2.1);
                    for (let j = 0; j < max; j++) {
                        page.drawCell(3.5, 3.5, "abcdefghijklmn"[j], 0, 0, 'C');
                        page.drawCell(3, 3.5, '', 0, 0, 'C');
                    }
                    offsety += lineHeight;
                }
                let n = template.questions[i].length;
                page.setXY(offsetx, offsety);
                page.setFont('FreeSans', 'B', 10);
                page.drawCell(colWidth - 2, 5, (i + start + 1) + ")", 0, 0, "R");
                for (let j = 0; j < template.questions[i].length; j++) {
                    page.drawRect(offsetx + 6.5 * j + 6, offsety - 1, 3.5, 3.5, '');
                }
                offsety += lineHeight;
                if ((i + 1) % 24 == 0) {
                    offsetx += 90;
                    offsety = 105.5;
                }
            }
        }

        let gcount = {};
        for (let i = 0; i < offlinequizconfig.length; i++) {
            let tpl = offlinequizconfig[i];
            const page = pdfDoc.addPage()
            header(wrapper(page), tpl);
            footer(wrapper(page), tpl, i + 1, offlinequizconfig.length);
            let n = gcount[tpl.thisgroup] || 0;
            if (n == 0) {
                gcount[tpl.thisgroup] = n;
            }
            questions(wrapper(page), tpl, n);
            gcount[tpl.thisgroup] += tpl.questions.length;
        }
        return pdfBytes = await pdfDoc.save();
    }

    const PDFCOUNTCACHE = {};

    async function getPagesCount(file) {
        // because of the way watch directories work, getPagesCount may be called several times in fast succession for the same file
        // as parsing a large PDF file may take some time, we use a cache to store page counts
        // because loading a PDF is async, this function must also be async
        // we store promises in the cache, so that fast successive calls just ends up waiting of the same promise
        // PDFCOUNTCACHE is a memory leak, however it consumes very little memory
        let key;
        try {
            let stat = fs.statSync(file);
            key = file + "|" + stat.mtime + "|" + stat.size;
            if (key in PDFCOUNTCACHE) return PDFCOUNTCACHE[key];
        } catch (_) {
            return 0;
        }

        PDFCOUNTCACHE[key] = new Promise(async (resolve, reject) => {
            try {
                const pdfDocument = fs.readFileSync(file);
                const doc = await PDFDocument.load(pdfDocument);
                resolve(doc.getPages().length);
            } catch (e) {
                // remove from cache: maybe file was locked and may work fine later on, and we should not keep this failed promise for later calls
                delete PDFCOUNTCACHE[key];
                reject(e);
            }
        });
        return PDFCOUNTCACHE[key];
    }

    async function exportPNG(file, n = 1) {
        const poppler = new Poppler();
        const options = {
            firstPageToConvert: n,
            lastPageToConvert: n,
            singleFile: true,
            pngFile: true,
        };

        const res = await poppler.pdfToCairo(file, undefined, options);
        return Buffer.from(res, "binary");
    }

    async function writePDF(path, image) {
        let pdfDoc;
        if (fs.existsSync(path)) {
            pdfDoc = await PDFDocument.load(fs.readFileSync(path));
        } else {
            pdfDoc = await PDFDocument.create();
        }
        const page = pdfDoc.addPage([210 * 2.54, 297 * 2.54]);
        const jpgImage = await pdfDoc.embedJpg(cv.imencode(".jpg", image, [cv.IMWRITE_JPEG_QUALITY, 25]));
        page.drawImage(jpgImage, { x: 0, y: 0, width: 210 * 2.54, height: 297 * 2.54 });
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(path, pdfBytes);
    }

    return {
        templateToPDF,
        getPagesCount,
        exportPNG,
        writePDF
    }
})();

let normalizeOptions = {
    denoise: 1.0,
    edged: true
}

function getNormalizedImage({ path, image, template, corners, strings }) {
    let ret = {
        width: image.sizes[1],
        height: image.sizes[0],
        filename: fspath.basename(path)
    }
    if (!utils.isImageA4(image)) {
        ret.error = strings.A4Error;
        ret.group = "99";
        ret.noma = "XXXXXX";
    };
    let denoised, edged, group, warped;
    let _denoise, _edged;
    for (let attempt = 0; attempt < 4; attempt++) {
        _denoise = ((attempt < 2) ? normalizeOptions.denoise : (normalizeOptions.denoise == 1.0 ? 0.5 : 1.0));
        _edged = ((attempt % 2 == 0) ? normalizeOptions.edged : !normalizeOptions.edged);
        denoised = utils.imageDenoised(image, _denoise);
        edged = utils.imageThreshold(denoised, _edged);
        if (corners == null) {
            ret.corners = utils.findCornerPositions(edged);
        } else {
            ret.corners = corners;
        }
        if (ret.corners == null) {
            continue;
        }
        let { br, bl, tr, tl } = ret.corners;
        if ((br.x - tl.x) * (br.y - tl.y) / (ret.width * ret.height) < 0.5
            || (Math.abs(tl.x - bl.x) / ret.width > 0.1) || (Math.abs(tr.x - br.x) / ret.width > 0.1) || (Math.abs(tl.y - tr.y) / ret.height > 0.1) || (Math.abs(bl.y - br.y) / ret.height > 0.1)
        ) {
            // corners seem wacky, try again with more sensitivity
            continue;
        } else {
            warped = utils.cropNormalizedCorners(ret.corners, edged);
            if (template[0].type.startsWith("custom")) { // no group management for custom templates, just assume group "a"
                group = {
                    x: AREA_GROUP.x1,
                    y: AREA_GROUP.y1,
                    group: "a"
                }
                if (template[0].type.startsWith("customqr")) {
                    function formatqr(t) {
                        let o = t.split("/");
                        if (o.length == 2) {
                            let n = parseInt(o[1]) - 1;
                            if (isNaN(n)) {
                                return null;
                            }
                            return {
                                code: o[0],
                                template: n
                            }
                        } else { // unrecognized QR Code, might be user error (true story) where user forgot to print unique copies
                            return {
                                code: -1,
                                template: 0
                            }
                        }
                    }
                    // figure out qrcode, using image
                    let iwarped = utils.cropNormalizedCorners(ret.corners, image);
                    try {
                        iwarped = iwarped.bgrToGray();
                    } catch (_) { }
                    // check for QR code presence
                    let qr = templater.readQR(iwarped, QR1.x, QR1.y, false);
                    if (qr === null) {
                        qr = templater.readQR(iwarped, QRS.x, QRS.y, false);
                        if (qr === null) {
                            ret.qr = null;
                        } else {
                            ret.qr = formatqr(qr.data);
                        }
                    } else {
                        ret.qr = formatqr(qr.data);
                    }

                }
                break; // accept this has a success !
            } else {
                group = checker.getGroup(warped);
                if (group.group != null) break;
            }
        }
    }
    if (!warped) {
        ret.error = strings.cornersError;
        ret.group = "99";
        ret.noma = "XXXXXX";
        warped = image;
    } else {
        // next time start with current config
        normalizeOptions.denoise = _denoise;
        normalizeOptions.edged = _edged;
        ret.pageid = utils.findPageIdArea(warped, AREA_GROUP.x1 - group.x, AREA_GROUP.y1 - group.y);

        if (group.group == null) {
            ret.error = strings.groupError;
            ret.group = "99";
            ret.noma = "XXXXXX";
        }
    }

    return {
        denoised, edged, warped, group, ret
    }
}

function outer(r1, r2) {
    let x1 = Math.min(r1.x, r2.x);
    let y1 = Math.min(r1.y, r2.y);
    let x2 = Math.max(r1.x + r1.w, r2.x + r2.w);
    let y2 = Math.max(r1.y + r1.h, r2.y + r2.h);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

async function getTemplatePageId(projectpath, template, pageidcache) {
    let path = fspath.join(fspath.join(projectpath, "template"), template.filename);
    if (path in pageidcache &&
        JSON.stringify(template.corners) == JSON.stringify(pageidcache[path].corners) &&
        JSON.stringify(template.pageid) == JSON.stringify(pageidcache[path].pageid)) {
        return pageidcache[path].image;
    } else {
        let entry = {};
        let image = await readFile(path);
        let denoised = utils.imageDenoised(image);
        let edged = utils.imageThreshold(denoised, true);
        entry.corners = template.corners;
        let warped = utils.cropNormalizedCorners(entry.corners, edged);
        entry.pageid = template.pageid;
        entry.image = utils.extractPageIdArea(warped, entry.pageid);
        pageidcache[path] = entry;
        return entry.image;
    }
}


const IMAGETYPES = ["bmp", "pbm", "pgm", "ppm", "sr", "ras", "jpeg", "jpg", "jpe", "jp2", "tiff", "tif", "png"];


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
            let buffer = await pdf.exportPNG(sp[0], parseInt(sp[1]));
            image = cv.imdecode(buffer);
        } else {
            throw new Error("Invalid file " + path);
        }
    }
    return image;
}

async function computeDrift({ template, projectpath, warped, group, ret, pageidcache, strings }) {
    let dx = 0;
    let dy = 0;

    if ("qr" in ret) {// we already got the template page info from the QR code
        // if ret.qr.template is null, then we are fucked ?
        if (ret.qr == null || ret.qr.template == null) {
            ret.error = strings.templateError;
            ret.group = "99";
            ret.noma = "XXXXXX";
            return ret;
        } else {
            let righttemplate = template[ret.qr.template];
            let answer = checker.getAnswers(warped, righttemplate.questions, -dx, -dy);
            ret.answers = answer.answers;
            if (ret.qr.template == 0) {
                ret.noma = checker.getNoma(warped, righttemplate.noma, -dx, -dy);
            } else {
                ret.noma = null;
            }
            ret.group = group.group;
            ret.failed = answer.failed;
            ret.errors = answer.errors;
            ret.template = righttemplate.filename;
            if ("read" in answer) ret.read = answer.read;
            ret.dx = dx;
            ret.dy = dy;
        }
    } else {
        let scores = [];
        let idx;
        for (let i = 0; i < template.length; i++) {
            idx = i;
            if (group.group != template[i].thisgroup) continue; // wrong group
            let pageid = utils.extractPageIdArea(warped, outer(ret.pageid, template[i].pageid));
            let thisid = await getTemplatePageId(projectpath, template[i], pageidcache);
            let score = utils.pagesSimilarity(pageid, thisid);
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
            if (!righttemplate.type.startsWith("custom")) { // no group for custom templates => no group position shift
                dx = righttemplate.group[0][0].x - group.x;
                dy = righttemplate.group[0][0].y - group.y;
            }
            // shift warped dx and dy
            let answer = checker.getAnswers(warped, righttemplate.questions, -dx, -dy);
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
        if (!righttemplate.type.startsWith("custom")) { // no group for custom templates => no group position shift
            dx = righttemplate.group[0][0].x - group.x;
            dy = righttemplate.group[0][0].y - group.y;
        }

        if (dy < -2) dy = -2;
        if (dy > 2) dy = 2;
        if (dx < -2) dx = -2;
        if (dx > 2) dx = 2;

        ret.answers = answers[best].answers;
        ret.noma = checker.getNoma(warped, righttemplate.noma, -dx, -dy);
        ret.group = group.group;
        ret.failed = answers[best].failed;
        ret.errors = answers[best].errors;
        if ("read" in answers[best]) ret.read = answers[best].read;
        ret.template = righttemplate.filename;
        ret.dx = dx;
        ret.dy = dy;
    }

}

module.exports = {
    getNormalizedImage, computeDrift, templater, checker, utils, REFSIZE, colors, project, pdf, debug(d) { DEBUG = d; }, AREA_GROUP, QR1, QRS, omrmodel: asyncomrmodel
}