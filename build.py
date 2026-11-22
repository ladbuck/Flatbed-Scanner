"""Builds index.html from src/ (shell.html + styles.css + js/*.js in name order).

Usage: python3 build.py
"""
import glob
import os
import shutil
import subprocess
import tempfile

root = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(root, "src")
js = "\n".join(open(f, encoding="utf-8").read() for f in sorted(glob.glob(os.path.join(src, "js", "*.js"))))
css = open(os.path.join(src, "styles.css"), encoding="utf-8").read()
shell = open(os.path.join(src, "shell.html"), encoding="utf-8").read()
assert "</script" not in js.lower(), "JS must not contain a closing script tag"
html = shell.replace("/*CSS*/", css).replace("/*JS*/", js)
with open(os.path.join(root, "index.html"), "w", encoding="utf-8") as fh:
    fh.write(html)
print("Wrote index.html (%d bytes)" % len(html.encode()))

if shutil.which("node"):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tmp:
        tmp.write(js)
    r = subprocess.run(["node", "--check", tmp.name], capture_output=True, text=True)
    os.unlink(tmp.name)
    print("Syntax check:", "ok" if r.returncode == 0 else r.stderr)
