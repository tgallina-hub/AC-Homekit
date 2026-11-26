from diagnostic_config import DEVICE_IP, DEVICE_ID
"""Independent device readback/restoration for hardware verification."""
import asyncio
import json
import sys
from msmart.device import AirConditioner

async def main():
    device = AirConditioner(DEVICE_IP, DEVICE_ID, 6444)
    await device.refresh()
    if not device.online:
        raise RuntimeError('Device did not respond')
    if len(sys.argv) > 1 and sys.argv[1] == 'restore':
        with open(sys.argv[2]) as file:
            state = json.load(file)
        for attempt in range(3):
            for field in ('target_temperature', 'eco', 'turbo', 'sleep', 'fahrenheit', 'follow_me', 'purifier'):
                setattr(device, field, state[field])
            device.power_state = state['power']
            device.operational_mode = AirConditioner.OperationalMode(state['mode'])
            device.fan_speed = state['fan_speed']
            device.swing_mode = AirConditioner.SwingMode(state['swing_mode'])
            await device.apply()
            await asyncio.sleep(3)
            await device.refresh()
            actual = device.to_dict()
            if all(actual[key] == state[key] for key in ('power', 'mode', 'target_temperature', 'fan_speed', 'swing_mode', 'eco', 'turbo', 'sleep', 'purifier', 'follow_me')):
                break
            await asyncio.sleep(3)
        if device.display_on != state['display_on']:
            await device.toggle_display()
        await device.refresh()
    print(json.dumps(device.to_dict(), default=str))

asyncio.run(main())
