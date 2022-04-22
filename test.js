const omr=require("./omr");
const cv=omr.utils.cv;
let project="hd2022project";
//project="tproject";
project="ingeproject";
let tmpl=omr.templater.processTemplate(project);
let results=omr.checker.getResults(project,tmpl);
omr.checker.createImageResults(project,tmpl,results);
debugger;
