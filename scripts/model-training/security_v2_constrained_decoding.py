"""Native, tokenizer-aware constraints for the Semantic Security V2 output.

This module deliberately constrains only the contract domain. It never receives
an expected label and never repairs text after generation.
"""
from __future__ import annotations

import itertools
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence


V2_FIELDS = ("riskType", "reasonCode", "requiresBackendValidation", "redactions")
_REDACTION_OPTIONS = (
    (),
    ("credential",),
    ("private_fields",),
    ("credential", "private_fields"),
    ("private_fields", "credential"),
)


@dataclass
class _TrieNode:
    children: dict[int, "_TrieNode"] = field(default_factory=dict)
    terminal: bool = False


class SecurityV2ConstraintError(ValueError):
    """Raised when the pinned tokenizer cannot represent the frozen domain."""


class SecurityV2TokenConstraint:
    """A finite prefix trie accepted by Transformers generation hooks."""

    def __init__(self, token_sequences: Iterable[Sequence[int]], eos_token_ids: Sequence[int]):
        sequences = [tuple(int(token) for token in sequence) for sequence in token_sequences]
        if not sequences:
            raise SecurityV2ConstraintError("empty V2 language")
        if not eos_token_ids:
            raise SecurityV2ConstraintError("missing EOS token")
        self._root = _TrieNode()
        self._sequence_count = len(sequences)
        for sequence in sequences:
            if not sequence:
                raise SecurityV2ConstraintError("empty V2 sequence")
            node = self._root
            for token in sequence:
                node = node.children.setdefault(token, _TrieNode())
            node.terminal = True
        self._eos_token_ids = tuple(dict.fromkeys(int(token) for token in eos_token_ids))
        self._state_count = self._count_nodes(self._root)

    @staticmethod
    def _count_nodes(node: _TrieNode) -> int:
        return 1 + sum(SecurityV2TokenConstraint._count_nodes(child) for child in node.children.values())

    @property
    def sequence_count(self) -> int:
        return self._sequence_count

    @property
    def state_count(self) -> int:
        return self._state_count

    @property
    def eos_token_ids(self) -> tuple[int, ...]:
        return self._eos_token_ids

    def allowed_tokens(self, generated_token_ids: Sequence[int]) -> list[int]:
        """Return legal next token IDs, failing closed for an unknown prefix."""
        node = self._root
        for token in generated_token_ids:
            child = node.children.get(int(token))
            if child is None:
                raise SecurityV2ConstraintError("generated prefix is outside V2 language")
            node = child
        if node.terminal:
            return list(self._eos_token_ids)
        if not node.children:
            raise SecurityV2ConstraintError("V2 language has no continuation")
        return sorted(node.children)

    def prefix_allowed_tokens_fn(self, prompt_length: int) -> Callable[[int, Any], list[int]]:
        """Build the callback expected by Transformers generate()."""
        if prompt_length < 0:
            raise SecurityV2ConstraintError("negative prompt length")

        def callback(_batch_id: int, input_ids: Any) -> list[int]:
            values = input_ids.tolist() if hasattr(input_ids, "tolist") else list(input_ids)
            if values and isinstance(values[0], list):
                values = values[0]
            return self.allowed_tokens(values[prompt_length:])

        return callback

    def logits_processor(self, prompt_length: int) -> Any:
        """Return a first-party Transformers-compatible token processor."""
        constraint = self

        class Processor:
            def __call__(self, input_ids: Any, scores: Any) -> Any:
                rows = input_ids.tolist() if hasattr(input_ids, "tolist") else list(input_ids)
                if rows and not isinstance(rows[0], list):
                    rows = [rows]
                original = scores.clone()
                for row_index, row in enumerate(rows):
                    try:
                        allowed = constraint.allowed_tokens(row[prompt_length:])
                    except SecurityV2ConstraintError:
                        # An impossible prefix must fail closed, never fall back to an arbitrary token.
                        scores[row_index, :] = float("-inf")
                        raise
                    scores[row_index, :] = float("-inf")
                    scores[row_index, allowed] = original[row_index, allowed]
                return scores

        return Processor()


