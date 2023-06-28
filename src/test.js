const fs = require("fs");
let file = process.argv.length > 2 ? process.argv[2] : "D:\\ICHEC\\Tests\\examenblancs\\scans\\BRW405BD82617BE_005300.pdf";
console.log(file);
console.log(JSON.stringify(fs.statSync(file)));

fs.open(file, 'r', function (status, fd) {
    if (status) {
        console.log(status.message);
        return;
    }
    var buffer = Buffer.alloc(10000);
    let tgt=Buffer.from("/Count");
    let count = 0;
    function loop(start) {
        fs.read(fd, buffer, 0, 10000, start, function (err, num) {
            if (err == null) {
                if (buffer.includes(tgt)) {
                    let s = buffer.toString('utf8', 0, num);
                    /*                let idx=s.indexOf('55');
                                    if (idx!=-1) {
                                        console.log(s);
                                        count++;
                                        if (count>5) return;
                                    }*/
                    idx = s.indexOf('/Count ');
                    if (idx != -1) {
                        let idx2=s.indexOf('\n',idx);
                        if (idx2!=-1) {
                            console.log(parseInt(s.substring(idx+7,idx2)));
                            return;    
                        }
                    }    
                }
                loop(start + 10000);
            }
        });
    }
    loop(0);
});