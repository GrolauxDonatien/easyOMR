
const nav = (() => {
    let steps = document.getElementById("steps");
    let panels = document.getElementsByClassName("panel");
    let listeners = [];
    let keylistener = {};

    function bringIntoView(el) {
        let bbel = el.getBoundingClientRect();
        let bbprt = el.parentElement.getBoundingClientRect();
        let bbgprt = el.parentElement.parentElement.getBoundingClientRect();
        if (bbel.top < bbgprt.top) { // above top
            el.scrollIntoView();
        } else if (bbel.bottom > bbgprt.bottom) {
            el.scrollIntoView();
        }
    }

    function select(panel) {
        let c = currentAll();
        if (c) {
            c.panel.classList.remove("selected");
            c.step.classList.remove("selected");
        }
        if (panel) {
            let p = document.getElementById(panel);
            p.classList.add("selected");
            steps.querySelector('[data-id="' + panel + '"]').classList.add("selected");
            for (let i = 0; i < listeners.length; i++) listeners[i](panel);
        }
    }

    function selectLast() {
        let all = steps.querySelectorAll("a");
        for (let i = all.length - 1; i >= 0; i--) {
            if ([...all[i].classList].indexOf("disabled") == -1) {
                select(all[i].getAttribute("data-id"));
                return;
            }
        }
    }

    function enable(panel, enabled) {
        let step = steps.querySelector('[data-id="' + panel + '"]');
        step.classList.remove("disabled");
        if (!enabled) {
            step.classList.add("disabled");
        }
    }

    function isEnabled(panel) {
        let step = steps.querySelector('[data-id="' + panel + '"]');
        return [...step.classList].indexOf("disabled") == -1;
    }

    function currentAll() {
        let el = document.querySelector(".panel.selected");
        if (el) {
            return {
                panel: el,
                step: steps.querySelector('.selected'),
                name: el.getAttribute("id")
            }
        } else {
            return null;
        }
    }

    function current() {
        return currentAll()?.name;
    }

    steps.addEventListener("click", (event) => {
        if (event.target.tagName == "A" && [...event.target.classList].indexOf("disabled") == -1) {
            let panel = event.target.getAttribute("data-id");
            select(panel);
        }
    });

    window.addEventListener("keydown", (e) => {
        let c = current();
        if (c != null && (c in keylistener)) {
            keylistener[c](e);
            e.stopPropagation();
            e.preventDefault();
        }
    });

    return {
        select, enable, current, panels() {
            let out = [];
            for (let i = 0; i < panels.length; i++) out.push(panels[i].getAttribute("id"));
            return tout;
        },
        addSelectEvent(n) {
            listeners.push(n);
        },
        onKeypress(panel, cb) {
            keylistener[panel] = cb;
        },
        disableAll() {
            enable("template", false);
            enable("scans", false);
            enable("export", false);
        },
        isEnabled, selectLast, bringIntoView
    }
})();

const hints = (() => {
    let panels = document.getElementsByClassName('panel');
    let hintState = JSON.parse(localStorage.getItem("hintstates") || "{}");
    let panelsName = [];
    let toggleListener = () => { };
    for (let i = 0; i < panels.length; i++) panelsName.push(panels[i].getAttribute("id"));
    function toggle(hint) {
        hintState[hint] = !(hintState[hint] == null ? true : hintState[hint]);
        let el = panels[panelsName.indexOf(hint)].querySelector(".hint");
        if (hintState[hint]) {
            el.classList.remove("collapsed");
        } else {
            el.classList.add("collapsed");
        }
    }
    for (let i = 0; i < panels.length; i++) {
        let hint = panels[i].querySelector(".hint");
        hint.addEventListener('click', (event) => {
            toggle(panelsName[i]);
            localStorage.setItem("hintstates", JSON.stringify(hintState));
            toggleListener();
        });
    }

    for (let k in hintState) {
        if (!hintState[k]) {
            hintState[k] = true;
            toggle(k);
        }
    }

    return {
        toggle,
        onToggle(t) {
            toggleListener = t;
        }
    }
})();

const lockDisplay = (msg) => {

    let lock = document.createElement("DIV");
    lock.classList.add("lock");
    document.body.appendChild(lock);
    let div = document.createElement("DIV");
    lock.appendChild(div);
    if (msg) {
        div.innerText = msg;
        let br = document.createElement("BR");
        div.appendChild(br);
    }
    let prog = document.createElement("PROGRESS");
    div.appendChild(prog);

    function length(l) {
        prog.setAttribute("max", l);
    }
    function progress(l) {
        prog.setAttribute("value", l);
    }
    function destroy() {
        document.body.removeChild(lock);
    }
    return {
        length, progress, destroy
    }
};

