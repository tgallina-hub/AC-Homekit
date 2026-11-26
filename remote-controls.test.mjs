import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {Accessory,Service,Characteristic,uuid} from '@homebridge/hap-nodejs';
import {installRemoteControls} from './LocalRemoteControls.js';
import {patchDisplayCommand} from './LocalProtocolFixes.js';
import {MessageSwitchDisplay} from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACMessage.js';

test('legacy display packet has the complete reserved payload and valid frame length',()=>{
 patchDisplayCommand(MessageSwitchDisplay);
 const command=new MessageSwitchDisplay(0);
 assert.equal(command._body.length,20);
 assert.equal(command.serialize().length,34);
 assert.equal(command.serialize()[1],command.serialize().length-1);
 patchDisplayCommand(MessageSwitchDisplay);
 assert.equal(command._body.length,20);
});

function fixture({displayVerified=true,heaterCooler=false,compactPanel=false,restoredHelper=false,temperatureCard=false}={}){
 const directory=mkdtempSync(join(tmpdir(),'midea-remote-'));
 const device=new EventEmitter();device.id=123;device.attributes={POWER:true,MODE:2,FAN_SPEED:60,TARGET_TEMPERATURE:21,SCREEN_DISPLAY:true,PROMPT_TONE:true,ECO_MODE:false,BOOST_MODE:false};
 const history=[];
 device.set_attribute=async values=>{history.push({...values});Object.assign(device.attributes,values);device.emit('update',values);};
 device.set_target_temperature=async value=>device.set_attribute({TARGET_TEMPERATURE:value});
 device.set_fan_auto=async value=>device.set_attribute({FAN_SPEED:value?102:60});
 const accessory=new Accessory('Ar-condicionado',uuid.generate(String(Math.random())));accessory.context={configuredNames:{}};
 const service=accessory.addService(heaterCooler?Service.HeaterCooler:Service.Thermostat,'Ar-condicionado');
 const fanService=accessory.addService(Service.Fanv2,'Fan','fan');
 const ecoModeService=accessory.addService(Service.Switch,'Eco','ecoMode');
 const boostModeService=accessory.addService(Service.Switch,'Turbo','boostMode');
 const api=new EventEmitter();api.user={storagePath:()=>directory};
 const handler={useThermostat:!heaterCooler,getTargetTemperature:()=>device.attributes.TARGET_TEMPERATURE,setTargetTemperature:async value=>device.set_target_temperature(value),configDev:{AC_options:{localDisplayControlVerified:displayVerified,compactPanel,temperatureCard}},device,accessory,service,fanService,ecoModeService,boostModeService,platform:{Service,Characteristic,api,log:console},setTargetState:async value=>device.set_attribute({POWER:value!==0}),handleConfiguredName(s,key,name){s.setCharacteristic(Characteristic.Name,name);s.setCharacteristic(Characteristic.ConfiguredName,name);}};
 if(compactPanel){for(const subtype of ['fanOnly','fanAuto','swingSwitch','dryMode'])accessory.addService(Service.Switch,subtype,subtype);api.platformAccessory=class extends Accessory{constructor(name,id){super(name,id);this.context={};}};api.hap={uuid};api.registerPlatformAccessories=()=>{};api.updatePlatformAccessories=()=>{};handler.platform.accessories=new Map([[accessory.UUID,accessory]]);handler.platform.discoveredCacheUUIDs=[];if(restoredHelper){const oldHelper=new api.platformAccessory('Funções extras do ar',uuid.generate('midea-extra-controls-123'));oldHelper.addService(Service.TemperatureSensor,'Antiga','outdoor');oldHelper.addService(Service.Switch,'Antiga ventilação','fanOnly');for(const subtype of ['localAuto','localCool','ecoMode','localComfort','localCancelTimers','localTimer-false-1','localTimer-true-8'])oldHelper.addService(Service.Switch,subtype,subtype);handler.platform.accessories.set(oldHelper.UUID,oldHelper);}accessory.addService(Service.TemperatureSensor,'Externa','outdoor');}
 for(const subtype of ['localAuto','localCool','localComfort','localCancelTimers','localTimer-false-1'])accessory.addService(Service.Switch,subtype,subtype);
 installRemoteControls(handler);
 const set=async (subtype,value)=>accessory.getServiceById(Service.Switch,subtype).getCharacteristic(Characteristic.On).handleSetRequest(value);
 const cleanup=()=>{api.emit('shutdown');rmSync(directory,{recursive:true});};
 return {handler,device,accessory,history,set,cleanup};
}

test('thermostat selector retains Auto and Cool without dedicated buttons',async()=>{
 const f=fixture();const {handler:h,device:d}=f;
 try{
  const state=h.service.getCharacteristic(Characteristic.TargetHeatingCoolingState);
  await state.handleSetRequest(Characteristic.TargetHeatingCoolingState.AUTO);
  assert.equal(d.attributes.MODE,1);assert.equal(d.attributes.FAN_SPEED,102);
  await assert.rejects(h.setRotationSpeed(40),/Auto/);
  await state.handleSetRequest(Characteristic.TargetHeatingCoolingState.COOL);
  await h.setRotationSpeed(63);assert.equal(d.attributes.FAN_SPEED,60);
  await h.boostModeService.getCharacteristic(Characteristic.On).handleSetRequest(true);
  assert.equal(d.attributes.MODE,2);assert.equal(d.attributes.TARGET_TEMPERATURE,17);assert.equal(d.attributes.FAN_SPEED,80);assert.equal(d.attributes.BOOST_MODE,true);
  await f.set('localQuiet',true);assert.equal(d.attributes.FAN_SPEED,40);assert.equal(d.attributes.PROMPT_TONE,false);
  await f.set('localQuiet',false);assert.equal(d.attributes.FAN_SPEED,80);
  assert.equal(h.localRemote.scheduler,undefined);
 }finally{f.cleanup();}
});

