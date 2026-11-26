import {join} from 'node:path';
import {LocalScheduler} from './LocalScheduler.js';
import {HAPStatus, HapStatusError} from '@homebridge/hap-nodejs';

function notAllowed(message) {
    const error = new HapStatusError(HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    error.message = message;
    return error;
}

export function installRemoteControls(handler) {
    const h = handler, d = h.device, {Service: S, Characteristic: C} = h.platform;
    const extra = [];
    let pending = Promise.resolve();
    const serial = action => {
        const result = pending.then(action);
        pending = result.catch(() => {});
        return result;
    };
    const switchService = (subtype, name, get, set) => {
        const service = h.accessory.getServiceById(S.Switch, subtype) || h.accessory.addService(S.Switch, name, subtype);
        h.accessory.context.configuredNames[subtype] ??= name;
        h.handleConfiguredName(service, subtype, name);
        service.getCharacteristic(C.On).onGet(() => !!get()).onSet(value => serial(() => set(!!value)));
        extra.push({service, get});
        return service;
    };
    const update = () => {
        for (const {service, get} of extra) service.updateCharacteristic(C.On, !!get());
        h.ecoModeService?.updateCharacteristic(C.On, !!scheduler.jobs.eco);
        if (h.fanService) {
            if (d.attributes.MODE === 1) h.fanService.updateCharacteristic(C.TargetFanState, C.TargetFanState.AUTO);
            h.fanService.getCharacteristic(C.TargetFanState).setProps({validValues: d.attributes.MODE === 1 ? [1] : [0, 1]});
        }
    };
    const scheduler = new LocalScheduler({
        file: join(h.platform.api.user.storagePath(), `remote-timers-${d.id}.json`),
        execute: (job, kind) => serial(async () => {
            if (scheduler.jobs[kind]?.id !== job.id) return;
            if (typeof d.attributes.POWER !== 'boolean') throw Error('Aguardando leitura do estado do ar-condicionado.');
            if (kind === 'eco' && (!d.attributes.POWER || d.attributes.MODE !== 2 || d.attributes.TARGET_TEMPERATURE !== job.targetTemperature)) return;
            await d.set_attribute({POWER: job.power, ...(job.power && !d.attributes.MODE ? {MODE: 2} : {})});
        }),
        changed: update,
        log: h.platform.log,
    });
    h.localRemote = {scheduler, serial, update};
    h.service.setPrimaryService(true);
    if (h.useThermostat !== false && h.fanService) {
        h.fanService.setPrimaryService(false);
        h.service.addLinkedService(h.fanService);
    }
    const clearSpecialModes = {ECO_MODE: false, BOOST_MODE: false, SLEEP_MODE: false};
    const changeMode = async mode => {
        scheduler.cancel('eco');
        await d.set_attribute({POWER: true, MODE: mode, ...clearSpecialModes, ...(mode === 1 ? {FAN_SPEED: 102} : {})});
    };
    switchService('localAuto', 'Modo Auto', () => d.attributes.POWER && d.attributes.MODE === 1,
        async value => { if (value) await changeMode(1); else if (d.attributes.MODE === 1) await d.set_attribute({POWER: false}); });
    switchService('localCool', 'Resfriar Cool', () => d.attributes.POWER && d.attributes.MODE === 2,
        async value => { if (value) await changeMode(2); else if (d.attributes.MODE === 2) await d.set_attribute({POWER: false}); });
    const oldSetTargetState = h.setTargetState.bind(h);
    const thermostat = h.useThermostat !== false;
    const targetState = thermostat ? C.TargetHeatingCoolingState : C.TargetHeaterCoolerState;
    h.setTargetState = value => serial(async () => {
        if (value === targetState.AUTO) await changeMode(1);
        else if (value === targetState.COOL) await changeMode(2);
        else await oldSetTargetState(value);
    });
    h.service.getCharacteristic(targetState).onSet(h.setTargetState);
    if (!thermostat) {
        h.getCoolingThresholdTemperature = () => h.getTargetTemperature();
        h.setCoolingThresholdTemperature = value => serial(() => h.setTargetTemperature(value));
        h.service.getCharacteristic(C.CoolingThresholdTemperature)
            .onGet(h.getCoolingThresholdTemperature)
            .onSet(h.setCoolingThresholdTemperature);
    }

    // AUTO owns the fan speed. Reject conflicting writes rather than silently ignoring them.
    h.setRotationSpeed = value => serial(async () => {
        if (d.attributes.MODE === 1) throw notAllowed('Velocidade automática no modo Auto. Selecione Resfriar para ajustar.');
        const speed = [40, 60, 80].reduce((a, b) => Math.abs(b - value) < Math.abs(a - value) ? b : a);
        await d.set_attribute({FAN_SPEED: speed});
    });
    const autoFan = value => serial(async () => {
        if (d.attributes.MODE === 1 && !value) throw notAllowed('O modo Auto exige ventilação automática.');
        await d.set_fan_auto(value);
    });
    h.fanService?.getCharacteristic(C.RotationSpeed).onSet(h.setRotationSpeed);
    if (!thermostat) h.service.getCharacteristic(C.RotationSpeed).onSet(h.setRotationSpeed);
    h.fanService?.getCharacteristic(C.TargetFanState).onSet(value => autoFan(value === C.TargetFanState.AUTO));
    h.fanAutoService?.getCharacteristic(C.On).onSet(autoFan);

    h.setEcoMode = value => serial(async () => {
        if (value) {
            await d.set_attribute({POWER: true, MODE: 2, TARGET_TEMPERATURE: Math.max(24, d.attributes.TARGET_TEMPERATURE), FAN_SPEED: 102, ECO_MODE: true});
            scheduler.schedule('eco', false, 8 * 3600000, 'Noite 8 horas');
            scheduler.jobs.eco.targetTemperature = d.attributes.TARGET_TEMPERATURE;
            scheduler.jobs.eco.armedAfter = Date.now() + 15000;
            scheduler.save();
        } else { scheduler.cancel('eco'); await d.set_attribute({ECO_MODE: false}); }
    });
    h.ecoModeService?.getCharacteristic(C.On).onSet(h.setEcoMode);
    h.getEcoMode = () => !!scheduler.jobs.eco && !!d.attributes.POWER;
    h.ecoModeService?.getCharacteristic(C.On).onGet(h.getEcoMode);
    h.setBoostMode = value => serial(async () => {
        scheduler.cancel('eco');
        if (value) await d.set_attribute({POWER: true, MODE: 2, TARGET_TEMPERATURE: 17, FAN_SPEED: 80, BOOST_MODE: true});
        else await d.set_attribute({BOOST_MODE: false});
    });
    h.boostModeService?.getCharacteristic(C.On).onSet(h.setBoostMode);

    let previousQuiet = h.accessory.context.localQuiet;
    if (previousQuiet) d.attributes.PROMPT_TONE = false;
    const persistQuiet = () => {
        h.accessory.context.localQuiet = previousQuiet;
        h.platform.api.updatePlatformAccessories?.([h.accessory]);
    };
    const displayVerified = h.configDev?.AC_options?.localDisplayControlVerified === true;
    switchService('localQuiet', displayVerified ? 'Não perturbe' : 'Silencioso',
        () => !!previousQuiet && d.attributes.POWER,
        async value => {
            if (value) {
                const original = {POWER: d.attributes.POWER, MODE: d.attributes.MODE, FAN_SPEED: d.attributes.FAN_SPEED, SCREEN_DISPLAY: d.attributes.SCREEN_DISPLAY, PROMPT_TONE: d.attributes.PROMPT_TONE};
                await d.set_attribute({POWER: true, MODE: d.attributes.MODE === 1 ? 2 : d.attributes.MODE, PROMPT_TONE: false, FAN_SPEED: 40});
                if (displayVerified && d.attributes.SCREEN_DISPLAY) await d.set_attribute({SCREEN_DISPLAY: false});
                previousQuiet = original;
                persistQuiet();
            } else if (previousQuiet) {
                const original = previousQuiet;
                // Prompt tone is a per-command option on this module, not a persistent mute readback.
                await d.set_attribute(original);
                previousQuiet = undefined;
                persistQuiet();
            }
            update();
        });

    let previousComfort;
    switchService('localComfort', 'Conforto 23 graus', () => !!previousComfort && d.attributes.POWER && d.attributes.TARGET_TEMPERATURE === 23,
        async value => {
            if (value) {
                if (d.attributes.MODE === 5) throw notAllowed('Conforto não está disponível no modo Somente ventilação.');
                previousComfort = d.attributes.TARGET_TEMPERATURE;
                scheduler.cancel('eco');
                await d.set_attribute({ECO_MODE: false, BOOST_MODE: false, TARGET_TEMPERATURE: 23, FAN_SPEED: d.attributes.FAN_SPEED});
            } else if (previousComfort !== undefined) {
                await d.set_target_temperature(previousComfort); previousComfort = undefined;
            }
        });

    for (const power of [false, true]) {
        for (const hours of [1, 2, 4, 8]) {
            const label = `${power ? 'Ligar' : 'Desligar'} em ${hours}h`;
            switchService(`localTimer-${power}-${hours}`, label,
                () => scheduler.jobs.timer?.label === label,
                async value => {
                    if (value) scheduler.schedule('timer', power, hours * 3600000, label);
                    else if (scheduler.jobs.timer?.label === label) scheduler.cancel('timer');
                });
        }
    }
    switchService('localCancelTimers', 'Cancelar temporizadores', () => false,
        async value => { if (value) scheduler.cancelAll(); });
    d.on('update', () => {
        const night = scheduler.jobs.eco;
        if (night && Date.now() >= (night.armedAfter || 0) && typeof d.attributes.POWER === 'boolean' && (!d.attributes.POWER || d.attributes.MODE !== 2 || (night.targetTemperature !== undefined && d.attributes.TARGET_TEMPERATURE !== night.targetTemperature))) scheduler.cancel('eco');
        update();
    });
    h.platform.api.on('shutdown', () => scheduler.stop());
    scheduler.resume();
    update();
    if (h.configDev?.AC_options?.compactPanel && h.platform.api.platformAccessory) {
        const api = h.platform.api;
        const helperUUID = api.hap.uuid.generate(`midea-extra-controls-${d.id}`);
        let helper = h.platform.accessories.get(helperUUID);
        const isNew = !helper;
        helper ??= new api.platformAccessory('Funções extras do ar', helperUUID);
        helper.context.mideaCompanionFor = d.id;
        helper.getService(S.AccessoryInformation)
            .setCharacteristic(C.Manufacturer, 'Midea')
            .setCharacteristic(C.Model, 'Controles adicionais')
            .setCharacteristic(C.SerialNumber, `${d.id}-extras`);
        const orderedCommands = [
            ['localAuto', '01 Modo Auto'],
            ['localCool', '02 Resfriar Cool'],
            ['fanOnly', '03 Somente ventilação'],
            ['fanAuto', '04 Ventilador automático'],
            ['swingSwitch', '05 Oscilação vertical'],
            ['localQuiet', '06 Silencioso'],
            ['dryMode', '07 Desumidificador'],
            ['boostMode', '08 Super'],
        ];
        const keep = new Set([...orderedCommands.map(([subtype]) => subtype), 'fan']);
        if (h.fanService) {
            const duplicate = helper.getServiceById(S.Fanv2, 'fan');
            if (duplicate) helper.removeService(duplicate);
        }
        for (const [subtype, name] of orderedCommands) {
            const service = h.accessory.getServiceById(S.Switch, subtype);
            if (!service) continue;
            const duplicate = helper.getServiceById(S.Switch, subtype);
            if (duplicate) helper.removeService(duplicate);
            h.accessory.context.configuredNames[subtype] = name;
            service.displayName = name;
            service.setCharacteristic(C.Name, name).setCharacteristic(C.ConfiguredName, name);
        }
        for (const service of [...h.accessory.services]) {
            if (service === h.service || service.UUID === S.AccessoryInformation.UUID || keep.has(service.subtype)) continue;
            const old = helper.services.find(candidate => candidate.UUID === service.UUID && candidate.subtype === service.subtype);
            if (old) helper.removeService(old);
            h.accessory.removeService(service);
            helper.addService(service);
            // A read-only primary sensor avoids a tile that toggles every extra switch at once.
            if (service.subtype === 'outdoor') service.setPrimaryService(true);
        }
        const order = new Map(orderedCommands.map(([subtype], index) => [subtype, index]));
        h.accessory.services.sort((a, b) => {
            const position = service => service.UUID === S.AccessoryInformation.UUID ? -2 : service === h.service ? -1 : (order.get(service.subtype) ?? 100);
            return position(a) - position(b);
        });
        if (h.useThermostat !== false) {
            const category = api.hap.Categories?.THERMOSTAT ?? 9;
            h.accessory.category = category;
            if (h.accessory._associatedHAPAccessory) h.accessory._associatedHAPAccessory.category = category;
        }
        h.platform.accessories.set(helperUUID, helper);
        if (!h.platform.discoveredCacheUUIDs.includes(helperUUID)) h.platform.discoveredCacheUUIDs.push(helperUUID);
        if (isNew) api.registerPlatformAccessories('homebridge-midea-platform', 'midea-platform', [helper]);
        api.updatePlatformAccessories([h.accessory, helper]);
        h.localRemote.helper = helper;
    }
    // Existing accessories need an explicit cache save for the added services and names.
    if (h.platform.accessories?.has(h.accessory.UUID)) h.platform.api.updatePlatformAccessories([h.accessory]);
}
