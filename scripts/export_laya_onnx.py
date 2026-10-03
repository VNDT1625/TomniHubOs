#!/usr/bin/env python3
"""
Canonical ONNX INT8 Exporter for Laya Decision Engine (convaiinnovations/laya-multilingual).
Quantizes 1.3GB PyTorch model weights down to ~308MB for offline, low-latency packaging.
"""

import argparse
import os
import sys
import time
import numpy as np
import torch
import torch.nn.functional as F
import transformers.masking_utils
from onnxruntime.quantization import quantize_dynamic, QuantType
import onnxruntime as ort
import laya


def apply_jit_patches():
    """Patch transformers sdpa_mask and PyTorch JIT tracing anomalies."""
    def patched_sdpa_mask(
        batch_size: int,
        q_length: int,
        kv_length: int,
        q_offset: int = 0,
        kv_offset: int = 0,
        mask_function=transformers.masking_utils.causal_mask_function,
        attention_mask: torch.Tensor | None = None,
        local_size: int | None = None,
        allow_is_causal_skip: bool = True,
        allow_is_bidirectional_skip: bool = False,
        allow_torch_fix: bool = True,
        use_vmap: bool = False,
        device: torch.device | str = "cpu",
        **kwargs,
    ) -> torch.Tensor | None:
        if isinstance(q_length, torch.Tensor) and q_length.ndim > 0:
            q_length, q_offset = q_length.shape[0], q_length[0].to(device)

        padding_mask = transformers.masking_utils.prepare_padding_mask(attention_mask, kv_length, kv_offset)

        if allow_is_causal_skip and transformers.masking_utils._ignore_causal_mask_sdpa(padding_mask, q_length, kv_length, kv_offset, local_size):
            return None
        if allow_is_bidirectional_skip and transformers.masking_utils._ignore_bidirectional_mask_sdpa(padding_mask, kv_length, local_size):
            return None

        if padding_mask is not None:
            mask_function = transformers.masking_utils.and_masks(mask_function, transformers.masking_utils.padding_mask_function(padding_mask))

        batch_arange = torch.arange(batch_size, device=device)
        head_arange = torch.arange(1, device=device)
        q_arange = torch.arange(q_length, device=device) + q_offset
        kv_arange = torch.arange(kv_length, device=device) + kv_offset

        attention_mask = mask_function(*transformers.masking_utils._non_vmap_expansion_sdpa(batch_arange, head_arange, q_arange, kv_arange))
        attention_mask = attention_mask.expand(batch_size, -1, q_length, kv_length)
        return attention_mask

    transformers.masking_utils.sdpa_mask = patched_sdpa_mask
    transformers.masking_utils.ALL_MASK_ATTENTION_FUNCTIONS["sdpa"] = patched_sdpa_mask


def patch_head_layers(model):
    """Patch TransformerEncoderLayer in model.head to guarantee dynamic sequence lengths in ONNX."""
    def dynamic_encoder_layer_forward(self, src, src_mask=None, src_key_padding_mask=None, is_causal=False):
        x = self.norm1(src)
        B, S, E = x.shape
        H = self.self_attn.num_heads
        D = self.self_attn.head_dim
        qkv = F.linear(x, self.self_attn.in_proj_weight, self.self_attn.in_proj_bias)
        q, k, v = qkv.chunk(3, dim=-1)
        q = q.view(B, S, H, D).transpose(1, 2)
        k = k.view(B, S, H, D).transpose(1, 2)
        v = v.view(B, S, H, D).transpose(1, 2)

        if src_key_padding_mask is not None:
            mask = src_key_padding_mask.unsqueeze(1).unsqueeze(2)
            attn_bias = torch.zeros((B, 1, 1, S), dtype=x.dtype, device=x.device).masked_fill(mask, -1e4)
            attn_out = F.scaled_dot_product_attention(q, k, v, attn_mask=attn_bias)
        else:
            attn_out = F.scaled_dot_product_attention(q, k, v)

        attn_out = attn_out.transpose(1, 2).reshape(B, S, E)
        attn_out = self.self_attn.out_proj(attn_out)
        x = src + self.dropout1(attn_out)
        ff = self.linear2(self.dropout(self.activation(self.linear1(self.norm2(x)))))
        return x + self.dropout2(ff)

    if model.head is not None:
        for layer in model.head.layers:
            layer.forward = dynamic_encoder_layer_forward.__get__(layer, layer.__class__)