test('quiet fallback does not claim LED control and persists mute state',async()=>{
 const f=fixture({displayVerified:false});
 try{
  await f.set('localQuiet',true);
  assert.equal(f.device.attributes.FAN_SPEED,40);
  assert.equal(f.device.attributes.PROMPT_TONE,false);
  assert.equal(f.device.attributes.SCREEN_DISPLAY,true);
  assert.ok(f.accessory.context.localQuiet);
  assert.equal(f.accessory.getServiceById(Service.Switch,'localQuiet').getCharacteristic(Characteristic.Name).value,'Silencioso');
  await f.set('localQuiet',false);
  assert.equal(f.device.attributes.PROMPT_TONE,true);
  assert.equal(f.accessory.context.localQuiet,undefined);
 }finally{f.cleanup();}
});


test('native AC panel maps AUTO correctly and keeps fan and temperature controls on the primary service',async()=>{
 const f=fixture({heaterCooler:true});
 try{
  await f.handler.service.getCharacteristic(Characteristic.TargetHeaterCoolerState).handleSetRequest(Characteristic.TargetHeaterCoolerState.AUTO);
  assert.equal(f.device.attributes.MODE,1);assert.equal(f.device.attributes.POWER,true);
  await assert.rejects(f.handler.service.getCharacteristic(Characteristic.RotationSpeed).handleSetRequest(40));
  await f.handler.service.getCharacteristic(Characteristic.TargetHeaterCoolerState).handleSetRequest(Characteristic.TargetHeaterCoolerState.COOL);
  await f.handler.service.getCharacteristic(Characteristic.CoolingThresholdTemperature).handleSetRequest(22);
  assert.equal(f.device.attributes.TARGET_TEMPERATURE,22);
  await f.handler.service.getCharacteristic(Characteristic.RotationSpeed).handleSetRequest(80);
  assert.equal(f.device.attributes.FAN_SPEED,80);
  assert.equal(f.handler.service.testCharacteristic(Characteristic.TargetHeatingCoolingState),false);
 }finally{f.cleanup();}
});


test('migration removes retired controls from both restored accessories without device writes',()=>{
 const f=fixture({compactPanel:true,restoredHelper:true});
 try{
  const helper=f.handler.localRemote.helper;
  assert.deepEqual(f.history,[]);
  assert.equal(helper.services.filter(s=>s.subtype==='outdoor').length,1);
  assert.equal(helper.services.filter(s=>s.UUID===Service.Switch.UUID).length,0);
  assert.equal(f.handler.ecoModeService,undefined);
  assert.deepEqual(f.accessory.services.filter(s=>s.UUID===Service.Switch.UUID).map(s=>s.getCharacteristic(Characteristic.Name).value),[
   '03 Somente ventilação','04 Ventilador automático','05 Oscilação vertical','06 Silencioso','07 Desumidificador','08 Super'
  ]);
  assert.ok(f.handler.platform.discoveredCacheUUIDs.includes(helper.UUID));
 }finally{f.cleanup();}
});

test('thermostat card retains a linked speed selector and the six remaining buttons',async()=>{
 const f=fixture({compactPanel:true,restoredHelper:true});
 try{
  assert.equal(f.handler.service.UUID,Service.Thermostat.UUID);
  assert.ok(f.handler.service.isPrimaryService);
  assert.ok(f.handler.service.linkedServices.includes(f.handler.fanService));
  assert.ok(f.accessory.getServiceById(Service.Fanv2,'fan'));
  assert.equal(f.accessory.category,9);
  assert.equal(f.accessory.services.filter(s=>s.UUID===Service.Switch.UUID).length,6);
  await f.handler.fanService.getCharacteristic(Characteristic.RotationSpeed).handleSetRequest(80);
  assert.equal(f.device.attributes.FAN_SPEED,80);
  assert.equal(f.handler.localRemote.helper.getServiceById(Service.Fanv2,'fan'),undefined);
 }finally{f.cleanup();}
});


test('temperature card publishes only the thermostat while grouped companion controls remain functional',async()=>{
 const f=fixture({compactPanel:true,restoredHelper:true,temperatureCard:true});
 try {
  assert.deepEqual(f.history,[]);
  assert.deepEqual(f.accessory.services.map(s=>s.UUID),[Service.AccessoryInformation.UUID,Service.Thermostat.UUID]);
  assert.equal(f.handler.service.linkedServices.length,0);
  const helper=f.handler.localRemote.helper;
  assert.equal(helper.services.filter(s=>s.UUID===Service.Switch.UUID).length,6);
  assert.ok(helper.getServiceById(Service.Fanv2,'fan'));
  assert.equal(helper.displayName,'Controles do ar');
  await helper.getServiceById(Service.Switch,'localQuiet').getCharacteristic(Characteristic.On).handleSetRequest(true);
  assert.equal(f.device.attributes.FAN_SPEED,40);
  await helper.getServiceById(Service.Switch,'localQuiet').getCharacteristic(Characteristic.On).handleSetRequest(false);
  await helper.getServiceById(Service.Fanv2,'fan').getCharacteristic(Characteristic.RotationSpeed).handleSetRequest(80);
  assert.equal(f.device.attributes.FAN_SPEED,80);
  await f.handler.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).handleSetRequest(Characteristic.TargetHeatingCoolingState.AUTO);
  await assert.rejects(helper.getServiceById(Service.Fanv2,'fan').getCharacteristic(Characteristic.RotationSpeed).handleSetRequest(40));
 } finally { f.cleanup(); }
});
