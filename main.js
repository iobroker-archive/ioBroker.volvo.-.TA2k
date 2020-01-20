"use strict";

/*
 * Created with @iobroker/create-adapter v1.20.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const uuidv4 = require("uuid/v4");
const request = require("request");
const traverse = require("traverse");
// Load your modules here, e.g.:
// const fs = require("fs");

class Volvo extends utils.Adapter {
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "volvo"
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));

        this.updateInterval = null;
        this.vinArray = [];
        this.baseHeader = {
            Accept: "application/vnd.wirelesscar.com.voc.AppUser.v4+json; charset=utf-8",
            "X-Client-Version": "4.6.10.275495",
            "X-App-Name": "Volvo On Call",
            "Accept-Language": "de-de",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "Volvo%20On%20Call/4.6.10.275495 CFNetwork/1121.2.2 Darwin/19.3.0",
            "X-Os-Type": "iPhone OS",
            "X-Device-Id": uuidv4(),
            "X-Os-Version": "13.3.1",
            "X-Originator-Type": "app",
            "X-Request-Id": "",
            Authorization: ""
        };
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        const buff = new Buffer(this.config.user + ":" + this.config.password);
        const base64data = buff.toString("base64");
        this.baseHeader["Authorization"] = "Basic " + base64data;
        this.login()
            .then(() => {
                this.log.debug("Login successful");
                this.setState("info.connection", true, true);

                this.vinArray.forEach(vin => {
                    this.getMethod(vin, "https://vocapi.wirelesscar.net/customerapi/rest/vehicles/$vin/attributes", "VehicleAttributes", "attributes")
                        .then(() => {})
                        .catch(() => {});
                    this.getMethod(vin, "https://vocapi.wirelesscar.net/customerapi/rest/vehicles/$vin/status", "VehicleStatus", "status")
                        .then(() => {})
                        .catch(() => {});
                    this.getMethod(vin, "https://vocapi.wirelesscar.net/customerapi/rest/vehicles/$vin/trips?quantity=1", "Trip", "trip")
                        .then(() => {})
                        .catch(() => {});
                    this.getMethod(
                        vin,
                        "https://vocapi.wirelesscar.net/customerapi/rest/vehicles/$vin/position?client_longitude=0.000000&client_precision=0.000000&client_latitude=0.000000 ",
                        "Position",
                        "position"
                    )
                        .then(() => {})
                        .catch(() => {});

                    this.updateInterval = setInterval(() => {
                        this.vinArray.forEach(vin => {
                            this.getMethod(vin, "https://vocapi.wirelesscar.net/customerapi/rest/vehicles/$vin/status", "VehicleStatus", "status")
                                .then(() => {})
                                .catch(() => {});
                            this.getMethod(
                                vin,
                                "https://vocapi.wirelesscar.net/customerapi/rest/vehicles/$vin/position?client_longitude=0.000000&client_precision=0.000000&client_latitude=0.000000 ",
                                "Position",
                                "position"
                            )
                                .then(() => {})
                                .catch(() => {});
                        });
                    }, this.config.interval * 60 * 1000);
                });
            })
            .catch(() => {
                this.log.error("Login failed");
            });

        // in this template all states changes inside the adapters namespace are subscribed
        this.subscribeStates("*");
    }

    login() {
        return new Promise((resolve, reject) => {
            this.baseHeader["X-Request-Id"] = uuidv4();
            request.get(
                {
                    url: "https://vocapi.wirelesscar.net/customerapi/rest/customeraccounts",
                    headers: this.baseHeader,
                    followAllRedirects: true
                },
                (err, resp, body) => {
                    if (err || resp.statusCode >= 400 || !body) {
                        this.log.error(err);
                        reject();
                        return;
                    }
                    this.log.debug(body);

                    try {
                        const customer = JSON.parse(body);
                        if (!customer.accountVehicleRelations) {
                            this.log.error("No vehicles found");
                            this.log.error(body);
                            reject();
                            return;
                        }
                        customer.accountVehicleRelations.forEach(vehicle => {
                            this.vinArray.push(vehicle.vehicle.vehicleId);
                            this.setObjectNotExists(vehicle.vehicle.vehicleId, {
                                type: "device",
                                common: {
                                    name: vehicle.vehicle.registrationNumber,
                                    role: "indicator",
                                    type: "mixed",
                                    write: false,
                                    read: true
                                },
                                native: {}
                            });
                            this.setObjectNotExists(vehicle.vehicle.vehicleId + ".remote", {
                                type: "state",
                                common: {
                                    name: "Remote controls",
                                    write: true
                                },
                                native: {}
                            });

                            const remotes = [
                                "lock",
                                "unlock",
                                "heater/start",
                                "heater/stop",
                                "preclimatization/start",
                                "preclimatization/stop",
                                "parkingclimate/start",
                                "parkingclimate/stop",
                                "precleaning/start",
                                "precleaning/stop",
                                "engine/start",
                                "engine/stop",
                                "honk_and_flash",
                                "honk_blink/both",
                                "honk_blink/horn",
                                "honk_blink/lights"
                            ];
                            remotes.forEach(service => {
                                this.setObjectNotExists(vehicle.vehicle.vehicleId + ".remote." + service, {
                                    type: "state",
                                    common: {
                                        name: "",
                                        type: "boolean",
                                        role: "button",
                                        write: true
                                    },
                                    native: {}
                                });
                            });
                        });
                        const adapter = this;
                        traverse(customer).forEach(function(value) {
                            if (this.path.length > 0 && this.isLeaf) {
                                const modPath = this.path;
                                this.path.forEach((pathElement, pathIndex) => {
                                    if (!isNaN(parseInt(pathElement))) {
                                        let stringPathIndex = parseInt(pathElement) + 1 + "";
                                        while (stringPathIndex.length < 2) stringPathIndex = "0" + stringPathIndex;
                                        const key = this.path[pathIndex - 1] + stringPathIndex;
                                        const parentIndex = modPath.indexOf(pathElement) - 1;
                                        //if (this.key === pathElement) {
                                        modPath[parentIndex] = key;
                                        //}
                                        modPath.splice(parentIndex + 1, 1);
                                    }
                                });
                                adapter.setObjectNotExists("customer." + modPath.join("."), {
                                    type: "state",
                                    common: {
                                        name: this.key,
                                        role: "indicator",
                                        type: typeof value,
                                        write: false,
                                        read: true
                                    },
                                    native: {}
                                });
                                adapter.setState("customer." + modPath.join("."), value, true);
                            }
                        });
                        resolve();
                    } catch (error) {
                        this.log.error(error);
                        this.log.error(error.stack);
                        reject();
                    }
                }
            );
        });
    }

    getMethod(vin, url, accept, path) {
        return new Promise((resolve, reject) => {
            this.log.debug("Get " + path);
            this.baseHeader["X-Request-Id"] = uuidv4();
            this.baseHeader["Accept"] = "application/vnd.wirelesscar.com.voc.$format.v4+json; charset=utf-8".replace("$format", accept);
            url = url.replace("/$vin/", "/" + vin + "/");

            request.get(
                {
                    url: url,
                    headers: this.baseHeader,
                    followAllRedirects: true
                },
                (err, resp, body) => {
                    if (err || resp.statusCode >= 400 || !body) {
                        this.log.error(err);
                        reject();
                        return;
                    }
                    this.log.debug(body);

                    try {
                        const customer = JSON.parse(body);

                        const adapter = this;
                        traverse(customer).forEach(function(value) {
                            if (this.path.length > 0 && this.isLeaf) {
                                const modPath = this.path;
                                this.path.forEach((pathElement, pathIndex) => {
                                    if (!isNaN(parseInt(pathElement))) {
                                        let stringPathIndex = parseInt(pathElement) + 1 + "";
                                        while (stringPathIndex.length < 2) stringPathIndex = "0" + stringPathIndex;
                                        const key = this.path[pathIndex - 1] + stringPathIndex;
                                        const parentIndex = modPath.indexOf(pathElement) - 1;
                                        //if (this.key === pathElement) {
                                        modPath[parentIndex] = key;
                                        //}
                                        modPath.splice(parentIndex + 1, 1);
                                    }
                                });
                                adapter.setObjectNotExists(vin + "." + path + "." + modPath.join("."), {
                                    type: "state",
                                    common: {
                                        name: this.key,
                                        role: "indicator",
                                        type: typeof value,
                                        write: false,
                                        read: true
                                    },
                                    native: {}
                                });
                                adapter.setState(vin + "." + path + "." + modPath.join("."), value, true);
                            }
                        });
                        resolve();
                    } catch (error) {
                        this.log.error(error);
                        this.log.error(error.stack);
                        reject();
                    }
                }
            );
        });
    }
    async setMethod(vin, service, position) {
        return new Promise(async (resolve, reject) => {
            this.baseHeader["X-Request-Id"] = uuidv4();
            this.baseHeader["Accept"] = "application/vnd.wirelesscar.com.voc.Service.v4+json; charset=utf-8";
            this.baseHeader["Content-Type"] = "application/json; charset=utf-";
            let body = "";
            if (position) {
                this.baseHeader["Content-Type"] = "application/vnd.wirelesscar.com.voc.ClientPosition.v4+json; charset=utf-8";
                const latState = await this.getStateAsync(vin + ".position.position.latitude");
                const longState = await this.getStateAsync(vin + ".position.position.longitude");
                body = '{"clientAccuracy":0,"clientLatitude":' + latState.val + ',"clientLongitude":' + longState.val + "}";
            }
            const url = "https://vocapi.wirelesscar.net/customerapi/rest/vehicles/" + vin + "/" + service;

            request.post(
                {
                    url: url,
                    headers: this.baseHeader,
                    followAllRedirects: true,
                    body: body
                },
                (err, resp, body) => {
                    if (err || resp.statusCode >= 400 || !body) {
                        this.log.error(err);
                        reject();
                        return;
                    }
                    this.log.debug(body);

                    try {
                        this.log.info(body);
                        resolve();
                    } catch (error) {
                        this.log.error(error);
                        this.log.error(error.stack);
                        reject();
                    }
                }
            );
        });
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.log.info("cleaned everything up...");
            clearInterval(this.updateInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            if (!state.ack) {
                const vin = id.split(".")[2];
                let body = "";
                let contentType = "";
                if (id.indexOf("remote") !== -1) {
                    const action = id.split(".")[4];
                    this.setMethod(vin, action, action.indexOf("honk") !== -1);
                }
            }
        } else {
            // The state was deleted
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = options => new Volvo(options);
} else {
    // otherwise start the instance directly
    new Volvo();
}