import json
import unittest
from security_semantic_evaluator_v2 import evaluate

class SecuritySemanticEvaluatorV2Tests(unittest.TestCase):
    def test_ignores_legacy_action_and_scores_semantic_fields(self):
        rows = [{
            'expected': {'action': 'block', 'riskType': 'prompt_injection', 'reasonCode': 'PROMPT_INJECTION', 'requiresBackendValidation': True, 'redactions': []},
            'predicted': {'action': 'allow', 'confidence': 0.99, 'riskType': 'prompt_injection', 'reasonCode': 'PROMPT_INJECTION', 'requiresBackendValidation': True, 'redactions': []},
        }]
        result = evaluate(rows)
        self.assertEqual(result['metrics']['schemaValid'], 1.0)
        self.assertEqual(result['metrics']['riskTypeExact'], 1.0)
        self.assertEqual(result['metrics']['reasonCodeExact'], 1.0)
        self.assertNotIn('action', result['fields'])

    def test_rejects_noncanonical_redactions(self):
        rows = [{
            'expected': {'riskType': 'prompt_injection', 'reasonCode': 'PROMPT_INJECTION', 'requiresBackendValidation': True, 'redactions': []},
            'predicted': {'riskType': 'prompt_injection', 'reasonCode': 'PROMPT_INJECTION', 'requiresBackendValidation': True, 'redactions': ['untrusted_instruction']},
        }]
        result = evaluate(rows)
        self.assertEqual(result['metrics']['schemaValid'], 0.0)

if __name__ == '__main__':
    unittest.main()