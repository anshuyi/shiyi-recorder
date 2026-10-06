"""Regenerate the original Shiyi geometric icon; requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[1]
im = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((16,16,496,496), radius=108, fill="#143D46")
d.rounded_rectangle((91,117,421,360), radius=28, outline="#F4EBDC", width=24)
d.line((193,410,319,410), fill="#F4EBDC", width=24)
d.line((256,360,256,410), fill="#F4EBDC", width=22)
d.line((166,183,166,294), fill="#F4EBDC", width=23)
d.line((208,183,208,294), fill="#F4EBDC", width=23)
d.ellipse((270,215,332,277), fill="#F17A65")
for size in (32,128,512):
    target=root/"public"/"app-icons"/f"shiyi-{size}.png"
    target.parent.mkdir(parents=True,exist_ok=True)
    im.resize((size,size),Image.Resampling.LANCZOS).save(target)
im.save(root/"branding"/"shiyi.ico", sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
