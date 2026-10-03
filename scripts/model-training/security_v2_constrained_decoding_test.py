"""CPU tests for the native Semantic Security V2 token constraint."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import torch
from transformers import AutoTokenizer, GPT2Config, GPT2LMHeadModel

sys.path.insert(0, str(Path(__file__).parent))
from security_v2_constrained_decoding import (  # noqa: E402
    SecurityV2ConstraintError,
    V2_FIELDS,
    _documents,
    build_security_v2_constraint,
    load_ontology,
)
from qwen_inference_daemon import uses_security_v2_constraint  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / ".local-models" / "Qwen3.5-0.8B"
ONTOLOGY = ROOT / "packages" / "desktop" / "src" / "process" / "services" / "security" / "security-ontology-v1.json"


def main() -> None:
    tokenizer = AutoTokenizer.from_pretrained(MODEL, local_files_only=True)
    ontology = load_ontology(ONTOLOGY)
    constraint = build_security_v2_constraint(tokenizer, [tokenizer.eos_token_id], ontology)
    documents = _documents(ontology)
    assert constraint.sequence_count == len(documents) == 1440

    risk_types = set()
    reason_codes = set()
    redaction_options = set()
    for document in documents:
        value = json.loads(document)
        assert set(value) == {"riskType", "reasonCode", "requiresBackendValidation", "redactions"}
        assert value["requiresBackendValidation"] is True
        assert ontology["reasonCodeRiskType"][value["reasonCode"]] == value["riskType"]
        assert len(value["redactions"]) == len(set(value["redactions"]))
        assert all(item in ontology["redactions"]["allowedValues"] for item in value["redactions"])
        assert tokenizer.decode(
            tokenizer(document, add_special_tokens=False)["input_ids"],
            skip_special_tokens=False,
            clean_up_tokenization_spaces=False,
        ) == document
        tokens = tokenizer(document, add_special_tokens=False)["input_ids"]
        assert constraint.allowed_tokens(tokens) == [tokenizer.eos_token_id]
        risk_types.add(value["riskType"])
        reason_codes.add(value["reasonCode"])
        redaction_options.add(tuple(value["redactions"]))

    assert risk_types == set(ontology["riskTypes"])
    assert reason_codes == set(ontology["reasonCodes"])
    assert redaction_options == {
        (),
        ("credential",),
        ("private_fields",),
        ("credential", "private_fields"),
        ("private_fields", "credential"),
    }

    first_tokens = tokenizer(documents[0], add_special_tokens=False)["input_ids"]
    allowed = constraint.allowed_tokens(first_tokens[:-1])
    assert first_tokens[-1] in allowed
    processor = constraint.logits_processor(0)
    scores = torch.zeros((1, tokenizer.vocab_size), dtype=torch.float32)
    invalid_token = next(token for token in range(tokenizer.vocab_size) if token not in allowed)
    scores[0, invalid_token] = 1000
    scores[0, first_tokens[-1]] = 1
    restricted = processor(torch.tensor([first_tokens[:-1]]), scores)
    assert not torch.isfinite(restricted[0, invalid_token])
    assert torch.isfinite(restricted[0, first_tokens[-1]])

    callback = constraint.prefix_allowed_tokens_fn(0)
    assert callback(0, torch.tensor(first_tokens[:-1])) == allowed
    prompt = tokenizer.apply_chat_template(
        [
            {"role": "system", "content": "Classify only normalized egress evidence."},
            {"role": "user", "content": "{}"},
        ],
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    prompt_inputs = tokenizer(prompt, return_tensors="pt")
    prompt_constraint = build_security_v2_constraint(
        tokenizer,
        [tokenizer.eos_token_id],
        ontology,
        prompt=prompt,
        prompt_token_ids=prompt_inputs["input_ids"][0].tolist(),
    )
    model = GPT2LMHeadModel(
        GPT2Config(
            vocab_size=len(tokenizer),
            n_positions=512,
            n_ctx=512,
            n_embd=8,
            n_layer=1,
            n_head=1,
            eos_token_id=tokenizer.eos_token_id,
            pad_token_id=tokenizer.pad_token_id,
        )
    ).eval()
    generated = model.generate(
        **prompt_inputs,
        do_sample=False,
        max_new_tokens=96,
        prefix_allowed_tokens_fn=prompt_constraint.prefix_allowed_tokens_fn(prompt_inputs["input_ids"].shape[1]),
    )
    generated_text = tokenizer.decode(
        generated[0, prompt_inputs["input_ids"].shape[1] :],
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    )
    generated_value = json.loads(generated_text)
    assert set(generated_value) == set(V2_FIELDS)
    assert uses_security_v2_constraint("security", "tomny.security.semantic.input.v2")
    assert not uses_security_v2_constraint("security", "tomny.security.input.v1")
    assert not uses_security_v2_constraint("user-understanding", "tomny.security.semantic.input.v2")
    try:
        constraint.allowed_tokens([invalid_token])
    except SecurityV2ConstraintError:
        pass
    else:
        raise AssertionError("invalid prefix was not rejected")

    print(json.dumps({
        "pass": True,
        "tokenizerClass": type(tokenizer).__name__,
        "vocabSize": tokenizer.vocab_size,
        "canonicalDocuments": len(documents),
        "grammarStates": constraint.state_count,
        "riskTypes": len(risk_types),
        "reasonCodes": len(reason_codes),
        "redactionCombinations": len(redaction_options),
        "eosTokenId": tokenizer.eos_token_id,
        "productionPathGeneration": True,
        "semanticGoldLeakage": False,
        "postProcessingRepair": False,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
