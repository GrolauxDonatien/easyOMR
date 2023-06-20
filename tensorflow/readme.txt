Input : yes & no folders containing 40x40 color jpg of ticked and unticked boxes

pip cannot install tensorflow by itself, solution is miniconda : https://gist.github.com/soleares/8e01f16c6a3c6f0a9f7f1e1acf312f34
to convert model to JS, tensorflowjs is required. It is not available in conda,
however 'pip install tensorflowjs' works in conda virtual environment

Step 1:
    set flag CREATETRAINDATA to true in omr.js
    -> defaults the omr recognition to an opencv algorithm
    Run some recognition
    -> this will create categorized images into tensorflow/train/[yes/no/empty/maybe/accuracy]

Step 2:
    run prep.py
    - process each file, contrast 150%, to grayscale (disabled, sample images are already preprocessed by easyOMR)
    -> split in test_images and train_images

Step 3:
    https://www.tensorflow.org/datasets/add_dataset
    in train directory, if there is no omrset subdirectory :
        tfds new omrset
        cd omrset
        configure omrset.py :
            'image': tfds.features.Image(shape=(40, 40, 1)),,
            comment dl_manager.download_and_extract,
            set     logging.warning(os.path.abspath(Path() / '..' /'..' / 'train' / 'train_images'))
                    return {
                        'train': self._generate_examples(Path() / '..' / '..' /'train' / 'train_images'),
                        'test': self._generate_examples(Path() / '..' / '..' /'train' / 'test_images'),
                    }
            at the very end: 'label': 'yes' if f.name.startswith('yes_') else 'no'

    in train/omrset directory, run
    tfds build
    => creates the dataset in \Users\XXX\tensorflow_datasets\omrset

Step 4:
    https://www.tensorflow.org/datasets/keras_example
    run omrtrain.py # for reasons I could not figure out, this would not run from a prompt in the conda virtual environment, but would run from pycharm
    -> trains the model and creates a file omr.ckpt.XXXXX

Step 5:
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
