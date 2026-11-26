import json
import os
from pathlib import Path
config = json.loads((Path(__file__).parent / 'storage/config.json').read_text())
device = next(p for p in config['platforms'] if p['platform'] == 'midea-platform')['devices'][0]
DEVICE_IP = os.environ.get('MIDEA_IP') or device['advanced_options']['ip']
DEVICE_ID = int(os.environ.get('MIDEA_DEVICE_ID') or device['id'])
