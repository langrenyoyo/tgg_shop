"""Optimize bundled artwork with Pillow and check the 200 KB media budget.

Run normally after regenerating artwork, or use --check for a read-only scan.
Existing PNG paths are preserved; no remote resources are introduced.
"""
import argparse
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEDIA_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
    '.mp3', '.mp4', '.wav', '.aac', '.m4a', '.ogg', '.mov', '.avi',
}
# Stay below both decimal KB and the developer tool's binary KB threshold.
LIMIT_BYTES = 200_000
TARGETS = {
    'assets/icons/home-earn.png': (192, 192),
    'assets/icons/home-invite.png': (192, 192),
    'assets/icons/home-membership.png': (192, 192),
    'assets/invite-share.png': (500, 500),
}


def optimize():
    from PIL import Image

    for relative, size in TARGETS.items():
        path = ROOT / relative
        with Image.open(path) as source:
            # Already optimized files must not be quantized repeatedly.
            if source.mode == 'P' and source.width <= size[0] and source.height <= size[1]:
                continue
            image = source.convert('RGB')
            image.thumbnail(size, Image.Resampling.LANCZOS)
            image = image.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
            output = BytesIO()
            image.save(output, format='PNG', optimize=True)
        before = path.stat().st_size
        if output.tell() < before:
            path.write_bytes(output.getvalue())
            print(f'{relative}: {before} -> {path.stat().st_size} bytes')


def check():
    files = sorted((path for path in ROOT.rglob('*')
                    if path.is_file() and path.suffix.lower() in MEDIA_EXTENSIONS
                    and not any(part in {'.git', 'node_modules'} for part in path.relative_to(ROOT).parts)),
                   key=lambda path: path.stat().st_size, reverse=True)
    total = sum(path.stat().st_size for path in files)
    print(f'Bundled media: {len(files)} files, {total} bytes ({total / 1024:.1f} KiB); limit {LIMIT_BYTES} bytes')
    if total > LIMIT_BYTES:
        for path in files[:5]:
            print(f'  {path.relative_to(ROOT)}: {path.stat().st_size} bytes')
        raise SystemExit('Media budget exceeded. Optimize the artwork before uploading.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Read-only media budget check; Pillow is not required')
    args = parser.parse_args()
    if not args.check:
        optimize()
    check()
