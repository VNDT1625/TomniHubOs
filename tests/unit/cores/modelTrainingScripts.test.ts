import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const trainer = readFileSync(resolve(process.cwd(), 'scripts/model-training/train_lora.py'), 'utf8');
const verifier = readFileSync(resolve(process.cwd(), 'scripts/model-training/verify_adapters.py'), 'utf8');
const queueRunner = readFileSync(resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py'), 'utf8');
const benchmark = readFileSync(resolve(process.cwd(), 'scripts/model-training/benchmark_adapters.py'), 'utf8');
const postBenchmark = readFileSync(resolve(process.cwd(), 'scripts/model-training/post_training_benchmark.py'), 'utf8');

type VerifierProbeResults = Record<string, string>;
type VerifierOutputProbeResults = Record<string, string | boolean>;

type SecurityPilotHeldoutProbe = {
  rows: number;
  semanticGroups: number;
  verified: boolean;
  tamperRejected: string;
};

function runSecurityPilotHeldoutProbe(): SecurityPilotHeldoutProbe {
  const script = String.raw`
import json
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(sys.argv[1]).resolve()
builder = root / 'scripts' / 'model-training' / 'fixtures' / 'build_security_pilot_heldout_v1.py'
fixture = root / 'scripts' / 'model-training' / 'fixtures' / 'security-pilot-heldout-v1.json'
training = root / '.training-data-v5-security'
with tempfile.TemporaryDirectory() as temporary:
    output = Path(temporary) / 'pilot-heldout'
    command = [sys.executable, str(builder), '--fixture', str(fixture), '--training-root', str(training), '--output', str(output)]
    built = json.loads(subprocess.check_output(command, cwd=root, text=True))
    verified = json.loads(subprocess.check_output([*command, '--verify'], cwd=root, text=True))
    test_path = output / 'immutable-test' / 'security-test.jsonl'
    test_path.chmod(0o666)
    test_path.write_bytes(b'{"tampered":true}\n')
    tamper = subprocess.run([*command, '--verify'], cwd=root, text=True, capture_output=True)
    print(json.dumps({
        'rows': built['rows'],
        'semanticGroups': built['semanticGroups'],
        'verified': verified['verified'],
        'tamperRejected': tamper.stderr.strip(),
    }))
`;
  return JSON.parse(
    execFileSync('python', ['-c', script, process.cwd()], { encoding: 'utf8' })
  ) as SecurityPilotHeldoutProbe;
}

function runProvenanceContractProbe(): VerifierProbeResults {
  const script = String.raw`
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

sys.modules['torch'] = types.ModuleType('torch')
safetensors = types.ModuleType('safetensors')
safetensors.safe_open = lambda *args, **kwargs: None
sys.modules['safetensors'] = safetensors
spec = importlib.util.spec_from_file_location('verify_adapters', sys.argv[1])
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def outcome(action):
    try:
        action()
    except Exception as error:
        return f'{type(error).__name__}: {error}'
    return 'ok'


def contract(candidate_id, candidate_version):
    return {
        'purpose': candidate_id.rsplit('.', 1)[-1],
        'candidateId': candidate_id,
        'candidateVersion': candidate_version,
        'recipeSha256': '1' * 64,
        'datasetManifestSha256': '2' * 64,
        'trainerImplementationSha256': verifier.sha256_file(Path(sys.argv[1]).with_name('train_lora.py')),
        'baseModel': {
            'modelId': 'Qwen/Qwen3.5-0.8B',
            'revision': 'pinned-revision',
            'contentSha256': '3' * 64,
        },
    }


def verify_schema_downgrade():
    with tempfile.TemporaryDirectory() as temporary:
        candidate = Path(temporary)
        (candidate / 'adapter_config.json').write_text('{}', encoding='utf-8')
        (candidate / 'adapter_model.safetensors').write_bytes(b'not-reached')
        (candidate / 'training_manifest.json').write_text(json.dumps({
            'schemaVersion': 'tomny.training-provenance.v1',
            'completed': True,
            'textOnly': True,
        }), encoding='utf-8')
        verifier.verify_adapter(candidate)


def provenance_shape(**overrides):
    value = {key: None for key in verifier.PROVENANCE_REQUIRED_FIELDS}
    value.update({
        'schemaVersion': verifier.PROVENANCE_SCHEMA,
        'targetProfile': 'last-block',
    })
    for name, fields in verifier.PROVENANCE_OBJECT_FIELDS.items():
        value[name] = {key: None for key in fields}
    value.update(overrides)
    return value


candidate5 = contract('com.tomny.core.security', '0.1.0-candidate.5')
current_receipt = {'schemaVersion': 'tomny.training-preflight.v1', 'resumeContract': candidate5.copy()}
mismatch_receipt = {
    'schemaVersion': 'tomny.training-preflight.v1',
    'resumeContract': {**candidate5, 'trainerImplementationSha256': '0' * 64},
}
candidate5_missing_receipt = {
    'schemaVersion': 'tomny.training-preflight.v1',
    'resumeContract': {key: value for key, value in candidate5.items() if key != 'trainerImplementationSha256'},
}
legacy = contract('com.tomny.core.assistant', '0.1.0-candidate.1')
legacy_receipt = {
    'schemaVersion': 'tomny.training-preflight.v1',
    'createdAt': '2026-07-26T15:18:30.438178+00:00',
    'resumeContract': {key: value for key, value in legacy.items() if key != 'trainerImplementationSha256'},
}
print(json.dumps({
    'currentGoodHash': outcome(lambda: verifier.verify_preflight_resume_contract(Path('candidate5'), current_receipt, candidate5)),
    'currentHashMismatch': outcome(lambda: verifier.verify_preflight_resume_contract(Path('candidate5'), mismatch_receipt, candidate5)),
    'legacyMissingField': outcome(lambda: verifier.verify_preflight_resume_contract(Path('candidate1'), legacy_receipt, legacy)),
    'candidate5MissingField': outcome(lambda: verifier.verify_preflight_resume_contract(Path('candidate5'), candidate5_missing_receipt, candidate5)),
    'schemaDowngrade': outcome(verify_schema_downgrade),
    'knownManifestShape': outcome(lambda: verifier.verify_provenance_schema(Path('candidate5'), provenance_shape())),
    'unknownManifestField': outcome(lambda: verifier.verify_provenance_schema(
        Path('candidate5'),
        {**provenance_shape(), 'futureField': True},
    )),
    'unknownTargetProfile': outcome(lambda: verifier.verify_provenance_schema(
        Path('candidate5'),
        provenance_shape(targetProfile='future-unknown-profile'),
    )),
    'knownBf16Precision': outcome(lambda: verifier.verify_provenance_schema(
        Path('candidate5'),
        provenance_shape(precision='bf16'),
    )),
    'unknownPrecision': outcome(lambda: verifier.verify_provenance_schema(
        Path('candidate5'),
        provenance_shape(precision='fp8'),
    )),
}))
`;
  const verifierPath = resolve(process.cwd(), 'scripts/model-training/verify_adapters.py');
  return JSON.parse(execFileSync('python', ['-c', script, verifierPath], { encoding: 'utf8' })) as VerifierProbeResults;
}

function runSafeFinalizeVerifierProbe(): VerifierProbeResults {
  const script = String.raw`
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

sys.modules['torch'] = types.ModuleType('torch')
safetensors = types.ModuleType('safetensors')
safetensors.safe_open = lambda *args, **kwargs: None
sys.modules['safetensors'] = safetensors
spec = importlib.util.spec_from_file_location('verify_adapters', sys.argv[1])
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

BEST = 0.047743719071149826
EVAL = 0.047745801508426666
TOLERANCE = max(5e-5, abs(BEST) * 1e-4)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_case(root, name):
    candidate = root / name
    checkpoint = candidate / 'checkpoint-800'
    checkpoint.mkdir(parents=True)
    weights = checkpoint / 'adapter_model.safetensors'
    weights.write_bytes(b'safe-weights')
    state_path = checkpoint / 'trainer_state.json'
    state = {
        'global_step': 800,
        'max_steps': 800,
        'best_metric': BEST,
        'best_model_checkpoint': str(checkpoint.resolve()),
    }
    state_path.write_text(json.dumps(state), encoding='utf-8')
    manifest = {
        'steps': 800,
        'metrics': {
            'train': {'safeFinalization': True},
            'validation': {'eval_loss': EVAL},
            'bestEvalLoss': BEST,
        },
        'validationGate': {
            'configuredRegression': 0.0,
            'numericTolerance': TOLERANCE,
            'observedDelta': EVAL - BEST,
            'allowedMaximum': BEST + TOLERANCE,
            'policy': 'absolute-or-relative-floating-point-tolerance',
        },
        'finalization': {
            'mode': 'checkpoint-eval-only',
            'sourceStep': 800,
            'sourceCheckpoint': str(checkpoint.resolve()),
            'sourceAdapterSha256': sha256(weights),
            'trainerStateSha256': sha256(state_path),
            'unsafeStateLoaded': False,
            'optimizerStepsExecuted': 0,
        },
    }
    return candidate, checkpoint, state_path, manifest, {'training': {'maxSteps': 800}}


def run_case(root, name):
    candidate, checkpoint, state_path, manifest, recipe = make_case(root, name)
    if name == 'missingValidation':
        del manifest['metrics']['validation']
    elif name == 'nonFiniteValidation':
        manifest['metrics']['validation']['eval_loss'] = float('nan')
    elif name == 'inconsistentGate':
        manifest['validationGate']['observedDelta'] += 0.01
    elif name == 'exceededGate':
        manifest['metrics']['validation']['eval_loss'] = BEST + 0.1
        manifest['validationGate']['observedDelta'] = 0.1
    elif name == 'unsafeState':
        manifest['finalization']['unsafeStateLoaded'] = True
    elif name == 'optimizerStep':
        manifest['finalization']['optimizerStepsExecuted'] = 1
    elif name == 'optimizerBoolean':
        manifest['finalization']['optimizerStepsExecuted'] = False
    elif name == 'sourceHash':
        manifest['finalization']['sourceAdapterSha256'] = '0' * 64
    elif name == 'sourceStep':
        manifest['finalization']['sourceStep'] = 799
    elif name == 'sourceBoolean':
        manifest['finalization']['sourceStep'] = True
    elif name == 'bestMetric':
        state = json.loads(state_path.read_text(encoding='utf-8'))
        state['best_metric'] = BEST + 0.1
        state_path.write_text(json.dumps(state), encoding='utf-8')
        manifest['finalization']['trainerStateSha256'] = sha256(state_path)
    try:
        validation = verifier.verify_validation_evidence(candidate, manifest)
        verifier.verify_safe_finalization(candidate, manifest, recipe, validation)
        return 'ok'
    except Exception as error:
        return f'{type(error).__name__}: {error}'


names = [
    'good',
    'missingValidation',
    'nonFiniteValidation',
    'inconsistentGate',
    'exceededGate',
    'unsafeState',
    'optimizerStep',
    'optimizerBoolean',
    'sourceHash',
    'sourceStep',
    'sourceBoolean',
    'bestMetric',
]
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    print(json.dumps({name: run_case(root, name) for name in names}))
`;
  const verifierPath = resolve(process.cwd(), 'scripts/model-training/verify_adapters.py');
  return JSON.parse(execFileSync('python', ['-c', script, verifierPath], { encoding: 'utf8' })) as VerifierProbeResults;
}

function runVerifierOutputWriteProbe(): VerifierOutputProbeResults {
  const script = String.raw`
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

sys.modules['torch'] = types.ModuleType('torch')
safetensors = types.ModuleType('safetensors')
safetensors.safe_open = lambda *args, **kwargs: None
sys.modules['safetensors'] = safetensors
spec = importlib.util.spec_from_file_location('verify_adapters', sys.argv[1])
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

def outcome(action):
    try:
        action()
    except Exception as error:
        return f'{type(error).__name__}: {error}'
    return 'accepted'

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    existing = root / 'verification-report.json'
    existing.write_text('original', encoding='utf-8')
    created = root / 'nested' / 'verification-report.json'
    verifier.write_new_text_atomic(created, '{"verified": true}\n')
    print(json.dumps({
        'overwrite': outcome(lambda: verifier.write_new_text_atomic(existing, 'replacement')),
        'originalPreserved': existing.read_text(encoding='utf-8') == 'original',
        'createdContent': created.read_text(encoding='utf-8'),
    }))
`;
  const verifierPath = resolve(process.cwd(), 'scripts/model-training/verify_adapters.py');
  return JSON.parse(
    execFileSync('python', ['-c', script, verifierPath], { encoding: 'utf8' })
  ) as VerifierOutputProbeResults;
}

function runValidationGateMigrationProbe(): VerifierProbeResults {
  const script = String.raw`
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

sys.modules['torch'] = types.ModuleType('torch')
safetensors = types.ModuleType('safetensors')
safetensors.safe_open = lambda *args, **kwargs: None
sys.modules['safetensors'] = safetensors
spec = importlib.util.spec_from_file_location('verify_adapters', sys.argv[1])
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

BEST = 0.08516750484704971
EVAL = 0.08516325801610947
TOLERANCE = max(5e-5, abs(BEST) * 1e-4)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_case(root, name):
    candidate = root / name
    candidate.mkdir()
    manifest = {
        'schemaVersion': 'tomny.training-provenance.v2',
        'createdAt': '2026-07-25T19:27:59.767127+00:00',
        'purpose': 'security',
        'candidate': {
            'id': 'com.tomny.core.security',
            'version': '0.1.0-candidate.1',
            'path': str(candidate.resolve()),
        },
        'metrics': {
            'validation': {'eval_loss': EVAL},
            'bestEvalLoss': BEST,
        },
        'recipe': {
            'content': {
                'training': {'maxValidationRegression': 0.0},
            },
        },
    }
    manifest_path = candidate / 'training_manifest.json'
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    prior_report = {
        'verified': True,
        'adapterCount': 1,
        'adapters': [{
            'path': str(candidate.resolve()),
            'purpose': 'security',
            'schemaVersion': 'tomny.training-provenance.v2',
        }],
    }
    prior_path = candidate / 'verification-report.json'
    prior_path.write_text(json.dumps(prior_report), encoding='utf-8')
    migration = {
        'schemaVersion': 'tomny.validation-gate-migration.v1',
        'migrationId': f'{name}-20260726',
        'createdAt': '2026-07-26T14:00:00+00:00',
        'reason': 'legacy-manifest-predates-validation-gate',
        'candidate': {
            'id': 'com.tomny.core.security',
            'version': '0.1.0-candidate.1',
            'purpose': 'security',
        },
        'source': {
            'manifestFile': 'training_manifest.json',
            'manifestSha256': sha256(manifest_path),
            'manifestSchemaVersion': 'tomny.training-provenance.v2',
            'manifestCreatedAt': manifest['createdAt'],
        },
        'priorVerification': {
            'reportFile': 'verification-report.json',
            'reportSha256': sha256(prior_path),
        },
        'derivation': {
            'method': 'derive-from-immutable-manifest-v1',
            'configuredRegressionSource': 'recipe.content.training.maxValidationRegression',
            'numericTolerancePolicy': 'max(5e-5, abs(bestEvalLoss) * 1e-4)',
        },
        'validationGate': {
            'configuredRegression': 0.0,
            'numericTolerance': TOLERANCE,
            'observedDelta': EVAL - BEST,
            'allowedMaximum': BEST + TOLERANCE,
            'policy': 'absolute-or-relative-floating-point-tolerance',
        },
    }
    if name == 'missingMigration':
        pass
    else:
        if name == 'manifestHashMismatch':
            migration['source']['manifestSha256'] = '0' * 64
        elif name == 'priorHashMismatch':
            migration['priorVerification']['reportSha256'] = '0' * 64
        elif name == 'candidateMismatch':
            migration['candidate']['id'] = 'com.tomny.core.other'
        (candidate / 'validation-gate-migration.json').write_text(json.dumps(migration), encoding='utf-8')
    try:
        validation = verifier.verify_validation_evidence(candidate, manifest)
        return 'ok:' + validation['evidenceSource']['kind']
    except Exception as error:
        return f'{type(error).__name__}: {error}'


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    names = ['goodMigration', 'missingMigration', 'manifestHashMismatch', 'priorHashMismatch', 'candidateMismatch']
    print(json.dumps({name: run_case(root, name) for name in names}))
`;
  const verifierPath = resolve(process.cwd(), 'scripts/model-training/verify_adapters.py');
  return JSON.parse(execFileSync('python', ['-c', script, verifierPath], { encoding: 'utf8' })) as VerifierProbeResults;
}

function runQueueResourceGateProbe(): Record<string, { safe: boolean; reasons: string[] }> {
  const script = String.raw`
import importlib.util
import json
from pathlib import Path
import sys
import types

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)
args = types.SimpleNamespace(
    min_free_vram_mib=3000,
    min_free_host_mib=3072,
    max_temp_c=78,
    max_gpu_utilization=15,
)
base = {
    'probeOk': True,
    'freeVramMiB': 3962,
    'temperatureC': 57,
    'gpuUtilizationPercent': 0,
    'computeProcesses': [],
    'blockedProcesses': [],
}

low = queue.gate_probe({**base, 'hostAvailableMiB': 2048}, args)
safe = queue.gate_probe({**base, 'hostAvailableMiB': 4096}, args)
print(json.dumps({'low': low, 'safe': safe}))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  return JSON.parse(execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' })) as Record<
    string,
    { safe: boolean; reasons: string[] }
  >;
}

type WindowsProcessFallbackProbeResults = {
  accessDeniedNames: string[];
  malformed: string;
  unknownField: string;
  zeroPidNonIdle: string;
  nonAccessDenied: string;
  fallbackCallsForNonAccessDenied: number;
};

function runWindowsProcessFallbackProbe(): WindowsProcessFallbackProbeResults {
  const script = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

class Result:
    def __init__(self, returncode, stdout='', stderr=''):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr

queue.os.name = 'nt'
access_denied = Result(1, stderr='ERROR: Access is denied.')
good_fallback = Result(0, json.dumps([
    {'Id': 0, 'ProcessName': 'Idle', 'WorkingSet64': 8192},
    {'Id': 42, 'ProcessName': 'Valorant-Win64-Shipping', 'WorkingSet64': 2048},
    {'Id': 99, 'ProcessName': 'python', 'WorkingSet64': 1024},
]))

def run_with_fallback(fallback):
    calls = []
    def mocked(command, **_kwargs):
        calls.append(command[0])
        return access_denied if command[0] == 'tasklist' else fallback
    queue.subprocess.run = mocked
    return queue.system_process_names(), calls

def outcome(action):
    try:
        action()
    except Exception as error:
        return f'{type(error).__name__}: {error}'
    return 'accepted'

names, _calls = run_with_fallback(good_fallback)
malformed = outcome(lambda: run_with_fallback(Result(0, '{not-json}')))
unknown_field = outcome(lambda: run_with_fallback(Result(0, json.dumps({
    'Id': 42, 'ProcessName': 'valorant', 'WorkingSet64': 2048, 'Future': True,
}))))
zero_pid_non_idle = outcome(lambda: run_with_fallback(Result(0, json.dumps({
    'Id': 0, 'ProcessName': 'not-idle', 'WorkingSet64': 1,
}))))
fallback_calls = []
def non_access(command, **_kwargs):
    fallback_calls.append(command[0])
    return Result(1, stderr='tasklist unavailable')
queue.subprocess.run = non_access
non_access_denied = outcome(queue.system_process_names)
print(json.dumps({
    'accessDeniedNames': sorted(names),
    'malformed': malformed,
    'unknownField': unknown_field,
    'zeroPidNonIdle': zero_pid_non_idle,
    'nonAccessDenied': non_access_denied,
    'fallbackCallsForNonAccessDenied': fallback_calls.count('powershell'),
}))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  return JSON.parse(
    execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' })
  ) as WindowsProcessFallbackProbeResults;
}

function runQueueNoPsutilMemoryProbe(): { availableMiB: number } {
  const script = String.raw`
import builtins
import importlib.util
import json
import sys

original_import = builtins.__import__
def guarded_import(name, *args, **kwargs):
    if name == 'psutil':
        raise ModuleNotFoundError('psutil intentionally unavailable for this probe')
    return original_import(name, *args, **kwargs)

builtins.__import__ = guarded_import
try:
    spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
    queue = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(queue)
finally:
    builtins.__import__ = original_import

print(json.dumps({'availableMiB': queue.available_host_memory_mib()}))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  return JSON.parse(execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' })) as {
    availableMiB: number;
  };
}

function runTrainingRuntimeGateProbe(): {
  missing: { ready: boolean; missing: string[] };
  ready: { ready: boolean; missing: string[] };
} {
  const script = String.raw`
import importlib.util
import json
import sys
import types

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

def probe(packages):
    queue.subprocess.run = lambda *args, **kwargs: types.SimpleNamespace(
        returncode=0,
        stdout=json.dumps(packages),
    )
    return queue.training_runtime_gate()

print(json.dumps({
    'missing': probe({name: name != 'torch' for name in queue.TRAINING_RUNTIME_PACKAGES}),
    'ready': probe({name: True for name in queue.TRAINING_RUNTIME_PACKAGES}),
}))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  return JSON.parse(execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' })) as {
    missing: { ready: boolean; missing: string[] };
    ready: { ready: boolean; missing: string[] };
  };
}

function runQueueFailureSummaryProbe(): { code: string; type: string; serialized: string } {
  const script = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)
summary = queue.public_failure(RuntimeError('secret-token C:\\private\\model'))
print(json.dumps({**summary, 'serialized': json.dumps(summary)}))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  return JSON.parse(execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' })) as {
    code: string;
    type: string;
    serialized: string;
  };
}

type StableGateProbeResults = {
  observations: Array<{ ready: boolean; streak: number }>;
  adaptive: {
    effectiveResumeThresholdMiB: number;
    launchEvidenceAvailableMiB: number;
    launchEvidenceThresholdMiB: number;
    observedRunConsumptionMiB: number;
  };
  transientLaunchSample: {
    effectiveResumeThresholdMiB: number;
    launchEvidenceAvailableMiB: number;
    launchEvidenceThresholdMiB: number;
  };
  invalid: string;
};

function runStableGateStreakProbe(): StableGateProbeResults {
  const script = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

streak = 0
observations = []
for safe in [True, True, False, True, True, True]:
    streak, ready = queue.update_stable_gate_streak(streak, safe, 3)
    observations.append({'streak': streak, 'ready': ready})
try:
    queue.update_stable_gate_streak(0, True, 1)
    invalid = 'accepted'
except Exception as error:
    invalid = f'{type(error).__name__}: {error}'
adaptive = queue.adaptive_resume_evidence(3072, 1536, 3238, 1080, 3072)
transient_launch_sample = queue.adaptive_resume_evidence(8945, 1536, 9372, 1435, 9372)
print(json.dumps({
    'observations': observations,
    'adaptive': adaptive,
    'transientLaunchSample': transient_launch_sample,
    'invalid': invalid,
}))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  return JSON.parse(execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' })) as StableGateProbeResults;
}

type HungTrainerProbeResults = {
  elapsedSeconds: number;
  exitCode: number;
  timeoutLogged: boolean;
};

function runHungTrainerProbe(): HungTrainerProbeResults {
  const script = String.raw`
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

with tempfile.TemporaryDirectory() as temporary:
    log_path = Path(temporary) / 'queue.log'
    started = time.monotonic()
    exit_code = queue.run_training(
        [sys.executable, '-c', "import time; print('trainer-ready', flush=True); time.sleep(60)"],
        log_path,
        output_idle_timeout_seconds=1,
    )
    elapsed = time.monotonic() - started
    print(json.dumps({
        'elapsedSeconds': elapsed,
        'exitCode': exit_code,
        'timeoutLogged': 'trainer-output-timeout' in log_path.read_text(encoding='utf-8'),
    }))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  const output = execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' });
  return JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? '{}') as HungTrainerProbeResults;
}

