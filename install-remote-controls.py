"""Install the local extension into the pinned Homebridge Midea plugin."""
from pathlib import Path
import shutil,sys

source=Path(__file__).resolve().parent
root=Path(sys.argv[1]) if len(sys.argv)>1 else source
target=root/'node_modules/homebridge-midea-platform/dist/accessory'
for name in ('LocalRemoteControls.js','LocalProtocolFixes.js'):
    shutil.copy2(source/name,target/name)
# Retire generated timer support and stored jobs from older installations.
(target/'LocalScheduler.js').unlink(missing_ok=True)
for timer_file in (root/'storage').glob('remote-timers-*.json'):
    timer_file.unlink()
path=target/'AirConditionerAccessory.js'
text=path.read_text()
if "import { patchDisplayCommand }" not in text:
    text="import { patchDisplayCommand } from './LocalProtocolFixes.js';\nimport { MessageSwitchDisplay } from '../devices/ac/MideaACMessage.js';\npatchDisplayCommand(MessageSwitchDisplay);\n"+text
if "import { installRemoteControls }" not in text:
    text="import { installRemoteControls } from './LocalRemoteControls.js';\n"+text
    marker='        this.coolingThresholdTemperature = accessory.context?.thresholds?.coolingTemperature ?? configDev.AC_options.maxTemp;'
    if marker not in text: raise RuntimeError('Pinned plugin constructor changed')
    text=text.replace(marker,marker+'\n        installRemoteControls(this);',1)
path.write_text(text)
print('Remote controls extension installed:',root)
device_file=root/'node_modules/homebridge-midea-platform/dist/devices/ac/MideaACDevice.js'
device_source=device_file.read_text()
device_source=device_source.replace('messageToSend.NEW_PROTOCOL.screen_display = !!v;', 'messageToSend.NEW_PROTOCOL.screen_display_alternate = !!v;')
device_file.write_text(device_source)
