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
        if (h.fanService) {
            if (d.attributes.MODE === 1) h.fanService.updateCharacteristic(C.TargetFanState, C.TargetFanState.AUTO);
            h.fanService.getCharacteristic(C.TargetFanState).setProps({validValues: d.attributes.MODE === 1 ? [1] : [0, 1]});
        }
    };
    h.localRemote = {serial, update};
    const removedSubtypes = new Set(['localAuto', 'localCool', 'ecoMode', 'localComfort', 'localCancelTimers']);
    const removeRetiredControls = accessory => {
        for (const service of [...accessory.services]) {
            if (!removedSubtypes.has(service.subtype) && !service.subtype?.startsWith('localTimer-')) continue;
            accessory.removeService(service);
            if (accessory.context.configuredNames) delete accessory.context.configuredNames[service.subtype];
        }
    };
    removeRetiredControls(h.accessory);
    h.ecoModeService = undefined;
    h.service.setPrimaryService(true);
    if (h.useThermostat !== false && h.fanService) {
        h.fanService.setPrimaryService(false);
        h.service.addLinkedService(h.fanService);
    }
    const clearSpecialModes = {ECO_MODE: false, BOOST_MODE: false, SLEEP_MODE: false};
    const changeMode = async mode => {
        await d.set_attribute({POWER: true, MODE: mode, ...clearSpecialModes, ...(mode === 1 ? {FAN_SPEED: 102} : {})});
    };
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

    h.setBoostMode = value => serial(async () => {
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

    d.on('update', update);
    update();
    if (h.configDev?.AC_options?.compactPanel && h.platform.api.platformAccessory) {
        const api = h.platform.api;
        const helperUUID = api.hap.uuid.generate(`midea-extra-controls-${d.id}`);
        let helper = h.platform.accessories.get(helperUUID);
        const isNew = !helper;
        helper ??= new api.platformAccessory('Funções extras do ar', helperUUID);
        helper.context.mideaCompanionFor = d.id;
        removeRetiredControls(helper);
        helper.getService(S.AccessoryInformation)
            .setCharacteristic(C.Manufacturer, 'Midea')
            .setCharacteristic(C.Model, 'Controles adicionais')
            .setCharacteristic(C.SerialNumber, `${d.id}-extras`);
        const orderedCommands = [
            ['fanOnly', '03 Somente ventilação'],
            ['fanAuto', '04 Ventilador automático'],
            ['swingSwitch', '05 Oscilação vertical'],
            ['localQuiet', '06 Silencioso'],
            ['dryMode', '07 Desumidificador'],
            ['boostMode', '08 Super'],
        ];
        const temperatureCard = h.configDev.AC_options.temperatureCard === true;
        const separateFan = temperatureCard && h.configDev.AC_options.separateFan === true;
        const keep = new Set(temperatureCard ? [] : [...orderedCommands.map(([subtype]) => subtype), 'fan']);
        if (h.fanService) {
            const duplicate = helper.getServiceById(S.Fanv2, 'fan');
            if (duplicate) helper.removeService(duplicate);
        }
        if (separateFan && h.fanService) {
            const fanUUID = api.hap.uuid.generate(`midea-fan-control-${d.id}`);
            let fanAccessory = h.platform.accessories.get(fanUUID);
            const newFan = !fanAccessory;
            const name = 'Velocidade do ventilador';
            fanAccessory ??= new api.platformAccessory(name, fanUUID);
            fanAccessory.context.mideaFanFor = d.id;
            fanAccessory.getService(S.AccessoryInformation)
                .setCharacteristic(C.Name, name)
                .setCharacteristic(C.Manufacturer, 'Midea')
                .setCharacteristic(C.Model, 'Controle de ventilação')
                .setCharacteristic(C.SerialNumber, `${d.id}-fan`);
            const oldFan = fanAccessory.getServiceById(S.Fanv2, 'fan');
            if (oldFan) fanAccessory.removeService(oldFan);
            h.service.removeLinkedService(h.fanService);
            h.accessory.removeService(h.fanService);
            h.accessory.context.configuredNames.fan = name;
            h.fanService.displayName = name;
            h.fanService.setCharacteristic(C.Name, name).setCharacteristic(C.ConfiguredName, name);
            fanAccessory.addService(h.fanService);
            h.fanService.setPrimaryService(true);
            const category = api.hap.Categories?.FAN ?? 3;
            fanAccessory.category = category;
            if (fanAccessory._associatedHAPAccessory) fanAccessory._associatedHAPAccessory.category = category;
            h.platform.accessories.set(fanUUID, fanAccessory);
            if (!h.platform.discoveredCacheUUIDs.includes(fanUUID)) h.platform.discoveredCacheUUIDs.push(fanUUID);
            if (newFan) api.registerPlatformAccessories('homebridge-midea-platform', 'midea-platform', [fanAccessory]);
            api.updatePlatformAccessories([fanAccessory]);
            h.localRemote.fanAccessory = fanAccessory;
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
            h.service.removeLinkedService(service);
            h.accessory.removeService(service);
            helper.addService(service);
            // A read-only primary sensor avoids a tile that toggles every extra switch at once.
            if (service.subtype === 'outdoor') service.setPrimaryService(true);
        }
        const order = new Map(orderedCommands.map(([subtype], index) => [subtype, index]));
        const controlsAccessory = temperatureCard ? helper : h.accessory;
        controlsAccessory.services.sort((a, b) => {
            const position = service => service.UUID === S.AccessoryInformation.UUID ? -2 : service === h.service ? -1 : (order.get(service.subtype) ?? 100);
            return position(a) - position(b);
        });
        if (h.useThermostat !== false) {
            const category = api.hap.Categories?.THERMOSTAT ?? 9;
            h.accessory.category = category;
            if (h.accessory._associatedHAPAccessory) h.accessory._associatedHAPAccessory.category = category;
        }
        if (temperatureCard) {
            helper.displayName = 'Controles do ar';
            helper.getService(S.AccessoryInformation).setCharacteristic(C.Name, 'Controles do ar');
            if (h.fanService && !separateFan) h.fanService.setPrimaryService(true);
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
