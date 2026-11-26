import {diagnosticIP, diagnosticID} from './diagnostic-config.js';
import {defaultsDeep} from 'lodash-es';
import {setTimeout as wait} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import Device from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACDevice.js';
import {MessageQuery,MessageACResponse,MessageNewProtocolQuery} from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACMessage.js';
import {defaultDeviceConfig,defaultConfig} from './node_modules/homebridge-midea-platform/dist/platformUtils.js';
const config=defaultsDeep(JSON.parse(readFileSync('storage/config.json')).platforms[0],defaultConfig);
const logger={info(){},debug(){},warn:console.error,error:console.error};
const d=new Device(logger,{ip:diagnosticIP,port:6444,id:diagnosticID,name:'Ar-condicionado',type:172,version:2},config,defaultsDeep(config.devices[0],defaultDeviceConfig));
d.build_query=()=>[new MessageQuery(d.device_protocol_version)];
const process=d.process_message.bind(d);
d.process_message=packet=>{
 const r=new MessageACResponse(packet,d.power_analysis_method);
 const values=Object.fromEntries(['wind_swing_ud_angle','rate_select','self_clean','anion'].map(k=>[k,r.get_body_attribute(k)]));
 console.log('RECEIVED',Date.now(),JSON.stringify(values));process(packet);
};
try{
 if(!await d.connect())throw Error('connection');
 await wait(2000);
 for(const [name,action] of [
  ['Energy 75%',()=>d.set_rate_select(75)],
  ['Energy 50%',()=>d.set_rate_select(50)],
  ['Energy 100%',()=>d.set_rate_select(100)],
  ['Fixed direction 25',()=>d.set_swing_angle('Vertical',25)],
  ['Fixed direction 0',()=>d.set_swing_angle('Vertical',0)],
 ]){
  console.log('TEST',name);await action();
  await wait(1500);await d.build_send(new MessageNewProtocolQuery(d.device_protocol_version,false,true));
  await wait(1500);
 }
 console.log('DONE');
}finally{d.close();}
globalThis.process.exit(0);
