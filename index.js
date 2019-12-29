var noble = require('@abandonware/noble')

let Service, Characteristic

module.exports = function (homebridge) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  homebridge.registerAccessory('homebridge-ble-environmental-sensor', 'BLEEnvironmentalSensor', Sensor)
}

class Sensor {
  constructor (log, config) {
    if (config.name === undefined) { return log('Name missing from configuration.') }
    if (config.deviceName === undefined) { return log('Device name missing from configuration.') }
    this.name = config.name
    this.deviceName = config.deviceName
    this.batteryVoltageMin = config.batteryVoltageMin === undefined ? 1800 : config.batteryVoltageMin
    this.batteryVoltageMax = config.batteryVoltageMax === undefined ? 3200 : config.batteryVoltageMax
    this.batteryVoltageLow = config.batteryVoltageLow === undefined ? 2000 : config.batteryVoltageLow
    this.maxUpdateInterval = config.maxUpdateInterval === undefined ? 30 * 60 * 1000 : config.maxUpdateInterval

    this.informationService = new Service.AccessoryInformation()
    this.informationService
      .setCharacteristic(Characteristic.Name, 'environmental')
      .setCharacteristic(Characteristic.Manufacturer, 'moritzmhmk')
      .setCharacteristic(Characteristic.Model, 'v0.0.1')
      .setCharacteristic(Characteristic.SerialNumber, '0000000001')

    let setupGetListener = (characteristic) => {
      characteristic.on('get', (callback) => {
        if (Date.now() - this.lastUpdate < this.maxUpdateInterval) {
          callback(null, characteristic.value)
        } else {
          log('cached value is too old')
          callback(new Error('cached value is too old'))
        }
      })
    }

    this.temperatureSensorService = new Service.TemperatureSensor(this.name)
    setupGetListener(this.temperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature))
    this.temperatureSensorService.getCharacteristic(Characteristic.StatusActive).on('get', (callback) => {
      callback(null, Date.now() - this.lastUpdate < this.maxUpdateInterval)
    })
    this.temperatureSensorService.getCharacteristic(Characteristic.StatusFault).on('get', (callback) => {
      callback(null, Date.now() - this.lastUpdate >= this.maxUpdateInterval)
    })

    this.humiditySensorService = new Service.HumiditySensor(this.name)
    setupGetListener(this.humiditySensorService.getCharacteristic(Characteristic.CurrentRelativeHumidity))
    this.humiditySensorService.getCharacteristic(Characteristic.StatusActive).on('get', (callback) => {
      callback(null, Date.now() - this.lastUpdate < this.maxUpdateInterval)
    })
    this.humiditySensorService.getCharacteristic(Characteristic.StatusFault).on('get', (callback) => {
      callback(null, Date.now() - this.lastUpdate >= this.maxUpdateInterval)
    })

    this.batteryService = new Service.BatteryService(this.name)
    setupGetListener(this.batteryService.getCharacteristic(Characteristic.BatteryLevel))
    setupGetListener(this.batteryService.getCharacteristic(Characteristic.StatusLowBattery))

    noble.on('stateChange', (state) => {
      log('Bluetooth state changed to: ' + state)
      if (state === 'poweredOn') {
        noble.startScanning([], true)
      } else {
        noble.stopScanning()
      }
    })

    noble.on('discover', (peripheral) => {
      if (peripheral.advertisement.localName === this.deviceName) {
        var manufacturerData = peripheral.advertisement.manufacturerData
        let batteryVoltage = manufacturerData.readUInt16LE(2)
        let temperature = manufacturerData.readUInt16LE(4) / 100
        let humidity = manufacturerData.readUInt16LE(6) / 100
        let pressure = (manufacturerData.readUInt16LE(8) + 101325) / 100
        this.lastUpdate = Date.now()

        let batteryLevel = percent(batteryVoltage, this.batteryVoltageMin, this.batteryVoltageMax)
        let batteryLow = batteryVoltage < this.batteryVoltageLow

        log(`received: ${batteryVoltage}mV (${batteryLevel.toFixed(2)}%, low:${batteryLow}) ${temperature}°C ${humidity}% ${pressure}hPa`)

        this.temperatureSensorService.setCharacteristic(Characteristic.CurrentTemperature, temperature)
        this.humiditySensorService.setCharacteristic(Characteristic.CurrentRelativeHumidity, humidity)
        this.batteryService.setCharacteristic(Characteristic.BatteryLevel, batteryLevel)
        this.batteryService.setCharacteristic(Characteristic.StatusLowBattery, batteryLow)
      }
    })
  }
  getServices () {
    return [this.informationService, this.temperatureSensorService, this.humiditySensorService, this.batteryService]
  }
}

let percent = (v, min, max) => Math.min(100, Math.max(0, (v - min) / (max - min) * 100))