type CancellationProbeResults = {
  childCancellationLogged: boolean;
  checkpointExists: boolean;
  checkpointPath: string;
  defaultPurposes: string[];
  exactPurpose: string[];
  promotionAllowed: boolean;
  queueCancelled: boolean;
  queueErrorPresent: boolean;
  secondAdapterState: string;
  startedPurposes: string[];
  terminalCheckpointStep: number;
  terminatedPids: number[];
};

function runCancellationProbe(): CancellationProbeResults {
  const script = String.raw`
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    cancel_file = root / 'stop.signal'
    trainer_log = root / 'trainer.log'
    terminated_pids = []
    fake_process = types.SimpleNamespace(pid=4242, stdout='unused', poll=lambda: None)
    queue.subprocess.Popen = lambda *args, **kwargs: fake_process
    queue.terminate_process_tree = lambda process: terminated_pids.append(process.pid) or True
    cancel_file.write_text('stop', encoding='utf-8')
    try:
        queue.run_training(['not-a-trainer'], trainer_log, cancel_file=cancel_file)
    except queue.QueueCancelled:
        pass
    else:
        raise AssertionError('cancelled trainer was not stopped')

    queue.CANDIDATE_ROOT = root / 'candidates'
    queue.QUEUE_ROOT = queue.CANDIDATE_ROOT / '_queue'
    candidate = queue.CANDIDATE_ROOT / 'security' / 'candidate.1'
    checkpoint = candidate / 'checkpoint-42'
    checkpoint.mkdir(parents=True)
    (checkpoint / 'adapter_model.safetensors').write_bytes(b'checkpoint')
    (checkpoint / 'trainer_state.json').write_text(
        json.dumps({'global_step': 42, 'max_steps': 100}), encoding='utf-8'
    )
    cancel_file.unlink()
    started_purposes = []
    plans = [
        {
            'purpose': 'security',
            'candidateId': 'com.tomny.core.security',
            'recipeSha256': 'a' * 64,
            'action': 'fresh',
            'candidate': str(candidate),
            'command': ['security'],
            'resumeCheckpoint': None,
        },
        {
            'purpose': 'user-understanding',
            'candidateId': 'com.tomny.core.user-understanding',
            'recipeSha256': 'b' * 64,
            'action': 'fresh',
            'candidate': str(queue.CANDIDATE_ROOT / 'assistant' / 'candidate.1'),
            'command': ['user-understanding'],
            'resumeCheckpoint': None,
        },
    ]
    args = types.SimpleNamespace(
        run_id='cancel-probe',
        candidate_version='candidate.1',
        only_purpose=None,
        start_at=None,
        cancel_file=cancel_file,
        resume_free_host_mib=4096,
        pause_free_host_mib=1536,
        trainer_output_idle_timeout_seconds=300,
    )
    queue.wait_for_safe_gpu = lambda *args, **kwargs: {}
    queue.resolve_execution_plans = lambda resolved, _version, _start: resolved
    queue.memory_pressure_command = lambda command, _args, _checkpoint: list(command)
    queue.available_host_memory_mib = lambda: 8192

    def cancel_during_first_training(command, _log_path, **_kwargs):
        started_purposes.append(command[0])
        cancel_file.write_text('stop', encoding='utf-8')
        raise queue.QueueCancelled('user-requested cancellation')

    queue.run_training = cancel_during_first_training
    queue.run_queue(args, plans)
    status = json.loads((queue.QUEUE_ROOT / 'cancel-probe' / 'status.json').read_text(encoding='utf-8'))
    print(json.dumps({
        'childCancellationLogged': 'trainer-cancelled' in trainer_log.read_text(encoding='utf-8'),
        'checkpointExists': checkpoint.is_dir(),
        'checkpointPath': str(checkpoint.resolve()),
        'defaultPurposes': [item['purpose'] for item in queue.select_exact_purpose(plans, None)],
        'exactPurpose': [item['purpose'] for item in queue.select_exact_purpose(plans, 'user-understanding')],
        'promotionAllowed': status['promotionAllowed'],
        'queueCancelled': status['state'] == 'cancelled',
        'queueErrorPresent': 'error' in status,
        'secondAdapterState': status['adapters'][1]['state'],
        'startedPurposes': started_purposes,
        'terminalCheckpointStep': status['cancellation']['checkpoint']['globalStep'],
        'terminatedPids': terminated_pids,
    }))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  const output = execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' });
  return JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? '{}') as CancellationProbeResults;
}

type SecurityCheckpointResumeProbeResults = {
  crossPurposeRejected: boolean;
  exactResumeCheckpoint: string;
  failedStateMismatchRejected: boolean;
  invocationCount: number;
  promotionAllowed: boolean;
  queueCancelled: boolean;
  parsedVersion: string;
  resumeMode: string;
  resumeStep: number;
  selectedPurposes: string[];
};

function runSecurityCheckpointResumeProbe(): SecurityCheckpointResumeProbeResults {
  const script = String.raw`
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

original_argv = sys.argv
sys.argv = ['run_candidate_queue.py', '--resume-security-checkpoint-50']
parsed_resume_args = queue.parse_args()
sys.argv = original_argv

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    queue.CANDIDATE_ROOT = root / 'candidates'
    queue.QUEUE_ROOT = queue.CANDIDATE_ROOT / '_queue'
    queue.TRAINER = root / 'train_lora.py'
    queue.TRAINER.write_text('trainer-bytes', encoding='utf-8')
    queue.DATASET_MANIFEST = root / 'manifest.json'
    queue.DATASET_MANIFEST.write_text('{}', encoding='utf-8')
    version = queue.SECURITY_CHECKPOINT_RESUME_VERSION
    candidate = queue.CANDIDATE_ROOT / queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID / version
    checkpoint = candidate / 'checkpoint-50'
    checkpoint.mkdir(parents=True)
    (checkpoint / 'adapter_model.safetensors').write_bytes(b'checkpoint-weights')
    (checkpoint / 'adapter_config.json').write_text('{}', encoding='utf-8')
    (checkpoint / 'trainer_state.json').write_text(json.dumps({
        'global_step': 50,
        'max_steps': 600,
    }), encoding='utf-8')
    item = {
        'purpose': 'security',
        'candidateId': queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
        'recipe': str(root / 'security-recipe.json'),
        'recipeSha256': 'f' * 64,
    }
    Path(item['recipe']).write_text('{}', encoding='utf-8')
    (candidate / 'training_preflight.json').write_text(json.dumps({
        'schemaVersion': 'tomny.training-preflight.v1',
        'resumeContract': queue.expected_resume_contract(item, version),
    }), encoding='utf-8')
    status_path = queue.QUEUE_ROOT / 'interrupted-security' / 'status.json'
    status_path.parent.mkdir(parents=True)
    status = {
        'schemaVersion': 'tomny.candidate-queue-status.v1',
        'runId': 'interrupted-security',
        'state': 'failed',
        'candidateVersion': version,
        'promotionAllowed': False,
        'selection': {'mode': 'exact-one-purpose', 'purpose': 'security', 'promotionAllowed': False},
        'adapters': [{
            'purpose': 'security',
            'candidateId': queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
            'recipeSha256': item['recipeSha256'],
            'baseModel': queue.BASE_BINDINGS['security'],
            'state': 'failed',
            'action': 'train-new',
            'candidate': str(candidate.resolve()),
        }],
    }
    status_path.write_text(json.dumps(status), encoding='utf-8')
    (queue.QUEUE_ROOT / 'latest.json').write_text(json.dumps({
        'runId': 'interrupted-security',
        'state': 'failed',
        'statusPath': str(status_path.resolve()),
    }), encoding='utf-8')

    resolved = queue.resolve_execution_plans([item], version, None, True)
    plan = resolved[0]
    status['adapters'][0]['purpose'] = 'assistant'
    status_path.write_text(json.dumps(status), encoding='utf-8')
    try:
        queue.resolve_execution_plans([item], version, None, True)
        cross_purpose_rejected = False
    except ValueError:
        cross_purpose_rejected = True
    status['adapters'][0]['purpose'] = 'security'
    status['adapters'][0]['state'] = 'cancelled'
    status_path.write_text(json.dumps(status), encoding='utf-8')
    try:
        queue.resolve_execution_plans([item], version, None, True)
        failed_state_mismatch_rejected = False
    except ValueError:
        failed_state_mismatch_rejected = True
    status['adapters'][0]['state'] = 'failed'
    status_path.write_text(json.dumps(status), encoding='utf-8')

    commands = []
    args = types.SimpleNamespace(
        run_id='resume-security-test',
        candidate_version=version,
        only_purpose='security',
        start_at=None,
        resume_security_checkpoint_50=True,
        cancel_file=None,
        resume_free_host_mib=4096,
        pause_free_host_mib=1536,
        trainer_output_idle_timeout_seconds=300,
    )
    queue.wait_for_safe_gpu = lambda *args, **kwargs: {}
    queue.available_host_memory_mib = lambda: 8192
    def stop_after_capture(command, _log_path, **_kwargs):
        commands.append(command)
        raise queue.QueueCancelled('test cancellation')
    queue.run_training = stop_after_capture
    queue.run_queue(args, [item])
    final_status = json.loads((queue.QUEUE_ROOT / 'resume-security-test' / 'status.json').read_text(encoding='utf-8'))
    command = commands[0]
    print(json.dumps({
        'crossPurposeRejected': cross_purpose_rejected,
        'exactResumeCheckpoint': command[command.index('--resume-from') + 1],
        'failedStateMismatchRejected': failed_state_mismatch_rejected,
        'invocationCount': len(commands),
        'promotionAllowed': final_status['promotionAllowed'],
        'queueCancelled': final_status['state'] == 'cancelled',
        'parsedVersion': parsed_resume_args.candidate_version,
        'resumeMode': final_status['resume']['mode'],
        'resumeStep': final_status['resume']['checkpoint']['globalStep'],
        'selectedPurposes': [adapter['purpose'] for adapter in final_status['adapters']],
    }))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  const output = execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' });
  return JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? '{}') as SecurityCheckpointResumeProbeResults;
}

