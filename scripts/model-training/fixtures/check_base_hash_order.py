"""Run directly to check the Windows-compatible base hash order."""
import hashlib
import sys
import tempfile
from pathlib import Path, PureWindowsPath

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_adapters import sha256_tree

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    for name in ("a/z.json", "a-file.json", "Z.json", "b.json"):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(name.encode("ascii"))
    expected = hashlib.sha256()
    files = sorted(root.rglob("*"), key=lambda p: PureWindowsPath(p.relative_to(root)))
    for path in files:
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix().encode("utf-8")
        expected.update(len(relative).to_bytes(4, "big"))
        expected.update(relative)
        expected.update(hashlib.sha256(path.read_bytes()).digest())
    assert sha256_tree(root) == expected.hexdigest()
    (root / "Z.json").write_bytes(b"changed")
    assert sha256_tree(root) != expected.hexdigest()
print("Cross-platform hash ordering and mutation checks passed.")
