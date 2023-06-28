Input : yes & no folders containing 40x40 color jpg of ticked and unticked boxes

pip cannot install tensorflow by itself, solution is miniconda : https://gist.github.com/soleares/8e01f16c6a3c6f0a9f7f1e1acf312f34
to convert model to JS, tensorflowjs is required. It is not available in conda,
however 'pip install tensorflowjs' works in conda virtual environment

Step 1:
    -> create training sets using the trainingdata.js script: .\node_modules\.bin\electron.cmd . trainingdata project_directory .\tensorflow\train
        hint: do this for several projects into different target directories, and merge the result togethor into .\tensorflow\train\(yes/no)
    -> split no into the full/no sets using the split.js script: .\node_modules\.bin\electron.cmd . split .\tensorflow\train
    -> *manually* check the purity of each set (yes/no/full).
        the predict.js script can help: .\node_modules\.bin\electron.cmd . predict .\tensorflow\train\no (yes/full)
        this will create excel sheets for all images with predictions from tensorflow and opencv. This can help identify errors.
        the count.js script can also help to split no into no/full: .\node_modules\.bin\electron.cmd . count .\tensorflow\train\no
        this will rename files by prefixing the count on non zero pixels. By sorting the files, it becomes easy to catch errors.

Step 2:
    run prep.py
    - process each file, contrast 150%, to grayscale (disabled, sample images are already preprocessed by easyOMR)
    -> split in test_images and train_images

Step 3:
    https://www.tensorflow.org/datasets/add_dataset
    activate conda environment
    in train directory, if there is no omrset subdirectory :
        tfds new omrset
        cd omrset
        configure omrset.py :
            'image': tfds.features.Image(shape=(40, 40, 1)),
            'label': tfds.features.ClassLabel(names=['no', 'yes', 'full']),
            comment dl_manager.download_and_extract,
            set     logging.warning(os.path.abspath(Path() / '..' /'..' / 'train' / 'train_images'))
                    return {
                        'train': self._generate_examples(Path() / '..' / '..' /'train' / 'train_images'),
                        'test': self._generate_examples(Path() / '..' / '..' /'train' / 'test_images'),
                    }
            at the very end: 'label': f.name.split("_")[0]

    in train/omrset directory, run
    if it exists, delete directory \Users\XXX\tensorflow_datasets\omrset
    tfds build
    => creates the dataset in \Users\XXX\tensorflow_datasets\omrset

Step 4:
    exit conda environment, it does not want to see the custom omrset data, however regular python does work fine
    https://www.tensorflow.org/datasets/keras_example
    python omrtrain.py
    -> trains the model and creates a file omr.ckpt.XXXXX

Step 5:
    activate conda environment
    run tojs.py to export the model for JavaScript

Step 6:
    Copy back group1-shard1of1.bin and model.json to the resources folders
    set flag CREATETRAINDATA to false in omr.js
    -> defaults the omr recognition to tensorflow, using the trained data

Step 7:
    Find acceptable thresholds for tick and untick in omr.js :
    
    let thresholdYes1 = 1500;
    let thresholdYes2 = -4500;
    let thresholdNo1 = -3000;
    let thresholdNo2 = -6000;

    uncomment line 
    cv.imwrite(`maybe_${yes1}_${res[i*2+1]}_${yes2}_${res[i*2]}.jpg`,images[i]);

    make a run, check images and decide the thresholds you are comfortable with
