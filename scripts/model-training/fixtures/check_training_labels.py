"""Run without torch: exercise the actual nested training encoder in both trainers."""
import ast
from pathlib import Path

class Tokenizer:
    mismatch = False
    def apply_chat_template(self, messages, tokenize=False, add_generation_prompt=False, enable_thinking=None):
        assert enable_thinking is False
        return "prompt:" if add_generation_prompt else ("wrong:" if self.mismatch else "prompt:") + messages[-1]["content"]
    def __call__(self, text, add_special_tokens=False):
        return {"input_ids": list(text.encode()), "attention_mask": [1] * len(text.encode())}

for name in ("train_lora.py", "train_lora_modal.py"):
    tree = ast.parse((Path(__file__).resolve().parents[1] / name).read_text(encoding="utf-8"))
    outer = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "tokenize_dataset")
    encoder = next(n for n in outer.body if isinstance(n, ast.FunctionDef) and n.name == "encode")
    tokenizer = Tokenizer()
    scope = {"Any": object, "tokenizer": tokenizer, "max_length": 9}
    exec(compile(ast.Module(body=[encoder], type_ignores=[]), name, "exec"), scope)
    sample = {"messages": [{"role": "user", "content": "query"}, {"role": "assistant", "content": "{}"}]}
    result = scope["encode"](sample)
    assert result["labels"] == [-100] * 7 + [123, 125]
    for limit, mismatch, role in ((8, False, "assistant"), (99, True, "assistant"), (99, False, "user")):
        scope["max_length"] = limit
        tokenizer.mismatch = mismatch
        sample["messages"][-1]["role"] = role
        try:
            scope["encode"](sample)
        except ValueError:
            pass
        else:
            raise AssertionError((name, limit, mismatch, role))
print("Both trainers reject truncated targets and misaligned prefixes")
