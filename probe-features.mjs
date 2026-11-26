import {diagnosticIP, diagnosticID} from './diagnostic-config.js';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as wait} from 'node:timers/promises';
import {defaultsDeep} from 'lodash-es';
import MideaACDevice from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACDevice.js';
import {defaultConfig, defaultDeviceConfig} from './node_modules/homebridge-midea-platform/dist/platformUtils.js';

const python = (process.env.MIDEA_PYTHON || 'python3');
const read = () => JSON.parse(execFileSync(python,['device-state.py'],{encoding:'utf8',timeout:20000}));
const config=JSON.parse(readFileSync('storage/config.json'));
const settings=defaultsDeep(config.platforms[0],defaultConfig);
const devConfig=defaultsDeep(settings.devices[0],defaultDeviceConfig);
const logger={info:()=>{},debug:()=>{},warn:console.error,error:console.error};
const device=new MideaACDevice(logger,{ip:diagnosticIP,port:6444,id:diagnosticID,name:'Ar-condicionado',type:172,version:2},settings,devConfig);
const results=[];
let original;
async function test(name,action,expected){
 try{
  await action(); await wait(1200);
  const state=read();
  const passed=Object.entries(expected).every(([k,v])=>state[k]===v);
  results.push({name,passed,expected,actual:Object.fromEntries(Object.keys(expected).map(k=>[k,state[k]]))});
  console.log(JSON.stringify(results.at(-1)));
  await device.refresh_status(); await wait(300);
 }catch(error){results.push({name,passed:false,error:String(error)}); console.log(JSON.stringify(results.at(-1)));}
}
try {
 original=read();
 if(!await device.connect())throw Error('Connection failed');
 await wait(1800);
 await test('Cool',()=>device.set_attribute({POWER:true,MODE:2,FAN_SPEED:60}),{power:true,mode:2,fan_speed:60});
 await test('Auto',()=>device.set_attribute({MODE:1,FAN_SPEED:102}),{mode:1,fan_speed:102});
 await test('Eco',()=>device.set_attribute({MODE:2,ECO_MODE:true,TARGET_TEMPERATURE:24}),{mode:2,eco:true,target_temperature:24});
 await test('Eco off',()=>device.set_attribute({ECO_MODE:false}),{eco:false});
 await test('Turbo',()=>device.set_attribute({MODE:2,TARGET_TEMPERATURE:17,FAN_SPEED:80,BOOST_MODE:true}),{mode:2,target_temperature:17,turbo:true});
 await test('Turbo off',()=>device.set_attribute({BOOST_MODE:false}),{turbo:false});
 await test('Sleep',()=>device.set_attribute({SLEEP_MODE:true}),{sleep:true});
 await test('Sleep off',()=>device.set_attribute({SLEEP_MODE:false}),{sleep:false});
 await test('Display off',()=>device.set_attribute({SCREEN_DISPLAY:false}),{display_on:false});
 await test('Display on',()=>device.set_attribute({SCREEN_DISPLAY:true}),{display_on:true});
 await test('Swing on',()=>device.set_swing(false,true),{swing_mode:12});
 await test('Swing off',()=>device.set_swing(false,false),{swing_mode:0});
 await test('Direction 25',()=>device.set_swing_angle('Vertical',25),{vertical_swing_angle:25});
 await test('Direction 50',()=>device.set_swing_angle('Vertical',50),{vertical_swing_angle:50});
 await test('Energy 75%',()=>device.set_rate_select(75),{rate_select:75});
 await test('Energy 50%',()=>device.set_rate_select(50),{rate_select:50});
 await test('Energy 100%',()=>device.set_rate_select(100),{rate_select:100});
 await test('Ionizer',()=>device.set_attribute({ANION:true}),{purifier:true});
 await test('Ionizer off',()=>device.set_attribute({ANION:false}),{purifier:false});
 await test('Comfort',()=>device.set_attribute({COMFORT_MODE:true,TARGET_TEMPERATURE:23}),{target_temperature:23});
 await device.set_attribute({COMFORT_MODE:false});
 await test('Self-clean',()=>device.set_self_clean(true),{self_clean:true});
 await test('Self-clean off',()=>device.set_self_clean(false),{self_clean:false});
}finally{
 device.close_socket();
 if(original){
  writeFileSync('test-results/probe-original.json',JSON.stringify(original,null,2));
  const restored=JSON.parse(execFileSync(python,['device-state.py','restore','test-results/probe-original.json'],{encoding:'utf8',timeout:20000}));
  const keys=['power','mode','target_temperature','fan_speed','swing_mode','eco','turbo','sleep','display_on','purifier'];
  results.push({name:'Restore original state',passed:keys.every(k=>restored[k]===original[k]),actual:Object.fromEntries(keys.map(k=>[k,restored[k]]))});
 }
 writeFileSync('test-results/probe-results.json',JSON.stringify(results,null,2));
 console.log('Probe complete:',results.filter(r=>r.passed).length,'/',results.length);
 process.exit(0);
}
