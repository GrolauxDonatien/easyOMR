import tensorflow as tf
import tensorflow_datasets as tfds
import os
import omrset

(ds_train, ds_test), ds_info = tfds.load(
    'omrset',
    split=['train', 'test'],
    shuffle_files=True,
    as_supervised=True,
    with_info=True,
)


def normalize_img(image, label):
    """Normalizes images: `uint8` -> `float32`."""
    return tf.cast(image, tf.float32) / 255., label


ds_train = ds_train.map(
    normalize_img, num_parallel_calls=tf.data.AUTOTUNE)
ds_train = ds_train.cache()
ds_train = ds_train.shuffle(ds_info.splits['train'].num_examples)
ds_train = ds_train.batch(128)
ds_train = ds_train.prefetch(tf.data.AUTOTUNE)

ds_test = ds_test.map(
    normalize_img, num_parallel_calls=tf.data.AUTOTUNE)
ds_test = ds_test.batch(128)
ds_test = ds_test.cache()
ds_test = ds_test.prefetch(tf.data.AUTOTUNE)

def create_model():
    """model = tf.keras.models.Sequential([
        tf.keras.layers.Flatten(input_shape=(40, 40, 1)),
        tf.keras.layers.Rescaling(1./255),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.Dense(3)
    ])"""
    # inspired by https://www.tensorflow.org/tutorials/images/classification
    model=tf.keras.models.Sequential([
        tf.keras.layers.Rescaling(1./255, input_shape=(40, 40, 1)),
        tf.keras.layers.Conv2D(16, 1, padding='same', activation='relu'),
        tf.keras.layers.MaxPooling2D(),
        tf.keras.layers.Conv2D(32, 1, padding='same', activation='relu'),
        tf.keras.layers.MaxPooling2D(),
        tf.keras.layers.Conv2D(64, 1, padding='same', activation='relu'),
        tf.keras.layers.MaxPooling2D(),
        tf.keras.layers.Flatten(),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dense(3)
    ])
    model.compile(
#        optimizer=tf.keras.optimizers.Adam(0.001),
        optimizer='adam',
        loss=tf.keras.losses.SparseCategoricalCrossentropy(from_logits=True),
#        metrics=[tf.keras.metrics.SparseCategoricalAccuracy()],
        metrics=['accuracy']
    )
    return model


model = create_model()
checkpoint_path = "omr.ckpt"
checkpoint_dir = os.path.dirname(checkpoint_path)

# Create a callback that saves the model's weights
cp_callback = tf.keras.callbacks.ModelCheckpoint(filepath=checkpoint_path,
                                                 save_weights_only=True,
                                                 verbose=1)

model.fit(
    ds_train,
    epochs=100,
    validation_data=ds_test,
    callbacks=[cp_callback])  # Pass callback to training
