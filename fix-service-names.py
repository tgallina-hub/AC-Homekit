"""Apply the local HomeKit naming fix to a pinned Midea plugin installation."""
import sys
from pathlib import Path

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
path = root / 'node_modules/homebridge-midea-platform/dist/accessory/BaseAccessory.js'
source = path.read_text()
start = source.index('    handleConfiguredName(service, subtype, fallbackName) {')
end = source.index('\n}\nexport function limitValue', start)
replacement = '''    handleConfiguredName(service, subtype, fallbackName) {
        // Local fix: publish initial names, not only lazy onGet callbacks.
        const labels = {
            outdoor: 'Temperatura externa',
            fanOnly: 'Somente ventilação',
            fan: 'Velocidade do ventilador',
            fanAuto: 'Ventilador automático',
            ecoMode: 'Modo Eco',
            dryMode: 'Desumidificar',
            boostMode: 'Turbo',
            swingSwitch: 'Oscilação vertical',
        };
        const getName = () => this.accessory.context.configuredNames[subtype]
            || labels[subtype] || `${this.device.name} ${fallbackName}`;
        service.displayName = getName();
        service.setCharacteristic(this.platform.Characteristic.Name, getName());
        service.setCharacteristic(this.platform.Characteristic.ConfiguredName, getName());
        service.getCharacteristic(this.platform.Characteristic.ConfiguredName)
            .onGet(getName)
            .onSet((value) => {
                this.accessory.context.configuredNames[subtype] = value;
                service.displayName = value;
                service.updateCharacteristic(this.platform.Characteristic.Name, value);
            });
    }'''
path.write_text(source[:start] + replacement + source[end:])
print('Applied naming fix:', path)