type SecurityStabilityCancelledResumeProbeResults = {
  exactResumeCheckpoint: string;
  invocationCount: number;
  parsedVersion: string;
  promotionAllowed: boolean;
  queueCancelled: boolean;
  resumeMode: string;
  resumeStep: number;
  staleCheckpointRejected: boolean;
};

function runSecurityStabilityCancelledResumeProbe(): SecurityStabilityCancelledResumeProbeResults {
  const script = String.raw`
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

original_argv = sys.argv
sys.argv = ['run_candidate_queue.py', '--resume-security-stability-candidate']
parsed_resume_args = queue.parse_args()
sys.argv = original_argv

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    queue.CANDIDATE_ROOT = root / 'candidates'
    queue.QUEUE_ROOT = queue.CANDIDATE_ROOT / '_queue'
    queue.TRAINER = root / 'train_lora.py'
    queue.TRAINER.write_text('trainer-bytes', encoding='utf-8')
    queue.DATASET_MANIFEST = root / 'manifest.json'
    queue.DATASET_MANIFEST.write_text('{}', encoding='utf-8')
    version = queue.SECURITY_STABILITY_CANDIDATE_VERSION
    candidate = queue.CANDIDATE_ROOT / queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID / version
    checkpoint = candidate / 'checkpoint-500'
    checkpoint.mkdir(parents=True)
    (checkpoint / 'adapter_model.safetensors').write_bytes(b'checkpoint-weights')
    (checkpoint / 'adapter_config.json').write_text('{}', encoding='utf-8')
    (checkpoint / 'trainer_state.json').write_text(json.dumps({
        'global_step': 500,
        'max_steps': 600,
    }), encoding='utf-8')
    item = {
        'purpose': 'security',
        'candidateId': queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
        'recipe': str(root / 'security-recipe.json'),
        'recipeSha256': 'a' * 64,
    }
    Path(item['recipe']).write_text('{}', encoding='utf-8')
    (candidate / 'training_preflight.json').write_text(json.dumps({
        'schemaVersion': 'tomny.training-preflight.v1',
        'resumeContract': queue.expected_resume_contract(item, version),
    }), encoding='utf-8')
    checkpoint_record = queue.checkpoint_progress(checkpoint)
    cancellation = {'code': 'user-requested', 'checkpoint': checkpoint_record}
    status_path = queue.QUEUE_ROOT / 'cancelled-security' / 'status.json'
    status_path.parent.mkdir(parents=True)
    status = {
        'schemaVersion': 'tomny.candidate-queue-status.v1',
        'runId': 'cancelled-security',
        'state': 'cancelled',
        'candidateVersion': version,
        'promotionAllowed': False,
        'selection': {'mode': 'exact-one-purpose', 'purpose': 'security', 'promotionAllowed': False},
        'cancellation': cancellation,
        'adapters': [{
            'purpose': 'security',
            'candidateId': queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
            'recipeSha256': item['recipeSha256'],
            'baseModel': queue.BASE_BINDINGS['security'],
            'state': 'cancelled',
            'action': 'resume-paused-checkpoint',
            'candidate': str(candidate.resolve()),
            'cancellation': cancellation,
        }],
    }
    status_path.write_text(json.dumps(status), encoding='utf-8')
    (queue.QUEUE_ROOT / 'latest.json').write_text(json.dumps({
        'runId': 'cancelled-security',
        'state': 'cancelled',
        'statusPath': str(status_path.resolve()),
    }), encoding='utf-8')

    resolved = queue.resolve_execution_plans([item], version, None, False, True)
    status['cancellation']['checkpoint']['adapterSha256'] = '0' * 64
    status_path.write_text(json.dumps(status), encoding='utf-8')
    try:
        queue.resolve_execution_plans([item], version, None, False, True)
        stale_checkpoint_rejected = False
    except ValueError:
        stale_checkpoint_rejected = True
    status['cancellation']['checkpoint'] = queue.checkpoint_progress(checkpoint)
    status['adapters'][0]['cancellation'] = status['cancellation']
    status_path.write_text(json.dumps(status), encoding='utf-8')

    commands = []
    args = types.SimpleNamespace(
        run_id='resume-security-stability-test',
        candidate_version=version,
        only_purpose='security',
        start_at=None,
        resume_security_checkpoint_50=False,
        resume_security_stability_candidate=True,
        cancel_file=None,
        resume_free_host_mib=4096,
        pause_free_host_mib=1536,
        trainer_output_idle_timeout_seconds=300,
    )
    queue.wait_for_safe_gpu = lambda *args, **kwargs: {}
    queue.available_host_memory_mib = lambda: 8192
    def stop_after_capture(command, _log_path, **_kwargs):
        commands.append(command)
        raise queue.QueueCancelled('test cancellation')
    queue.run_training = stop_after_capture
    queue.run_queue(args, [item])
    final_status = json.loads((queue.QUEUE_ROOT / 'resume-security-stability-test' / 'status.json').read_text(encoding='utf-8'))
    command = commands[0]
    print(json.dumps({
        'exactResumeCheckpoint': command[command.index('--resume-from') + 1],
        'invocationCount': len(commands),
        'parsedVersion': parsed_resume_args.candidate_version,
        'promotionAllowed': final_status['promotionAllowed'],
        'queueCancelled': final_status['state'] == 'cancelled',
        'resumeMode': final_status['resume']['mode'],
        'resumeStep': final_status['resume']['checkpoint']['globalStep'],
        'staleCheckpointRejected': stale_checkpoint_rejected,
    }))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  const output = execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' });
  return JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? '{}') as SecurityStabilityCancelledResumeProbeResults;
}

type SecurityOrphanedWaitingRecoveryProbeResults = {
  freshCancelPathRequired: boolean;
  benignWindowsProcessesAccepted: boolean;
  unobservablePythonRejected: boolean;
  queueIdentityDetected: boolean;
  liveLockRejected: boolean;
  liveProcessRejected: boolean;
  latestStateRejected: boolean;
  mismatchRejected: boolean;
  finalizedRejected: boolean;
  tamperedReceiptRejected: boolean;
  crossPurposeRejected: boolean;
  noTrainerStarted: boolean;
  parsedVersion: string;
  recoveryAction: string;
  recoveryState: string;
  promotionAllowed: boolean;
  laterResumeAction: string;
  latestWasReplaced: boolean;
};

function runSecurityOrphanedWaitingRecoveryProbe(): SecurityOrphanedWaitingRecoveryProbeResults {
  const script = String.raw`
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    queue.CANDIDATE_ROOT = root / 'candidates'
    queue.QUEUE_ROOT = queue.CANDIDATE_ROOT / '_queue'
    queue.TRAINER = root / 'train_lora.py'
    queue.TRAINER.write_text('trainer-bytes', encoding='utf-8')
    queue.DATASET_MANIFEST = root / 'manifest.json'
    queue.DATASET_MANIFEST.write_text('{}', encoding='utf-8')
    version = queue.SECURITY_STABILITY_CANDIDATE_VERSION
    candidate = queue.CANDIDATE_ROOT / queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID / version
    checkpoint = candidate / 'checkpoint-500'
    checkpoint.mkdir(parents=True)
    (checkpoint / 'adapter_model.safetensors').write_bytes(b'checkpoint-weights')
    (checkpoint / 'adapter_config.json').write_text('{}', encoding='utf-8')
    (checkpoint / 'trainer_state.json').write_text(json.dumps({
        'global_step': 500,
        'max_steps': 600,
    }), encoding='utf-8')
    item = {
        'purpose': 'security',
        'candidateId': queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
        'recipe': str(root / 'security-recipe.json'),
        'recipeSha256': 'a' * 64,
    }
    Path(item['recipe']).write_text('{}', encoding='utf-8')
    (candidate / 'training_preflight.json').write_text(json.dumps({
        'schemaVersion': 'tomny.training-preflight.v1',
        'resumeContract': queue.expected_resume_contract(item, version),
    }), encoding='utf-8')
    progress = queue.checkpoint_progress(checkpoint)
    cancellation = {'code': 'user-requested', 'checkpoint': progress}
    cancelled_path = queue.QUEUE_ROOT / 'earlier-cancelled' / 'status.json'
    cancelled_path.parent.mkdir(parents=True)
    cancelled = {
        'schemaVersion': 'tomny.candidate-queue-status.v1',
        'runId': 'earlier-cancelled',
        'state': 'cancelled',
        'candidateVersion': version,
        'promotionAllowed': False,
        'selection': {'mode': 'exact-one-purpose', 'purpose': 'security', 'promotionAllowed': False},
        'cancellation': cancellation,
        'adapters': [{
            'purpose': 'security',
            'candidateId': queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
            'recipeSha256': item['recipeSha256'],
            'baseModel': queue.BASE_BINDINGS['security'],
            'state': 'cancelled',
            'action': 'resume-paused-checkpoint',
            'candidate': str(candidate.resolve()),
            'cancellation': cancellation,
        }],
    }
    cancelled_path.write_text(json.dumps(cancelled), encoding='utf-8')
    waiting_path = queue.QUEUE_ROOT / 'orphaned-waiting' / 'status.json'
    waiting_path.parent.mkdir(parents=True)
    waiting = {
        'schemaVersion': 'tomny.candidate-queue-status.v1',
        'runId': 'orphaned-waiting',
        'state': 'waiting-for-gpu',
        'createdAt': '2026-08-21T07:45:54+00:00',
        'updatedAt': '2026-08-21T10:48:31+00:00',
        'promotionAllowed': False,
        'candidateVersion': version,
        'executionStartAt': 'security',
        'selection': {
            'mode': queue.SECURITY_STABILITY_CANCELLED_RESUME_MODE,
            'purpose': 'security',
            'promotionAllowed': False,
        },
        'adapters': [{
            'purpose': 'security',
            'candidateId': queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
            'recipeSha256': item['recipeSha256'],
            'baseModel': queue.BASE_BINDINGS['security'],
            'state': 'pending',
        }],
        'gpuGate': {'safe': False, 'probe': {'computeProcesses': []}},
    }
    waiting_path.write_text(json.dumps(waiting), encoding='utf-8')
    (queue.QUEUE_ROOT / 'latest.json').write_text(json.dumps({
        'runId': 'orphaned-waiting',
        'state': 'waiting-for-gpu',
        'updatedAt': '2026-08-21T10:48:31+00:00',
        'statusPath': str(waiting_path.resolve()),
    }), encoding='utf-8')
    fresh_cancel = root / 'fresh-cancel.request'

    def rejected(action):
        try:
            action()
        except (RuntimeError, ValueError):
            return True
        return False

    class Process:
        def __init__(self, info):
            self.info = info

    def probe_processes(records):
        queue.psutil = types.SimpleNamespace(
            Error=RuntimeError,
            process_iter=lambda _fields: [Process(record) for record in records],
        )
        return queue.active_candidate_training_processes()

    benign_windows_processes_accepted = probe_processes([
        {'pid': 0, 'name': 'System Idle Process', 'cmdline': []},
        {'pid': 4, 'name': 'System', 'cmdline': None},
        {'pid': 236, 'name': '', 'cmdline': None},
        {'pid': 1000, 'name': 'svchost.exe', 'cmdline': []},
    ]) == []
    unobservable_python_rejected = rejected(lambda: probe_processes([
        {'pid': 999991, 'name': 'python.exe', 'cmdline': None},
    ]))
    queue_identity_detected = probe_processes([
        {
            'pid': 999991,
            'name': 'python.exe',
            'cmdline': ['python.exe', 'C:/repo/scripts/model-training/run_candidate_queue.py'],
        },
    ]) == [{'pid': 999991, 'name': 'python.exe'}]
    queue.psutil = None
    queue.active_candidate_training_processes = lambda: []
    fresh_cancel_path_required = rejected(
        lambda: queue.security_stability_orphaned_waiting_recovery_plan([item], version, None)
    )
    queue.lock_is_held = lambda _path: True
    live_lock_rejected = rejected(
        lambda: queue.security_stability_orphaned_waiting_recovery_plan([item], version, fresh_cancel)
    )
    queue.lock_is_held = lambda _path: False
    queue.active_candidate_training_processes = lambda: [{'pid': 4242, 'name': 'python'}]
    live_process_rejected = rejected(
        lambda: queue.security_stability_orphaned_waiting_recovery_plan([item], version, fresh_cancel)
    )
    queue.active_candidate_training_processes = lambda: []
    waiting['state'] = 'running'
    waiting_path.write_text(json.dumps(waiting), encoding='utf-8')
    latest_state_rejected = rejected(
        lambda: queue.security_stability_orphaned_waiting_recovery_plan([item], version, fresh_cancel)
    )
    waiting['state'] = 'waiting-for-gpu'
    waiting['adapters'][0]['candidateId'] = 'com.tomny.core.other'
    waiting_path.write_text(json.dumps(waiting), encoding='utf-8')
    mismatch_rejected = rejected(
        lambda: queue.security_stability_orphaned_waiting_recovery_plan([item], version, fresh_cancel)
    )
    waiting['adapters'][0]['candidateId'] = queue.SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID
    waiting_path.write_text(json.dumps(waiting), encoding='utf-8')
    (candidate / 'training_manifest.json').write_text('{}', encoding='utf-8')
    finalized_rejected = rejected(
        lambda: queue.security_stability_orphaned_waiting_recovery_plan([item], version, fresh_cancel)
    )
    (candidate / 'training_manifest.json').unlink()
    cancelled['cancellation']['checkpoint']['adapterSha256'] = '0' * 64
    cancelled_path.write_text(json.dumps(cancelled), encoding='utf-8')
    tampered_receipt_rejected = rejected(
        lambda: queue.security_stability_orphaned_waiting_recovery_plan([item], version, fresh_cancel)
    )
    restored_progress = queue.checkpoint_progress(checkpoint)
    cancelled['cancellation'] = {'code': 'user-requested', 'checkpoint': restored_progress}
    cancelled['adapters'][0]['cancellation'] = cancelled['cancellation']
    cancelled_path.write_text(json.dumps(cancelled), encoding='utf-8')
    cross_purpose_rejected = rejected(
        lambda: queue.security_stability_orphaned_waiting_recovery_plan([
            {**item, 'purpose': 'user-understanding'},
        ], version, fresh_cancel)
    )
    original_argv = sys.argv
    sys.argv = [
        'run_candidate_queue.py',
        '--recover-orphaned-waiting-security-stability-candidate',
        '--cancel-file', str(fresh_cancel),
    ]
    parsed = queue.parse_args()
    sys.argv = original_argv
    calls = []
    args = types.SimpleNamespace(
        run_id='orphaned-recovery',
        candidate_version=version,
        only_purpose='security',
        start_at=None,
        resume_security_checkpoint_50=False,
        resume_security_stability_candidate=False,
        recover_orphaned_waiting_security_stability_candidate=True,
        cancel_file=fresh_cancel,
    )
    queue.wait_for_safe_gpu = lambda *_args, **_kwargs: calls.append('gpu')
    queue.run_training = lambda *_args, **_kwargs: calls.append('trainer')
    queue.run_queue(args, [item])
    recovered_path = queue.QUEUE_ROOT / 'orphaned-recovery' / 'status.json'
    recovered = json.loads(recovered_path.read_text(encoding='utf-8'))
    resume = queue.security_stability_cancelled_resume_plan([item], version)
    latest = json.loads((queue.QUEUE_ROOT / 'latest.json').read_text(encoding='utf-8'))
    print(json.dumps({
        'freshCancelPathRequired': fresh_cancel_path_required,
        'benignWindowsProcessesAccepted': benign_windows_processes_accepted,
        'unobservablePythonRejected': unobservable_python_rejected,
        'queueIdentityDetected': queue_identity_detected,
        'liveLockRejected': live_lock_rejected,
        'liveProcessRejected': live_process_rejected,
        'latestStateRejected': latest_state_rejected,
        'mismatchRejected': mismatch_rejected,
        'finalizedRejected': finalized_rejected,
        'tamperedReceiptRejected': tampered_receipt_rejected,
        'crossPurposeRejected': cross_purpose_rejected,
        'noTrainerStarted': calls == [],
        'parsedVersion': parsed.candidate_version,
        'recoveryAction': recovered['adapters'][0]['action'],
        'recoveryState': recovered['state'],
        'promotionAllowed': recovered['promotionAllowed'],
        'laterResumeAction': resume['action'],
        'latestWasReplaced': latest['runId'] == 'orphaned-recovery',
    }))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  const output = execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' });
  return JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? '{}') as SecurityOrphanedWaitingRecoveryProbeResults;
}

