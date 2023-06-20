import tensorflow as tf
import tensorflow_datasets as tfds
import os
from PIL import Image, ImageOps, ImageEnhance
from pathlib import Path
import numpy as np
import time

import os

os.environ["CUDA_VISIBLE_DEVICES"] = "-1"


def create_model():
    model = tf.keras.models.Sequential([
        tf.keras.layers.Flatten(input_shape=(40, 40, 1)),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dense(2)
    ])
    model.compile(
        optimizer=tf.keras.optimizers.Adam(0.001),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(from_logits=True),
        metrics=[tf.keras.metrics.SparseCategoricalAccuracy()],
    )
    return model


model = create_model()
checkpoint_path = "omr.ckpt"

model.load_weights(checkpoint_path)

class_names = ["no", "yes"]
total = 0
wrongs = 0
ref_time = time.time() * 1000;


def run(path):
    global total, wrongs
    files = list(os.listdir(path))
    total += len(files)
    i = 0
    for file in files:
        i += 1
        if i % 100 == 0:
            cur_time = time.time() * 1000
            print(
                f"Working on {file}, {round(i * 1000 / (cur_time - ref_time), 2)} images/secs, {round(i * 100.0 / total, 2)}%, ratio {round(wrongs / total, 2)}%")
        img = Image.open(path / file)
        # img = ImageOps.grayscale(ImageEnhance.Contrast(img).enhance(1.5))
        # files from test_images are already contrasted and grayscaled
        img_array = tf.keras.utils.img_to_array(img)
        img_array = tf.expand_dims(img_array, 0)
        predictions = model.predict(img_array, verbose=0)
        score = tf.nn.softmax(predictions[0])
        cn = class_names[np.argmax(score)]
        percent = (100 * np.max(score)).round(2)
        ref = 'yes' if file.startswith('yes') else 'no'
        if cn != ref:
            wrongs += 1
            print(f"WRONG DEDUCTION: {file} is {cn} with  {percent} confidence,  {score}")
        elif percent < 100.0:
            print(f"UNSURE: {file} is {cn} with  {percent} confidence")


run(Path() / "test_images")
print(f"{total} totals, {wrongs} wrongs, ratio {wrongs / total}")
