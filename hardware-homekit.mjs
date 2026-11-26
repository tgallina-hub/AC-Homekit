import {diagnosticIP, diagnosticID} from './diagnostic-config.js';
/** Exercise actual HomeKit setter callbacks, then close the writer and read independently. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EventEmitter} from 'node:events';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {Accessory,Service,Characteristic,uuid} from '@homebridge/hap-nodejs';
import {defaultsDeep} from 'lodash-es';
import MideaACDevice from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACDevice.js';
import {MessageACResponse, MessageQuery, MessageNewProtocolQuery} from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACMessage.js';
import Handler from './node_modules/homebridge-midea-platform/dist/accessory/AirConditionerAccessory.js';
import {defaultConfig,defaultDeviceConfig} from './node_modules/homebridge-midea-platform/dist/platformUtils.js';
const exec=promisify(execFile);
const python=(process.env.MIDEA_PYTHON || 'python3');
const read=async()=>JSON.parse((await exec(python,['device-state.py'],{timeout:20000})).stdout);
const original=JSON.parse(readFileSync('test-results/original-state.json'));
const settings=defaultsDeep(JSON.parse(readFileSync('storage/config.json')).platforms[0],defaultConfig);
const results=[];
const outputPath=process.env.MIDEA_RESULTS_FILE || 'test-results/homekit-hardware-results.json';
const selection=process.env.MIDEA_TESTS?.split('|');
const directory=mkdtempSync(join(tmpdir(),'midea-hardware-'));
const logger={info:()=>{},debug:process.env.MIDEA_TRACE?console.error:()=>{},warn:console.error,error:console.error};
const tests=[
 ['Cool button',async(h,set)=>set('localCool',true),{mode:2,power:true}],
 ['Auto button',async(h,set)=>set('localAuto',true),{mode:1,fan_speed:102}],
 ['Auto blocks manual fan',async(h,set)=>{await set('localAuto',true);let rejected=false;try{await h.setRotationSpeed(40);}catch{rejected=true;}if(!rejected)throw Error('Manual fan write was not rejected');},{mode:1,fan_speed:102}],
 ['Fan low',async(h,set)=>{await set('localCool',true);await h.setRotationSpeed(40);},{mode:2,fan_speed:40}],
 ['Fan medium',async(h,set)=>{await set('localCool',true);await h.setRotationSpeed(60);},{mode:2,fan_speed:60}],
 ['Fan high',async(h,set)=>{await set('localCool',true);await h.setRotationSpeed(80);},{mode:2,fan_speed:80}],
 ['Fan automatic',async(h,set)=>{await set('localCool',true);await h.fanAutoService.getCharacteristic(Characteristic.On).handleSetRequest(true);},{fan_speed:102}],
 ['Dry',async h=>h.dryModeService.getCharacteristic(Characteristic.On).handleSetRequest(true),{mode:3}],
 ['Fan only',async h=>h.fanOnlyService.getCharacteristic(Characteristic.On).handleSetRequest(true),{mode:5}],
 ['Eco Noite',async h=>{await h.ecoModeService.getCharacteristic(Characteristic.On).handleSetRequest(true);if(!h.localRemote.scheduler.jobs.eco)throw Error('8h deadline missing');},{mode:2,eco:true,target_temperature:24,fan_speed:102}],
 ['Night 8h program',async h=>{await h.ecoModeService.getCharacteristic(Characteristic.On).handleSetRequest(true);if(!h.localRemote.scheduler.jobs.eco)throw Error('8h deadline missing');},{mode:2,target_temperature:24,fan_speed:102}],
 ['Super',async h=>h.boostModeService.getCharacteristic(Characteristic.On).handleSetRequest(true),{mode:2,target_temperature:17,fan_speed:80,turbo:true}],
 ['Quiet fan and mute',async(h,set)=>{await set('localQuiet',true);if(h.device.attributes.PROMPT_TONE!==false)throw Error('Mute flag not applied');},{fan_speed:40}],
 ['Quiet cancel restores feedback',async(h,set)=>{await set('localQuiet',true);await set('localQuiet',false);if(h.device.attributes.PROMPT_TONE!==true)throw Error('Feedback not restored');},{fan_speed:40,display_on:true}],
 ['Do not disturb',async(h,set)=>set('localQuiet',true),{fan_speed:40,display_on:false}],
 ['Do not disturb cancel',async(h,set)=>{await set('localQuiet',true);await set('localQuiet',false);},{display_on:true}],
 ['Comfort 23',async(h,set)=>{await set('localCool',true);await set('localComfort',true);},{mode:2,target_temperature:23}],
 ['Vertical swing on',async h=>h.swingSwitchService.getCharacteristic(Characteristic.On).handleSetRequest(true),{swing_mode:12}],
 ['Vertical swing off',async h=>h.swingSwitchService.getCharacteristic(Characteristic.On).handleSetRequest(false),{swing_mode:0}],
 ['Direction 25',async h=>h.device.set_swing_angle('Vertical',25),{vertical_swing_angle:25}],
 ['Energy 75%',async h=>h.device.set_rate_select(75),{rate_select:75}],
 ['Energy 50%',async h=>h.device.set_rate_select(50),{rate_select:50}],
 ['Energy 100%',async h=>h.device.set_rate_select(100),{rate_select:100}],
 ['Ionizer',async h=>h.device.set_attribute({ANION:true}),{purifier:true}],
 ['Ionizer off',async h=>h.device.set_attribute({ANION:false}),{purifier:false}],
 ['Self-clean',async h=>h.device.set_self_clean(true),{self_clean:true}],
 ['Self-clean off',async h=>h.device.set_self_clean(false),{self_clean:false}],
 ['Timer cancellation',async(h,set)=>{await set('localTimer-false-1',true);await set('localCancelTimers',true);if(Object.keys(h.localRemote.scheduler.jobs).length)throw Error('Timer not cancelled');},{power:true}],
 ['Timer power off expiry',async h=>{h.localRemote.scheduler.schedule('timer',false,2000,'Hardware test');await wait(2600);},{power:false}],
 ['Timer power on expiry',async h=>{h.localRemote.scheduler.schedule('timer',true,2000,'Hardware test');await wait(2600);},{power:true}],
];
try{
 for(const [name,action,expected] of tests.filter(item=>!selection||selection.includes(item[0]))){
  const deviceConfig=defaultsDeep(structuredClone(settings.devices[0]),defaultDeviceConfig);
  const device=new MideaACDevice(logger,{ip:diagnosticIP,port:6444,id:diagnosticID,name:'Ar-condicionado',type:172,version:2},settings,deviceConfig);
  device.build_query=()=>[new MessageQuery(device.device_protocol_version)];
  const observed={};
  const processMessage=device.process_message.bind(device);
  device.process_message=message=>{
   const response=new MessageACResponse(message,device.power_analysis_method);
   const mapping={power:'power',mode:'mode',target_temperature:'target_temperature',fan_speed:'fan_speed',eco:'eco_mode',turbo:'boost_mode',sleep:'sleep_mode',display_on:'screen_display',vertical_swing_angle:'wind_swing_ud_angle',rate_select:'rate_select',purifier:'anion',self_clean:'self_clean'};
   for(const [field,key]of Object.entries(mapping)){const value=response.get_body_attribute(key);if(value!==undefined)observed[field]=value;}
   const vertical=response.get_body_attribute('swing_vertical'), horizontal=response.get_body_attribute('swing_horizontal');
   if(vertical!==undefined&&horizontal!==undefined)observed.swing_mode=(vertical?12:0)|(horizontal?3:0);
   processMessage(message);
  };
  const api=new EventEmitter();api.user={storagePath:()=>directory};api.hap={Characteristic,Service,uuid};
  try{
   if(!await device.connect())throw Error('Connection failed');
   for(let i=0;i<10&&typeof device.attributes.POWER!=='boolean';i++)await wait(500);
   if(typeof device.attributes.POWER!=='boolean')throw Error('Device did not provide initial state');
   const accessory=new Accessory('Ar-condicionado',uuid.generate(name));accessory.context={configuredNames:{}};
   const handler=new Handler({Service,Characteristic,api,log:logger},accessory,device,deviceConfig);
   const set=(subtype,value)=>accessory.getServiceById(Service.Switch,subtype).getCharacteristic(Characteristic.On).handleSetRequest(value);
   for(const key of Object.keys(observed))delete observed[key];
   await action(handler,set);
   for(let attempt=0;attempt<Number(process.env.MIDEA_CONFIRMATION_ATTEMPTS || 3);attempt++){
    await wait(2000);await device.refresh_status();if(Object.keys(expected).some(k=>['vertical_swing_angle','rate_select','self_clean'].includes(k)))await device.build_send(new MessageNewProtocolQuery(device.device_protocol_version,false,true));await wait(1000);
    if(Object.entries(expected).every(([k,v])=>observed[k]===v))break;
   }
   if(name==='Night 8h program'&&!handler.localRemote.scheduler.jobs.eco)throw Error('Night deadline was unexpectedly cancelled');
   results.push({name,passed:Object.entries(expected).every(([k,v])=>observed[k]===v),expected,actual:Object.fromEntries(Object.keys(expected).map(k=>[k,observed[k]??null])),verification:'parsed responses received from the device; excludes optimistic local updates'});
  }catch(error){results.push({name,passed:false,error:String(error)});}
  finally{api.emit('shutdown');device.close();}
  writeFileSync(outputPath,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.at(-1)));
 }
}finally{
 let restored;
 for(let attempt=0;attempt<3;attempt++){try{restored=JSON.parse((await exec(python,['device-state.py','restore','test-results/original-state.json'],{timeout:30000})).stdout);break;}catch(error){if(attempt===2)throw error;await wait(3000);}}
 const fields=['power','mode','target_temperature','fan_speed','swing_mode','eco','turbo','sleep','display_on'];
 results.push({name:'Restore initial state',passed:fields.every(k=>restored[k]===original[k]),actual:Object.fromEntries(fields.map(k=>[k,restored[k]]))});
 writeFileSync(outputPath,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.at(-1)));
 rmSync(directory,{recursive:true});
 process.exit(0);
}
