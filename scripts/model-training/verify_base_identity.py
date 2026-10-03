from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path

EXPECTED_REVISION = "2fc06364715b967f1860aea9cf38778875588b17"
EXPECTED_SHA256 = "ff3a07808a9e83627e69a07131fdec45c60973f23cc5617204d173461ec65fe6"

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def sha256_tree(root: Path) -> str:
    files = sorted((p for p in root.rglob("*") if p.is_file()), key=lambda p: tuple(x.lower() for x in p.relative_to(root).parts))
    h = hashlib.sha256()
    for path in files:
        rel = path.relative_to(root).as_posix().encode("utf-8")
        h.update(len(rel).to_bytes(4, "big")); h.update(rel); h.update(bytes.fromhex(sha256_file(path)))
    return h.hexdigest()

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", default=EXPECTED_REVISION)
    parser.add_argument("--expected-sha", default=EXPECTED_SHA256)
    args = parser.parse_args()
    root = Path(args.model).resolve()
    metadata = root / ".cache" / "huggingface" / "trees" / f"{args.revision}.json"
    actual = sha256_tree(root)
    errors = []
    if actual != args.expected_sha: errors.append("canonical hash mismatch")
    if not metadata.is_file(): errors.append("pinned revision metadata missing")
    else:
        try:
            tree = json.loads(metadata.read_text(encoding="utf-8"))
            if not isinstance(tree.get("files"), dict) or not tree["files"]: errors.append("revision metadata has no file map")
            for rel, entry in tree.get("files", {}).items():
                path = root / rel
                if not path.is_file() or path.stat().st_size != entry.get("size"): errors.append(f"snapshot file mismatch: {rel}")
        except (OSError, json.JSONDecodeError): errors.append("invalid revision metadata")
    result = {"baseIdentityMatched": not errors, "repository": "Qwen/Qwen3.5-0.8B", "revision": args.revision, "canonicalManifestSha256": actual, "expectedCanonicalManifestSha256": args.expected_sha, "revisionMetadata": str(metadata), "errors": errors}
    print(json.dumps(result, sort_keys=True))
    if errors: raise SystemExit(1)

if __name__ == "__main__": main()
