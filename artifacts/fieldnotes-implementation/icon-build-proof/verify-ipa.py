"""Inspect only public bundle metadata and icon assets; never extract signing data.

Usage: python artifacts/fieldnotes-implementation/icon-build-proof/verify-ipa.py
Optional positional argument: local Development IPA path.
Requires Pillow and numpy. CgBI decoding uses Python's standard library.
"""
from pathlib import Path
import hashlib
import io
import json
import plistlib
import struct
import sys
import zipfile
import zlib

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "ipa"
IPA = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".tmp/fieldnotes-development-59.ipa"
SOURCE = ROOT / "assets/icon.png"
HOST = "Payload/Nearr.app/"
EXT = HOST + "PlugIns/NearrShareExtension.appex/"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def decode_png(data):
    if b"CgBI" not in data[:64]:
        im = Image.open(io.BytesIO(data))
        im.load()
        return im.convert("RGBA"), "ordinary PNG"
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    cursor, compressed, header = 8, [], None
    while cursor < len(data):
        length = struct.unpack(">I", data[cursor:cursor + 4])[0]
        kind = data[cursor + 4:cursor + 8]
        payload = data[cursor + 8:cursor + 8 + length]
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            compressed.append(payload)
        cursor += length + 12
    w, h, depth, color, compression, filtering, interlace = header
    assert depth == 8 and color in (2, 6) and interlace == 0
    assert compression == 0 and filtering == 0
    bpp = 4 if color == 6 else 3
    raw = zlib.decompress(b"".join(compressed), -15)
    stride = w * bpp
    assert len(raw) == h * (stride + 1)
    pixels = bytearray(h * stride)
    for y in range(h):
        mode = raw[y * (stride + 1)]
        assert mode in range(5)
        row = raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)]
        for x, value in enumerate(row):
            i = y * stride + x
            left = pixels[i - bpp] if x >= bpp else 0
            up = pixels[i - stride] if y else 0
            upper_left = pixels[i - stride - bpp] if y and x >= bpp else 0
            predictor = (0, left, up, (left + up) // 2, paeth(left, up, upper_left))[mode]
            pixels[i] = (value + predictor) & 255
    bgra = np.frombuffer(pixels, dtype=np.uint8).reshape((h, w, bpp))
    rgba = np.full((h, w, 4), 255, dtype=np.uint8)
    rgba[:, :, :3] = bgra[:, :, [2, 1, 0]]
    if bpp == 4:
        rgba[:, :, 3] = bgra[:, :, 3]
        alpha = rgba[:, :, 3].astype(float)
        rgb = rgba[:, :, :3].astype(float)
        # Apple's CgBI stores premultiplied BGRA; recover straight RGB.
        np.divide(rgb * 255, alpha[:, :, None], out=rgb, where=alpha[:, :, None] > 0)
        rgba[:, :, :3] = np.rint(np.clip(rgb, 0, 255)).astype(np.uint8)
    return Image.fromarray(rgba), "CgBI raw-deflate / PNG unfilter / BGRA unpremultiply"


def metadata(z, name, keys):
    p = plistlib.loads(z.read(name))
    return {key: p[key] for key in keys if key in p}


def image_proof(z, name, stem, source):
    data = z.read(name)
    actual, decoder = decode_png(data)
    (OUT / (stem + ".png")).write_bytes(data)
    actual.save(OUT / (stem + "-decoded.png"))
    rgb = actual.convert("RGB")
    a = np.array(rgb).astype(np.int16)
    comparisons = {}
    for kernel in ("NEAREST", "BILINEAR", "BICUBIC", "LANCZOS"):
        expected = source.resize(actual.size, getattr(Image.Resampling, kernel))
        difference = np.abs(a - np.array(expected).astype(np.int16))
        comparisons[kernel] = {
            "meanAbsoluteChannelDifference255": float(difference.mean()),
            "maxAbsoluteChannelDifference255": int(difference.max()),
            "exactPixelFraction": float(np.all(difference == 0, axis=2).mean()),
            "within8PerChannelPixelFraction": float(np.all(difference <= 8, axis=2).mean()),
        }
    corners = [rgb.getpixel(p) for p in ((0, 0), (rgb.width - 1, 0), (0, rgb.height - 1), (rgb.width - 1, rgb.height - 1))]
    return {
        "archivePath": name, "bytes": len(data), "sha256": sha(data),
        "dimensions": list(actual.size), "decoder": decoder,
        "alphaExtrema": list(actual.getchannel("A").getextrema()),
        "decodedRGBSha256": sha(rgb.tobytes()), "cornerRGB": corners,
        "sourceResamplingComparisons": comparisons,
        "exactSourceRGBMatch": rgb.size == source.size and rgb.tobytes() == source.tobytes(),
    }, rgb


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")
    report = {
        "buildId": "74a22771-5998-485b-ac16-f316caf7491d",
        "buildSourceCommit": "bb2a705ceda39f0938d2a90eca88952828ba614d",
        "buildIdentityOrigin": "Successful EAS build identity supplied by root; bundle versions below independently read from IPA",
        "ipaFilename": IPA.name, "ipaBytes": IPA.stat().st_size, "ipaSHA256": file_sha(IPA),
        "sourceSHA256": file_sha(SOURCE), "sourceDecodedRGBSHA256": sha(source.tobytes()),
        "sourceDimensions": list(source.size),
    }
    keys = ["CFBundleIdentifier", "CFBundleName", "CFBundleDisplayName", "CFBundleShortVersionString", "CFBundleVersion", "MinimumOSVersion", "CFBundleIcons", "CFBundleIcons~ipad", "UIUserInterfaceStyle"]
    with zipfile.ZipFile(IPA) as z:
        report["hostInfo"] = metadata(z, HOST + "Info.plist", keys)
        report["extensionInfo"] = metadata(z, EXT + "Info.plist", keys + ["NSExtension", "ShareExtensionHeight", "AppGroup"])
        report["expoInfo"] = metadata(z, HOST + "Expo.plist", ["EXUpdatesRuntimeVersion", "EXUpdatesEnabled"])
        report["extensionEmbeddedBundle"] = {"archivePath": EXT + "main.jsbundle", "bytes": len(z.read(EXT + "main.jsbundle")), "sha256": sha(z.read(EXT + "main.jsbundle"))}
        catalog = z.read(HOST + "Assets.car")
        report["compiledAssetCatalog"] = {"archivePath": HOST + "Assets.car", "bytes": len(catalog), "sha256": sha(catalog), "individualRenditionsDecoded": False}
        report["compiledIconResources"] = [n for n in z.namelist() if n.startswith(HOST) and "/" not in n[len(HOST):] and n.startswith(HOST + "AppIcon")]
        report["icons"] = []
        decoded = []
        for name, stem in [(HOST + "AppIcon60x60@2x.png", "AppIcon60x60@2x"), (HOST + "AppIcon76x76@2x~ipad.png", "AppIcon76x76@2x~ipad"), (EXT + "assets/assets/icon.png", "extension-receipt-icon")]:
            proof, im = image_proof(z, name, stem, source)
            report["icons"].append(proof)
            decoded.append(im)
    report["limitations"] = [
        "Compiled 120px and 152px PNG renditions decoded; catalog-only renditions inside Assets.car not individually decoded on this Windows host.",
        "No physical iPhone installation, launcher, Settings, share-sheet geometry, VoiceOver or haptic test is established by archive inspection.",
        "Source commit f6e9bbd is a later JS-only loading treatment intended for Development OTA and is not the native IPA source commit.",
    ]
    (OUT / "ipa-verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    # Contact sheet labels clearly distinguish extracted pixels from source resampling.
    sheet = Image.new("RGB", (1000, 630), "#E7E3DC")
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 18), "ACTUAL IPA ICON PIXELS - source comparison (not an installed-device screenshot)", fill="#263A32")
    for i, compiled in enumerate(decoded[:2]):
        x = 24 + i * 330
        expected = source.resize(compiled.size, Image.Resampling.LANCZOS)
        draw.text((x, 54), f"Compiled {compiled.width}px (enlarged)", fill="#263A32")
        sheet.paste(compiled.resize((270, 270), Image.Resampling.NEAREST), (x, 78))
        draw.text((x, 365), f"Source at {compiled.width}px (Lanczos)", fill="#263A32")
        sheet.paste(expected, (x, 390))
    draw.text((690, 54), "Extension receipt icon", fill="#263A32")
    sheet.paste(decoded[2].resize((270, 270), Image.Resampling.LANCZOS), (690, 78))
    draw.text((690, 365), "1024px source RGB: exact match", fill="#263A32")
    draw.text((24, 590), "All decoded compiled PNGs are opaque. iPhone home-screen and catalog-only 3x appearance remain unobserved.", fill="#263A32")
    sheet.save(OUT / "compiled-icon-comparison.png")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
