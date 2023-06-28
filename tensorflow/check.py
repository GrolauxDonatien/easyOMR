import tensorflow as tf
import tensorflow_datasets as tfds

ds, ds_info = tfds.load(
    'omrset',
    split='train',
    with_info=True,
)

tfds.show_examples(ds, ds_info)

