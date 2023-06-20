from PIL import Image, ImageOps, ImageEnhance

from pathlib import Path
import os

if not os.path.exists('train_images'):
    os.mkdir('train_images')

if not os.path.exists('test_images'):
    os.mkdir('test_images')


def process(path):
    ret = []
    pics = list(filter(lambda f: f.endswith('.jpg'), os.listdir(path)))
    i = 0
    for file in pics:
        i += 1
        target = 'train_images' if i%10!=0 else 'test_images'
        img = Image.open(Path() / path / file)
#        img = ImageOps.grayscale(ImageEnhance.Contrast(img).enhance(1.5))
        img.save(Path() / target / f"{path}_{file}")


process('yes')
process('no')