def _token_ids(tokenizer: Any, text: str) -> tuple[int, ...]:
    encoded = tokenizer(text, add_special_tokens=False)
    values = encoded["input_ids"] if isinstance(encoded, dict) else encoded.input_ids
    if values and isinstance(values[0], list):
        values = values[0]
    return tuple(int(token) for token in values)


def _decode(tokenizer: Any, values: Sequence[int]) -> str:
    try:
        return tokenizer.decode(
            list(values), skip_special_tokens=False, clean_up_tokenization_spaces=False
        )
    except TypeError:
        return tokenizer.decode(list(values), skip_special_tokens=False)


def _ontology_values(ontology: dict[str, Any]) -> tuple[list[str], list[str], dict[str, str]]:
    risk_types = ontology.get("riskTypes")
    reason_codes = ontology.get("reasonCodes")
    mapping = ontology.get("reasonCodeRiskType")
    if not isinstance(risk_types, list) or not all(isinstance(item, str) for item in risk_types):
        raise SecurityV2ConstraintError("invalid ontology riskTypes")
    if not isinstance(reason_codes, list) or not all(isinstance(item, str) for item in reason_codes):
        raise SecurityV2ConstraintError("invalid ontology reasonCodes")
    if not isinstance(mapping, dict):
        raise SecurityV2ConstraintError("invalid ontology reasonCodeRiskType")
    return risk_types, reason_codes, mapping


def _documents(ontology: dict[str, Any]) -> list[str]:
    risk_types, reason_codes, mapping = _ontology_values(ontology)
    allowed_redactions = ontology.get("redactions", {}).get("allowedValues")
    if allowed_redactions != ["credential", "private_fields"]:
        raise SecurityV2ConstraintError("unexpected V2 redaction domain")
    values: list[str] = []
    for reason_code in reason_codes:
        risk_type = mapping.get(reason_code)
        if risk_type not in risk_types:
            raise SecurityV2ConstraintError(f"unmapped reasonCode: {reason_code}")
        field_values: dict[str, Any] = {
            "riskType": risk_type,
            "reasonCode": reason_code,
            "requiresBackendValidation": True,
        }
        for redactions in _REDACTION_OPTIONS:
            field_values["redactions"] = list(redactions)
            # The schema does not require key order, so preserve that freedom.
            for order in itertools.permutations(V2_FIELDS):
                ordered = {key: field_values[key] for key in order}
                values.append(json.dumps(ordered, ensure_ascii=False, separators=(",", ":")))
    return values


def build_security_v2_constraint(
    tokenizer: Any,
    eos_token_ids: Sequence[int],
    ontology: dict[str, Any],
    prompt: str | None = None,
    prompt_token_ids: Sequence[int] | None = None,
) -> SecurityV2TokenConstraint:
    """Build and round-trip the complete canonical V2 language."""
    if prompt is not None:
        baseline = tuple(prompt_token_ids or _token_ids(tokenizer, prompt))
        if tuple(_token_ids(tokenizer, prompt)) != baseline:
            raise SecurityV2ConstraintError("runtime prompt tokenization mismatch")
    token_sequences: list[tuple[int, ...]] = []
    seen: set[tuple[int, ...]] = set()
    for document in _documents(ontology):
        full_tokens = _token_ids(tokenizer, (prompt or "") + document)
        prefix = tuple(_token_ids(tokenizer, prompt)) if prompt is not None else ()
        if prompt is not None and full_tokens[: len(prefix)] != prefix:
            raise SecurityV2ConstraintError("tokenizer prompt prefix mismatch")
        tokens = full_tokens[len(prefix) :]
        round_trip = _decode(tokenizer, full_tokens) if prompt is not None else _decode(tokenizer, tokens)
        expected_text = (prompt or "") + document
        if not tokens or round_trip != expected_text:
            raise SecurityV2ConstraintError("tokenizer cannot round-trip V2 document")
        if any(token in eos_token_ids for token in tokens):
            raise SecurityV2ConstraintError("EOS appears inside V2 document")
        if tokens not in seen:
            seen.add(tokens)
            token_sequences.append(tokens)
    return SecurityV2TokenConstraint(token_sequences, eos_token_ids)


def load_ontology(path: str | Path) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SecurityV2ConstraintError("ontology must be an object")
    return value
