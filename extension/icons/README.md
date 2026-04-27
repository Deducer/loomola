# Extension icons

Need 16×16, 32×32, 48×48, and 128×128 PNGs. For now, use a simple solid-accent
camera glyph or upload your real Loom Clone mark.

Quick path with macOS `sips`:

```sh
# Start from a single 1024×1024 source PNG (e.g. the brand logo at
# /Users/iancross/Design/Vayu Labs/Vayu Labs Logos/vayu labs logo purple.png
# or any other square PNG)
sips -z 16 16   source.png --out icons/icon-16.png
sips -z 32 32   source.png --out icons/icon-32.png
sips -z 48 48   source.png --out icons/icon-48.png
sips -z 128 128 source.png --out icons/icon-128.png
```

Until those exist, Chrome will use a default puzzle-piece icon — functional,
just unbranded.