const dialog = ({ title, buttons, content }) => {
    let main = document.createElement("DIV");
    main.classList.add("lock");
    let diag = document.createElement("DIV");
    main.appendChild(diag);
    document.body.appendChild(main);
    let div = document.createElement("DIV");
    diag.appendChild(div);
    if (title) {
        div.innerText = title;
        div.setAttribute("class", "title");
        div = document.createElement("DIV");
        diag.appendChild(div);
    }
    let contentEl = document.createElement("DIV");
    contentEl.setAttribute("class", "content");
    diag.appendChild(contentEl);
    if (content) {
        contentEl.innerText = content;
    }
    let buttonBar = document.createElement("DIV");
    diag.appendChild(buttonBar);
    buttonBar.setAttribute("class", "buttonbar");
    for (let but in buttons) {
        let button = document.createElement("BUTTON");
        button.innerText = but;
        button.addEventListener("click", buttons[but]);
        buttonBar.appendChild(button);
    }

    function destroy() {
        document.body.removeChild(main);
    }
    return {
        content: contentEl, buttonBar, destroy
    }
}


// from https://www.nayuki.io/page/convex-hull-algorithm
const convexHull = (function () {
    let convexhull = {};
    // Returns a new array of points representing the convex hull of
    // the given set of points. The convex hull excludes collinear points.
    // This algorithm runs in O(n log n) time.
    function makeHull(points) {
        var newPoints = points.slice();
        newPoints.sort(convexhull.POINT_COMPARATOR);
        return convexhull.makeHullPresorted(newPoints);
    }
    convexhull.makeHull = makeHull;
    // Returns the convex hull, assuming that each points[i] <= points[i + 1]. Runs in O(n) time.
    function makeHullPresorted(points) {
        if (points.length <= 1)
            return points.slice();
        // Andrew's monotone chain algorithm. Positive y coordinates correspond to "up"
        // as per the mathematical convention, instead of "down" as per the computer
        // graphics convention. This doesn't affect the correctness of the result.
        var upperHull = [];
        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            while (upperHull.length >= 2) {
                var q = upperHull[upperHull.length - 1];
                var r = upperHull[upperHull.length - 2];
                if ((q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x))
                    upperHull.pop();
                else
                    break;
            }
            upperHull.push(p);
        }
        upperHull.pop();
        var lowerHull = [];
        for (var i = points.length - 1; i >= 0; i--) {
            var p = points[i];
            while (lowerHull.length >= 2) {
                var q = lowerHull[lowerHull.length - 1];
                var r = lowerHull[lowerHull.length - 2];
                if ((q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x))
                    lowerHull.pop();
                else
                    break;
            }
            lowerHull.push(p);
        }
        lowerHull.pop();
        if (upperHull.length == 1 && lowerHull.length == 1 && upperHull[0].x == lowerHull[0].x && upperHull[0].y == lowerHull[0].y)
            return upperHull;
        else
            return upperHull.concat(lowerHull);
    }
    convexhull.makeHullPresorted = makeHullPresorted;
    function POINT_COMPARATOR(a, b) {
        if (a.x < b.x)
            return -1;
        else if (a.x > b.x)
            return +1;
        else if (a.y < b.y)
            return -1;
        else if (a.y > b.y)
            return +1;
        else
            return 0;
    }
    convexhull.POINT_COMPARATOR = POINT_COMPARATOR;
    return convexhull;
})();

