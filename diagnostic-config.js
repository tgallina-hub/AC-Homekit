import {readFileSync} from 'node:fs';
const config = JSON.parse(readFileSync(new URL('./storage/config.json', import.meta.url), 'utf8'));
const device = config.platforms.find(p => p.platform === 'midea-platform')?.devices?.[0];
export const diagnosticIP = process.env.MIDEA_IP || device?.advanced_options?.ip;
export const diagnosticID = Number(process.env.MIDEA_DEVICE_ID || device?.id);
if (!diagnosticIP || !diagnosticID) throw new Error('Configure storage/config.json or MIDEA_IP and MIDEA_DEVICE_ID.');
