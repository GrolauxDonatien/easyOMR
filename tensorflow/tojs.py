import tensorflowjs as tfjs
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
tfjs_target_dir = Path() / "js"

model.load_weights(checkpoint_path)
tfjs.converters.save_keras_model(model, tfjs_target_dir)
