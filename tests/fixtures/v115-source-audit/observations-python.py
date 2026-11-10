import subprocess

DETECTOR_ID = "py-detector"


def test_runs():
    subprocess.run("npm run build", shell=True)
    return "a\nb".split("\n")