def export_laya_onnx(model_id: str, output_path: str, keep_fp32: bool = False, verify: bool = True):
    print(f"[LayaExporter] Loading model '{model_id}'...")
    apply_jit_patches()
    agent = laya.load(model_id)
    model = agent.model.cpu().eval()
    patch_head_layers(model)

    output_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(output_dir, exist_ok=True)
    fp32_path = output_path.replace(".onnx", "_fp32.onnx")

    dummy_state = "Kiểm tra mật khẩu tài khoản người dùng"
    dummy_q = agent._to_internal({
        "type": "choice",
        "instructions": "Nội dung có chứa mật khẩu không?",
        "criteria": {"yes": "Có", "no": "Không"}
    })
    seq, markers = laya.common.build_sequence(agent.tok, dummy_state, dummy_q, 512, 192)
    b = laya.common.collate_items([[{"ids": seq, "markers": markers, "qtype": laya.common.QTYPES[dummy_q["t"]]}]], agent.tok.pad_token_id)

    print(f"[LayaExporter] Exporting fully dynamic FP32 ONNX graph to '{fp32_path}'...")
    t0 = time.perf_counter()
    torch.onnx.export(
        model,
        (b["input_ids"], b["attention_mask"], b["marker_pos"], b["marker_mask"], b["qtype"]),
        fp32_path,
        input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
        output_names=["logits", "act_logits"],
        dynamic_axes={
            "input_ids": {0: "batch_size", 1: "seq_len"},
            "attention_mask": {0: "batch_size", 1: "seq_len"},
            "marker_pos": {0: "batch_size", 1: "kmax"},
            "marker_mask": {0: "batch_size", 1: "kmax"},
            "qtype": {0: "batch_size"},
            "logits": {0: "batch_size", 1: "kmax"},
            "act_logits": {0: "batch_size"},
        },
        opset_version=17,
        do_constant_folding=True,
    )
    sz_fp32 = os.path.getsize(fp32_path) / (1024 * 1024)
    print(f"[LayaExporter] FP32 exported in {time.perf_counter() - t0:.2f}s ({sz_fp32:.1f} MB)")

    print(f"[LayaExporter] Quantizing to INT8 at '{output_path}'...")
    t0 = time.perf_counter()
    quantize_dynamic(
        model_input=fp32_path,
        model_output=output_path,
        weight_type=QuantType.QInt8,
    )
    sz_int8 = os.path.getsize(output_path) / (1024 * 1024)
    print(f"[LayaExporter] INT8 quantized in {time.perf_counter() - t0:.2f}s ({sz_int8:.1f} MB)")
    print(f"[LayaExporter] Compression ratio: {sz_fp32 / sz_int8:.2f}x")

    if not keep_fp32 and os.path.exists(fp32_path):
        os.remove(fp32_path)
        print(f"[LayaExporter] Removed temporary FP32 graph.")

    if verify:
        print("[LayaExporter] Verifying INT8 model with sample inferences...")
        sess = ort.InferenceSession(output_path, providers=["CPUExecutionProvider"])
        sample_tests = [
            ("Mật khẩu của tôi là SecretPass123", "Nội dung có chứa mật khẩu không?"),
            ("Mở trình duyệt web để tra cứu thông tin", "Ý định công cụ người dùng là gì?")
        ]
        for idx, (text, instr) in enumerate(sample_tests, 1):
            q_item = agent._to_internal({
                "type": "choice",
                "instructions": instr,
                "criteria": {"yes": "Có", "no": "Không"}
            })
            s, m = laya.common.build_sequence(agent.tok, text, q_item, 512, 192)
            batch = laya.common.collate_items([[{"ids": s, "markers": m, "qtype": laya.common.QTYPES[q_item["t"]]}]], agent.tok.pad_token_id)
            inputs = {
                "input_ids": batch["input_ids"].numpy(),
                "attention_mask": batch["attention_mask"].numpy(),
                "marker_pos": batch["marker_pos"].numpy(),
                "marker_mask": batch["marker_mask"].numpy(),
                "qtype": batch["qtype"].numpy(),
            }
            t_inf = time.perf_counter()
            out = sess.run(None, inputs)
            lat = (time.perf_counter() - t_inf) * 1000
            print(f"  Sample {idx}: {lat:.2f}ms | shape={inputs['input_ids'].shape} | logits={out[0][0]}")

    print(f"\n[LayaExporter] SUCCESS: Exported Laya ONNX INT8 model ready at '{output_path}'")


def main():
    parser = argparse.ArgumentParser(description="Export Laya PyTorch checkpoint to ONNX INT8")
    parser.add_argument("--model", default="convaiinnovations/laya-multilingual", help="HuggingFace model ID or local path")
    parser.add_argument("--output", default="resources/models/laya_multilingual_int8.onnx", help="Output path for INT8 ONNX file")
    parser.add_argument("--keep-fp32", action="store_true", help="Keep intermediate FP32 ONNX model")
    parser.add_argument("--no-verify", action="store_true", help="Skip verification benchmark")
    args = parser.parse_args()

    export_laya_onnx(
        model_id=args.model,
        output_path=args.output,
        keep_fp32=args.keep_fp32,
        verify=not args.no_verify,
    )


if __name__ == "__main__":
    main()