type MemoryPressurePauseProbeResults = Record<string, string>;

type ExactCheckpointResumeProbeResults = {
  exactResume: string;
  containsLatest: boolean;
  freshHasResume: boolean;
};

function runMemoryPressurePauseReceiptProbe(): MemoryPressurePauseProbeResults {
  const script = String.raw`
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

ITEM = {
    'purpose': 'user-understanding',
    'candidateId': 'com.tomny.core.user-understanding',
    'recipeSha256': 'f' * 64,
}
VERSION = '0.1.0-candidate.1'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_case(root, name):
    candidate = (root / name).resolve()
    checkpoint = candidate / 'checkpoint-100'
    checkpoint.mkdir(parents=True)
    weights_path = checkpoint / 'adapter_model.safetensors'
    weights_path.write_bytes(b'checkpoint-weights')
    state_path = checkpoint / 'trainer_state.json'
    state_path.write_text(json.dumps({'global_step': 100, 'max_steps': 800}), encoding='utf-8')
    receipt = {
        'schemaVersion': queue.MEMORY_PRESSURE_RECEIPT_SCHEMA,
        'code': 'host-memory-pressure',
        'candidate': {
            'id': ITEM['candidateId'],
            'version': VERSION,
            'path': str(candidate),
        },
        'checkpoint': {
            'path': str(checkpoint),
            'globalStep': 100,
            'trainerStateSha256': sha256(state_path),
        },
        'memory': {
            'availableMiB': 1024,
            'pauseThresholdMiB': queue.MIN_MEMORY_PRESSURE_FREE_MIB,
            'observedAt': '2026-07-26T00:00:00+00:00',
        },
        'resumeContract': queue.expected_resume_contract(ITEM, VERSION),
        'candidateOnly': True,
        'promotionAllowed': False,
    }
    if name == 'tamperedHash':
        receipt['checkpoint']['trainerStateSha256'] = '0' * 64
    elif name == 'weakThreshold':
        receipt['memory']['pauseThresholdMiB'] = queue.MIN_MEMORY_PRESSURE_FREE_MIB - 1
    elif name == 'trainerChanged':
        receipt['resumeContract']['trainerImplementationSha256'] = '0' * 64
    elif name == 'promoted':
        receipt['promotionAllowed'] = True
    elif name == 'escapedCheckpoint':
        receipt['checkpoint']['path'] = str(root.resolve())
    elif name == 'missingWeights':
        weights_path.unlink()
    (candidate / 'memory-pressure-pause.json').write_text(json.dumps(receipt), encoding='utf-8')
    try:
        queue.verify_memory_pressure_pause_receipt(candidate, ITEM, VERSION)
        return 'ok'
    except Exception as error:
        return f'{type(error).__name__}: {error}'


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    names = ['good', 'tamperedHash', 'weakThreshold', 'trainerChanged', 'promoted', 'escapedCheckpoint', 'missingWeights']
    print(json.dumps({name: run_case(root, name) for name in names}))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  return JSON.parse(
    execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' })
  ) as MemoryPressurePauseProbeResults;
}

function runExactCheckpointResumeProbe(): ExactCheckpointResumeProbeResults {
  const script = String.raw`
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

spec = importlib.util.spec_from_file_location('run_candidate_queue', sys.argv[1])
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

with tempfile.TemporaryDirectory() as temporary:
    checkpoint = Path(temporary) / 'candidate' / 'checkpoint-447'
    checkpoint.mkdir(parents=True)
    args = types.SimpleNamespace(pause_free_host_mib=1536)
    resumed = queue.memory_pressure_command(
        ['python', 'train_lora.py', '--resume-from', 'latest'], args, checkpoint
    )
    fresh = queue.memory_pressure_command(['python', 'train_lora.py'], args, None)
    resume_index = resumed.index('--resume-from')
    print(json.dumps({
        'exactResume': resumed[resume_index + 1],
        'containsLatest': 'latest' in resumed,
        'freshHasResume': '--resume-from' in fresh,
    }))
`;
  const queuePath = resolve(process.cwd(), 'scripts/model-training/run_candidate_queue.py');
  return JSON.parse(
    execFileSync('python', ['-c', script, queuePath], { encoding: 'utf8' })
  ) as ExactCheckpointResumeProbeResults;
}

type CandidateEvidenceContractProbeResults = {
  malformedJson: string;
  missingFinalManifest: string;
  overwrite: string;
  candidateRawReuse: string;
  nonFiniteMetricAccepted: boolean;
  booleanMetricAccepted: boolean;
  invertedConfidenceIntervalAccepted: boolean;
  outOfRangeMetricAccepted: boolean;
  changedCandidate: string;
  changedBase: string;
  cliExitCode: number;
  cliError: string;
  cliOutput: string;
};

function runCandidateEvidenceContractProbe(): CandidateEvidenceContractProbeResults {
  const script = String.raw`
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types


def install_module(name, **attributes):
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules[name] = module


install_module('psutil')
install_module('torch')
install_module('peft', PeftModel=object)
install_module(
    'transformers',
    AutoTokenizer=object,
    BitsAndBytesConfig=object,
    Qwen3_5Config=object,
    Qwen3_5ForCausalLM=object,
)
install_module(
    'benchmark_cases',
    ENUMS={},
    PRIMARY_FIELDS={},
    PRIMARY_LABEL='',
    SCHEMAS={},
    build_cases=lambda *args, **kwargs: [],
    case_counts=lambda *args, **kwargs: {},
)
install_module('data_quality', canonical_text=lambda value: value)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def outcome(action):
    try:
        action()
    except Exception as error:
        return f'{type(error).__name__}: {error}'
    return 'accepted'


post = load_module('post_training_benchmark', sys.argv[1])
benchmark = load_module('benchmark_adapters', sys.argv[2])


def make_gate_report(composite, critical):
    domains = {}
    for purpose in post.DOMAINS:
        domains[purpose] = {
            'adapter': {
                'metrics': {
                    'productionGate': {'passed': True},
                    'semanticGroupCount': 100,
                    'criticalIndependentGroupCount': 30,
                    'compositeAccuracyLowerBound95': composite,
                    'criticalCorrectLowerBound95': critical,
                    'catastrophicFailures': 0,
                },
            },
            'comparison': {'clusteredBootstrapCI95': [0.0, 0.1]},
        }
    return {'domains': domains}


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    malformed = root / 'malformed.json'
    malformed.write_bytes(b'{')

    partial = root / 'partial-output'
    partial.mkdir()
    for name in ('benchmark-report.json', 'raw-generations.jsonl', 'benchmark-cases.jsonl'):
        (partial / name).write_text('{}', encoding='utf-8')

    existing = root / 'post-training-candidate-report.json'
    existing.write_text('{}', encoding='utf-8')

    reuse = root / 'stale-raw-output'
    reuse.mkdir()
    (reuse / 'raw-generations.jsonl').write_text('{}', encoding='utf-8')

    non_finite_gate = post.confidence_gate(make_gate_report(float('nan'), 0.99))
    boolean_gate = post.confidence_gate(make_gate_report(0.95, True))
    inverted_ci_report = make_gate_report(0.95, 0.99)
    for domain in inverted_ci_report['domains'].values():
        domain['comparison']['clusteredBootstrapCI95'] = [0.1, -0.1]
    inverted_ci_gate = post.confidence_gate(inverted_ci_report)
    out_of_range_gate = post.confidence_gate(make_gate_report(1.01, 0.99))

    expected_verification = {'verified': True, 'adapters': []}
    expected_base_hashes = {'qwen35-08b': 'base-08', 'qwen35-2b': 'base-2'}
    def stable_base_hash(path):
        return 'base-08' if '0.8B' in str(path) else 'base-2'

    post.verify_candidates = lambda *_args: expected_verification
    post.sha256_tree = stable_base_hash

    post.verify_candidates = lambda *_args: {'verified': False, 'adapters': []}
    changed_candidate = outcome(
        lambda: post.verify_benchmark_inputs_unchanged({}, '0.1.0-candidate.1', expected_verification, expected_base_hashes)
    )

    post.verify_candidates = lambda *_args: expected_verification
    post.sha256_tree = lambda _path: 'changed-base'
    changed_base = outcome(
        lambda: post.verify_benchmark_inputs_unchanged({}, '0.1.0-candidate.1', expected_verification, expected_base_hashes)
    )
    cli = subprocess.run(
        [sys.executable, sys.argv[1], '--dry-run', '--gate-fixture', str(malformed)],
        text=True,
        capture_output=True,
        check=False,
    )

    print(json.dumps({
        'malformedJson': outcome(lambda: post.read_json(malformed, 'fixture')),
        'missingFinalManifest': outcome(
            lambda: post.validate_benchmark_evidence(partial, {}, root / 'dataset.json', {'tests': {}}, {})
        ),
        'overwrite': outcome(lambda: post.write_new_text_atomic(existing, '{}')),
        'candidateRawReuse': outcome(lambda: benchmark.prepare_output_root(reuse, True, '0.1.0-candidate.1')),
        'nonFiniteMetricAccepted': non_finite_gate['domains']['security']['checks']['compositeLowerBound95'],
        'booleanMetricAccepted': boolean_gate['domains']['security']['checks']['criticalLowerBound95'],
        'invertedConfidenceIntervalAccepted': inverted_ci_gate['domains']['security']['checks']['nonRegressionLowerBound95'],
        'outOfRangeMetricAccepted': out_of_range_gate['domains']['security']['checks']['compositeLowerBound95'],
        'changedCandidate': changed_candidate,
        'changedBase': changed_base,
        'cliExitCode': cli.returncode,
        'cliError': cli.stderr.strip(),
        'cliOutput': cli.stdout.strip(),
    }))
`;
  const postBenchmarkPath = resolve(process.cwd(), 'scripts/model-training/post_training_benchmark.py');
  const benchmarkPath = resolve(process.cwd(), 'scripts/model-training/benchmark_adapters.py');
  return JSON.parse(
    execFileSync('python', ['-c', script, postBenchmarkPath, benchmarkPath], { encoding: 'utf8' })
  ) as CandidateEvidenceContractProbeResults;
}

type SecurityV05PostTrainingBenchmarkProbeResults = {
  queueAccepted: boolean;
  queueMismatch: string;
  candidateOnly: boolean;
  promotionAllowed: boolean;
  checkpointArgument: boolean;
  heldoutArgument: boolean;
  skipBaseAbsent: boolean;
  resourceOverrideAbsent: boolean;
};

function runSecurityV05PostTrainingBenchmarkProbe(): SecurityV05PostTrainingBenchmarkProbeResults {
  const script = String.raw`
import hashlib
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('post_training_benchmark', sys.argv[1])
post = importlib.util.module_from_spec(spec)
spec.loader.exec_module(post)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def outcome(action):
    try:
        action()
    except Exception as error:
        return f'{type(error).__name__}: {error}'
    return 'accepted'


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary).resolve()
    post.REPO_ROOT = root
    candidate_root = root / '.model-adapters' / 'candidates'
    candidate = candidate_root / post.SECURITY_V05_CANDIDATE_ID / post.SECURITY_V05_CANDIDATE_VERSION
    checkpoint = candidate / 'checkpoint-600'
    checkpoint.mkdir(parents=True)
    for parent in (candidate, checkpoint):
        (parent / 'adapter_model.safetensors').write_bytes(b'weights')
        (parent / 'adapter_config.json').write_bytes(b'config')
    state = {'global_step': 600, 'best_model_checkpoint': str(checkpoint)}
    (checkpoint / 'trainer_state.json').write_text(json.dumps(state), encoding='utf-8')
    manifest = {
        'schemaVersion': post.PROVENANCE_SCHEMA, 'completed': True, 'status': 'candidate',
        'purpose': 'security', 'precision': 'bf16',
        'candidate': {'id': post.SECURITY_V05_CANDIDATE_ID, 'version': post.SECURITY_V05_CANDIDATE_VERSION, 'path': str(candidate)},
        'baseModel': {**post.BASES['security'], 'path': str(root / post.BASES['security']['path'])},
        'recipe': {'sha256': post.SECURITY_V05_RECIPE_SHA256},
        'finalization': {
            'mode': 'checkpoint-eval-only', 'unsafeStateLoaded': False, 'optimizerStepsExecuted': 0,
            'sourceCheckpoint': str(checkpoint), 'sourceStep': 600,
            'sourceAdapterSha256': sha(checkpoint / 'adapter_model.safetensors'),
            'trainerStateSha256': sha(checkpoint / 'trainer_state.json'),
        },
    }
    manifest_path = candidate / 'training_manifest.json'
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    report = {
        'schemaVersion': 'tomny.adapter-verification-report.v1', 'verified': True, 'adapterCount': 1,
        'adapters': [{
            'path': str(candidate), 'purpose': 'security', 'manifestSha256': sha(manifest_path),
            'weightSha256': sha(candidate / 'adapter_model.safetensors'),
            'adapterConfigSha256': sha(candidate / 'adapter_config.json'),
        }],
    }
    report_path = candidate / 'verification-report.json'
    report_path.write_text(json.dumps(report), encoding='utf-8')
    queue_root = candidate_root / '_queue'
    latest_path = queue_root / 'latest.json'
    status_path = queue_root / 'run-security-v05' / 'status.json'
    status_path.parent.mkdir(parents=True)
    adapter = {
        'purpose': 'security', 'candidateId': post.SECURITY_V05_CANDIDATE_ID,
        'recipeSha256': post.SECURITY_V05_RECIPE_SHA256,
        'baseModel': {key: post.BASES['security'][key] for key in ('modelId', 'revision', 'contentSha256')},
        'candidate': str(candidate), 'state': 'completed-candidate',
    }
    status = {
        'runId': 'run-security-v05', 'state': 'completed-candidates',
        'candidateVersion': post.SECURITY_V05_CANDIDATE_VERSION, 'promotionAllowed': False, 'adapters': [adapter],
    }
    status_path.write_text(json.dumps(status), encoding='utf-8')
    latest_path.write_text(json.dumps({'runId': 'run-security-v05', 'state': 'completed-candidates', 'statusPath': str(status_path)}), encoding='utf-8')
    post.SECURITY_V05_QUEUE_LATEST = latest_path
    evidence = post.security_v05_candidate_evidence(candidate_root)
    accepted = post.validate_security_v05_queue(latest_path, candidate)
    command = post.security_v05_benchmark_command(root / '.model-benchmarks' / 'checkpoints' / 'security' / 'run', evidence)
    status['adapters'][0]['state'] = 'skipped-completed'
    status_path.write_text(json.dumps(status), encoding='utf-8')
    mismatch = outcome(lambda: post.validate_security_v05_queue(latest_path, candidate))
    print(json.dumps({
        'queueAccepted': accepted['candidateOnly'] is True and accepted['promotionAllowed'] is False,
        'queueMismatch': mismatch,
        'candidateOnly': evidence['candidateOnly'], 'promotionAllowed': evidence['promotionAllowed'],
        'checkpointArgument': '--checkpoint-adapter' in command and evidence['checkpoint'] in command,
        'heldoutArgument': '--immutable-test-manifest' in command and str(post.SECURITY_V05_HELDOUT_MANIFEST) in command,
        'skipBaseAbsent': '--skip-base' not in command,
        'resourceOverrideAbsent': '--allow-low-host-memory' not in command,
    }))
