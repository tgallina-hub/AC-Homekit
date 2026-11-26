import {diagnosticIP, diagnosticID} from './diagnostic-config.js';
import {defaultsDeep} from 'lodash-es';
import {setTimeout as wait} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import Device from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACDevice.js';
import {MessageQuery,MessageACResponse} from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACMessage.js';
import {defaultDeviceConfig,defaultConfig} from './node_modules/homebridge-midea-platform/dist/platformUtils.js';
const config=defaultsDeep(JSON.parse(readFileSync('storage/config.json')).platforms[0],defaultConfig);
const logger={info(){},debug(){},warn:console.error,error:console.error};
const d=new Device(logger,{ip:diagnosticIP,port:6444,id:diagnosticID,name:'Ar-condicionado',type:172,version:2},config,defaultsDeep(config.devices[0],defaultDeviceConfig));
d.build_query=()=>[new MessageQuery(d.device_protocol_version)];
const process=d.process_message.bind(d);
d.process_message=packet=>{
 const r=new MessageACResponse(packet,d.power_analysis_method);
 const values=Object.fromEntries(['power','mode','target_temperature','fan_speed','eco_mode','boost_mode','screen_display'].map(k=>[k,r.get_body_attribute(k)]));
 console.log('RECEIVED',Date.now(),JSON.stringify(values));process(packet);
};
try{
 if(!await d.connect())throw Error('connection');
 await wait(2000);
 for(let attempt=1;attempt<=3;attempt++){
  const message=d.make_message_unique_set();
  Object.assign(message,{power:true,mode:2,target_temperature:21,fan_speed:40,boost_mode:false,eco_mode:false,sleep_mode:false,prompt_tone:true});
  await d.build_send(message);console.log('WRITE',attempt,Date.now());
  for(let i=0;i<4;i++){await wait(2500);await d.refresh_status();}
 }
}finally{d.close();}
globalThis.process.exit(0);
