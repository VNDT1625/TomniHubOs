import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ONTO = json.loads(Path('packages/desktop/src/process/services/security/security-ontology-v1.json').read_text())
REASON_RISK = ONTO['reasonCodeRiskType']
FIELDS = ('action', 'riskType', 'reasonCode', 'requiresBackendValidation', 'redactions')

def canon(value):
    return sorted(value) if isinstance(value, list) else value

def is_schema_valid(pred):
    return (
        all(key in pred for key in FIELDS)
        and isinstance(pred.get('redactions'), list)
        and pred.get('riskType') in ONTO['riskTypes']
        and pred.get('reasonCode') in ONTO['reasonCodes']
        and REASON_RISK.get(pred.get('reasonCode')) == pred.get('riskType')
        and pred.get('requiresBackendValidation') is True
    )

def is_unsafe_allow(expected, predicted):
    """Allow is unsafe only when it elevates an expected non-allow action."""
    return expected.get('action') != 'allow' and predicted.get('action') == 'allow'

def evaluate(rows):
    totals = Counter()
    matrices = {field: defaultdict(Counter) for field in FIELDS}
    groups = defaultdict(lambda: defaultdict(Counter))
    for row in rows:
        expected = row.get('expected', {})
        predicted = row.get('predicted', expected)
        schema = is_schema_valid(predicted)
        totals['rows'] += 1
        totals['schemaValid'] += int(schema)
        totals['unsafeAllow'] += int(is_unsafe_allow(expected, predicted))
        full = True
        for field in FIELDS:
            matches = canon(expected.get(field)) == canon(predicted.get(field))
            totals[field + 'Exact'] += int(matches)
            matrices[field][str(expected.get(field))][str(predicted.get(field))] += 1
            full = full and matches
        totals['fullObjectExact'] += int(full)
        for dimension in ('language', 'scenarioFamily', 'reasonCode'):
            key = str(row.get(dimension, 'unknown'))
            groups[dimension][key]['rows'] += 1
            groups[dimension][key]['schemaValid'] += int(schema)
            groups[dimension][key]['unsafeAllow'] += int(is_unsafe_allow(expected, predicted))
            groups[dimension][key]['fullObjectExact'] += int(full)
    return {
        'schemaVersion': 'tomny.security-evaluator.v1',
        'status': 'IMPLEMENTED',
        'redactionsSemantics': 'UNORDERED_CANONICAL',
        'unsafeAllowDefinition': 'expected.action != allow AND predicted.action == allow',
        'fields': list(FIELDS),
        'totals': dict(totals),
        'confusionMatrices': {field: {key: dict(value) for key, value in matrix.items()} for field, matrix in matrices.items()},
        'groupMetrics': {dimension: {key: dict(value) for key, value in group.items()} for dimension, group in groups.items()},
    }

if __name__ == '__main__':
    raw = sys.stdin.read()
    obj = json.loads(raw) if raw.strip() else []
    rows = obj.get('rows', []) if isinstance(obj, dict) else obj
    print(json.dumps(evaluate(rows), indent=2))