`;
  return JSON.parse(
    execFileSync(
      'python',
      ['-c', script, resolve(process.cwd(), 'scripts/model-training/post_training_benchmark.py')],
      {
        encoding: 'utf8',
      }
    )
  ) as SecurityV05PostTrainingBenchmarkProbeResults;
}

type ErrorTaxonomyProbeResults = {
  categoryKeys: string[];
  schemaCategoryKeys: string[];
  invalidJsonCount: number;
  schemaCaseCount: number;
  scoreUnchanged: boolean;
  gateUnchanged: boolean;
};

function runErrorTaxonomyProbe(): ErrorTaxonomyProbeResults {
  const script = String.raw`
import importlib.util
import json
import sys
import types


def install_module(name, **attributes):
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules[name] = module


install_module('psutil')
install_module('torch')
install_module('peft', PeftModel=object)
install_module(
    'transformers',
    AutoTokenizer=object,
    BitsAndBytesConfig=object,
    Qwen3_5Config=object,
    Qwen3_5ForCausalLM=object,
)
install_module(
    'benchmark_cases',
    ENUMS={'assistant': {'status': {'ready', 'needs_confirmation', 'cannot_verify'}}},
    PRIMARY_FIELDS={'assistant': ['intent', 'status']},
    PRIMARY_LABEL={'assistant': 'status'},
    SCHEMAS={'assistant': {'intent': str, 'status': str, 'confidence': (int, float), 'reasonCode': str, 'nextAction': str, 'requiresConfirmation': bool}},
    build_cases=lambda *args, **kwargs: [],
    case_counts=lambda *args, **kwargs: {},
)
install_module('data_quality', canonical_text=lambda value: value)

spec = importlib.util.spec_from_file_location('benchmark_adapters', sys.argv[1])
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def record(group, variant, evaluation):
    return {
        'case': {
            'groupId': group,
            'variant': variant,
            'language': 'vi',
            'critical': False,
            'expected': {'status': 'ready'},
        },
        'evaluation': evaluation,
        'latencySeconds': 0.1,
        'outputTokens': 5,
        'peakVramBytes': 16,
    }


def evaluation(json_valid, violations, primary, composite, strict, label):
    return {
        'jsonValid': json_valid,
        'schemaCompliant': not violations,
        'schemaViolationKinds': violations,
        'primaryCorrect': primary,
        'compositeCorrect': composite,
        'strictExpectedCorrect': strict,
        'predictedLabel': label,
        'confidence': 0.9 if json_valid else None,
        'catastrophic': False,
    }


records = [
    record('valid', 'clean', evaluation(True, [], True, True, True, 'ready')),
    record('invalid-json', 'paraphrase', evaluation(False, ['key-set'], False, False, False, '__invalid_json__')),
    record('type-range', 'noisy', evaluation(True, ['type', 'value-range'], False, False, False, 'needs_confirmation')),
    record('enum', 'adversarial', evaluation(True, ['enum'], False, False, False, 'unknown')),
]
metrics = benchmark.summarize_condition(records, 'assistant')
taxonomy = metrics['errorTaxonomy']
score_before = {key: metrics[key] for key in ('jsonValidRate', 'schemaComplianceRate', 'primaryAccuracy', 'compositeAccuracy', 'macroF1')}
gate_before = metrics['productionGate']
metrics['errorTaxonomy'] = {'unrelated': {'caseCount': 999}}
score_after = {key: metrics[key] for key in score_before}
gate_after = benchmark.gate_pass(metrics, benchmark.PRODUCTION_GATES)
print(json.dumps({
    'categoryKeys': sorted(taxonomy),
    'schemaCategoryKeys': sorted(taxonomy['schemaViolations']),
    'invalidJsonCount': taxonomy['invalidJson']['caseCount'],
    'schemaCaseCount': taxonomy['schemaViolations']['caseCount'],
    'scoreUnchanged': score_before == score_after,
    'gateUnchanged': gate_before == gate_after,
}))
`;
  const benchmarkPath = resolve(process.cwd(), 'scripts/model-training/benchmark_adapters.py');
  return JSON.parse(
    execFileSync('python', ['-c', script, benchmarkPath], { encoding: 'utf8' })
  ) as ErrorTaxonomyProbeResults;
}

describe('production model-training scripts', () => {
  it('keeps the immutable test split outside trainer-readable inputs', () => {
    expect(trainer).toContain('trainerReadableSplits must be exactly');
    expect(trainer).toContain('test.get("trainerReadable") is not False');
    expect(trainer).toContain('for split_name in ("train", "validation")');
    expect(trainer).not.toContain('split_paths["test"]');
    expect(trainer).toContain('Dataset manifest SHA-256 does not match');
    expect(trainer).toContain('recipe.promotionStatus must be candidate-only');
  });

  it('builds a provenance-bound 30-group Security pilot held-out corpus and rejects tampering', () => {
    const result = runSecurityPilotHeldoutProbe();

    expect(result.rows).toBe(120);
    expect(result.semanticGroups).toBe(30);
    expect(result.verified).toBe(true);
    expect(result.tamperRejected).toContain('tampered');
    expect(benchmark).toContain('ALLOWED_IMMUTABLE_BENCHMARK_SOURCE_KINDS');
    expect(benchmark).toContain('trainerReadable") is not False');
  });

  it('requires full validation unless the run is explicitly smoke-only', () => {
    expect(trainer).toContain('Dataset or memory limits require explicit --smoke');
    expect(trainer).toContain('"fullValidation": args.validation_limit == 0');
    expect(verifier).toContain('production candidate did not use full validation');
  });

  it('fails closed on non-finite training state and immutable artifact mismatches', () => {
    expect(trainer).toContain('Non-finite gradients detected; refusing to save adapter');
    expect(trainer).toContain('Non-finite evaluation loss ');
    expect(trainer).toContain('FiniteWeightCallback');
    expect(trainer).toContain('Non-finite trainable weights after optimizer step');
    expect(trainer).toContain('Non-finite training curve value');
    expect(verifier).toContain('immutable artifact binding failed');
    expect(verifier).toContain('base-model content hash mismatch');
  });

  it('bounds CUDA cache during long full-validation passes', () => {
    expect(trainer).toContain('TRAINING_CACHE_CLEAR_STEPS = 10');
    expect(trainer).toContain('EVALUATION_CACHE_CLEAR_INTERVAL = 32');
    expect(trainer).toContain('torch_empty_cache_steps');
    expect(trainer).toContain('prediction_loss_only');
    expect(trainer).toContain('self._evaluation_batch_count % EVALUATION_CACHE_CLEAR_INTERVAL == 0');
    expect(trainer).toContain('torch.cuda.empty_cache()');
  });

  it('requires an explicit supported precision and isolates the BF16 stability candidate', () => {
    expect(trainer).toContain('recipe.training.precision must be fp16 or bf16');
    expect(trainer).toContain('torch.cuda.is_bf16_supported()');
    expect(trainer).toContain('"bf16": args.precision == "bf16"');
    expect(queueRunner).toContain('SECURITY_STABILITY_CANDIDATE_VERSION = "0.5.0-candidate.1"');
    expect(queueRunner).toContain('--security-stability-candidate');
    expect(queueRunner).toContain('SECURITY_STABILITY_ITEM');
    expect(trainer).toContain('stabilitySmokeEvidence');
    expect(trainer).toContain('stability smoke verification report does not attest a finite adapter');
    expect(queueRunner).toContain('security-rtx3050-bf16-production-v5.json');
  });
  it('supports resumable best-model training without overwriting completed candidates', () => {
    expect(trainer).toContain('load_best_model_at_end');
    expect(trainer).toContain('EarlyStoppingCallback');
    expect(trainer).toContain('resume_from_checkpoint=resume_checkpoint');
    expect(trainer).toContain('Completed immutable candidate cannot be resumed');
  });

  it('treats only bounded floating-point jitter as equivalent final validation', () => {
    expect(trainer).toContain('FINAL_EVAL_REL_TOLERANCE = 1e-4');
    expect(trainer).toContain('FINAL_EVAL_ABS_TOLERANCE = 5e-5');
    expect(trainer).toContain('validation_regressed(eval_loss, best_metric, configured_regression)');
    expect(trainer).toContain('observedDelta');
    expect(trainer).toContain('absolute-or-relative-floating-point-tolerance');

    const best = 0.047743719071149826;
    const jittered = 0.047745801508426666;
    const tolerance = Math.max(5e-5, Math.abs(best) * 1e-4);
    expect(jittered).toBeLessThanOrEqual(best + tolerance);
    expect(best + tolerance * 2).toBeGreaterThan(best + tolerance);
  });

  it('materializes exact benchmark schemas and matches every immutable oracle', () => {
    const script = String.raw`
import json
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(sys.argv[1]).parent))
from benchmark_cases import SCHEMAS, build_cases
cases = build_cases()
assert all(set(case['expected']) == set(SCHEMAS[case['domain']]) for case in cases)
assert all(case['expected']['confidence'] == 0.9 for case in cases)
manifest_path = Path(sys.argv[2])
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
normalize = lambda value: re.sub(r'\s+', ' ', value.strip()).casefold()
total_rows = 0
for domain in SCHEMAS:
    entry = manifest['domains'][domain]['splits']['test']
    test_path = manifest_path.parent / entry['path']
    references = {normalize(case['prompt']): case for case in build_cases([domain])}
    rows = 0
    for line in test_path.open(encoding='utf-8'):
        if not line.strip():
            continue
        row = json.loads(line)
        messages = {message['role']: message['content'] for message in row['messages']}
        expected_payload = json.loads(messages['assistant'])
        assert expected_payload == references[normalize(messages['user'])]['expected']



        rows += 1
    assert rows == entry['rows']
    total_rows += rows
print(json.dumps({'caseCount': len(cases), 'immutableRows': total_rows}))
`;
    const result = JSON.parse(
      execFileSync(
        'python',
        [
          '-c',
          script,
          resolve(process.cwd(), 'scripts/model-training/benchmark_cases.py'),
          resolve(process.cwd(), '.tmp/regenerated-v8/manifest.json'),
        ],
        { encoding: 'utf8' }
      )
    ) as { caseCount: number; immutableRows: number };

    expect(result).toEqual({ caseCount: 264, immutableRows: 192 });
  });

  it('keeps the v2 user-understanding candidate benchmark separate from the immutable v1 oracle', () => {
    const script = String.raw`
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(sys.argv[1]).parent))
from benchmark_cases import USER_UNDERSTANDING_V2_SCHEMA, build_user_understanding_v2_cases
cases = build_user_understanding_v2_cases()
assert len(cases) == 48
assert all(set(case['expected']) == set(USER_UNDERSTANDING_V2_SCHEMA) for case in cases)
assert all(case['expected']['requiresUserConfirmation'] is True for case in cases)
assert {case['language'] for case in cases} == {'en', 'vi'}
assert len({case['groupId'] for case in cases}) == 12
print(json.dumps({'cases': len(cases)}))
`;
    const result = JSON.parse(
      execFileSync('python', ['-c', script, resolve(process.cwd(), 'scripts/model-training/benchmark_cases.py')], {
        encoding: 'utf8',
      })
    ) as { cases: number };

    expect(result).toEqual({ cases: 48 });
  });
  it('creates bounded robustness variants only in a new training-data v3 root', () => {
    const script = String.raw`
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

