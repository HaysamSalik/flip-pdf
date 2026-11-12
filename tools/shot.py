import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
box = None
if len(sys.argv) > 3 and sys.argv[3].strip():
    box = tuple(int(v) for v in sys.argv[3].split(","))
im = Image.open(src)
if box: im = im.crop(box)
w = int(sys.argv[4]) if len(sys.argv) > 4 else 720
h = round(im.height * w / im.width)
im = im.convert("RGB").resize((w, h), Image.LANCZOS)
im.save(dst, quality=88)
print(dst, im.size)