function dotsToBezier(dots, smooth_value) {
    let bezier = [];

    if (dots.length > 0) {
        bezier.push(dots[0], dots[1]);
        for (let i = 0; i < dots.length; i += 2) {
            let x1 = dots[i];
            let y1 = dots[i + 1];
            let x2 = dots[(i + 2) % dots.length];
            let y2 = dots[(i + 3) % dots.length];
            let x0 = dots[(dots.length + i - 2) % dots.length];
            let y0 = dots[(dots.length + i - 1) % dots.length];
            let x3 = dots[(i + 4) % dots.length];
            let y3 = dots[(i + 5) % dots.length];

            let xc1 = (x0 + x1) / 2.0;
            let yc1 = (y0 + y1) / 2.0;
            let xc2 = (x1 + x2) / 2.0;
            let yc2 = (y1 + y2) / 2.0;
            let xc3 = (x2 + x3) / 2.0;
            let yc3 = (y2 + y3) / 2.0;
            let len1 = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
            let len2 = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
            let len3 = Math.sqrt((x3 - x2) * (x3 - x2) + (y3 - y2) * (y3 - y2));

            let k1 = len1 / (len1 + len2);
            let k2 = len2 / (len2 + len3);

            let xm1 = xc1 + (xc2 - xc1) * k1;
            let ym1 = yc1 + (yc2 - yc1) * k1;

            let xm2 = xc2 + (xc3 - xc2) * k2;
            let ym2 = yc2 + (yc3 - yc2) * k2;

            // Resulting control points. Here smooth_value is mentioned
            // above coefficient K whose value should be in range [0...1].
            ctrl1_x = xm1 + (xc2 - xm1) * smooth_value + x1 - xm1;
            ctrl1_y = ym1 + (yc2 - ym1) * smooth_value + y1 - ym1;

            ctrl2_x = xm2 + (xc2 - xm2) * smooth_value + x2 - xm2;
            ctrl2_y = ym2 + (yc2 - ym2) * smooth_value + y2 - ym2;
            bezier.push(ctrl1_x, ctrl1_y, ctrl2_x, ctrl2_y, x2, y2);
        }
    }
    return bezier
}

