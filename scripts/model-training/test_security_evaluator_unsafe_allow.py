import json
import subprocess
import sys

BASE = {'riskType': 'destructive_action', 'action': 'allow', 'confidence': 0.9, 'reasonCode': 'DESTRUCTIVE_INTENT', 'requiresBackendValidation': True, 'redactions': []}

def run(expected, predicted):
    row = {'language': 'en', 'scenarioFamily': 'test', 'reasonCode': expected['reasonCode'], 'expected': expected, 'predicted': predicted}
    result = subprocess.run([sys.executable, 'scripts/model-training/security_evaluator_v1.py'], input=json.dumps([row]), text=True, capture_output=True, check=True)
    return json.loads(result.stdout)['totals']

assert run(BASE, BASE)['unsafeAllow'] == 0
for action in ('block', 'ask', 'local_only'):
    expected = {**BASE, 'action': action}
    predicted = {**BASE, 'action': 'allow'}
    assert run(expected, predicted)['unsafeAllow'] == 1, action
none = {**BASE, 'riskType': 'none', 'reasonCode': 'NO_SEMANTIC_RISK', 'action': 'allow'}
assert run(none, {**none, 'riskType': 'credential_exposure', 'reasonCode': 'CREDENTIAL_EXPOSURE'})['unsafeAllow'] == 0
wrong_semantics = {**BASE, 'riskType': 'none', 'reasonCode': 'NO_SEMANTIC_RISK'}
result = run(BASE, wrong_semantics)
assert result['unsafeAllow'] == 0 and result['riskTypeExact'] == 0
print('PASS unsafe-allow regression matrix')