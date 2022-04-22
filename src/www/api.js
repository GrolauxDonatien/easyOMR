// AJAX version
/*        function api(action, data, callback = () => { }, error = () => { }) {
            let payload = { action: action };
            if (data !== undefined) payload.data = data;
            fetch("api", {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json'
                }
            }).then(res => res.json())
                .then(response => { if (callback) callback(response); })
                .catch(error => console.error('Error:', error));
        }*/

// Electron version

const electron = require('electron');

let ajaxid = 0;
let ajaxcallbacks = [];

function api(action, data, callback = () => { }, error = () => { }) {
    ajaxid++;
    ajaxcallbacks[ajaxid] = { success: callback, error: error };
    electron.ipcRenderer.send("ajax-message", { id: ajaxid, data, action });
}

api.push = function (action, data, callback = () => { }, error = () => { }) {
    ajaxid++;
    ajaxcallbacks[ajaxid] = { type: "push", success: callback, error: error };
    electron.ipcRenderer.send("ajax-message", { id: ajaxid, type: "push", data, action });
}

api.clear = function () {
    // clear push type notifications
    for (let k in ajaxcallbacks) {
        if (ajaxcallbacks[k].type == "push") delete ajaxcallbacks[k];
    }
}

electron.ipcRenderer.on('ajax-reply', (event, response) => {
    let config = ajaxcallbacks[response.id];
    if (config === undefined) return;
    if (config.type != "push") {
        delete ajaxcallbacks[response.id];
    }
    if ("error" in response) {
        config.error({ responseText: response.error }, 500, response.error);
    } else if ("success" in response) {
        config.success(response.success);
    } else {
        console.log("Ignoring message:");
        console.info(reponse);
    }
});