const viewer = (() => {
    let resizers = {};
    function resize() {
        for (let k in resizers) resizers[k]();
    }
    window.addEventListener("resize", resize);
    hints.onToggle(resize);

    function create(root) {
        let listSelectListener = () => { };
        let clickListener = () => { };
        let drawDirectives = [];
        let drawImage = null;
        let dx, dy;
        let drawWait = false;
        let left, right, canvas, context;
        let elements = [];
        let zoom = 1.0;
        root.innerHTML = "";
        left = document.createElement("DIV");
        left.classList.add("leftview");
        right = document.createElement("DIV");
        right.classList.add("rightview");
        canvas = document.createElement("CANVAS");
        canvas.setAttribute("title", "CTRL+molette pour zoomer");
        right.appendChild(canvas);
        context = canvas.getContext("2d");
        right.appendChild(canvas);
        root.appendChild(left);
        root.appendChild(right);
        left.addEventListener("click", (e) => {
            if (e.target.tagName == "LI") {
                let s = root.querySelector("li.selected");
                if (s) s.classList.remove("selected");
                e.target.classList.add("selected");
                nav.bringIntoView(e.target);
                listSelectListener(select());
            }
        });
        canvas.addEventListener("click", (e) => {
            if (!drawImage) return;
            let wr = right.clientWidth / drawImage.width;
            let hr = right.clientHeight / drawImage.height;
            let ar = Math.min(wr, hr) * zoom;
            let x = Math.round(e.offsetX / ar);
            let y = Math.round(e.offsetY / ar);
            if (x > drawImage.width) return;
            if (y > drawImage.height) return;
            clickListener(x, y, e);
        });
        canvas.addEventListener("wheel", (e) => {
            if (e.ctrlKey) {
                if (e.wheelDeltaY > 0) {
                    zoom = Math.min(10.0, zoom * 1.1);
                    resize();
                } else if (e.wheelDeltaY < 0) {
                    zoom = Math.max(1.0, zoom / 1.1);
                    resize();
                }
            }
        });
        resizers[root.getAttribute("id")] = () => {
            canvas.width = 1;
            canvas.height = 1;
            redraw();
        }

        function setList(list) {
            let current = select();
            let found = false;
            elements = list;
            left.innerHTML = "";
            let ul = document.createElement("UL");
            left.appendChild(ul);
            for (let i = 0; i < list.length; i++) {
                let li = document.createElement("LI");
                li.innerHTML = list[i];
                if (li.innerText.length > 30) {
                    li.setAttribute("title",li.innerText);
                    li.innerText = li.innerText.substring(0, 10) + "..." + li.innerText.substring(list[i].length - 10);
                }
                ul.appendChild(li);
                if (current == list[i]) {
                    li.classList.add("selected");
                    nav.bringIntoView(li);
                    found = true;
                }
            }
            if (!found && current != null) {
                listSelectListener(null);
            }
            resize();
        }

        function onListSelect(cb) {
            listSelectListener = cb;
        }

        function onClick(cb) {
            clickListener = cb;
        }

        function clear() {
            drawDirectives = [];
            drawImage = null;
            drawWait = false;
        }

        function drawCoords(coords, color) {
            drawDirectives.push({ coords, color });
        }

        function drawText(text, x, y, color) {
            drawDirectives.push({ text, x, y, color });
        }

        function drawBezier(dots, color) {
            drawDirectives.push({ bezier: dots, color });
        }

        function redraw() {
            context.clearRect(0, 0, canvas.width, canvas.height);
            if (!drawImage && drawWait) {
                canvas.width = 100;
                canvas.height = 100;
                canvas.style.width = "100px";
                canvas.style.height = "100px";
                context.save();
                context.font = "30px sans serif";
                context.fillStyle = "black";
                context.fillText("\u29D6", 20, 50);
                context.restore();
                return;
            }
            if (!drawImage) return;
            let wr = right.clientWidth / drawImage.width;
            let hr = right.clientHeight / drawImage.height;
            let ar = Math.min(wr, hr) * zoom;
            canvas.width = ar * drawImage.width;
            canvas.height = ar * drawImage.height;
            context.drawImage(drawImage, 0, 0, ar * drawImage.width, ar * drawImage.height);
            canvas.style.width = (drawImage.width * ar) + "px";
            canvas.style.height = (drawImage.height * ar) + "px";
            for (let i = 0; i < drawDirectives.length; i++) {
                if ("coords" in drawDirectives[i]) {
                    context.beginPath();
                    context.strokeStyle = drawDirectives[i].color;
                    context.lineWidth = 2;
                    let coords = drawDirectives[i].coords;
                    for (let i = 0; i < coords.length; i++) {
                        if (coords[i]) for (let j = 0; j < coords[i].length; j++) {
                            let b = coords[i][j];
                            if (b) context.rect((b.x + dx) * ar, (b.y + dy) * ar, b.w * ar, b.h * ar);
                        }
                    }
                    context.stroke();
                    context.lineWidth = 1;
                } else if ("text" in drawDirectives[i]) {
                    context.beginPath();
                    context.fillStyle = drawDirectives[i].color;
                    context.font = (30 * ar) + "px arial";
                    context.fillText(drawDirectives[i].text, (drawDirectives[i].x + dx) * ar, (drawDirectives[i].y + dy) * ar);
                    context.stroke();
                } else if ("bezier" in drawDirectives[i]) {
                    context.beginPath();
                    context.strokeStyle = drawDirectives[i].color;
                    context.lineWidth = 1;
                    let bezier = drawDirectives[i].bezier;
                    if (bezier && bezier.length > 0) {
                        context.moveTo((bezier[0] + dx) * ar, (bezier[1] + dy) * ar);
                        for (let i = 2; i < bezier.length; i += 6) {
                            context.bezierCurveTo((bezier[i] + dx) * ar, (bezier[i + 1] + dy) * ar, (bezier[i + 2] + dx) * ar, (bezier[i + 3] + dy) * ar, (bezier[i + 4] + dx) * ar, (bezier[i + 5] + dy) * ar);
                        }
                    }
                    context.stroke();
                }
            }
        }

        function select(n) {
            if (n === undefined) {
                let s = root.querySelector(".selected");
                if (!s) return null;
                let idx = Array.prototype.indexOf.call(s.parentElement.children, s);
                if (idx >= 0) return elements[idx];
                return null;
            } else {
                let s = root.querySelector("li.selected");
                if (s) s.classList.remove("selected");
                let idx = elements.indexOf(n);
                if (idx != -1) {
                    let tgt = root.querySelectorAll("li")[idx];
                    tgt.classList.add("selected");
                    nav.bringIntoView(tgt);
                } else if (Number.isInteger(n) && n>=0 && n<elements.length) {
                    select(elements[n]);
                }
            }
        }

        function resize() {
            setTimeout(resizers[root.getAttribute("id")], 10);
        }

        resize();

        return {
            setList,
            onListSelect,
            onClick,
            clear,
            drawImage(image, ldx = 0, ldy = 0) {
                drawImage = image;
                dx = ldx;
                dy = ldy;
                resize();
            },
            drawCoords,
            drawText,
            drawBezier,
            redraw,
            select,
            wait() {
                drawWait = true;
            }
        }

    }

    return {
        create,
        resize
    }

})();

