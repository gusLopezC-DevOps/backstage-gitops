#!/usr/bin/env python3
"""Genera el ConfigMap backstage-templates a partir de assets/.

Uso:
    python3 scripts/gen_cm.py
"""

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "apps/backstage/assets"
OUT = ROOT / "apps/backstage/templates/configmap.yaml"


def encode_key(rel: str) -> str:
    return rel.replace("/", ".")


def main() -> None:
    if not ASSETS.exists():
        print(f"ERROR: {ASSETS} not found", file=sys.stderr)
        sys.exit(1)

    # -- collect files (sorted for reproducibility) ----------------------------------
    files: list[tuple[str, pathlib.Path]] = []
    for p in sorted(ASSETS.rglob("*")):
        if p.is_file():
            rel = str(p.relative_to(ASSETS))
            files.append((rel, p))

    # -- extract override.yaml (used verbatim for the override.yaml CM key) ----------
    override_path = ASSETS / "override.yaml"
    if not override_path.exists():
        print(f"ERROR: {override_path} not found", file=sys.stderr)
        sys.exit(1)
    override_content = override_path.read_text()

    # -- build CM data blocks --------------------------------------------------------
    lines: list[str] = ["apiVersion: v1", "kind: ConfigMap",
                        "metadata:", "  name: backstage-templates",
                        "  namespace: workloads", "data:"]

    def add_block(key: str, content: str) -> None:
        lines.append(f"  {key}: |")
        for line in content.splitlines():
            lines.append(f"    {line}")
        lines.append("")

    # override.yaml always first
    add_block("override.yaml", override_content)

    # remaining files (sorted by key, override.yaml excluded)
    for rel, p in files:
        if rel == "override.yaml":
            continue
        key = encode_key(rel)
        add_block(key, p.read_text())

    # -- layout (key → mount path inside the pod) ------------------------------------
    add_block("layout", "\n".join(f"{encode_key(rel)} {rel}" for rel, _ in files))

    OUT.write_text("\n".join(lines) + "\n")
    print(f"OK  {OUT}  ({len(files)} files)")


if __name__ == "__main__":
    main()