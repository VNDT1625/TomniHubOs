"""Diagnostic v6 evaluation; synthetic corpus results never authorize promotion."""
import hashlib
import json
import math
import time
from pathlib import Path

DOMAINS = ("security", "user-understanding", "semantic-analysis")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def valid(domain, value):
    if not isinstance(value, dict):
        return False
    if domain == "semantic-analysis":
        return set(value) == {"security", "userUnderstanding"} and all(
            value[key] is None or valid(child, value[key])
            for key, child in (("security", "security"), ("userUnderstanding", "user-understanding"))
        )
    number = value.get("confidence")
    if type(number) not in (int, float) or not math.isfinite(number) or not 0 <= number <= 1:
        return False
    if domain == "user-understanding":
        return (
            set(value) == {"hasMemorySignal", "kind", "scopeHint", "confidence", "reason", "requiresUserConfirmation"}
            and type(value["hasMemorySignal"]) is bool
            and value["kind"] in ("preference", "fact", "decision", "habit", "none")
            and value["scopeHint"] in ("workspace", "surface", "global", "none")
            and isinstance(value["reason"], str) and 0 < len(value["reason"]) <= 500
            and value["requiresUserConfirmation"] is True
            and (value["kind"] != "none" and value["scopeHint"] != "none" if value["hasMemorySignal"] else value["kind"] == "none" and value["scopeHint"] == "none")
        )
    return (
        set(value) == {"riskType", "action", "confidence", "reasonCode", "requiresBackendValidation", "redactions"}
        and value["action"] in ("allow", "ask", "local_only", "block")
        and isinstance(value["riskType"], str) and bool(value["riskType"])
        and isinstance(value["reasonCode"], str) and bool(value["reasonCode"])
        and value["requiresBackendValidation"] is True
        and isinstance(value["redactions"], list) and all(isinstance(x, str) for x in value["redactions"])
    )


def correct(domain, actual, expected):
    if not valid(domain, actual):
        return False
    if domain == "semantic-analysis":
        return all(
            actual[key] is None if expected[key] is None else correct(child, actual[key], expected[key])
            for key, child in (("security", "security"), ("userUnderstanding", "user-understanding"))
        )
    fields = ("action", "riskType", "reasonCode", "redactions", "requiresBackendValidation") if domain == "security" else ("hasMemorySignal", "kind", "scopeHint", "requiresUserConfirmation")
    return all(actual[key] == expected[key] for key in fields)


def parse_generated_json(text):
    """Accept strict JSON or one bounded markdown JSON fence; reject prose."""
    candidate = text.strip()
    if candidate.startswith("```json") and candidate.endswith("```"):
        candidate = candidate[7:-3].strip()
    elif candidate.startswith("```") and candidate.endswith("```"):
        candidate = candidate[3:-3].strip()
    try:
        return json.loads(candidate)
    except (ValueError, TypeError):
        return None


