from __future__ import annotations
import json, sys
from pathlib import Path
from transformers import AutoTokenizer, GPT2Config, GPT2LMHeadModel
import torch
sys.path.insert(0, str(Path(__file__).parent))
from security_v3_constrained_decoding import V3_FIELDS, _documents, build_security_v3_constraint, load_ontology, SecurityV3ConstraintError
ROOT=Path(__file__).resolve().parents[2]
MODEL=ROOT/'.local-models'/'Qwen3.5-0.8B'
ONTOLOGY=ROOT/'packages'/'desktop'/'src'/'process'/'services'/'security'/'security-ontology-v1.json'
def main():
 tok=AutoTokenizer.from_pretrained(MODEL, local_files_only=True); ont=load_ontology(ONTOLOGY)
 docs=_documents(ont); c=build_security_v3_constraint(tok,[tok.eos_token_id],ont)
 assert len(docs)==12*6 and c.sequence_count==len(docs)
 seen_r=set(); seen_reason=set()
 for d in docs:
  v=json.loads(d); assert set(v)==set(V3_FIELDS); assert v['requiresBackendValidation'] is True
  assert ont['reasonCodeRiskType'][v['reasonCode']]==v['riskType']; seen_r.add(v['riskType']); seen_reason.add(v['reasonCode'])
  ids=tok(d, add_special_tokens=False)['input_ids']; assert tok.decode(ids,skip_special_tokens=False,clean_up_tokenization_spaces=False)==d; assert c.allowed_tokens(ids)==[tok.eos_token_id]
 assert seen_r==set(ont['riskTypes']) and seen_reason==set(ont['reasonCodes'])
 prompt=tok.apply_chat_template([{'role':'system','content':'Return exactly three fields.'},{'role':'user','content':'{}'}], tokenize=False, add_generation_prompt=True, enable_thinking=False)
 inp=tok(prompt, return_tensors='pt'); pc=build_security_v3_constraint(tok,[tok.eos_token_id],ont,prompt=prompt,prompt_token_ids=inp['input_ids'][0].tolist())
 model=GPT2LMHeadModel(GPT2Config(vocab_size=len(tok),n_positions=512,n_ctx=512,n_embd=8,n_layer=1,n_head=1,eos_token_id=tok.eos_token_id,pad_token_id=tok.pad_token_id)).eval()
 out=model.generate(**inp,do_sample=False,max_new_tokens=96,prefix_allowed_tokens_fn=pc.prefix_allowed_tokens_fn(inp['input_ids'].shape[1]))
 text=tok.decode(out[0,inp['input_ids'].shape[1]:],skip_special_tokens=True,clean_up_tokenization_spaces=False); assert set(json.loads(text))==set(V3_FIELDS)
 bad=next(i for i in range(tok.vocab_size) if i not in c.allowed_tokens(tok(docs[0],add_special_tokens=False)['input_ids'][:-1]))
 try: c.allowed_tokens([bad]); raise AssertionError('invalid prefix accepted')
 except SecurityV3ConstraintError: pass
 print(json.dumps({'pass':True,'documents':len(docs),'states':sum(1 for _ in docs),'fields':list(V3_FIELDS),'redactionsReachable':False,'actionReachable':False,'semanticGoldLeakage':False,'postGenerationRepair':False},sort_keys=True))
if __name__=='__main__': main()