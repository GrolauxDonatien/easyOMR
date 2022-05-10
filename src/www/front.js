/* viewer needs to change
*
* strategy is:
*    turn into a component with an API
*    pilot its behavior from the outside
*    when the project is loaded, a predefined template is already present
*    each time the directory change notification is triggered
*    diff with template in memory, process new template and adapt viewer in consequence
*
*/

api("set-menu", menuStrings);

function joinPath(path, extra) {
    let sep = (path.indexOf('/') != -1) ? "/" : "\\";
    return path + sep + extra;
}

let customTemplateEditor, redrawTemplate, redrawScan;
const PAD = 5;

function formatFilename(fn) {
    let dropDotIdx = fn.indexOf(":", 3);
    if (dropDotIdx != -1) return fn.substring(0, dropDotIdx);
    return fn;
}

function equalsFilename(fn1, fn2) {
    return formatFilename(fn1) == formatFilename(fn2);
}

const project = (() => {
    let current = {};
    let forceRefresh;

    function runTemplateView(forceRescan) {
        let path = joinPath(current.path, "template");
        let v = viewer.create(document.getElementById("templateView"));
        let listEl = document.querySelector('#templateView .leftview');
        function list(full = false) {
            let l = [];
            for (let i = 0; i < current.template.length; i++) l.push(full ? current.template[i].filename : formatFilename(current.template[i].filename));
            return l;
        }
        v.setList(list());
        function select(n) {
            v.clear();
            let info = null;
            let gcount = {};
            for (let i = 0; i < current.template.length; i++) {
                let g = current.template[i].thisgroup;
                if (equalsFilename(current.template[i].filename, n)) {
                    info = current.template[i];
                    gcount = gcount[g] || 0;
                    break;
                }
                gcount[g] = (gcount[g] || 0) + current.template[i].questions.length;
            }
            if (!info) {
                v.redraw();
                return;
            }
            v.wait();
            v.redraw();
            api("file-image", { path: joinPath(path, info.filename), corners: info.corners }, (result) => {
                let image = new Image();
                image.onload = () => {
                    v.drawImage(image);
                    if (info.noma == null) {
                        v.drawText(errorStrings.nomaTemplate, 600, 70, "red");
                        v.drawText(errorStrings.retryTemplate, 600, 100, "red");
                    } else {
                        v.drawCoords(info.noma, "blue");
                    }
                    if ("group" in info) {
                        if ("abcdef".indexOf(info.thisgroup[0]) == -1) {
                            v.drawCoords(info.group, "red");
                            v.drawText(errorStrings.groupTemplate, 10, 320, "red");
                            v.drawText(errorStrings.retryTemplate, 10, 400, "red");
                        } else {
                            v.drawCoords(info.group, "blue");
                            v.drawCoords([[info.group[0][info.thisgroup.charCodeAt(0) - 97]]], "green");
                        }
                    }
                    if (info.questions == null || info.questions.length == 0) {
                        v.drawText(errorStrings.questionsTemplate, 10, 720, "red");
                        v.drawText(errorStrings.retryTemplate, 10, 750, "red");
                    } else {
                        v.drawCoords(info.questions, "green");
                        if (info.type == "custom") {
                            let coords = info.questions;
                            for (let i = 0; i < coords.length; i++) if (coords[i]) {
                                let allDots = [];
                                for (let j = 0; j < coords[i].length; j++) {
                                    let b = coords[i][j];
                                    allDots.push({ x: b.x - PAD, y: b.y - PAD });
                                    allDots.push({ x: b.x + b.w + PAD, y: b.y - PAD });
                                    allDots.push({ x: b.x + b.w + PAD, y: b.y + b.h + PAD });
                                    allDots.push({ x: b.x - PAD, y: b.y + b.h + PAD });
                                    v.drawText(String.fromCharCode(97 + j), b.x + 4, b.y + b.h - 4, "green");
                                }
                                let hull = convexHull.makeHull(allDots);
                                allDots = [];
                                for (let i = 0; i < hull.length; i++) {
                                    allDots.push(hull[i].x);
                                    allDots.push(hull[i].y);
                                }
                                v.drawBezier(dotsToBezier(allDots, 0.5), "green");
                                let tx = allDots[0];
                                let ty = allDots[1];
                                for (let i = 2; i < allDots.length; i += 2) {
                                    if (allDots[i] < tx) tx = allDots[i];
                                    if (allDots[i + 1] < ty) ty = allDots[i + 1];
                                }
                                v.drawText((gcount + 1 + i) + ")", tx, ty - 10, "green");
                            }
                        }
                    }
                    v.redraw();
                };
                image.src = "data:image/jpg;base64," + result.image;
            }, () => {
                alert(errorStrings.missingImage);
            });
        };
        v.onListSelect(select);
        let updLock = false;
        let updFuture;
        function update(files) {
            if (updLock) {
                updFuture = files;
                return;
            }
            files.sort();
            updLock = true;
            updFuture = null;
            let lock = lockDisplay(strings.updatingTemplates);
            // diff current.template with list
            let l = list(true);
            let dirty = false;
            for (let i = l.length - 1; i >= 0; i--) {
                if (files.indexOf(l[i]) == -1) {
                    current.template.splice(i, 1); // remove template
                    dirty = true;
                }
            }
            let idx = 0;
            let xlsxPresent = false;
            lock.length(files.length);
            function loop() {
                if (idx >= files.length) { // its over
                    if (!xlsxPresent && "users" in current) {
                        delete current.users;
                        if (!dirty) { // if dirty, project will be saved anyway
                            api("project-save", current); // save project
                        }
                    }
                    if (dirty) {
                        forceRescan(); // scan needs to be redone
                        api("project-save", current); // save project
                        v.setList(list());
                        v.redraw();
                        nav.select("template"); // refresh UI
                    }
                    updLock = false;
                    lock.destroy();
                    if (updFuture !== null) {
                        update(updFuture);
                    } else {
                        if (v.select() != null) {
                            select(v.select());
                        } else {
                            v.select(0); // force select first item
                            if (v.select() != null) {
                                select(v.select());
                            }
                        }
                        setNav();
                    }
                    return;
                }
                if (formatFilename(files[idx]).toLowerCase().endsWith('.xlsx')) {
                    xlsxPresent = true;
                    if (current?.users?.filename == files[idx]) {
                        idx++;
                        loop();
                    } else {
                        let filename = files[idx];
                        api("file-users", joinPath(path, files[idx++]), (users) => {
                            lock.progress(idx);
                            if (users && JSON.stringify(users) != JSON.stringify(current.users)) {
                                current.users = {
                                    filename,
                                    users
                                }
                                api("project-save", current, loop, loop); // save project
                            } else loop();
                        }, loop);
                    }
                } else if (l.indexOf(files[idx]) == -1) {
                    dirty = true;
                    api("file-template", joinPath(path, files[idx++]), (tpl) => {
                        lock.progress(idx);
                        if (tpl) current.template.splice(idx, 0, tpl); // insert in template
                        loop();
                    }, loop);
                } else {
                    idx++;
                    loop();
                }
            }
            loop();
        }
        api.push("directory-watch", path, update);

        nav.onKeypress("template", (e) => {
            let el, all, idx;
            switch (e.key) {
                case "ArrowDown":
                    el = listEl.querySelector(".selected");
                    all = [...listEl.querySelectorAll("li")];
                    if (el == null) {
                        idx = -1;
                    } else {
                        idx = all.indexOf(el);
                    }
                    idx++;
                    if (idx < all.length) {
                        let event = e = document.createEvent("MouseEvents");
                        event.initEvent("click", true, true);
                        all[idx].dispatchEvent(event, true);
                    }
                    break;
                case "ArrowUp":
                    el = listEl.querySelector(".selected");
                    all = [...listEl.querySelectorAll("li")];
                    if (el == null) {
                        idx = all.length;
                    } else {
                        idx = all.indexOf(el);
                    }
                    idx--;
                    if (idx >= 0) {
                        let event = e = document.createEvent("MouseEvents");
                        event.initEvent("click", true, true);
                        all[idx].dispatchEvent(event, true);
                    }
                    break;
                case "Home":
                    all = [...listEl.querySelectorAll("li")];
                    if (all.length > 0) {
                        let event = e = document.createEvent("MouseEvents");
                        event.initEvent("click", true, true);
                        all[0].dispatchEvent(event, true);
                    }
                    break;
                case "End":
                    all = [...listEl.querySelectorAll("li")];
                    if (all.length > 0) {
                        let event = e = document.createEvent("MouseEvents");
                        event.initEvent("click", true, true);
                        all[all.length - 1].dispatchEvent(event, true);
                    }
                    break;
            }
        });

        function customTemplateEditor() {
            let template;
            let gcount = {};
            let current = project.current();
            let n = v.select();
            for (let i = 0; i < current.template.length; i++) {
                let g = current.template[i].thisgroup;
                if (equalsFilename(current.template[i].filename, n)) {
                    template = current.template[i];
                    gcount = gcount[g] || 0;
                    break;
                }
                gcount[g] = (gcount[g] || 0) + current.template[i].questions.length;
            }
            if (!template) return;
            // copy questions
            let questions = JSON.parse(JSON.stringify(template.questions));
            nav.select("edit-custom-template");
            // we will run the position UI directly here

            let root = document.querySelector('#edit-custom-template .positionview');
            root.innerHTML = ""; // clear up
            let canvas = document.createElement("CANVAS");
            root.appendChild(canvas);
            let context = canvas.getContext("2d");
            let drawImage = null;
            let drawWait = true;
            let zoom = 1.0;
            let selected = {};

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
                let wr = canvas.parentElement.clientWidth / drawImage.width;
                let hr = canvas.parentElement.clientHeight / drawImage.height;
                let ar = Math.min(wr, hr) * zoom;
                canvas.width = ar * drawImage.width;
                canvas.height = ar * drawImage.height;
                context.drawImage(drawImage, 0, 0, ar * drawImage.width, ar * drawImage.height);
                canvas.style.width = (drawImage.width * ar) + "px";
                canvas.style.height = (drawImage.height * ar) + "px";
                let dx = 0, dy = 0;
                let coords = questions;
                for (let i = 0; i < coords.length; i++) if (coords[i]) {
                    let allDots = [];
                    context.beginPath();
                    context.strokeStyle = "blue";
                    context.lineWidth = 1;
                    for (let j = 0; j < coords[i].length; j++) {
                        let b = coords[i][j];
                        if (!b) continue;
                        allDots.push({ x: b.x - PAD, y: b.y - PAD });
                        allDots.push({ x: b.x + b.w + PAD, y: b.y - PAD });
                        allDots.push({ x: b.x + b.w + PAD, y: b.y + b.h + PAD });
                        allDots.push({ x: b.x - PAD, y: b.y + b.h + PAD });
                        if ((i + "x" + j) in selected) {
                            context.stroke();
                            context.strokeStyle = "green";
                            context.lineWidth = 2;
                            context.beginPath();
                            context.rect((b.x + dx) * ar, (b.y + dy) * ar, b.w * ar, b.h * ar);
                            context.stroke();
                            context.beginPath();
                            context.strokeStyle = "blue";
                            context.lineWidth = 1;
                        } else {
                            context.rect((b.x + dx) * ar, (b.y + dy) * ar, b.w * ar, b.h * ar);
                        }
                    }
                    let hull = convexHull.makeHull(allDots);
                    allDots = [];
                    for (let i = 0; i < hull.length; i++) {
                        allDots.push(hull[i].x);
                        allDots.push(hull[i].y);
                    }
                    let bezier = dotsToBezier(allDots, 0.5);
                    if (bezier && bezier.length > 0) {
                        context.moveTo((bezier[0] + dx) * ar, (bezier[1] + dy) * ar);
                        for (let i = 2; i < bezier.length; i += 6) {
                            context.bezierCurveTo((bezier[i] + dx) * ar, (bezier[i + 1] + dy) * ar, (bezier[i + 2] + dx) * ar, (bezier[i + 3] + dy) * ar, (bezier[i + 4] + dx) * ar, (bezier[i + 5] + dy) * ar);
                        }
                    }
                    let tx = allDots[0];
                    let ty = allDots[1];
                    for (let i = 2; i < allDots.length; i += 2) {
                        if (allDots[i] < tx) tx = allDots[i];
                        if (allDots[i + 1] < ty) ty = allDots[i + 1];
                    }
                    context.fillStyle = "blue";
                    context.font = (30 * ar) + "px arial";
                    context.fillText((gcount + 1 + i) + ")", (tx + dx) * ar, (ty - 10 + dy) * ar);
                    context.stroke();
                }
            }

            function resize() {
                if (nav.current() != "edit-custom-template" || canvas.parentElement == null) { // auto unbind
                    window.removeEventListener("resize", resize);
                    return;
                }
                canvas.width = 1;
                canvas.height = 1;
                redraw();
            }

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

            let events = ["click"];

            for (let i = 0; i < events.length; i++) {
                canvas.addEventListener(events[i], (e) => {
                    if (!drawImage) return;
                    let wr = canvas.parentElement.clientWidth / drawImage.width;
                    let hr = canvas.parentElement.clientHeight / drawImage.height;
                    let ar = Math.min(wr, hr) * zoom;
                    let x = Math.round(e.offsetX / ar);
                    let y = Math.round(e.offsetY / ar);
                    if (x > drawImage.width) return;
                    if (y > drawImage.height) return;
                    eventListener(events[i], x, y, ar, e);
                });
            }

            function coordsIndex(x, y, coords) {
                let dx = 0;
                let dy = 0;
                for (let i = 0; i < coords.length; i++) {
                    if (x + dx >= coords[i].x && y + dy >= coords[i].y && x + dx <= coords[i].x + coords[i].w && y + dy <= coords[i].y + coords[i].h) return i;
                }
                return -1;
            }

            function eventListener(type, x, y, ar, e) {
                switch (type) {
                    case "click":
                        let coords = questions;
                        for (let i = 0; i < coords.length; i++) {
                            let n = coordsIndex(x, y, coords[i]);
                            if (n != -1) {
                                let k = i + "x" + n;
                                if (k in selected) {
                                    delete selected[k];
                                } else {
                                    selected[k] = true;
                                }
                                redraw();
                            }
                        }
                }
            }

            window.addEventListener("resize", resize);

            rebind(document.querySelector("#edit-custom-template .group"), "click", () => {
                let newgroup = [];
                for (let i = questions.length - 1; i >= 0; i--) {
                    for (let j = questions[i].length - 1; j >= 0; j--) {
                        let k = i + "x" + j;
                        if (k in selected) { // transfer in new group
                            newgroup.push(questions[i][j]);
                            questions[i].splice(j, 1);
                        }
                    }
                    if (questions[i].length == 0) { // remove group now left empty
                        questions.splice(i, 1);
                    }
                }
                function sortBox(a, b) {
                    if (a.y + a.h < b.y) return -1; // a completely above b
                    if (b.y + b.h < a.y) return 1; // b completely above a
                    return a.x - b.x; // on a similar horizontal line, sort by x position
                }
                // sort newgroup
                newgroup.sort(sortBox);
                // add group to questions
                questions.push(newgroup);
                // sort questions
                questions.sort((la, lb) => {
                    return sortBox(la[0], lb[0]); // sort is based on the first box of each question group
                });
                selected = {};
                redraw();
            })

            rebind(document.querySelector("#edit-custom-template .save"), "click", () => {
                template.questions = questions;
                forceRescan();
                api("project-save", project.current());
                nav.select("template");
                select(v.select());
            })

            rebind(document.querySelector("#edit-custom-template .cancel"), "click", () => {
                nav.select("template");
            })

            resize();

            api("file-image", { path: joinPath(joinPath(project.current().path, "/template"), template.filename), corners: template.corners }, (result) => {
                let image = new Image();
                image.onload = () => {
                    drawImage = image;
                    drawWait = false;
                    resize();
                };
                image.src = "data:image/jpg;base64," + result.image;
            });
        }

        return {
            forceRefresh() {
                let files = [];
                for (let i = 0; i < current.template.length; i++) files.push(current.template[i].filename);
                current.template = [];
                v.setList([]);
                update(files);
            }, customTemplateEditor, redraw() {
                v.redraw();
            }
        }
    }

    function rebind(el, event, cb) {
        let clone = el.cloneNode(true);
        el.parentElement.replaceChild(clone, el);
        clone.addEventListener(event, cb);
        return clone;
    }

    function runScansView() {
        let path = joinPath(current.path, "scans");
        let v = viewer.create(document.getElementById("scansView"));
        let listEl = document.querySelector('#scansView .leftview');
        let list = {};

        function filters() {
            return {
                ok: document.getElementById("ok").checked,
                noma: document.getElementById("noma").checked,
                pending: document.getElementById("pending").checked,
                pages: document.getElementById("pages").checked
            }
        }

        rebind(document.getElementById("ok"), "click", show);
        rebind(document.getElementById("noma"), "click", show);
        rebind(document.getElementById("pending"), "click", show);
        rebind(document.getElementById("pages"), "click", show);

        rebind(document.querySelector(".scanbuttons select"), "focusin", changeTemplateLong);
        document.querySelector(".scanbuttons select").addEventListener("change", changeTemplate);
        document.querySelector(".scanbuttons select").addEventListener("focusout", changeTemplate);

        rebind(document.querySelector(".scanbuttons .position"), "click", position);

        rebind(document.querySelector(".scanbuttons .bg"), "click", blueToGreen);
        rebind(document.querySelector(".scanbuttons .bo"), "click", blueToBlack);
        rebind(document.querySelector(".scanbuttons .ro"), "click", redToBlack);

        rebind(document.querySelector(".scanbuttons .cancel"), "click", cancel);
        rebind(document.querySelector(".scanbuttons .save"), "click", save);

        let currentImage;
        let currentScan;
        let currentTemplate;

        function select(n) {
            v.clear();
            currentImage = null;
            currentScan = null;
            let select = document.querySelector(".scanbuttons select");
            select.innerHTML = "";
            if (n == null) {
                v.redraw();
                return;
            }

            v.wait();
            v.redraw();
            let info = list[n];
            if (!info) return;

            let gcount = {};
            for (let i = 0; i < current.template.length; i++) {
                let tpl = current.template[i];
                let opt = document.createElement("OPTION");
                if (!(tpl.thisgroup in gcount)) gcount[tpl.thisgroup] = 0;
                gcount[tpl.thisgroup]++;
                opt.innerText = tpl.thisgroup + gcount[tpl.thisgroup];
                opt.value = opt.innerText;
                if (current.template[i].filename == info.template) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            }
            let count = 0;
            let tpl = null;
            for (let i = 0; i < current.template.length; i++) {
                if (current.template[i].filename == info.template) {
                    tpl = current.template[i];
                    break;
                } else {
                    if (current.template[i].thisgroup == info.group) count += current.template[i].questions.length;
                }
            }
            api("file-image", { path: joinPath(path, info.filename), corners: info.corners }, (result) => {
                let image = new Image();
                image.onload = () => {
                    currentImage = image;
                    currentScan = JSON.parse(JSON.stringify(info)); // work on deep copy
                    currentTemplate = tpl;
                    redraw();
                };
                image.src = "data:image/jpg;base64," + result.image;
            });
        }

        v.onListSelect(select);

        function redraw() {
            let info = currentScan;
            let tpl = currentTemplate;
            if (!info) return;
            v.clear();
            v.drawImage(currentImage, -info.dx || 0, -info.dy || 0);
            v.drawText(formatFilename(info.filename), 600, 50, "green");
            if ("error" in info) {
                v.drawText(info.error, 10, 320, "red");
                v.drawText(errorStrings.scan1, 10, 400, "red");
                v.drawText(errorStrings.scan2, 10, 430, "red");
                v.redraw();
                return;
            }
            for (let i = 0; i < info.noma.length; i++) {
                let p = tpl.noma[i][0];
                let c = info.noma.charAt(i);
                if (c == "_" || c == "X") continue;
                v.drawText(c, p.x, p.y - 45, "green");
            }
            for (let j = 0; j < info.noma.length; j++) {
                switch (info.noma.charAt(j)) {
                    case "_":
                    case "X":
                        v.drawCoords([tpl.noma[j]], "red");
                        break;
                    default:
                        let c = info.noma.charCodeAt(j) - 48;
                        let coords = [[tpl.noma[j][c]]];
                        v.drawCoords(coords, "green");
                }
            }
            if (current.users && (info.noma in current.users.users)) {
                v.drawText(current.users.users[info.noma], 10, 120, "green");
            }
            let g = info.group.charCodeAt(0) - 97;
            if ("group" in tpl) v.drawCoords([[tpl.group[0][g]]], "green");
            let greencoords = [];
            let bluecoords = [];
            let redcoords = [];
            for (let j = 0; j < tpl.questions.length; j++) {
                let coords = tpl.questions[j];
                // v.drawText("" + (count + j), coords[0].x - 40, coords[0].y+coords[0].h - 5, "green");
                let answer = info.answers[j];
                let fail = info.failed[j] || [];
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
            v.drawCoords([greencoords], "green");
            v.drawCoords([bluecoords], "blue");
            v.drawCoords([redcoords], "red");
            v.redraw();
        }

        function coordsIndex(x, y, coords) {
            let dx = currentScan.dx;
            let dy = currentScan.dy;
            for (let i = 0; i < coords.length; i++) {
                if (x + dx >= coords[i].x && y + dy >= coords[i].y && x + dx <= coords[i].x + coords[i].w && y + dy <= coords[i].y + coords[i].h) return i;
            }
            return -1;
        }

        function flattenAnswer(answer) {
            let flat = [];
            for (let j = 0; j < answer.length; j++) flat.push(false);
            if (answer != "99") {
                let s = answer.split("/");
                for (let j = 0; j < s.length; j++) {
                    flat[s[j].charCodeAt(0) - 97] = true;
                }
            }
            return flat;
        }

        function rebuiltAnswer(flat) {
            let o = [];
            for (let j = 0; j < flat.length; j++) {
                if (flat[j]) o.push(String.fromCharCode(j + 97));
            }
            if (o.length == 0) {
                return "99";
            } else {
                return o.join("/");
            }
        }

        v.onClick((x, y, event) => {
            let info = currentScan;
            if ("error" in info) return; // buggy
            let tpl = currentTemplate;

            // click in group => do not bother, the user needs to use the select in the toolbar because
            // we need a template along with the group. Letting the user select a group without a template,
            // will not work as the auto detection was wrong anyway.

            // click in noma ?

            for (let i = 0; i < tpl.noma.length; i++) {
                let n = coordsIndex(x, y, tpl.noma[i]);
                if (n != -1) {
                    info.noma = info.noma.substring(0, i) + String.fromCharCode(n + 48) + info.noma.substring(i + 1);
                    redraw();
                    return;
                }
            }

            // click in questions ?

            for (let i = 0; i < tpl.questions.length; i++) {
                let n = coordsIndex(x, y, tpl.questions[i]);
                if (n != -1) {
                    let f = null;
                    if (info.failed[i] && info.failed[i][n]) {
                        f = info.failed[i][n];
                        info.failed[i][n] = null; // remove fail marker
                    }
                    let flat = flattenAnswer(info.answers[i]);
                    // apply click
                    switch (f) {
                        case "maybe":
                            flat[n] = true;
                            break;
                        case "missing box":
                            flat[n] = false;
                            break;
                        default:
                            flat[n] = !flat[n];
                            break;
                    }
                    info.answers[i] = rebuiltAnswer(flat);
                    redraw();
                    return;
                }
            }
        });

        function changeTemplateLong() {
            let options = document.querySelectorAll(".scanbuttons option");
            if (options.length < current.template.length) return; // options not displayed yet
            let gcount = {};
            for (let i = 0; i < current.template.length; i++) {
                let tpl = current.template[i];
                let opt = options[i];
                if (!opt || !tpl) break;
                if (!(tpl.thisgroup in gcount)) gcount[tpl.thisgroup] = 0;
                gcount[tpl.thisgroup]++;
                opt.innerText = strings.group + " " + tpl.thisgroup + " " + strings.page + " " + gcount[tpl.thisgroup];
            }
        }

        function changeTemplateShort() {
            let options = document.querySelectorAll(".scanbuttons option");
            let gcount = {};
            for (let i = 0; i < current.template.length; i++) {
                let tpl = current.template[i];
                let opt = options[i];
                if (!opt || !tpl) break;
                if (!(tpl.thisgroup in gcount)) gcount[tpl.thisgroup] = 0;
                gcount[tpl.thisgroup]++;
                opt.innerText = tpl.thisgroup + gcount[tpl.thisgroup];
            }
        }

        function changeTemplate() {
            changeTemplateShort();
            if (currentScan == null) return;
            let path = joinPath(joinPath(current.path, "scans"), currentScan.filename);
            let tgt = document.querySelector(".scanbuttons select").value;
            let gcount = {};
            for (let i = 0; i < current.template.length; i++) {
                let tpl = current.template[i];
                if (!(tpl.thisgroup in gcount)) gcount[tpl.thisgroup] = 0;
                gcount[tpl.thisgroup]++;
                if (tpl.thisgroup + gcount[tpl.thisgroup] == tgt) {
                    // nothing really changed
                    if (currentScan.group == tpl.thisgroup && currentScan.template == tpl.filename) continue;
                    api('file-scan-fixed', { path, template: tpl, strings: fileScanStrings, corners: currentScan.corners }, (result) => {
                        delete currentScan.error; // reset eventual error
                        for (let k in result) {
                            currentScan[k] = result[k];
                        }
                        currentTemplate = tpl;
                        save(); // unfortunately, this is required for updating the whole list
                    });
                }
            }
        }

        function position() {
            if (!currentScan) return;
            nav.select("position");
            // we will run the position UI directly here

            let root = document.querySelector('#position .positionview');
            root.innerHTML = ""; // clear up
            let canvas = document.createElement("CANVAS");
            root.appendChild(canvas);
            let context = canvas.getContext("2d");
            let drawImage = null;
            let drawWait = true;
            let corners = JSON.parse(JSON.stringify(currentScan.corners));
            let zoom = 1.0;

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
                let wr = canvas.parentElement.clientWidth / drawImage.width;
                let hr = canvas.parentElement.clientHeight / drawImage.height;
                let ar = Math.min(wr, hr) * zoom;
                canvas.width = ar * drawImage.width;
                canvas.height = ar * drawImage.height;
                context.drawImage(drawImage, 0, 0, ar * drawImage.width, ar * drawImage.height);
                canvas.style.width = (drawImage.width * ar) + "px";
                canvas.style.height = (drawImage.height * ar) + "px";
                context.fillStyle = "blue";
                function drawCorner(corner, dx, dy) {
                    context.fillRect(corner.x * ar, corner.y * ar, dx * 10, dy * 4);
                    context.fillRect(corner.x * ar, corner.y * ar, dx * 4, dy * 10);
                }
                drawCorner(corners.tl, 1, 1);
                drawCorner(corners.tr, -1, 1);
                drawCorner(corners.bl, 1, -1);
                drawCorner(corners.br, -1, -1);
            }

            function resize() {
                if (nav.current() != "position" || canvas.parentElement == null) { // auto unbind
                    window.removeEventListener("resize", resize);
                    return;
                }
                canvas.width = 1;
                canvas.height = 1;
                redraw();
            }

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

            let events = ["mousedown", "leave", "mousemove", "mouseup"];

            for (let i = 0; i < events.length; i++) {
                canvas.addEventListener(events[i], (e) => {
                    if (!drawImage) return;
                    let wr = canvas.parentElement.clientWidth / drawImage.width;
                    let hr = canvas.parentElement.clientHeight / drawImage.height;
                    let ar = Math.min(wr, hr) * zoom;
                    let x = Math.round(e.offsetX / ar);
                    let y = Math.round(e.offsetY / ar);
                    if (x > drawImage.width) return;
                    if (y > drawImage.height) return;
                    eventListener(events[i], x, y, ar, e);
                });
            }

            let mode = "none";
            let ox, oy;

            function eventListener(type, x, y, ar, e) {
                if (mode == "none" && type == "mousedown") {
                    for (let k in corners) {
                        if (Math.abs(corners[k].x * ar - e.offsetX) < 10 && Math.abs(corners[k].y * ar - e.offsetY) < 10) {
                            mode = k;
                            ox = x;
                            oy = y;
                        }
                    }
                } else if (mode != "none") {
                    switch (type) {
                        case "leave":
                        case "mouseup":
                            mode = "none";
                            break;
                        default:
                            corners[mode].x += (x - ox);
                            corners[mode].y += (y - oy);
                            ox = x;
                            oy = y;
                            redraw();
                    }
                }
            }

            window.addEventListener("resize", resize);

            rebind(document.querySelector("#position .save"), "click", () => {
                for (let i = 0; i < current.template.length; i++) {
                    if (current.template[i].filename == currentScan.template) {
                        api('file-scan-fixed', { path: joinPath(path, currentScan.filename), template: current.template[i], strings: fileScanStrings, corners: corners }, (result) => {
                            delete currentScan.error; // reset eventual error
                            for (let k in result) {
                                currentScan[k] = result[k];
                            }
                            currentTemplate = current.template[i];
                            // outer save, needed to refresh list
                            save();
                            nav.select("scans");
                        });
                        return;
                    }
                }
                // if we are here, then there is no current template for this scan
                api('file-scan', { path: joinPath(path, currentScan.filename), strings: fileScanStrings, template: current.template, corners: corners }, (result) => {
                    delete currentScan.error; // reset eventual error
                    for (let k in result) {
                        currentScan[k] = result[k];
                    }

                    let tpl = null;
                    for (let i = 0; i < current.template.length; i++) {
                        if (current.template[i].filename == currentScan.template) {
                            tpl = current.template[i];
                            break;
                        }
                    }

                    currentTemplate = tpl;
                    // outer save, needed to refresh list
                    save();
                    nav.select("scans");
                    return;
                });
            })
            rebind(document.querySelector("#position .cancel"), "click", () => {
                nav.select("scans");
            })

            resize();
            api("file-original", { path: joinPath(path, currentScan.filename) }, (result) => {
                let image = new Image();
                image.onload = () => {
                    drawImage = image;
                    drawWait = false;
                    resize();
                };
                image.src = "data:image/jpg;base64," + result.image;
            });
        }

        function blueToGreen() {
            if (!currentScan) return;
            let info = currentScan;
            let tpl = currentTemplate;
            let dirty = false;
            for (let i = 0; i < tpl.questions.length; i++) {
                for (let n = 0; n < tpl.questions[i].length; n++) {
                    if (info.failed[i] && info.failed[i][n] && info.failed[i][n] == "maybe") {
                        info.failed[i][n] = null; // remove fail marker
                        let flat = flattenAnswer(info.answers[i]);
                        flat[n] = true;
                        info.answers[i] = rebuiltAnswer(flat);
                        dirty = true;
                    }
                }
            }
            if (dirty) redraw();
        }

        function blueToBlack() {
            if (!currentScan) return;
            let info = currentScan;
            let tpl = currentTemplate;
            let dirty = false;
            for (let i = 0; i < tpl.questions.length; i++) {
                for (let n = 0; n < tpl.questions[i].length; n++) {
                    if (info.failed[i] && info.failed[i][n] && info.failed[i][n] == "maybe") {
                        info.failed[i][n] = null; // remove fail marker
                        let flat = flattenAnswer(info.answers[i]);
                        flat[n] = false;
                        info.answers[i] = rebuiltAnswer(flat);
                        dirty = true;
                    }
                }
            }
            if (dirty) redraw();
        }

        function redToBlack() {
            if (!currentScan) return;
            let info = currentScan;
            let tpl = currentTemplate;
            let dirty = false;
            for (let i = 0; i < tpl.questions.length; i++) {
                for (let n = 0; n < tpl.questions[i].length; n++) {
                    if (info.failed[i] && info.failed[i][n] && info.failed[i][n] == "empty") {
                        info.failed[i][n] = null; // remove fail marker
                        let flat = flattenAnswer(info.answers[i]);
                        flat[n] = false;
                        info.answers[i] = rebuiltAnswer(flat);
                        dirty = true;
                    }
                }
            }
            if (dirty) redraw();
        }

        function cancel() {
            if (currentScan == null) return;
            for (let i = 0; i < current.scans.length; i++) {
                if (current.scans[i].filename == currentScan.filename) { // found the original
                    currentScan = JSON.parse(JSON.stringify(current.scans[i])); // redo a deep copy
                    redraw();
                    return;
                }
            }
        }

        function save(event = { ctrlKey: false }) {
            if (currentScan == null) return;
            for (let i = 0; i < current.scans.length; i++) {
                if (current.scans[i].filename == currentScan.filename) { // found the original
                    let fn = currentScan.filename;
                    // update the original
                    current.scans[i] = JSON.parse(JSON.stringify(currentScan));
                    // refresh failed and errors count;
                    let errors = 0;
                    let failed = current.scans[i].failed;
                    for (let k in failed) {
                        for (let kk in failed[k]) {
                            if (!failed[k][kk]) {
                                delete failed[k][kk];
                            } else {
                                errors++;
                            }
                        }
                        if (!failed[k] || Object.keys(failed[k]).length == 0) delete failed[k];
                    }
                    current.scans[i].errors = errors;
                    // save the udpated version
                    api("project-save", current);
                    // reset the left list
                    let files = [];
                    for (let i = 0; i < current.scans.length; i++) {
                        files.push(current.scans[i].filename);
                    }
                    if (event.ctrlKey == true) select(null); // prevent auto selection
                    update(files);
                    // find the item in the left list and select it
                    for (let k in list) {
                        if (list[k].filename == fn) {
                            v.select(k);
                            select(k);
                            break;
                        }
                    }
                    redraw();
                    if (event.ctrlKey == true) {
                        all = [...listEl.querySelectorAll("li")];
                        if (all.length > 0) {
                            let event = e = document.createEvent("MouseEvents");
                            event.initEvent("click", true, true);
                            all[0].dispatchEvent(event, true);
                        }
                    }
                    return;
                }
            }
            if (cb) cb();
        }

        function update(files) {
            // diff current.scans with list
            let l = {};
            let dirty = false;
            // remove scans not needed anymore
            for (let i = current.scans.length - 1; i >= 0; i--) {
                if (files.indexOf(current.scans[i].filename) == -1) {
                    current.scans.splice(i, 1);
                    dirty = true;
                }
            }

            if (dirty) {
                api("project-save", current);
            }

            for (let i = 0; i < current.scans.length; i++) l[current.scans[i].filename] = current.scans[i];
            let needsScan = [];

            for (let i = 0; i < files.length; i++) {
                if (!(files[i] in l)) {
                    needsScan.push(files[i]);
                }
            }

            if (needsScan.length > 0) {
                /* hide the list */
                v.setList([]);
                /* show the button */
                let ss = document.getElementById("startscans");
                let but = ss.querySelector("button");
                ss.style.display = "initial";
                let clone = but.cloneNode(true);
                ss.replaceChild(clone, but);
                document.querySelector("#scans .filters").style.display = "none";
                document.querySelector("#scans .scanview").style.display = "none";
                clone.addEventListener("click", () => {
                    let lock = lockDisplay(strings.updatingScans);
                    lock.length(needsScan.length);
                    let idx = 0;
                    function loop() {
                        if (idx >= needsScan.length) {
                            api("project-save", current);
                            lock.destroy();
                            show();
                        } else {
                            api("file-scan", { path: joinPath(path, needsScan[idx++]), template: current.template, strings: fileScanStrings }, (r) => {
                                lock.progress(idx);
                                if (r) current.scans.push(r);
                                setTimeout(loop, 1); // give a chance for the UI to update itself in case of resize etc
                            }, loop);
                        }
                    }
                    loop();
                });
            } else {
                show();
            }
        }

        function show() {
            function count(w) {
                let t = 0;
                for (let k in w) t += w[k].length;
                return t;
            }
            document.querySelector("#scans .filters").style.display = "block";
            document.querySelector("#scans .scanview").style.display = "flex";
            document.querySelector("#startscans").style.display = "none";
            let s = splitScans();
            document.querySelector('label[for="ok"] span').innerText = count(s.ok);
            document.querySelector('label[for="pending"] span').innerText = count(s.pending);
            document.querySelector('label[for="noma"] span').innerText = count(s.noma);
            document.querySelector('label[for="pages"] span').innerText = count(s.pages);
            let f = filters();
            list = toList(s, f, currentScan);
            v.setList(Object.keys(list));
            if (v.select()==null) {
                v.select(0); // force select first item
                if (v.select() != null) {
                    select(v.select());
                }
            }
        }

        api.push("directory-watch", path, update);

        nav.onKeypress("scans", (e) => {
            let el, all, idx;
            switch (e.key) {
                case "ArrowDown":
                    el = listEl.querySelector(".selected");
                    all = [...listEl.querySelectorAll("li")];
                    if (el == null) {
                        idx = -1;
                    } else {
                        idx = all.indexOf(el);
                    }
                    idx++;
                    if (idx < all.length) {
                        let event = e = document.createEvent("MouseEvents");
                        event.initEvent("click", true, true);
                        all[idx].dispatchEvent(event, true);
                    }
                    break;
                case "ArrowUp":
                    el = listEl.querySelector(".selected");
                    all = [...listEl.querySelectorAll("li")];
                    if (el == null) {
                        idx = all.length;
                    } else {
                        idx = all.indexOf(el);
                    }
                    idx--;
                    if (idx >= 0) {
                        let event = e = document.createEvent("MouseEvents");
                        event.initEvent("click", true, true);
                        all[idx].dispatchEvent(event, true);
                    }
                    break;
                case "Home":
                    all = [...listEl.querySelectorAll("li")];
                    if (all.length > 0) {
                        let event = e = document.createEvent("MouseEvents");
                        event.initEvent("click", true, true);
                        all[0].dispatchEvent(event, true);
                    }
                    break;
                case "End":
                    all = [...listEl.querySelectorAll("li")];
                    if (all.length > 0) {
                        let event = e = document.createEvent("MouseEvents");
                        event.initEvent("click", true, true);
                        all[all.length - 1].dispatchEvent(event, true);
                    }
                    break;
                case "Escape":
                    cancel();
                    break;
                case "s":
                    save(e);
                    break;
            }
        });

        return {
            reset() {
                let files = [];
                for (let i = 0; i < current.scans.length; i++) {
                    files.push(current.scans[i].filename);
                }
                if (files.length > 0) {
                    current.scans = [];
                    v.clear();
                    update(files);
                }
            },
            redraw() {
                return v.redraw();
            }
        }
    }

    function toList(s, f, currentScan) {
        list = {};
        // insert in list object
        let gcount = {};
        let pageMap = {};
        for (let i = 0; i < current.template.length; i++) {
            let g = current.template[i].thisgroup;
            if (!(g in gcount)) gcount[g] = 0;
            gcount[g]++;
            pageMap[current.template[i].filename] = g + gcount[g];
        }
        function add(sub, suffix, force) {
            for (let noma in sub) {
                for (let i = 0; i < sub[noma].length; i++) {
                    if (force || sub[noma][i].filename == currentScan?.filename) {
                        let k = noma + "&nbsp;" + (pageMap[sub[noma][i].template] || "") + "&nbsp;" + suffix;
                        if (k in list) { // conflict, first one becomes xxx(1) and this one becomes yyy(2)
                            list[k + "(1)"] = list[k];
                            delete list[k];
                            k = k + "(2)";
                        } else if ((k + "(1)") in list) {
                            let c = 2;
                            while ((k + "(" + c + ")") in list) c++;
                            k = k + "(" + c + ")";
                        }
                        list[k] = sub[noma][i];
                    }
                }
            }
        }

        add(s.errors, "&#x274C;", true);
        add(s.noma, "?", f.noma);
        add(s.pending, "&#x1F50E;&#xFE0E;", f.pending);
        add(s.pages, "&#x1F4D6;", f.pages);
        add(s.ok, "&check;", f.ok);
        return list;
    }

    function hasErrors() {
        for (let i = 0; i < current.scans.length; i++) {
            let scan = current.scans[i];
            for (let k in scan.failed) {
                for (let kk in scan.failed[k]) {
                    if (scan.failed[k][kk] && scan.failed[k][kk] != "empty") {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function open(proj) {
        if ("path" in current) {
            let sep = (current.path.indexOf('/') != -1) ? "/" : "\\";
            api("directory-unwatch", current.path + sep + "template");
            api("directory-unwatch", current.path + sep + "scans");
            api.clear();
            let views = document.getElementsByClassName("scanview");
            for (let i = 0; i < views.length; i++) {
                views[i].innerHTML = ""; // clear these dynamic views
            }
        }
        api("project-load", proj, (p) => {
            current = p;
            setNav();
            if ("path" in current) {
                if (!("template" in current)) {
                    current.template = [];
                }
                if (!("scans" in current)) {
                    current.scans = [];
                }
                if (("template" in current) && current.template.length > 0) {
                    if (("scans" in current) && current.scans.length > 0 && !hasErrors()) {
                        nav.select("export");
                    } else {
                        nav.select("scans");
                    }
                } else {
                    nav.select("template");
                }
                function toText(txt) {
                    let div = document.createElement("DIV");
                    div.innerText = txt;
                    return div.innerHTML;
                }
                let sep = (current.path.indexOf('/') != -1) ? "/" : "\\";
                document.getElementById("templateDirectory").innerHTML = "&#128193; " + toText(current.path + sep + "template");
                document.getElementById("scansDirectory").innerHTML = "&#128193; " + toText(current.path + sep + "scans");
                document.getElementById("exportDirectory").innerHTML = "&#128193; " + toText(current.path + sep + "export");
                let scan = runScansView();
                redrawScan = scan.redraw;
                let tplView = runTemplateView(scan.reset);
                forceRefresh = tplView.forceRefresh;
                customTemplateEditor = tplView.customTemplateEditor;
                redrawTemplate = tplView.redraw;
            }
        }, (e) => {
            alert(e.responseText);
        });
    }

    function splitScans() {
        /* corrections is a list of
        * {file:"",noma:"", group:"", corners:[{x,y},{x,y},{x,y},{x,y}], answers:[{i:0,v:"a"}]} 
        * noma => noma correction, group => group correction
        * corners => corners correction
        * answers => answers correction
        */

        let scans = current.scans;
        let template = current.template;

        let groups = [];
        for (let i = 0; i < template.length; i++) {
            groups.push(template[i].thisgroup);
        }

        let ok = {};
        let noma = {};
        let pending = {};
        let pages = {};
        let errors = {};

        function addScan(scan, where) {
            if (!(scan.noma in where)) where[scan.noma] = [];
            where[scan.noma].push(scan);
        }

        for (let i = 0; i < scans.length; i++) {
            let scan = scans[i];
            if ("error" in scan) {
                addScan(scan, errors);
            } else if (scan.noma.indexOf("_") != -1 || scan.noma.indexOf("X") != -1) {
                addScan(scan, noma);
            } else if (groups.indexOf(scan.group) == -1) {
                addScan(scan, pending);
            } else {
                // a scan is correct if there are no errors
                let allright = true;
                outer: for (let k in scan.failed) {
                    for (let kk in scan.failed[k]) {
                        if (scan.failed[k][kk] && scan.failed[k][kk] != "empty") { // empty boxes are not user correctable
                            allright = false;
                            break outer;
                        }
                    }
                }
                if (allright) {
                    addScan(scan, ok);
                } else {
                    addScan(scan, pending);
                }
            }
        }

        let gcount = {};
        let pageMap = {};
        for (let i = 0; i < current.template.length; i++) {
            let g = current.template[i].thisgroup;
            if (!(g in gcount)) gcount[g] = 0;
            gcount[g]++;
            pageMap[current.template[i].filename] = g + gcount[g];
        }

        for (let noma in ok) { // allowed to stay in ok iff all the pages are there
            let g = ok[noma][0].group;
            let accept = ok[noma].length == gcount[g];
            if (accept) {
                // all scans for this noma belongs to the same group
                for (let i = 1; i < ok[noma].length; i++) {
                    if (ok[noma][i].group != g) {
                        accept = false;
                        break;
                    }
                }
                // all templates for this norma are different
                for (let i = 0; i < ok[noma].length - 1; i++) {
                    for (let j = i + 1; j < ok[noma].length; j++) {
                        if (ok[noma][i].template == ok[noma][j].template) {
                            accept = false;
                            break;
                        }
                    }
                }
            }

            if (!accept) {
                pages[noma] = ok[noma];
                delete ok[noma];
            } else {
                // sort pages
                ok[noma].sort((a, b) => {
                    return pageMap[a.template].localeCompare(pageMap[b.template]);
                });
            }

        }

        return {
            ok,
            noma,
            pending,
            pages,
            errors
        }
    }

    function setNav() {
        nav.disableAll();
        if ("path" in current) {
            nav.enable("template", true);
            if (("template" in current) && current.template.length > 0) {
                nav.enable("scans", true);
                nav.enable('export', true);
            }
        }
    }

    function prepareExport(filename) {
        let path = joinPath(joinPath(current.path, "export"), filename);
        let ss = splitScans();
        ss.errors = []; // remove these scans as we cannot use them correctly
        let lines = toList(ss, { ok: true, noma: true, pending: true, pages: true });
        let indexes = {};
        let gcount = {};
        for (let i = 0; i < current.template.length; i++) {
            let g = current.template[i].thisgroup;
            if (!(g in gcount)) gcount[g] = 1;
            indexes[current.template[i].filename] = gcount[g];
            gcount[g] += current.template[i].questions.length;
        }
        let ret = { path, indexes, lines, strings: exportStrings };
        if ("users" in current) ret.users = current.users.users;
        return ret;
    }

    function runTemplateEditor(root) {
        root.innerHTML = "";
        let groups = {};
        for (let i = 0; i < current.template.length; i++) {
            let g = current.template[i].thisgroup;
            if (!(g in groups)) {
                groups[g] = [];
            }
            for (let j = 0; j < current.template[i].questions.length; j++) {
                groups[g].push(current.template[i].questions[j].length);
            }
        }
        if (Object.keys(groups).length == 0) groups["a"] = [2]; // ensure at least a group with a line of two boxes
        let grouplist = document.getElementById("grouplist");
        grouplist.innerHTML = "";
        for (let k in groups) {
            let option = document.createElement("OPTION");
            option.setAttribute("value", k);
            option.innerText = strings.group + " " + k;
            grouplist.appendChild(option);
        }
        let option = document.createElement("OPTION");
        option.setAttribute("value", "new");
        option.innerText = strings.addGroup;
        grouplist.appendChild(option);
        grouplist = rebind(grouplist, 'change', changeGroup);

        let groupLetter = "abcdef";

        function changeGroup() {
            let v = grouplist.value;
            if (v == "new") {
                for (let i = 0; i < groupLetter.length; i++) {
                    if (!(groupLetter[i] in groups)) {
                        groups[groupLetter[i]] = [2];
                        let option = document.createElement("OPTION");
                        option.setAttribute("value", groupLetter[i]);
                        option.innerText = strings.group + " " + groupLetter[i];
                        grouplist.insertBefore(option, grouplist.querySelector("option:checked"));
                        grouplist.value = groupLetter[i];
                        select(grouplist.value);
                        return;
                    }
                }
                grouplist.value = grouplist.querySelector("option:first-child").value;
                select(grouplist.value);
                return;
            }
            select(v);
        };

        function getBoxes(n) {
            let l = [];
            for (let j = 0; j < n; j++) {
                l.push('<span class="boxed">' + String.fromCharCode(j + 97) + "</span>&nbsp;");
            }
            return l.join("");
        }

        function select(group) {
            root.innerHTML = "";
            let table = document.createElement('TABLE');
            let tbody = document.createElement('TBODY');
            root.appendChild(table);
            table.appendChild(tbody);
            function genTR(i) {
                let tr = document.createElement("TR");
                let td = document.createElement("TD");
                td.innerText = (i + 1) + ")";
                tr.appendChild(td);
                td = document.createElement("TD");
                tr.appendChild(td);
                td.innerHTML = getBoxes(groups[group][i]);
                td = document.createElement("TD");
                tr.appendChild(td);
                td.innerHTML = '<button class="delBox">- &#9744;</button> <button class="addBox">+ &#9744;</button> <button class="delLine">' + strings.delete + '</button> <button class="addLine">' + strings.copy + '</button>';
                return tr;
            }
            for (let i = 0; i < groups[group].length; i++) {
                tbody.appendChild(genTR(i));
            }
            function refreshCounts() {
                let trs = tbody.childNodes;
                for (let i = 0; i < trs.length; i++) {
                    trs[i].querySelector("td:first-child").innerText = (i + 1) + ")";
                }
            }

            table.addEventListener('click', (e) => {
                if (e.target.tagName == "BUTTON") {
                    let tr = e.target.parentElement.parentElement;
                    let group = grouplist.value;
                    let index = [...tbody.childNodes].indexOf(tr);
                    switch (e.target.classList[0]) {
                        case "addBox":
                            if (groups[group][index] < 10) {
                                groups[group][index]++;
                                tr.querySelector("td:first-child + td").innerHTML = getBoxes(groups[group][index]);
                            }
                            break;
                        case "delBox":
                            if (groups[group][index] > 2) {
                                groups[group][index]--;
                                tr.querySelector("td:first-child + td").innerHTML = getBoxes(groups[group][index]);
                            }
                            break;
                        case "delLine":
                            if (groups[group].length > 1) {
                                tbody.removeChild(tr);
                                groups[group].splice(index, 1);
                                refreshCounts();
                            }
                            break;
                        case "addLine":
                            groups[group].splice(index, 0, groups[group][index]);
                            let ntr = genTR(index);
                            tbody.insertBefore(ntr, tr);
                            refreshCounts();
                            break;
                    }
                }
            });
        }

        if (Object.keys(groups).length > 0) {
            select(Object.keys(groups)[0]);
        }


        function save() {
            api('template-create', { path: current.path, groups, strings: customTemplateStrings }, () => {
                nav.select("template");
//                forceRefresh();
            }, (e) => { alert(e.message); });
        }

        rebind(document.querySelector(".templatebuttons .save"), "click", save);

        rebind(document.querySelector(".templatebuttons .cancel"), "click", () => {
            nav.select("template");
        })

        nav.onKeypress("edit-template", (e) => {
            switch (e.key) {
                case "Escape":
                    nav.select("template");
                    break;
                case "s":
                    if (e.ctrlKey == true && e.shiftKey == false && e.altKey == false) {
                        save();
                    }
                    break;
            }
        });
    }

    return {
        open,
        current() {
            return current;
        },
        setNav,
        hasErrors,
        exportCSV() {
            let lock = lockDisplay(exportStrings.running);
            setTimeout(() => {
                let r = prepareExport("results.csv");
                r.separator = ";";
                api('export-csv', r, lock.destroy, lock.destroy);
            }, 100);
        },
        exportCSVComma() {
            let lock = lockDisplay(exportStrings.running);
            setTimeout(() => {
                let r = prepareExport("results.csv");
                r.separator = ",";
                api('export-csv', r, lock.destroy, lock.destroy);
            }, 100);
        },
        exportExcel() {
            let lock = lockDisplay(exportStrings.running);
            setTimeout(() => {
                let r = prepareExport("results.xlsx");
                r.images = false;
                api('export-excel', r, lock.destroy, lock.destroy);
            }, 100);
        },
        exportExcelImages() {
            let lock = lockDisplay(exportStrings.running);
            setTimeout(() => {
                let r = prepareExport("resultsImages.xlsx");
                r.images = true;
                r.template = current.template;
                api('export-excel', r, lock.destroy, lock.destroy);
            }, 100);
        },
        exportMoodle() {
            let lock = lockDisplay(exportStrings.running);
            let r = prepareExport("dummy");
            let keys = Object.keys(r.lines);
            let templates = {};
            for (let i = 0; i < current.template.length; i++) templates[current.template[i].filename] = current.template[i];
            lock.length(keys.length);
            // loop through setTimeouts so that the browser has a chance to refresh the display
            function loop(i) {
                if (!(i < keys.length)) {
                    lock.destroy();
                    return;
                }
                lock.progress(i);
                let scan = r.lines[keys[i]];
                api("clear-scan", { path: current.path, scan, template: templates[scan.template] },
                    () => { setTimeout(() => { loop(i + 1) }, 1); }, // leave a bit of time for the ui to refresh for example if the window is resized
                    () => { loop(i + 1); });
            }
            setTimeout(() => loop(0), 100);
        },
        exportMoodleZip() {
            let lock = lockDisplay(exportStrings.running);
            let r = prepareExport("dummy");
            let keys = Object.keys(r.lines);
            let templates = {};
            for (let i = 0; i < current.template.length; i++) templates[current.template[i].filename] = current.template[i];
            lock.length(keys.length);
            // loop through setTimeouts so that the browser has a chance to refresh the display
            function loop(i) {
                if (!(i < keys.length)) {
                    lock.destroy();
                    lock = lockDisplay(exportStrings.createZip);
                    api("export-zipjpg", { path: joinPath(current.path, "export") }, () => {
                        api("export-deletejpg", { path: joinPath(current.path, "export") }, lock.destroy, lock.destroy);
                    }, () => {
                        alert(errorStrings.createZip);
                        lock.destroy();
                    });
                    return;
                }
                lock.progress(i);
                let scan = r.lines[keys[i]];
                api("clear-scan", { path: current.path, scan, template: templates[scan.template] },
                    () => { setTimeout(() => { loop(i + 1) }, 1); }, // leave a bit of time for the ui to refresh for example if the window is resized
                    () => { loop(i + 1); });
            }
            api("export-deletejpg", { path: joinPath(current.path, "export") }, () => {
                api("export-deletezip", { path: joinPath(current.path, "export") }, () => {
                    loop(0);
                }, () => {
                    alert(errorStrings.deleteZip);
                });
            }, () => {
                alert(errorStrings.deleteImages);
            });
        },
        exportMoodleXML() {
            let lock = lockDisplay(exportStrings.running);
            setTimeout(() => {
                let r = prepareExport("moodle.xml");
                delete r.lines;
                r.template = current.template;
                api('export-moodlexml', r, lock.destroy, lock.destroy);
            }, 100);
        },
        runTemplateEditor
    }
})();


nav.addSelectEvent((panel) => {
    document.querySelector('a[data-id="edit-template"]').style.display = (panel == "edit-template" ? "inline" : "none");
    document.querySelector('a[data-id="edit-custom-template"]').style.display = (panel == "edit-custom-template" ? "inline" : "none");
    document.querySelector('a[data-id="position"]').style.display = (panel == "position" ? "inline" : "none");
    let templates = project.current().template;
    switch (panel) {
        case "export":
            if (templates.length == 0) {
                nav.select("template");
                return;
            }
            document.querySelector(".hasErrors").style.display = "block";
            if (!project.hasErrors()) {
                document.querySelector(".hasErrors").style.display = "none";
            }
            switch (project.current().template[0].type) {
                case "custom":
                case "grid":
                    document.getElementById("exportMoodle").style.display = "none";
                    document.getElementById("exportMoodleZip").style.display = "none";
                    break;
                default:
                    document.getElementById("exportMoodle").style.display = "block";
                    document.getElementById("exportMoodleZip").style.display = "block";
                    break;
            }
            break;
        case "template":
            if (redrawTemplate) redrawTemplate();
            if (templates.length == 0) {
                document.getElementById("template-edit-button").style.display = "inline-block";
            } else {
                document.getElementById("template-edit-button").style.display = "none";
                let type = templates[0].type;
                for (let i = 1; i < templates.length; i++) {
                    if (type != templates[i].type) {
                        alert(errorStrings.mixedTemplates);
                        return;
                    }
                }
                if (type == "grid" || type == "custom") {
                    document.getElementById("template-edit-button").style.display = "inline-block";
                }
            }
            break;
        case "edit-template":
            project.runTemplateEditor(document.querySelector("#edit-template .editor"));
            break;
        case "scans":
            if (redrawScan) redrawScan();
            break;
    }
});

nav.select("project");

document.getElementById("openProject").addEventListener('click', () => {
    api("project-open", null, (dir) => {
        if (dir != null) project.open(dir);
    });
});

document.getElementById("templateDirectory").addEventListener('click', (e) => {
    let c = project.current();
    if ("path" in c) {
        api("directory-open", e.target.innerText.substring(e.target.innerText.indexOf(' ') + 1));
    }
});

document.getElementById("scansDirectory").addEventListener('click', (e) => {
    let c = project.current();
    if ("path" in c) {
        api("directory-open", e.target.innerText.substring(e.target.innerText.indexOf(' ') + 1));
    }
});

document.getElementById("exportDirectory").addEventListener('click', (e) => {
    let c = project.current();
    if ("path" in c) {
        api("directory-open", e.target.innerText.substring(e.target.innerText.indexOf(' ') + 1));
    }
});

document.getElementById("exportMoodle").addEventListener('click', project.exportMoodle);
document.getElementById("exportMoodleZip").addEventListener('click', project.exportMoodleZip);
document.getElementById("exportMoodleXML").addEventListener('click', project.exportMoodleXML);
document.getElementById("exportCSV").addEventListener('click', project.exportCSV);
document.getElementById("exportCSVComma").addEventListener('click', project.exportCSVComma);
document.getElementById("exportExcel").addEventListener('click', project.exportExcel);
document.getElementById("exportExcelImages").addEventListener('click', project.exportExcelImages);
document.getElementById("exportExcelImages").addEventListener('click', project.exportExcelImages);
document.getElementById("template-edit-button").addEventListener('click', () => {
    if (project.current().template.length == 0) {
        let diag = dialog({
            title: customTemplateStrings.editTemplate, content: customTemplateStrings.editTemplatePickAChoice,
            buttons: {
                [customTemplateStrings.editTemplateChoice1]: function () {
                    diag.destroy();
                    diag = dialog({
                        title: customTemplateStrings.editTemplateMoodleTitle,
                        content: customTemplateStrings.editTemplateMoodle,
                        buttons: {
                            "Ok"() {
                                diag.destroy();
                            }
                        }
                    });
                },
                [customTemplateStrings.editTemplateChoice2]: function () {
                    diag.destroy();
                    nav.select("edit-template");
                },
                [customTemplateStrings.editTemplateChoice3]: function () {
                    diag.destroy();
                    diag = dialog({
                        title: customTemplateStrings.editTemplateCustomTitle,
                        content: customTemplateStrings.editTemplateCustom,
                        buttons: {
                            [strings.continue]: function () {
                                api("template-custom-copy", {
                                    path: joinPath(project.current().path, "/template"),
                                    lang: location.href.substring(location.href.length - 7, location.href.length - 5)
                                }, () => {
                                    diag.destroy();
                                }, (e) => {
                                    alert(e);
                                    diag.destroy();
                                });
                            },
                            [strings.cancel]: function () {
                                diag.destroy();
                            }
                        }
                    });
                },
                [strings.cancel]: function () {
                    diag.destroy();
                }
            }
        });
    } else {
        switch (project.current().template[0].type) {
            case "grid":
                nav.select("edit-template");
                break;
            case "custom":
                customTemplateEditor();
                break;
        }
    }
});

project.setNav();