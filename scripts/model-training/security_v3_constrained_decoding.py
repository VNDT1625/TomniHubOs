"""Tokenizer-aware finite constraint for Security semantic V3."""
from __future__ import annotations
import itertools, json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence
V3_FIELDS = ("riskType", "reasonCode", "requiresBackendValidation")
@dataclass
class _Node:
    children: dict[int, "_Node"] = field(default_factory=dict)
    terminal: bool = False
class SecurityV3ConstraintError(ValueError): pass
class SecurityV3TokenConstraint:
    def __init__(self, sequences: Iterable[Sequence[int]], eos_token_ids: Sequence[int]):
        seqs = [tuple(map(int, s)) for s in sequences]
        if not seqs or not eos_token_ids: raise SecurityV3ConstraintError("empty V3 language")
        self._root = _Node(); self._sequence_count = len(seqs); self._eos_token_ids = tuple(dict.fromkeys(map(int, eos_token_ids)))
        for seq in seqs:
            if not seq: raise SecurityV3ConstraintError("empty V3 sequence")
            node = self._root
            for token in seq: node = node.children.setdefault(token, _Node())
            node.terminal = True
    @property
    def sequence_count(self): return self._sequence_count
    @property
    def eos_token_ids(self): return self._eos_token_ids
    def allowed_tokens(self, generated_token_ids):
        node = self._root
        for token in generated_token_ids:
            node = node.children.get(int(token))
            if node is None: raise SecurityV3ConstraintError("prefix outside V3 language")
        if node.terminal: return list(self._eos_token_ids)
        if not node.children: raise SecurityV3ConstraintError("V3 language has no continuation")
        return sorted(node.children)
    def prefix_allowed_tokens_fn(self, prompt_length: int) -> Callable[[int, Any], list[int]]:
        if prompt_length < 0: raise SecurityV3ConstraintError("negative prompt length")
        def callback(_batch_id, input_ids):
            values = input_ids.tolist() if hasattr(input_ids, "tolist") else list(input_ids)
            if values and isinstance(values[0], list): values = values[0]
            return self.allowed_tokens(values[prompt_length:])
        return callback
def _token_ids(tokenizer, text):
    encoded = tokenizer(text, add_special_tokens=False); values = encoded["input_ids"] if isinstance(encoded, dict) else encoded.input_ids
    if values and isinstance(values[0], list): values = values[0]
    return tuple(map(int, values))
def _decode(tokenizer, values):
    try: return tokenizer.decode(list(values), skip_special_tokens=False, clean_up_tokenization_spaces=False)
    except TypeError: return tokenizer.decode(list(values), skip_special_tokens=False)
def _documents(ontology):
    risks, reasons, mapping = ontology.get("riskTypes"), ontology.get("reasonCodes"), ontology.get("reasonCodeRiskType")
    if not isinstance(risks, list) or not isinstance(reasons, list) or not isinstance(mapping, dict): raise SecurityV3ConstraintError("invalid ontology")
    out=[]
    for reason in reasons:
        risk=mapping.get(reason)
        if risk not in risks: raise SecurityV3ConstraintError(f"unmapped reasonCode: {reason}")
        values={"riskType": risk, "reasonCode": reason, "requiresBackendValidation": True}
        for order in itertools.permutations(V3_FIELDS): out.append(json.dumps({k: values[k] for k in order}, ensure_ascii=False, separators=(",", ":")))
    return out
def build_security_v3_constraint(tokenizer, eos_token_ids, ontology, prompt=None, prompt_token_ids=None):
    baseline=tuple(prompt_token_ids or _token_ids(tokenizer, prompt or ""))
    if prompt is not None and tuple(_token_ids(tokenizer, prompt)) != baseline: raise SecurityV3ConstraintError("prompt tokenization mismatch")
    sequences=[]; seen=set()
    for document in _documents(ontology):
        full=_token_ids(tokenizer, (prompt or "") + document); prefix=_token_ids(tokenizer, prompt or "") if prompt is not None else ()
        if prompt is not None and full[:len(prefix)] != prefix: raise SecurityV3ConstraintError("prompt prefix mismatch")
        tokens=full[len(prefix):]; expected=(prompt or "")+document
        if not tokens or _decode(tokenizer, full if prompt is not None else tokens) != expected: raise SecurityV3ConstraintError("V3 round trip failed")
        if any(t in eos_token_ids for t in tokens): raise SecurityV3ConstraintError("EOS in V3 document")
        if tokens not in seen: seen.add(tokens); sequences.append(tokens)
    return SecurityV3TokenConstraint(sequences, eos_token_ids)
def load_ontology(path):
    value=json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict): raise SecurityV3ConstraintError("ontology must be object")
    return value