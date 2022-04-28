# easyOMR
Please see the ![Wiki](https://github.com/GrolauxDonatien/easyOMR/wiki) to access the user manual.

Optical Mark Recognition made easy for teachers. With easyOMR, it is easy to create answer forms for OMR recognition, import and correct the scanned results from the students, and export everything to Excel for grading. easyOMR can work hand in hand with Moodle Offline Quizz module, or just stand-alone with no Moodle required at all.

![easyOMR screenshot](https://github.com/GrolauxDonatien/easyOMR/blob/main/screenshot.png?raw=true)

The https://moodle.org/plugins/mod_offlinequiz module of Moodle adds paper-and-pencil multiple-choice quizzes to Moodle. This module is able to create response grids specific to custom questionnaires, and students' answer forms are evaluated and graded automatically. 

However, a human intervention is required to ensure the scans are processed correctly, and unfortunately this module suffers from performance and stability issues for large group of students and multi-page forms. 

easyOMR replaces this process by offering a streamlined UI for the quick and easy manual correction of the scanned results, and generate clean scans that can then be imported into Moodle with no further manual intervention required.

However, easyOMR is not limited to working with Moodle. You can also use it alone to quickly create response forms, process the scans from the students' answers, and export the results to Excel. The generated Excel sheet provides an auto-grading solution where you set the points for each questions, and the points are calculated automatically for each student. Alternatively, you also have the opportunity to create your own form using Word, mixing questions and answers, and easyOMR can then process it as usual.

![easyOMR workflows](https://github.com/GrolauxDonatien/easyOMR/blob/main/workflow.png?raw=true)

easyOMR is an Electron application, using opencv for OMR. It is currently translated into English and French. To run in French, add `--lang=fr` to the command line.
You are welcome to contribute other languages. Let XX be the 2 character ISO standard for the new language:
- copy www/index-en.html to www/index-XX.html and translate every strings in the file, including HTML and JavaScript.
- copy resources/template-en.docx to resources/template-XX.docx. Once the file is translated, print it to PDF to create resources/template-XX.pdf.
