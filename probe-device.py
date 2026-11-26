from diagnostic_config import DEVICE_IP, DEVICE_ID
"""Hardware probes with one connection and fresh-state reads (no optimistic state)."""
import asyncio, json, logging, fcntl
lock_file=open("test-results/hardware-test.lock", "w")
fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
from pathlib import Path
from msmart.device import AirConditioner as AC
from msmart.device.AC.command import PropertyId

logging.basicConfig(level=logging.ERROR)
results=[]
path=Path('test-results')

async def read():
    observer=AC(DEVICE_IP,DEVICE_ID,6444)
    try:
        await observer.refresh()
        if not observer.online: raise RuntimeError('No readback from device')
        return observer.to_dict()
    finally: observer._lan._disconnect()

async def command(values=None, action=None):
    device=AC(DEVICE_IP,DEVICE_ID,6444)
    try:
        await device.refresh()
        if action: await action(device)
        else:
            baseline = {'power_state': True, 'operational_mode': AC.OperationalMode.COOL, 'target_temperature': 21, 'fan_speed': 60, 'eco': False, 'turbo': False, 'sleep': False, 'follow_me': False, 'purifier': False, 'swing_mode': AC.SwingMode.OFF}
            for k,v in (baseline | values).items(): setattr(device,k,v)
            await device.apply()
    finally: device._lan._disconnect()

async def test(name,values,expected,action=None):
    try:
        await command(values,action)
        for attempt in range(3):
            await asyncio.sleep(1)
            actual=await read()
            if all(actual[k]==v for k,v in expected.items()): break
        result={'name':name,'passed':all(actual[k]==v for k,v in expected.items()),'expected':expected,'actual':{k:actual[k] for k in expected}}
    except Exception as error: result={'name':name,'passed':False,'error':str(error)}
    results.append(result); print(json.dumps(result),flush=True)
    (path/'device-probe-results.json').write_text(json.dumps(results,indent=2))

async def main():
    original=json.loads((path/'original-state.json').read_text())
    try:
        await test('Cool',{'power_state':True,'operational_mode':AC.OperationalMode.COOL,'eco':False,'target_temperature':22,'fan_speed':60},{'power':True,'mode':2,'target_temperature':22,'fan_speed':60})
        await test('Auto',{'operational_mode':AC.OperationalMode.AUTO,'fan_speed':102},{'mode':1,'fan_speed':102})
        await test('Dry',{'operational_mode':AC.OperationalMode.DRY},{'mode':3})
        await test('Fan',{'operational_mode':AC.OperationalMode.FAN_ONLY},{'mode':5})
        await test('Low',{'operational_mode':AC.OperationalMode.COOL,'fan_speed':40},{'mode':2,'fan_speed':40})
        await test('Medium',{'fan_speed':60},{'fan_speed':60})
        await test('High',{'fan_speed':80},{'fan_speed':80})
        await test('Eco',{'eco':True,'target_temperature':24,'fan_speed':102},{'eco':True,'target_temperature':24,'fan_speed':102})
        await test('Eco off',{'eco':False},{'eco':False})
        await test('Super',{'eco':False,'target_temperature':17,'fan_speed':80,'turbo':True},{'mode':2,'target_temperature':17,'fan_speed':80,'turbo':True})
        await test('Super off',{'turbo':False},{'turbo':False})
        await test('Sleep',{'sleep':True},{'sleep':True})
        await test('Sleep off',{'sleep':False},{'sleep':False})
        await test('Display off',{}, {'display_on':False},lambda d:d.toggle_display())
        await test('Display on',{}, {'display_on':True},lambda d:d.toggle_display())
        await test('Swing on',{'swing_mode':AC.SwingMode.VERTICAL},{'swing_mode':12})
        await test('Swing off',{'swing_mode':AC.SwingMode.OFF},{'swing_mode':0})
        await test('Direction 25',{'vertical_swing_angle':AC.SwingAngle.POS_2},{'vertical_swing_angle':25})
        await test('Energy 75',{'rate_select':AC.RateSelect.GEAR_75},{'rate_select':75})
        await test('Energy 50',{'rate_select':AC.RateSelect.GEAR_50},{'rate_select':50})
        await test('Energy normal',{'rate_select':AC.RateSelect.OFF},{'rate_select':100})
        await test('Ionizer',{'purifier':True},{'purifier':True})
        await test('Ionizer off',{'purifier':False},{'purifier':False})
        await test('Follow-me flag',{'follow_me':True},{'follow_me':True})
        await test('Follow-me off',{'follow_me':False},{'follow_me':False})
        await test('Self-clean',{}, {'self_clean':True},lambda d:d.start_self_clean())
        await test('Self-clean off',{}, {'self_clean':False},lambda d:d._apply_properties({PropertyId.SELF_CLEAN:False}))
        await test('Comfort',{'target_temperature':23},{'target_temperature':23})
    finally:
        values={k:original[k] for k in ('target_temperature','eco','turbo','sleep','fahrenheit','follow_me','purifier')}
        values.update(power_state=original['power'],operational_mode=AC.OperationalMode(original['mode']),fan_speed=original['fan_speed'],swing_mode=AC.SwingMode(original['swing_mode']))
        await test('Restore',values,{k:original[k] for k in ('power','mode','target_temperature','fan_speed','swing_mode','eco','turbo','sleep','purifier','follow_me')})
        state=await read()
        if state['display_on']!=original['display_on']: await command(action=lambda d:d.toggle_display())
        (path/'final-state.json').write_text(json.dumps(await read(),indent=2))

asyncio.run(main())
