"""Synthetic capability probe executed inside Hermes's existing managed runtime."""
import importlib.util
import json
import logging
import os
from pathlib import Path
import re
import shutil
import sys
import time
from urllib.parse import urlsplit

logging.disable(logging.CRITICAL)
os.umask(0o077)
destination = Path(sys.argv[1]).resolve()
images = '--images' in sys.argv[2:]
report = {'provider': 'openai-codex', 'trials': []}

def emit(value):
    print('FORKBASKET_HERMES_PROBE ' + json.dumps(value), flush=True)

def image_file(value, name):
    from PIL import Image
    source = Path(value).resolve()
    with Image.open(source) as picture:
        picture.verify()
    with Image.open(source) as picture:
        dimensions = list(picture.size)
    if source.stat().st_size > 25 * 1024 * 1024:
        raise ValueError('Image too large')
    target = destination / f'{name}{source.suffix.lower()}'
    shutil.copyfile(source, target)
    target.chmod(0o600)
    return target, dimensions

try:
    from hermes_cli.auth import get_codex_auth_status
    status = get_codex_auth_status()
    report['loggedIn'] = bool(status.get('logged_in'))
    route = urlsplit(status.get('base_url') or '')
    report['nativeCodexRoute'] = route.scheme == 'https' and route.hostname == 'chatgpt.com' and route.path.rstrip('/') == '/backend-api/codex'
    # The status object may contain runtime credentials: never serialize it.
    del status
    if not report['loggedIn'] or not report['nativeCodexRoute']:
        raise RuntimeError('Hermes needs a native Codex connection')
    import hermes_cli
    root = Path(hermes_cli.__file__).resolve().parent.parent
    plugin = root / 'plugins/image_gen/openai-codex/__init__.py'
    spec = importlib.util.spec_from_file_location('forkbasket_hermes_image_probe', plugin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    provider = module.OpenAICodexImageGenProvider()
    report['available'] = provider.is_available()
    emit({'phase': 'capabilities', **report})
    if not report['available']:
        raise RuntimeError('Hermes image provider unavailable')
    if images:
        destination.mkdir(parents=True, exist_ok=True, mode=0o700)
        icon_prompt = 'A single red apple with a green leaf, centered friendly soft three-dimensional food illustration for a mobile shopping tile. Warm ivory background, gentle shadow, no text, no border, no extra objects.'
        trials = [
            ('icon', icon_prompt, 'square'),
            ('recipe', 'An appetizing photograph of creamy salmon pasta with dill and lemon in a ceramic bowl, natural window light, warm family kitchen, no text or graphics.', 'landscape'),
            ('reference-icon', 'Use the attached apple illustration as the style reference. Create a single ripe pear with a leaf instead, matching its lighting, material, framing and warm ivory background. No apple, no text, no border.', 'square'),
        ]
        reference = None
        for name, prompt, aspect in trials:
            emit({'phase': 'generating', 'trial': name})
            started = time.monotonic()
            kwargs = {'image_url': str(reference)} if name == 'reference-icon' else {}
            result = provider.generate(prompt, aspect_ratio=aspect, **kwargs)
            trial = {'name': name, 'success': bool(result.get('success')), 'seconds': round(time.monotonic() - started, 1)}
            if trial['success']:
                target, dimensions = image_file(result['image'], name)
                trial.update({'dimensions': dimensions, 'bytes': target.stat().st_size, 'artifact': str(target)})
                if name == 'icon':
                    reference = target
            else:
                # Never print provider error bodies or potentially identifying logs.
                category = str(result.get('error_type') or '')
                trial['errorType'] = category if re.fullmatch(r'[a-z_]{1,60}', category) else 'provider_error'
                match = re.search(r'HTTP (\d{3})', str(result.get('error') or ''))
                if match:
                    trial['httpStatus'] = int(match.group(1))
            report['trials'].append(trial)
            emit({'phase': 'trial-result', **trial})
            if not trial['success']:
                break
        report['success'] = len(report['trials']) == 3 and all(trial['success'] for trial in report['trials'])
        (destination / 'result.json').write_text(json.dumps(report, indent=2))
        emit({'phase': 'complete', **report})
        if not report['success']:
            sys.exit(1)
except Exception as error:
    emit({'phase': 'failed', 'errorType': type(error).__name__})
    sys.exit(1)
