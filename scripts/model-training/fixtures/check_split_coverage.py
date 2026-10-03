import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from generate_data import domain_rows, require_split_coverage

for domain in ("user-understanding", "semantic-analysis"):
    splits = {name: domain_rows(domain, name) for name in ("train", "validation")}
    try:
        require_split_coverage(splits, domain)
    except ValueError:
        pass
    else:
        raise AssertionError("Legacy incomplete coverage must be rejected")
rows = [{"messages": [{"content": json.dumps({"security": {} if s else None, "userUnderstanding": {} if u else None})}]} for s in (False, True) for u in (False, True)]
require_split_coverage({"train": rows, "validation": rows}, "semantic-analysis")
try:
    require_split_coverage({"train": rows, "validation": rows[:-1]}, "semantic-analysis")
except ValueError:
    pass
else:
    raise AssertionError("Missing combined branch must be rejected")
from generate_data import heldout_rows, require_independent_prompts
for domain in ("security", "user-understanding", "semantic-analysis"):
    try:
        require_independent_prompts({"train": domain_rows(domain, "train"), "test": heldout_rows(domain)})
    except ValueError:
        pass
    else:
        raise AssertionError("Relabelled training examples must not pass as held-out")
require_independent_prompts({"train": [{"messages": [{"role": "user", "content": "One independent scenario"}]}], "test": [{"messages": [{"role": "user", "content": "Another distinct scenario"}]}]})
try:
    require_split_coverage({"train": rows, "validation": rows, "test": rows[:-1]}, "semantic-analysis")
except ValueError:
    pass
else:
    raise AssertionError("Heldout missing a branch must be rejected even when validation is complete")
require_split_coverage({"train": rows, "validation": rows, "test": rows}, "semantic-analysis")

# Different family IDs cannot turn identical prompts into independent scenarios.
clones = [{"messages": [{"role": "user", "content": "Same actual request"}],
           "metadata": {"scenarioFamily": family}} for family in ("first", "second")]
try:
    require_independent_prompts({"train": clones})
except ValueError:
    pass
else:
    raise AssertionError("Fabricated same-split families must be rejected")
require_independent_prompts({"train": [clones[0], clones[0]]})
# A standalone adapter is an explicit selection, never an implicit partial release.
import tempfile
from generate_data import load_authored_corpus
source = Path(__file__).with_name("user-understanding-v7-authored.jsonl")
authored = [json.loads(line) for line in source.read_text(encoding="utf-8").splitlines()]
document = {"user-understanding": {split: [row for row in authored if row["metadata"]["split"] == split]
                                   for split in ("train", "validation", "test")}}
with tempfile.TemporaryDirectory() as temporary:
    corpus = Path(temporary) / "authored.json"
    corpus.write_text(json.dumps(document), encoding="utf-8")
    load_authored_corpus(corpus, ("user-understanding",))
    for selection in (None, (), ("security",), ("not-a-domain",)):
        try:
            load_authored_corpus(corpus, selection)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid or incomplete selection accepted: {selection}")
    document["user-understanding"]["validation"] = document["user-understanding"]["train"]
    corpus.write_text(json.dumps(document), encoding="utf-8")
    try:
        load_authored_corpus(corpus, ("user-understanding",))
    except ValueError:
        pass
    else:
        raise AssertionError("Single-domain mode must still reject train/validation reuse")
print("Split coverage, leakage, family and explicit single-domain checks passed")
