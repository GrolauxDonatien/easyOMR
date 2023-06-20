# step 1 : create dataset
# dict_keys(['data', 'target', 'frame', 'categories', 'feature_names', 'target_names', 'DESCR', 'details', 'url'])

from pathlib import Path
import os
from PIL import Image, ImageOps
import numpy
from sklearn.utils import Bunch
from sklearn.linear_model import SGDClassifier
from sklearn.model_selection import StratifiedKFold
from sklearn.base import clone
from sklearn.model_selection import cross_val_score
from sklearn.svm import SVC


def read_data(path):
    ret = []
    i = 0
    for file in os.listdir(path):
        i += 1
        if i > 500:
            break
        if file.endswith('.jpg'):
            img = ImageOps.grayscale(Image.open(path / file))
            np = numpy.asarray(img).flatten()
            ret.append(np)
    return ret


def read_path(path):
    data = read_data(Path() / path)
    target = [path] * len(data)
    return {"data": data, "target": target}


dataset = Bunch(
    data=[],
    target=[],
    frame=None,
    categories={},
    feature_names=[],
    target_names=['class'],
    DESCR='By Donatien Grolaux',
    details={},
    url=""
)

data = []
target = []

temp = read_path("yes")
dataset.data = dataset.data + temp["data"]
dataset.target = dataset.target + temp["target"]

temp = read_path("no")
dataset.data = dataset.data + temp["data"]
dataset.target = dataset.target + temp["target"]

for i in range(0, len(dataset.data[0])):
    dataset.feature_names.append(f"pixel{i + 1}")

dataset.data = numpy.array(dataset.data)
dataset.target = numpy.array(dataset.target)

# print(dataset)
# print(dataset.data.shape)
# print(dataset.target.shape)

X, Y = dataset.data, dataset.target
X_train, X_test, Y_train, Y_test = X[:900], X[900:], Y[:900], Y[900:]

svm_clf = SVC(random_state=42)
svm_clf.fit(X_train, Y_train)

print(Y[0])
print(Y[500])

for i in range(0, len(X)):
    print(f"{i} : {svm_clf.predict([X[i]])} = {Y[i]}")
    scores = svm_clf.decision_function([X[i]]);
    print(scores)