def run(*, domains=DOMAINS, candidate_root=Path('/workspace/.model-adapters/candidates'), candidate_versions=None, output_path=Path('/outputs/benchmarks/v6-diagnostic-1')):
    import torch
    from peft import PeftModel
    from benchmark_adapters import load_text_only_model
    from verify_adapters import sha256_tree
    data = Path("/workspace/data")
    output = Path(output_path)
    output.mkdir(parents=True, exist_ok=False)
    manifest = json.loads((data / "manifest.json").read_bytes())
    expected_base = "ff3a07808a9e83627e69a07131fdec45c60973f23cc5617204d173461ec65fe6"
    assert sha256_tree(Path("/workspace/model")) == expected_base
    cases = {}
    bindings = {}
    for domain in domains:
        entry = manifest["domains"][domain]["splits"]["test"]
        source = (data / entry["path"]).resolve()
        assert data.resolve() in source.parents and entry["immutable"] and entry["trainerReadable"] is False
        assert sha(source) == entry["sha256"]
        cases[domain] = [json.loads(line) for line in source.read_text().splitlines() if line]
        assert len(cases[domain]) == entry["rows"]
        for row in cases[domain]:
            meta = row["metadata"]
            assert meta["synthetic"] and not any(meta.get(k) for k in ("containsUserData", "containsRawChat", "containsSecrets", "containsSourceCode"))
            assert valid(domain, json.loads(row["messages"][-1]["content"]))
        version = "0.6.0-modal-full.2" if domain == "semantic-analysis" else "0.6.0-candidate.1"
        version = (candidate_versions or {}).get(domain, version)
        candidate = Path(candidate_root) / ("com.tomny.core." + domain) / version
        report = json.loads((candidate / "verification-report.json").read_bytes())
        evidence = report["adapters"][0]
        assert report["verified"] and evidence["purpose"] == domain and evidence["baseModel"]["contentSha256"] == expected_base
        for filename, key in (("training_manifest.json", "manifestSha256"), ("adapter_config.json", "adapterConfigSha256"), ("adapter_model.safetensors", "weightSha256")):
            assert sha(candidate / filename) == evidence[key]
        bindings[domain] = {"candidate": str(candidate), "verificationSha256": sha(candidate / "verification-report.json"), "testSha256": sha(source)}
    report = {"schemaVersion": "tomny.v6-diagnostic.v1", "promotionAllowed": False, "limitations": ["Synthetic same-generator test corpus; not independent production acceptance.", "Security riskType is checked as a string; strict runtime enum acceptance requires a separate gate.", "No recovery; batch size one; GPU timings are not local runtime concurrency evidence."], "manifestSha256": sha(data / "manifest.json"), "bindings": bindings, "domains": {}}
    model, tokenizer, _ = load_text_only_model(Path("/workspace/model"))
    torch.manual_seed(20260908)
    with (output / "raw-generations.jsonl").open("x", encoding="utf-8") as raw:
        for domain in domains:
            report["domains"][domain] = {}
            for condition in ("base", "adapter"):
                if condition == "adapter":
                    model = PeftModel.from_pretrained(model, bindings[domain]["candidate"], adapter_name=domain)
                    model.eval()
                records = []
                for row in cases[domain]:
                    messages = row["messages"]
                    expected = json.loads(messages[-1]["content"])
                    prompt = tokenizer.apply_chat_template(messages[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
                    encoded = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to("cuda")
                    assert encoded.input_ids.shape[1] <= 512
                    torch.cuda.reset_peak_memory_stats()
                    torch.cuda.synchronize()
                    started = time.perf_counter()
                    with torch.inference_mode():
                        tokens = model.generate(**encoded, max_new_tokens=256, do_sample=False, pad_token_id=tokenizer.pad_token_id)
                    torch.cuda.synchronize()
                    elapsed = time.perf_counter() - started
                    text = tokenizer.decode(tokens[0, encoded.input_ids.shape[1]:], skip_special_tokens=True)
                    parsed = parse_generated_json(text)
                    record = {"domain": domain, "condition": condition, "rowId": row["metadata"]["rowId"], "output": text, "expected": expected, "schemaValid": valid(domain, parsed), "correct": correct(domain, parsed, expected), "seconds": elapsed, "peakVramBytes": torch.cuda.max_memory_allocated(), "outputTokens": int(tokens.shape[1] - encoded.input_ids.shape[1])}
                    raw.write(json.dumps(record, ensure_ascii=False) + "\n")
                    raw.flush()
                    records.append(record)
                    print(domain, condition, len(records), len(cases[domain]), record["correct"], flush=True)
                report["domains"][domain][condition] = {"count": len(records), "schemaValid": sum(r["schemaValid"] for r in records), "correct": sum(r["correct"] for r in records), "meanSeconds": sum(r["seconds"] for r in records) / len(records), "peakVramBytes": max(r["peakVramBytes"] for r in records)}
                if condition == "adapter":
                    model = model.unload()
    report["rawSha256"] = sha(output / "raw-generations.jsonl")
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    run()
