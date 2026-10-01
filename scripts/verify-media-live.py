"""Bounded synthetic vision/icon checks using only the personal Hermes profile."""
import base64
import importlib.util
import json
import logging
import os
from pathlib import Path
import shutil
import sys

logging.disable(logging.CRITICAL)
os.umask(0o077)
spec = importlib.util.spec_from_file_location('companion', Path(__file__).with_name('hermes-companion.py'))
companion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(companion)
folder = Path(sys.argv[1])

try:
    from PIL import Image
    picture = companion.personal.image_provider(refresh=True, model='gpt-image-2-medium', background='transparent', size='816x816').generate(
        'Draw one shopping-list icon of a ripe pear. Match the attached style sheet of existing Twemoji food icons: simple flat 2D vector-like emoji, bold rounded silhouette, cheerful clean solid colors, minimal flat shading, no outlines. Center a recognizable pear with generous empty padding, filling 75% of a square canvas. Isolated on a fully transparent background. No photography, 3D, textures, gradients, cast shadows, scenery, lettering, backdrop or checkerboard. Clear at 48 pixels. Draw only the pear; do not reproduce the style sheet.',
        reference_image_urls=[str(Path(__file__).resolve().parent.parent / 'backend/assets/item-style-reference.png')]
    )
    if not picture.get('success'):
        raise RuntimeError('Native icon generation failed')
    source = Path(picture['image'])
    target = folder / 'personal-pear-icon.png'
    shutil.copyfile(source, target)
    with Image.open(target) as image:
        alpha = image.getchannel('A').getextrema() if 'A' in image.getbands() else (255, 255)
        print(json.dumps({'stage':'icon','image':str(target),'size':image.size,'alpha':alpha,'transparent':alpha[0] < 255}), flush=True)
    if os.environ.get('FORKBASKET_MEDIA_ICON_ONLY') == '1':
        sys.exit(0)
    schema = {'type':'object','additionalProperties':False,'required':['name','servings','ingredients','steps'],'properties':{'name':{'type':'string'},'servings':{'type':'integer'},'ingredients':{'type':'array','items':{'type':'string'}},'steps':{'type':'array','items':{'type':'string'}}}}
    result = companion.perform({'path':'chat/completions','body':{'model':'gpt-6-luna','reasoning_effort':'xhigh','messages':[
        {'role':'system','content':'Transcribe the visible recipe precisely into the schema. Preserve quantities and all steps. Do not invent missing details.'},
        {'role':'user','content':[{'type':'text','text':'Read this recipe screenshot.'},{'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode((folder/'synthetic-recipe.png').read_bytes()).decode(),'detail':'high'}}]}
    ],'response_format':{'type':'json_schema','json_schema':{'name':'recipe_transcription','strict':True,'schema':schema}}}})
    recipe = json.loads(result['choices'][0]['message']['content'])
    assert recipe['servings'] == 4 and len(recipe['ingredients']) == 3 and len(recipe['steps']) == 3, 'Incorrect transcription'
    assert any('600' in ingredient and 'yogurt' in ingredient.lower() for ingredient in recipe['ingredients']), 'Missing yogurt quantity'
    assert any('4' in ingredient and 'pear' in ingredient.lower() for ingredient in recipe['ingredients']), 'Missing pears'
    assert any('80' in ingredient and 'oat' in ingredient.lower() for ingredient in recipe['ingredients']), 'Missing oats'
    print(json.dumps({'stage':'vision','recipe':recipe,'model':'gpt-6-luna','reasoning':'xhigh'}), flush=True)
except Exception as error:
    print(json.dumps({'stage':'failed','errorType':type(error).__name__}), flush=True)
    sys.exit(1)
