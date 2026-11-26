import {diagnosticIP, diagnosticID} from './diagnostic-config.js';
import {defaultsDeep} from 'lodash-es';
import {setTimeout as wait} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import Device from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACDevice.js';
import {MessageQuery,MessageACResponse} from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACMessage.js';
import {defaultConfig,defaultDeviceConfig} from './node_modules/homebridge-midea-platform/dist/platformUtils.js';
import {patchDisplayCommand} from './LocalProtocolFixes.js';
import {MessageSwitchDisplay} from './node_modules/homebridge-midea-platform/dist/devices/ac/MideaACMessage.js';
patchDisplayCommand(MessageSwitchDisplay);
const config=defaultsDeep(JSON.parse(readFileSync('storage/config.json')).platforms[0],defaultConfig);
const logger={info:console.log,debug(){},warn:console.error,error:console.error};
const d=new Device(logger,{ip:diagnosticIP,port:6444,id:diagnosticID,name:'Ar-condicionado',type:172,version:2},config,defaultsDeep(config.devices[0],defaultDeviceConfig));
d.build_query=()=>[new MessageQuery(d.device_protocol_version)];
const process=d.process_message.bind(d);
d.process_message=packet=>{const r=new MessageACResponse(packet,d.power_analysis_method);const v=r.get_body_attribute('screen_display');if(v!==undefined)console.log('LED report:',v);process(packet);};
try{
 if(!await d.connect())throw Error('Connection failed');await wait(2500);
 d.attributes.PROMPT_TONE=false;
 d.set_alternate_switch_display(true);
 console.log('ALTERNATE DISPLAY OFF');
 await d.set_attribute({SCREEN_DISPLAY:false});
 for(let i=0;i<4;i++){await wait(2000);await d.refresh_status();}
 // Force a fresh desired-state packet even if optimistic local state is unchanged.
 console.log('ALTERNATE DISPLAY ON');await d.set_attribute({SCREEN_DISPLAY:true});
 for(let i=0;i<4;i++){await wait(2000);await d.refresh_status();}
}finally{d.close();}
globalThis.process.exit(0);
