import tensorflow_datasets as tfds
from pathlib import Path
import logging
import os

# TODO(omrset): Markdown description  that will appear on the catalog page.
_DESCRIPTION = """
Description is **formatted** as markdown.

It should also contain any processing which has been applied (if any),
(e.g. corrupted example skipped, images cropped,...):
"""

# TODO(omrset): BibTeX citation
_CITATION = """
"""


class Omrset(tfds.core.GeneratorBasedBuilder):
  """DatasetBuilder for omrset dataset."""

  VERSION = tfds.core.Version('1.0.0')
  RELEASE_NOTES = {
      '1.0.0': 'Initial release.',
  }

  def _info(self) -> tfds.core.DatasetInfo:
    """Returns the dataset metadata."""
    # TODO(omrset): Specifies the tfds.core.DatasetInfo object
    return tfds.core.DatasetInfo(
        builder=self,
        description=_DESCRIPTION,
        features=tfds.features.FeaturesDict({
            # These are the features of your dataset like images, labels ...
            'image': tfds.features.Image(shape=(40, 40, 1)),
            'label': tfds.features.ClassLabel(names=['no', 'yes', 'full']),
        }),
        # If there's a common (input, target) tuple from the
        # features, specify them here. They'll be used if
        # `as_supervised=True` in `builder.as_dataset`.
        supervised_keys=('image', 'label'),  # Set to `None` to disable
        homepage='https://dataset-homepage/',
        citation=_CITATION,
    )

  def _split_generators(self, dl_manager: tfds.download.DownloadManager):
    """Returns SplitGenerators."""
    # TODO(omrset): Downloads the data and defines the splits
    # path = dl_manager.download_and_extract('https://todo-data-url')

    # TODO(omrset): Returns the Dict[split names, Iterator[Key, Example]]

    logging.warning(os.path.abspath(Path() / '..' /'..' / 'train' / 'train_images'))

    return {
        'train': self._generate_examples(Path() / '..' / '..' /'train' / 'train_images'),
        'test': self._generate_examples(Path() / '..' / '..' /'train' / 'test_images'),
    }

  def _generate_examples(self, path):
    """Yields examples."""
    # TODO(omrset): Yields (key, example) tuples from the dataset
    for f in path.glob('*.jpg'):
        yield f.name, {
            'image': f,
            'label': f.name.split("_")[0]
        }