generator = Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix='tomny-data-v3-') as temporary:
    temporary_root = Path(temporary)
    root = temporary_root / 'training-data-v3'
    command = [
        sys.executable, str(generator), '--output', str(root), '--authored-corpus', str(Path(sys.argv[3])),
        '--domain', 'security',
        '--augmentation-limit-per-domain', '12',
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['datasetVersion'] == '2026-07-27.v3'
    assert manifest['augmentation']['profile'] == 'robustness-v1'
    assert manifest['augmentation']['allowedSplits'] == ['train']
    assert manifest['augmentation']['immutableBenchmarkAugmentedRows'] == 0
    domains = manifest['domains']
    quality_domains = manifest['quality']['domains']

    for domain, entry in domains.items():
        coverage = quality_domains[domain]['coverage']
        assert coverage['primaryLabelTotalVariation'] <= coverage['maximumPrimaryLabelTotalVariation']
        assert quality_domains[domain]['leakage']['splitIsolation']['passed'] is True
        assert quality_domains[domain]['leakage']['scenarioFamily']['scenarioFamilyCrossSplitCount'] >= 0

        train_path = root / entry['splits']['train']['path']
        validation_path = root / entry['splits']['validation']['path']
        test_path = root / entry['splits']['test']['path']
        train_rows = [json.loads(line) for line in train_path.read_text(encoding='utf-8').splitlines()]
        validation_rows = [json.loads(line) for line in validation_path.read_text(encoding='utf-8').splitlines()]
        test_bytes = test_path.read_bytes()
        test_rows = [json.loads(line) for line in test_bytes.decode('utf-8').splitlines()]
        augmented = [row for row in train_rows if 'augmentation' in row['metadata']]
        assert len(augmented) == 0
        assert not any('augmentation' in row['metadata'] for row in validation_rows)
        assert not any('augmentation' in row['metadata'] for row in test_rows)
        assert hashlib.sha256(test_bytes).hexdigest() == entry['splits']['test']['sha256']
        output_keys = {tuple(sorted(json.loads(row['messages'][2]['content']))) for row in train_rows}
        assert len(output_keys) == 1
        assert {row['metadata']['augmentation']['kind'] for row in augmented} == {
            'paraphrase-frame-v1', 'noisy-context-v1', 'untrusted-instruction-v1'
        }
    blocked = temporary_root / '.training-data-v6-qwen08b-semantic-r4'
    blocked_result = subprocess.run(
        [sys.executable, str(generator), '--output', str(blocked), '--count', '100'],
        capture_output=True,
        text=True,
    )
    assert blocked_result.returncode != 0
    assert not blocked.exists()
print(json.dumps({'domains': len(domains), 'augmentationRowsPerDomain': 12}))
`;
    const result = JSON.parse(
      execFileSync(
        'python',
        [
          '-c',
          script,
          resolve(process.cwd(), 'scripts/model-training/generate_data.py'),
          resolve(process.cwd(), '.tmp/authored-v8-all.json'),
        ],
        {
          encoding: 'utf8',
        }
      )
    ) as { domains: number; augmentationRowsPerDomain: number };

    expect(result).toEqual({ domains: 3, augmentationRowsPerDomain: 0 });
  });

  it('serializes candidate training and fails closed when the GPU is occupied or unsafe', () => {
    expect(queueRunner).toContain('class QueueLock');
    expect(queueRunner).toContain('Another candidate training queue already holds');
    expect(queueRunner).toContain('GPU compute processes are active');
    expect(queueRunner).toContain('blocked GPU applications are active');
    expect(queueRunner).toContain('free VRAM');
    expect(queueRunner).toContain('GPU temperature');
  });

  it('uses strict PowerShell process telemetry only when Windows tasklist is access-denied', () => {
    const result = runWindowsProcessFallbackProbe();

    expect(result.accessDeniedNames).toContain('valorant-win64-shipping.exe');
    expect(result.accessDeniedNames).toContain('python.exe');
    expect(result.malformed).toContain('PowerShell process fallback returned malformed telemetry');
    expect(result.unknownField).toContain('PowerShell process fallback returned malformed telemetry');
    expect(result.zeroPidNonIdle).toContain('PowerShell process fallback returned malformed telemetry');
    expect(result.nonAccessDenied).toContain('tasklist failed: tasklist unavailable');
    expect(result.fallbackCallsForNonAccessDenied).toBe(0);
    expect(queueRunner).toContain('def tasklist_access_denied');
    expect(queueRunner).toContain('def windows_powershell_process_names');
    expect(queueRunner).toContain('Get-Process');
    expect(queueRunner).toContain('WorkingSet64');
  });

  it('waits for practical host-memory headroom before launching the trainer', () => {
    const results = runQueueResourceGateProbe();

    expect(results.low.safe).toBe(false);
    expect(results.low.reasons.join(' ')).toContain('free host memory');
    expect(results.safe.safe).toBe(true);
    expect(queueRunner).toContain('--min-free-host-mib');
    const runQueueBody = queueRunner.slice(queueRunner.indexOf('def run_queue'), queueRunner.indexOf('def parse_args'));
    expect(runQueueBody).toContain('plans = resolve_execution_plans');
    expect(runQueueBody.indexOf('wait_for_safe_gpu')).toBeLessThan(runQueueBody.indexOf('resolve_execution_plans'));
  });

  it('keeps the host-memory gate available when optional psutil is absent', () => {
    const result = runQueueNoPsutilMemoryProbe();

    expect(result.availableMiB).toBeGreaterThan(0);
    expect(queueRunner).toContain('def available_host_memory_mib');
    expect(queueRunner).toContain('GlobalMemoryStatusEx');
  });

  it('reports training runtime dependencies before a queue can create candidates', () => {
    const result = runTrainingRuntimeGateProbe();

    expect(result.missing).toEqual({ ready: false, missing: ['torch'] });
    expect(result.ready).toEqual({ ready: true, missing: [] });
    expect(queueRunner).toContain('def require_training_runtime');
    expect(queueRunner).toContain('"trainingRuntime": runtime');
  });

  it('requires consecutive safe resource samples before launch or pressure recovery', () => {
    const results = runStableGateStreakProbe();

    expect(results.observations).toEqual([
      { ready: false, streak: 1 },
      { ready: false, streak: 2 },
      { ready: false, streak: 0 },
      { ready: false, streak: 1 },
      { ready: false, streak: 2 },
      { ready: true, streak: 3 },
    ]);
    expect(results.adaptive.observedRunConsumptionMiB).toBe(2158);
    expect(results.adaptive.launchEvidenceAvailableMiB).toBe(3238);
    expect(results.adaptive.launchEvidenceThresholdMiB).toBe(3072);
    expect(results.adaptive.effectiveResumeThresholdMiB).toBe(3072);
    expect(results.transientLaunchSample.launchEvidenceAvailableMiB).toBe(9372);
    expect(results.transientLaunchSample.launchEvidenceThresholdMiB).toBe(8945);
    expect(results.transientLaunchSample.effectiveResumeThresholdMiB).toBe(8945);
    expect(results.adaptive.effectiveResumeThresholdMiB).toBeGreaterThanOrEqual(
      results.adaptive.launchEvidenceThresholdMiB
    );
    expect(results.invalid).toContain('at least two consecutive samples');
    expect(queueRunner).toContain('--stable-gate-samples');
    expect(queueRunner).toContain('gpu-stabilizing');
    expect(queueRunner).toContain('memory-recovery-stabilizing');
    expect(queueRunner).toContain('stableSamplesRequired');
    expect(queueRunner).toContain('adaptive_resume_evidence');
    expect(queueRunner).toContain('effectiveResumeThresholdMiB');
  });

  it('fails fast when checkpoint resume cannot safely load optimizer state', () => {
    expect(trainer).toContain('Safe checkpoint resume requires PyTorch >=2.6');
    expect(trainer).toContain('Version(torch.__version__.split');

    const mainBody = trainer.slice(trainer.indexOf('def main()'));
    expect(mainBody.indexOf('require_safe_resume_runtime(args.resume_from)')).toBeLessThan(
      mainBody.indexOf('load_text_only_qwen35(str(model_path), compute_dtype)')
    );
  });

  it('checkpoints and pauses a candidate under host-memory pressure before a guarded resume', () => {
    expect(trainer).toContain('MemoryPressurePauseCallback');
    expect(trainer).toContain('control.should_save = True');
    expect(trainer).toContain('MEMORY_PRESSURE_EXIT_CODE = 75');
    expect(trainer).toContain('memory-pressure-pause.json');
    expect(trainer).toContain('promotionAllowed');
    expect(queueRunner).toContain('verify_memory_pressure_pause_receipt');
    expect(queueRunner).toContain('paused-memory-pressure');
    expect(queueRunner).toContain('--pause-free-host-mib');
    expect(queueRunner).toContain('--resume-free-host-mib');
    expect(queueRunner).toContain('resume-free-host-mib must preserve the launch safety gate');
    expect(queueRunner).toContain('resume-free-host-mib must be greater than the pause threshold');
    expect(queueRunner).toContain('memory_pressure_command');
    expect(queueRunner).toContain('Memory pressure pause threshold does not match the queue contract');
    expect(trainer).toContain('"trainerImplementationSha256": sha256_file(Path(__file__).resolve())');
    expect(queueRunner).toContain('"trainerImplementationSha256": sha256_file(TRAINER)');
  });

  it('fails closed when a memory-pressure pause receipt is tampered or promotable', () => {
    const results = runMemoryPressurePauseReceiptProbe();

    expect(results.good).toBe('ok');
    expect(results.tamperedHash).toContain('trainer state hash mismatch');
    expect(results.weakThreshold).toContain('invalid memory evidence');
    expect(results.trainerChanged).toContain('resume contract mismatch');
    expect(results.promoted).toContain('must remain candidate-only');
    expect(results.escapedCheckpoint).toContain('not the latest candidate checkpoint');
    expect(results.missingWeights).toContain('Checkpoint adapter weights are missing');
  });

  it('pins every automatic pause recovery to its verified checkpoint instead of resolving latest again', () => {
    const results = runExactCheckpointResumeProbe();

    expect(results.exactResume).toMatch(/checkpoint-447$/);
    expect(results.containsLatest).toBe(false);
    expect(results.freshHasResume).toBe(false);
    expect(queueRunner).toContain('resume-paused-checkpoint');
    expect(queueRunner).not.toContain('"--resume-from", "latest"');
  });

  it('surfaces hash-bound checkpoint progress before loading the resumed model', () => {
    expect(queueRunner).toContain('def checkpoint_progress');
    expect(queueRunner).toContain('Checkpoint progress is internally inconsistent');
    expect(queueRunner).toContain('Checkpoint adapter weights are missing');
    expect(queueRunner).toContain("'resumeCheckpoint': resume_checkpoint");
    expect(queueRunner).toContain("'trainerStateSha256': sha256_file(state_path)");
    expect(queueRunner).toContain("'adapterSha256': sha256_file(weights_path)");

    expect(queueRunner).toContain("'remainingSteps': max_steps - global_step");
    expect(queueRunner).toContain("'completedPercent': round(100 * global_step / max_steps, 2)");
  });

  it('accepts a current preflight receipt with the matching trainer hash', () => {
    expect(runProvenanceContractProbe().currentGoodHash).toBe('ok');
  });

  it('rejects a current preflight receipt with a mismatched trainer hash', () => {
    expect(runProvenanceContractProbe().currentHashMismatch).toContain('preflight resume contract mismatch');
  });

  it('accepts an allowlisted historical Candidate 1 receipt without a trainer hash', () => {
    expect(runProvenanceContractProbe().legacyMissingField).toBe('ok');
  });

  it('rejects a Candidate 5 receipt without a trainer hash', () => {
    expect(runProvenanceContractProbe().candidate5MissingField).toContain('preflight resume contract mismatch');
  });

  it('rejects a downgraded training provenance schema through the adapter verifier', () => {
    expect(runProvenanceContractProbe().schemaDowngrade).toContain('training provenance schema mismatch');
  });

  it('rejects unknown production manifest fields, precisions, and target profiles', () => {
    const results = runProvenanceContractProbe();

    expect(results.knownManifestShape).toBe('ok');
    expect(results.unknownManifestField).toContain('unsupported training provenance fields');
    expect(results.unknownTargetProfile).toContain('unsupported target profile');
    expect(results.knownBf16Precision).toBe('ok');
    expect(results.unknownPrecision).toContain('unsupported training precision');
  });

  it('keeps queue output candidate-only and resumes only checkpointed candidates', () => {
    expect(queueRunner).toContain('"promotionAllowed": False');
    expect(queueRunner).toContain('Queue resume checkpoint is unavailable');
    expect(queueRunner).toContain('Incomplete candidate has no resumable checkpoint');
    expect(queueRunner).toContain('Checkpoint resume contract mismatch');
    expect(trainer).toContain('tomny.training-preflight.v1');
    expect(trainer).toContain('Checkpoint resume contract differs from recipe');
  });

  it('pins recipe bytes, re-verifies completed candidates, and records adapter failure', () => {
    const failure = runQueueFailureSummaryProbe();

    expect(queueRunner).toContain('Pinned recipe SHA-256 mismatch');
    expect(queueRunner).toContain('verify_completed_candidate(candidate)');
    expect(queueRunner).toContain('"--output", os.devnull');
    expect(queueRunner).toContain('current_adapter["state"] = "failed"');
    expect(failure).toMatchObject({ code: 'queue-failed', type: 'RuntimeError' });
    expect(failure.serialized).not.toContain('secret-token');
    expect(failure.serialized).not.toContain('private');
  });

  it('rejects injected probes outside read-only modes and stops after trainer failure', () => {
    expect(queueRunner).toContain('--probe-json is restricted to --dry-run or --status');
    expect(queueRunner).toContain('CUDA_FATAL_EXIT_CODE = 76');
    expect(queueRunner).toContain('fatal_cuda_output(line)');
    expect(queueRunner).toContain('terminate_process_tree(process)');
    expect(queueRunner).toContain('trainer-cuda-fatal');
    expect(queueRunner).toContain("raise RuntimeError(f\"{item['purpose']} trainer exited");
  });

  it('bounds a silent trainer hang and records fail-closed evidence', () => {
    const result = runHungTrainerProbe();

    expect(result.exitCode).toBe(77);
    expect(result.timeoutLogged).toBe(true);
    expect(result.elapsedSeconds).toBeLessThan(10);
    expect(queueRunner).toContain('TRAINER_HUNG_EXIT_CODE = 77');
    expect(queueRunner).toContain('--trainer-output-idle-timeout-seconds');
    expect(trainer).toContain('evaluation-heartbeat');
  });

  it('records user cancellation, keeps the checkpoint, and does not launch another purpose', () => {
    const result = runCancellationProbe();

    expect(result.childCancellationLogged).toBe(true);
    expect(result.terminatedPids).toEqual([4242]);
    expect(result.queueCancelled).toBe(true);
    expect(result.queueErrorPresent).toBe(false);
    expect(result.promotionAllowed).toBe(false);
    expect(result.checkpointExists).toBe(true);
    expect(result.terminalCheckpointStep).toBe(42);
    expect(result.startedPurposes).toEqual(['security']);
    expect(result.secondAdapterState).toBe('pending');
    expect(result.defaultPurposes).toEqual(['security', 'user-understanding']);
    expect(result.exactPurpose).toEqual(['user-understanding']);
    expect(queueRunner).toContain("['taskkill', '/PID', str(process.pid), '/T', '/F']");
    expect(queueRunner).toContain("status['state'] = 'cancelled'");
    expect(queueRunner).toContain('--cancel-file');
  });

  it('resumes only the audited interrupted Security checkpoint through queue safeguards', () => {
    const result = runSecurityCheckpointResumeProbe();

    expect(result.crossPurposeRejected).toBe(true);
    expect(result.failedStateMismatchRejected).toBe(true);
    expect(result.invocationCount).toBe(1);
    expect(result.exactResumeCheckpoint).toContain('checkpoint-50');
    expect(result.queueCancelled).toBe(true);
    expect(result.promotionAllowed).toBe(false);
    expect(result.parsedVersion).toBe('0.4.0-candidate.1');
    expect(result.resumeMode).toBe('exact-security-checkpoint-50-resume');
    expect(result.resumeStep).toBe(50);
    expect(result.selectedPurposes).toEqual(['security']);
    expect(queueRunner).toContain('--resume-security-checkpoint-50');
    expect(queueRunner).toContain('Security checkpoint resume latest terminal state mismatch');
    expect(queueRunner).toContain("'resume-interrupted-security-checkpoint-50'");
  });

  it('resumes only the exact user-cancelled Security BF16 checkpoint through queue safeguards', () => {
    const result = runSecurityStabilityCancelledResumeProbe();

    expect(result.exactResumeCheckpoint).toContain('checkpoint-500');
    expect(result.invocationCount).toBe(1);
    expect(result.parsedVersion).toBe('0.5.0-candidate.1');
    expect(result.promotionAllowed).toBe(false);
    expect(result.queueCancelled).toBe(true);
    expect(result.resumeMode).toBe('resume-cancelled-security-stability-candidate');
    expect(result.resumeStep).toBe(500);
    expect(result.staleCheckpointRejected).toBe(true);
    expect(queueRunner).toContain('--resume-security-stability-candidate');
    expect(queueRunner).toContain('requires a user-requested cancellation receipt');
    expect(queueRunner).toContain('checkpoint is not the latest candidate checkpoint');
  });

  it('terminally recovers only the orphaned waiting Security BF16 queue without launching training', () => {
    const result = runSecurityOrphanedWaitingRecoveryProbe();

    expect(result.freshCancelPathRequired).toBe(true);
    expect(result.benignWindowsProcessesAccepted).toBe(true);
    expect(result.unobservablePythonRejected).toBe(true);
    expect(result.queueIdentityDetected).toBe(true);
    expect(result.liveLockRejected).toBe(true);
    expect(result.liveProcessRejected).toBe(true);
    expect(result.latestStateRejected).toBe(true);
    expect(result.mismatchRejected).toBe(true);
    expect(result.finalizedRejected).toBe(true);
    expect(result.tamperedReceiptRejected).toBe(true);
    expect(result.crossPurposeRejected).toBe(true);
    expect(result.noTrainerStarted).toBe(true);
    expect(result.parsedVersion).toBe('0.5.0-candidate.1');
    expect(result.recoveryAction).toBe('recover-orphaned-waiting-security-stability-candidate');
    expect(result.recoveryState).toBe('cancelled');
    expect(result.promotionAllowed).toBe(false);
    expect(result.laterResumeAction).toBe('resume-cancelled-security-stability-candidate');
    expect(result.latestWasReplaced).toBe(true);
    expect(queueRunner).toContain('--recover-orphaned-waiting-security-stability-candidate');
    expect(queueRunner).toContain('rejects active queue or trainer processes');
    expect(queueRunner).toContain('requires a fresh absent --cancel-file path');
  });

  it('routes three adapters through the immutable Qwen 0.8B base', () => {
    expect(queueRunner).toContain('BASE_MODELS[item["purpose"]]');
    expect(queueRunner).toContain('BASE_BINDINGS[item["purpose"]]');
    expect(queueRunner).toContain('Qwen3.5-0.8B');
    expect(queueRunner).not.toContain('Qwen3.5-2B');
    expect(queueRunner).toContain('ff3a07808a9e83627e69a07131fdec45c60973f23cc5617204d173461ec65fe6');
    expect(queueRunner).toContain('.training-data-v6-qwen08b-semantic-r4');
    expect(queueRunner).toContain('Dataset base binding mismatch');
  });

  it('benchmarks immutable tests with the same mixed candidate topology', () => {
    expect(benchmark).toContain('--immutable-test-manifest');
    expect(benchmark).toContain('Path(args.immutable_test_manifest).resolve().parent');
    expect(benchmark).toContain('trainerReadable") is not False');
    expect(benchmark).toContain('verify_immutable_sources(immutable_sources)');
    expect(benchmark).toContain('qwen35-08b-candidate');
    expect(benchmark).not.toContain('qwen35-2b-candidate');
    expect(benchmark).toContain('Candidate benchmark output must be below .model-benchmarks/candidates');
    expect(benchmark).toContain('cannot name a promotion channel');
    expect(benchmark.match(/structured_output_recovery=True/g)).toHaveLength(1);
    expect(benchmark).toContain('structuredOutputRecovery');
    expect(benchmark).toContain('initialOutput');
    expect(benchmark).toContain('recoveryOutput');
    expect(benchmark).toContain('maxAdditionalAttempts');
  });

  it('never lets a format-only recovery change an already valid security decision', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import types


def install_module(name, **attributes):
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules[name] = module


schema = {
    'riskType': str,
    'action': str,
    'confidence': (int, float),
    'reasonCode': str,
    'requiresBackendValidation': bool,
    'redactions': list,
}
install_module('psutil')
install_module('torch')
install_module('peft', PeftModel=object)
install_module(
    'transformers',
    AutoTokenizer=object,
    BitsAndBytesConfig=object,
    Qwen3_5Config=object,
    Qwen3_5ForCausalLM=object,
)
install_module(
    'benchmark_cases',
    ENUMS={'security': {'action': {'allow', 'ask', 'local_only', 'block'}}},
    PRIMARY_FIELDS={'security': ['action', 'riskType']},
    PRIMARY_LABEL={'security': 'action'},
    SCHEMAS={'security': schema},
    build_cases=lambda *args, **kwargs: [],
    case_counts=lambda *args, **kwargs: {},
)
install_module('data_quality', canonical_text=lambda value: value)

spec = importlib.util.spec_from_file_location('benchmark_adapters', sys.argv[1])
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)

case = {
    'domain': 'security',
    'expected': {
        'riskType': 'prompt_injection',
        'action': 'block',
        'confidence': 0.9,
        'reasonCode': 'untrusted_instruction',
        'requiresBackendValidation': True,
        'redactions': [],
    },
    'catastrophic': {'action': ['allow']},
}
initial_block = json.dumps({
    'riskType': 'prompt_injection',
    'action': 'block',
    'confidence': 0.9,
    'reasonCode': 'untrusted_instruction',
    'requiresBackendValidation': True,
})
retry_allow = json.dumps({
    **case['expected'],
    'action': 'allow',
})
retry_block = json.dumps(case['expected'])


def recover(initial, retry):
    output, receipt, evaluation = benchmark.recover_structured_output(
        case,
        initial,
        lambda: (retry, 0.1, 12, 0),
    )
    return {
        'output': output,
        'selectedAttempt': receipt['selectedAttempt'],
        'succeeded': receipt['succeeded'],
        'primaryLabelPreserved': receipt['primaryLabelPreserved'],
        'action': evaluation['predictedLabel'],
        'catastrophic': evaluation['catastrophic'],
    }


print(json.dumps({
    'downgrade': recover(initial_block, retry_allow),
    'sameDecision': recover(initial_block, retry_block),
    'invalidInitial': recover('not json', retry_allow),
}))
`;
    const result = JSON.parse(
      execFileSync('python', ['-c', script, resolve(process.cwd(), 'scripts/model-training/benchmark_adapters.py')], {
        encoding: 'utf8',
      })
    ) as Record<string, Record<string, unknown>>;

    expect(result.downgrade).toMatchObject({
      output: expect.stringContaining('"action": "block"'),
      selectedAttempt: 'initial',
      succeeded: false,
      primaryLabelPreserved: false,
      action: 'block',
      catastrophic: false,
    });
    expect(result.sameDecision).toMatchObject({
      selectedAttempt: 'recovery',
      succeeded: true,
      primaryLabelPreserved: true,
      action: 'block',
      catastrophic: false,
    });
    expect(result.invalidInitial).toMatchObject({
      selectedAttempt: 'recovery',
      succeeded: true,
      primaryLabelPreserved: true,
      action: 'allow',
      catastrophic: true,
    });
  });

  it('reports a complete error taxonomy without changing benchmark scores or gates', () => {
    const results = runErrorTaxonomyProbe();

    expect(results.categoryKeys).toEqual([
      'invalidJson',
      'primaryDecisionFailures',
      'robustVariantFailures',
      'schemaViolations',
    ]);
    expect(results.schemaCategoryKeys).toEqual(['caseCount', 'caseRate', 'enum', 'keySet', 'type', 'valueRange']);
    expect(results.invalidJsonCount).toBe(1);
    expect(results.schemaCaseCount).toBe(3);
    expect(results.scoreUnchanged).toBe(true);
    expect(results.gateUnchanged).toBe(true);
  });

  it('fails closed before CUDA benchmark startup when host memory is low', () => {
    expect(benchmark).toContain('MIN_BENCHMARK_FREE_HOST_MIB = 3072');

    expect(benchmark).toContain('BENCHMARK_MEMORY_STABLE_SAMPLES = 3');
    expect(benchmark).toContain('samplesMiB');
    expect(benchmark).toContain('minimumObservedMiB');
    expect(benchmark).toContain('consecutive samples');
    expect(benchmark).toContain('psutil.virtual_memory().available');
    expect(benchmark).toContain('Benchmark requires {BENCHMARK_MEMORY_STABLE_SAMPLES} consecutive samples');
    expect(benchmark).toContain('"resourceGate": resource_gate');

    const resourceGateCall = benchmark.indexOf(
      'resource_gate = require_host_memory_headroom(args.allow_low_host_memory)'
    );
    const cudaCheck = benchmark.indexOf('if not torch.cuda.is_available()');
    expect(resourceGateCall).toBeGreaterThan(-1);
    expect(resourceGateCall).toBeLessThan(cudaCheck);
  });

  it('re-verifies every earlier candidate in a suffix resume before benchmark handoff', () => {
    expect(queueRunner).toContain('Cannot start at');
    expect(queueRunner).toContain("plan['action'] != 'skip-completed'");
    expect(queueRunner).not.toContain('skipped-before-start');
    expect(postBenchmark).toContain('ALLOWED_COMPLETED_STATES');
    expect(postBenchmark).toContain("'completed-candidate', 'skipped-completed'");
  });

  it('keeps post-training evaluation fail-closed and candidate-only', () => {
    expect(postBenchmark).toContain('Queue is not completed-candidates; benchmark fails closed');
    expect(postBenchmark).toContain('_queue/<runId>/status.json');
    expect(postBenchmark).toContain('sha256_tree(base_path)');
    expect(postBenchmark).toContain('FORBIDDEN_PROMOTION_PARTS');
    expect(postBenchmark).toContain('"promotionAllowed": False');
    expect(postBenchmark).toContain("'semanticGroupsMinimum': 100");
    expect(postBenchmark).toContain("'criticalIndependentGroupsMinimum': 30");
    expect(postBenchmark).toContain('current 12-group synthetic test is intentionally insufficient');
  });

  it('orchestrates a completed Security v0.5 candidate only through its finalized checkpoint evidence', () => {
    const result = runSecurityV05PostTrainingBenchmarkProbe();

    expect(result.queueAccepted).toBe(true);
    expect(result.queueMismatch).toContain('Security queue adapter identity or completion evidence mismatch');
    expect(result.candidateOnly).toBe(true);
    expect(result.promotionAllowed).toBe(false);
    expect(result.checkpointArgument).toBe(true);
    expect(result.heldoutArgument).toBe(true);
    expect(result.skipBaseAbsent).toBe(true);
    expect(result.resourceOverrideAbsent).toBe(true);
    expect(postBenchmark).toContain('SECURITY_V05_CANDIDATE_VERSION');
    expect(postBenchmark).toContain('--security-v05-single-domain');
    expect(postBenchmark).toContain('Security queue is not one completed candidate; benchmark fails closed');
    expect(postBenchmark).toContain('Security trainer-selected checkpoint does not match finalized adapter artifacts');
    expect(postBenchmark).toContain("'--checkpoint-adapter'");
  });

  it('rejects malformed, partial, reused, or non-finite candidate benchmark evidence without exposing internals', () => {
    const results = runCandidateEvidenceContractProbe();

    expect(results.malformedJson).toBe('RuntimeError: Candidate evidence JSON is unreadable or malformed');
    expect(results.missingFinalManifest).toBe('RuntimeError: Candidate evidence JSON is unreadable or malformed');
    expect(results.overwrite).toBe('RuntimeError: Candidate evidence output already exists');
    expect(results.candidateRawReuse).toBe('RuntimeError: Candidate benchmark cannot reuse raw output');
    expect(results.nonFiniteMetricAccepted).toBe(false);
    expect(results.booleanMetricAccepted).toBe(false);
    expect(results.invertedConfidenceIntervalAccepted).toBe(false);
    expect(results.outOfRangeMetricAccepted).toBe(false);
    expect(results.changedCandidate).toBe('RuntimeError: Candidate artifacts or provenance changed during benchmark');
    expect(results.changedBase).toBe('RuntimeError: qwen35-08b: base model changed during benchmark');
    expect(results.cliExitCode).toBe(2);
    expect(results.cliError).toBe('candidate-evidence-verification-failed');
    expect(results.cliOutput).toBe('');
  });

  it('never overwrites an existing verification report while writing candidate evidence', () => {
    const results = runVerifierOutputWriteProbe();

    expect(results.overwrite).toBe('RuntimeError: Verification evidence output already exists');
    expect(results.originalPreserved).toBe(true);
    expect(results.createdContent).toBe('{"verified": true}\n');
  });

  it('uses the same production provenance schema in training, verification, and post-training benchmark', () => {
    expect(trainer).toContain('tomny.training-provenance.v2');
    expect(verifier).toContain('tomny.training-provenance.v2');
    expect(postBenchmark).toContain('tomny.training-provenance.v2');
    expect(postBenchmark).toMatch(/manifest\.get\(.schemaVersion.\) != PROVENANCE_SCHEMA/);
    expect(postBenchmark).not.toContain('tomny.adapter-training-manifest.v2');
  });

  it('accepts only an audited sidecar when a legacy candidate lacks validationGate', () => {
    const results = runValidationGateMigrationProbe();

    expect(results.goodMigration).toBe('ok:migration-sidecar');
    expect(results.missingMigration).toContain('validationGate is missing');
    expect(results.manifestHashMismatch).toContain('source manifest hash mismatch');
    expect(results.priorHashMismatch).toContain('prior verification hash mismatch');
    expect(results.candidateMismatch).toContain('candidate binding mismatch');
  });

  it('accepts only validation evidence that is finite and internally consistent', () => {
    const results = runSafeFinalizeVerifierProbe();

    expect(results.good).toBe('ok');
    expect(results.missingValidation).toContain('validation metrics are missing');
    expect(results.nonFiniteValidation).toContain('must be a finite number');
    expect(results.inconsistentGate).toContain('observed delta does not match');
    expect(results.exceededGate).toContain('exceeds the allowed maximum');
  });

  it('binds safe finalization to a zero-step JSON and safetensors checkpoint', () => {
    const results = runSafeFinalizeVerifierProbe();

    expect(results.unsafeState).toContain('unsafeStateLoaded=false');
    expect(results.optimizerStep).toContain('zero optimizer steps');
    expect(results.optimizerBoolean).toContain('zero optimizer steps');
    expect(results.sourceHash).toContain('source adapter hash mismatch');
    expect(results.sourceStep).toContain('source step is not bound');
    expect(results.sourceBoolean).toContain('sourceStep must be a positive integer');
    expect(results.bestMetric).toContain('best metric binding mismatch');
  });

  it('never loads pickle-based checkpoint state during verification', () => {
    expect(verifier).toContain('trainer_state.json');
    expect(verifier).not.toContain('optimizer.pt');
    expect(verifier).not.toContain('torch.load');
  });

  it('rejects severe primary-label distribution drift before starting training', () => {
    const script = String.raw`
import ast
import json
from pathlib import Path
import sys
from typing import Any

source_path = Path(sys.argv[1])
tree = ast.parse(source_path.read_text(encoding='utf-8'))
selected = [
    node for node in tree.body
    if isinstance(node, ast.FunctionDef) and node.name == 'primary_label_total_variation'
]
namespace = {'Any': Any}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(source_path), 'exec'), namespace)
measure = namespace['primary_label_total_variation']


def outcome(action):
    try:
        return {'ok': action()}
    except Exception as error:
        return {'error': f'{type(error).__name__}: {error}'}


print(json.dumps({
    'balanced': measure({'allow': 50, 'block': 50}, {'allow': 25, 'block': 25}),
    'shifted': measure(
        {'allow': 549, 'ask': 137, 'block': 277, 'local_only': 133},
        {'allow': 125, 'ask': 250, 'block': 375, 'local_only': 250},
    ),
    'invalid': outcome(lambda: measure({'allow': True}, {'allow': 1})),
}))
`;
    const result = JSON.parse(
      execFileSync('python', ['-c', script, resolve(process.cwd(), 'scripts/model-training/train_lora.py')], {
        encoding: 'utf8',
      })
    ) as Record<string, unknown>;

    expect(result.balanced).toBe(0);
    expect(result.shifted).toBeGreaterThan(0.37);
    expect(result.invalid).toMatchObject({ error: expect.stringContaining('non-negative integer counts') });
    expect(trainer).toContain('distribution_shift > MAX_PRIMARY_LABEL_TOTAL_VARIATION');
    expect(trainer).toContain('Primary label distribution shift');
  });

  it('keeps verified best-checkpoint benchmarks isolated from promotion-capable candidate runs', () => {
    const script = String.raw`
import argparse
import ast
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import types
from typing import Any

source_path = Path(sys.argv[1])
tree = ast.parse(source_path.read_text(encoding='utf-8'))
selected = [
    node for node in tree.body
    if isinstance(node, (ast.FunctionDef, ast.Assign))
    and (
        isinstance(node, ast.FunctionDef)
        and node.name in {'is_candidate_only', 'resolve_model_runs', 'validate_candidate_output', 'verify_checkpoint_evidence', 'sha256_file'}
        or isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id in {'CANDIDATE_IDS', 'VERIFICATION_REPORT_SCHEMA'} for target in node.targets)
    )
]
namespace = {
    'argparse': argparse,
    'Any': Any,
    'hashlib': hashlib,
    'json': json,
    'math': math,
    'MODEL_RUNS': [],
    'Path': Path,
    're': re,
}
# Probe namespace is intentionally minimal.
exec(compile(ast.Module(body=selected, type_ignores=[]), str(source_path), 'exec'), namespace)
resolve_runs = namespace['resolve_model_runs']
validate_output = namespace['validate_candidate_output']
VERIFICATION_REPORT_SCHEMA = namespace['VERIFICATION_REPORT_SCHEMA']
sha256_file = namespace['sha256_file']


def outcome(action):
    try:
        return {'ok': action()}
    except Exception as error:
        return {'error': f'{type(error).__name__}: {error}'}


previous_cwd = Path.cwd()
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    os.chdir(root)
    checkpoint = root / '.model-adapters' / 'candidates' / 'com.tomny.core.security' / '0.3.0-candidate.1' / 'checkpoint-50'
    checkpoint.mkdir(parents=True)
    (checkpoint / 'adapter_model.safetensors').write_bytes(b'weights')
    (checkpoint / 'adapter_config.json').write_bytes(b'config')
    (checkpoint / 'trainer_state.json').write_text(json.dumps({
        'global_step': 50,
        'max_steps': 450,
        'best_metric': 0.125,
        'best_model_checkpoint': str(checkpoint.resolve()),
    }), encoding='utf-8')
    candidate = checkpoint.parent
    (candidate / 'adapter_model.safetensors').write_bytes(b'weights')
    (candidate / 'adapter_config.json').write_bytes(b'config')
    (candidate / 'training_manifest.json').write_text('{}', encoding='utf-8')
    verification_path = candidate / 'verification-report.json'
    verification = {
        'schemaVersion': VERIFICATION_REPORT_SCHEMA,
        'verified': True,
        'adapterCount': 1,
        'adapters': [{
            'path': str(candidate.resolve()),
            'schemaVersion': 'tomny.training-provenance.v2',
            'purpose': 'security',
            'steps': 450,
            'productionProvenance': {
                'validation': {'bestEvalLoss': 0.125},
            },
            'manifestSha256': sha256_file(candidate / 'training_manifest.json'),
            'adapterConfigSha256': sha256_file(candidate / 'adapter_config.json'),
            'weightSha256': sha256_file(candidate / 'adapter_model.safetensors'),
        }],
    }
    verification_path.write_text(json.dumps(verification), encoding='utf-8')
    stale_verification_path = candidate / 'verification-report-stale.json'
    stale_verification = json.loads(json.dumps(verification))
    stale_verification['adapters'][0]['weightSha256'] = '0' * 64
    stale_verification_path.write_text(json.dumps(stale_verification), encoding='utf-8')
    base_model = root / '.local-models' / 'Qwen3.5-0.8B'
    base_model.mkdir(parents=True)

    def args(**overrides):
        values = {
            'candidate_root': None,
            'candidate_version': None,
            'checkpoint_domain': 'security',
            'checkpoint_adapter': str(checkpoint),
            'checkpoint_verification_report': str(verification_path),
            'domains': ['security'],
            'base_model_08b': str(base_model),
            'base_model_2b': None,
        }
        values.update(overrides)
        return types.SimpleNamespace(**values)

    run = resolve_runs(args())[0]
    allowed_output = root / '.model-benchmarks' / 'checkpoints' / 'security-step-50'
    escaped_checkpoint = root / 'checkpoint-50'
    escaped_checkpoint.mkdir()
    (escaped_checkpoint / 'adapter_model.safetensors').write_bytes(b'weights')
    (escaped_checkpoint / 'trainer_state.json').write_text('{}', encoding='utf-8')
    print(json.dumps({
        'run': run,
        'allowedOutput': outcome(lambda: validate_output(args(), allowed_output)),
        'missingPair': outcome(lambda: resolve_runs(args(checkpoint_adapter=None))),
        'missingEvidence': outcome(lambda: resolve_runs(args(checkpoint_verification_report=None))),
        'staleEvidence': outcome(lambda: resolve_runs(args(checkpoint_verification_report=str(stale_verification_path)))),
        'multipleDomains': outcome(lambda: resolve_runs(args(domains=['security', 'user-understanding']))),
        'candidateConflict': outcome(lambda: resolve_runs(args(candidate_version='0.3.0-candidate.1'))),
        'escapedCheckpoint': outcome(lambda: resolve_runs(args(checkpoint_adapter=str(escaped_checkpoint)))),
        'escapedOutput': outcome(lambda: validate_output(args(), root / 'outside')),
    }))
    os.chdir(previous_cwd)
`;
    const result = JSON.parse(
      execFileSync('python', ['-c', script, resolve(process.cwd(), 'scripts/model-training/benchmark_adapters.py')], {
        encoding: 'utf8',
      })
    ) as Record<string, unknown>;

    expect(result.run).toMatchObject({
      modelId: 'qwen35-08b-checkpoint-candidate',
      domains: ['security'],
      verificationEvidence: {
        reportSchemaVersion: 'tomny.adapter-verification-report.v1',
        checkpointWeightSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(result.allowedOutput).toEqual({ ok: null });
    expect(result.missingPair).toMatchObject({ error: expect.stringContaining('must be provided together') });
    expect(result.missingEvidence).toMatchObject({ error: expect.stringContaining('must be provided together') });
    expect(result.staleEvidence).toMatchObject({ error: expect.stringContaining('checkpoint weight hash mismatch') });
    expect(result.multipleDomains).toMatchObject({ error: expect.stringContaining('exactly the matching') });
    expect(result.candidateConflict).toMatchObject({ error: expect.stringContaining('cannot be combined') });
    expect(result.escapedCheckpoint).toMatchObject({ error: expect.stringContaining('below the candidate root') });
    expect(result.escapedOutput).toMatchObject({ error: expect.stringContaining('.model-benchmarks') });
  });

  it('fails closed on unsafe or malformed runtime GPU telemetry without using a GPU', () => {
    const script = String.raw`
import contextlib
import importlib.util
import io
import json
import sys
import types


def install_module(name, **attributes):
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules[name] = module


install_module('psutil')
install_module('torch')
install_module('peft', PeftModel=object)
install_module(
    'transformers',
    AutoTokenizer=object,
    BitsAndBytesConfig=object,
    Qwen3_5Config=object,
    Qwen3_5ForCausalLM=object,
)
install_module(
    'benchmark_cases',
    ENUMS={},
    PRIMARY_FIELDS={},
    PRIMARY_LABEL={},
    SCHEMAS={},
    build_cases=lambda *args, **kwargs: [],
    case_counts=lambda *args, **kwargs: {},
)
install_module('data_quality', canonical_text=lambda value: value)

spec = importlib.util.spec_from_file_location('benchmark_adapters', sys.argv[1])
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def outcome(action):
    try:
        return {'ok': action()}
    except Exception as error:
        return {'error': f'{type(error).__name__}: {error}'}


class Result:
    def __init__(self, returncode, stdout):
        self.returncode = returncode
        self.stdout = stdout


def telemetry(stdout, returncode=0):
    benchmark.shutil.which = lambda _name: 'nvidia-smi'
    benchmark.subprocess.run = lambda *_args, **_kwargs: Result(returncode, stdout)
    return benchmark.enforce_runtime_gpu_budget('test')


benchmark.shutil.which = lambda _name: None
def unavailable():
    benchmark.shutil.which = lambda _name: None
    return benchmark.enforce_runtime_gpu_budget('test')

def cooldown():
    samples = iter([
        {'freeVramMiB': 512, 'temperatureC': 79, 'gpuUtilizationPercent': 0},
        {'freeVramMiB': 512, 'temperatureC': 70, 'gpuUtilizationPercent': 0},
    ])
    waits = []
    benchmark.torch.cuda = types.SimpleNamespace(empty_cache=lambda: None)
    benchmark.read_runtime_gpu_telemetry = lambda: next(samples)
    benchmark.time.sleep = lambda seconds: waits.append(seconds)
    with contextlib.redirect_stdout(io.StringIO()):
        result = benchmark.wait_for_runtime_gpu_budget('test')
    return {'result': result, 'waits': waits}


print(json.dumps({
    'valid': benchmark.parse_runtime_gpu_telemetry('512, 70, 99\n'),
    'missingField': outcome(lambda: benchmark.parse_runtime_gpu_telemetry('512, 70\n')),
    'multipleRows': outcome(lambda: benchmark.parse_runtime_gpu_telemetry('512, 70, 0\n512, 70, 0\n')),
    'nonInteger': outcome(lambda: benchmark.parse_runtime_gpu_telemetry('512, N/A, 0\n')),
    'invalidBounds': outcome(lambda: benchmark.parse_runtime_gpu_telemetry('512, 151, 0\n')),
    'lowVram': outcome(lambda: telemetry('255, 70, 0\n')),
    'hot': outcome(lambda: telemetry('512, 79, 0\n')),
    'subprocessFailure': outcome(lambda: telemetry('', 1)),
    'unavailable': outcome(unavailable),
    'cooldown': cooldown(),
}))
`;
    const result = JSON.parse(
      execFileSync('python', ['-c', script, resolve(process.cwd(), 'scripts/model-training/benchmark_adapters.py')], {
        encoding: 'utf8',
      })
    ) as Record<string, unknown>;

    expect(result.valid).toEqual({ freeVramMiB: 512, temperatureC: 70, gpuUtilizationPercent: 99 });
    expect(result.missingField).toMatchObject({
      error: 'ValueError: GPU runtime telemetry must contain exactly one three-field row',
    });
    expect(result.multipleRows).toMatchObject({
      error: 'ValueError: GPU runtime telemetry must contain exactly one three-field row',
    });
    expect(result.nonInteger).toMatchObject({
      error: 'ValueError: GPU runtime telemetry contains a non-integer field',
    });
    expect(result.invalidBounds).toMatchObject({
      error: 'ValueError: GPU runtime telemetry is outside its physical bounds',
    });
    expect(result.lowVram).toMatchObject({
      error: 'RuntimeError: GPU runtime watchdog aborted benchmark at test: free VRAM 255 MiB is below 256 MiB',
    });
    expect(result.hot).toMatchObject({
      error: 'RuntimeError: GPU runtime watchdog aborted benchmark at test: GPU temperature 79 C exceeds 78 C',
    });
    expect(result.subprocessFailure).toMatchObject({ error: 'RuntimeError: GPU runtime telemetry is unavailable' });
    expect(result.unavailable).toMatchObject({
      error: 'RuntimeError: GPU runtime telemetry is unavailable: nvidia-smi was not found',
    });
    expect(result.cooldown).toEqual({
      result: { freeVramMiB: 512, temperatureC: 70, gpuUtilizationPercent: 0 },
      waits: [30],
    });
    const runCondition = benchmark.slice(
      benchmark.indexOf('def run_condition('),
      benchmark.indexOf('def load_raw_records(')
    );
    const releaseIndex = runCondition.indexOf('del encoded, generated');
    const cacheReleaseIndex = runCondition.indexOf('torch.cuda.empty_cache()', releaseIndex);
    const postBatchCheckIndex = runCondition.indexOf('after-batch-', cacheReleaseIndex);
    expect(releaseIndex).toBeGreaterThan(-1);
    expect(cacheReleaseIndex).toBeGreaterThan(releaseIndex);
    expect(postBatchCheckIndex).toBeGreaterThan(cacheReleaseIndex);
    expect(benchmark).toContain('"promotionAllowed": False');
  });

  it('binds candidate benchmark safety and non-regression floors to exact held-out denominators', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import types


def install_module(name, **attributes):
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules[name] = module


install_module('psutil')
install_module('torch')
install_module('peft', PeftModel=object)
install_module('transformers', AutoTokenizer=object, BitsAndBytesConfig=object, Qwen3_5Config=object, Qwen3_5ForCausalLM=object)
install_module('benchmark_cases', ENUMS={}, PRIMARY_FIELDS={}, PRIMARY_LABEL={}, SCHEMAS={}, build_cases=lambda *args: [], case_counts=lambda *args: {})
install_module('data_quality', canonical_text=lambda value: value)

spec = importlib.util.spec_from_file_location('benchmark_adapters', sys.argv[1])
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def record(case_id, critical, catastrophic, action, correct):
    return {
        'case': {'caseId': case_id, 'critical': critical, 'catastrophic': catastrophic},
        'evaluation': {'parsed': {'action': action}, 'compositeCorrect': correct},
    }


def outcome(action):
    try:
        return {'ok': action()}
    except Exception as error:
        return {'error': f'{type(error).__name__}: {error}'}


base = [
    record('security-critical', True, {'action': ['allow']}, 'block', True),
    record('security-negative', False, {}, 'allow', True),
]
adapter_safe = [
    record('security-critical', True, {'action': ['allow']}, 'block', True),
    record('security-negative', False, {}, 'allow', True),
]
adapter_false_allow = [
    record('security-critical', True, {'action': ['allow']}, 'allow', False),
    record('security-negative', False, {}, 'allow', True),
]
valid_args = types.SimpleNamespace(
    candidate_version='0.5.0-candidate.1', checkpoint_adapter=None,
    immutable_test_manifest='immutable.json', skip_base=False, limit_groups=0,
    variants=['clean', 'paraphrase', 'noisy', 'adversarial'], seed=20260725,
    max_new_tokens=96, max_input_tokens=512, batch_size=4, allow_low_host_memory=False,
)
print(json.dumps({
    'safe': benchmark.candidate_comparison_gate('security', base, adapter_safe),
    'falseAllow': benchmark.candidate_comparison_gate('security', base, adapter_false_allow),
    'mismatch': outcome(lambda: benchmark.candidate_comparison_gate('security', base, adapter_safe[:1])),
    'validConfiguration': outcome(lambda: benchmark.validate_candidate_benchmark_configuration(valid_args)),
    'missingHeldout': outcome(lambda: benchmark.validate_candidate_benchmark_configuration(types.SimpleNamespace(**{**valid_args.__dict__, 'immutable_test_manifest': None}))),
}))
`;
    const result = JSON.parse(
      execFileSync('python', ['-c', script, resolve(process.cwd(), 'scripts/model-training/benchmark_adapters.py')], {
        encoding: 'utf8',
      })
    ) as Record<string, Record<string, unknown>>;

    expect(result.safe).toMatchObject({
      passed: true,
      baseAdapterDenominator: { baseRecordCount: 2, adapterRecordCount: 2, sharedCaseCount: 2, exactMatch: true },
      securityFalseAllowDenominator: 1,
    });
    expect(result.safe.checks).toMatchObject({
      compositeNonRegression: { baseNumerator: 2, adapterNumerator: 2, denominator: 2, passed: true },
      criticalNonRegression: { baseNumerator: 1, adapterNumerator: 1, denominator: 1, passed: true },
      zeroSecurityFalseAllow: { numerator: 0, denominator: 1, floor: 0, passed: true },
    });
    expect(result.falseAllow).toMatchObject({
      passed: false,
      checks: { zeroSecurityFalseAllow: { numerator: 1, denominator: 1, passed: false } },
    });
    expect(result.mismatch).toMatchObject({ error: expect.stringContaining('case denominators differ') });
    expect(result.validConfiguration).toEqual({ ok: null });
    expect(result.missingHeldout).toMatchObject({ error: expect.stringContaining('immutable held-out') });
  });
});
