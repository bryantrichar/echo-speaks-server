const request = require('request');
const reqPromise = require("request-promise");
const logger = require('./logger');
const alexaCookie = require('./alexa-cookie/alexa-cookie');
const os = require('os');
// const alexaRemote = require('alexa-remote2');
const dateFormat = require('dateformat');
const editJsonFile = require("edit-json-file", {
    autosave: true
});
const dataFolder = require('os').homedir() + '/.echo-speaks';
const sessionFile = editJsonFile(dataFolder + '/session.json');

let alexaUrl = 'https://alexa.amazon.com';
let sessionData = sessionFile.get() || {};
sessionFile.save();

var clearSession = function(url, useHeroku) {
    sessionFile.unset('csrf');
    sessionFile.unset('cookie');
    sessionFile.save();
    if (url && useHeroku) {
        let options = {
            method: 'DELETE',
            uri: url,
            json: true
        };
        reqPromise(options)
            .then(function(resp) {
                // console.log('resp:', resp);
                if (resp) {
                    logger.info(`** Sent Remove Alexa Cookie Request to SmartThings Successfully! **`);
                }
            })
            .catch(function(err) {
                logger.error("ERROR: Unable to send Alexa Cookie to SmartThings: " + err.message);
            });
    }
};

function getRemoteCookie(alexaOptions) {
    return new Promise(resolve => {
        if (alexaOptions.useHeroku === false || alexaOptions.checkForCookie === false) { resolve(undefined); }
        let config = {};
        if (alexaOptions.useHeroku === true && alexaOptions.stEndpoint) {
            getCookiesFromST(alexaOptions.stEndpoint)
                .then(function(cookies) {
                    if (cookies && cookies.cookie && cookies.csrf) {
                        if (sessionData['csrf'] === undefined || sessionData['csrf'] !== cookies.csrf) {
                            sessionFile.set('csrf', cookies.csrf);
                            sessionData['csrf'] = cookies.csrf;
                        }
                        if (sessionData['cookie'] === undefined || sessionData['cookie'] !== cookies.cookie) {
                            sessionFile.set('cookie', cookies.cookie);
                            sessionData['cookie'] = cookies.cookie;
                        }
                        sessionFile.save();
                        config.cookies = cookies.cookie;
                        config.csrf = cookies.csrf;
                        resolve(config);
                    }
                });
        } else {
            resolve(config);
        }
    });
};

function alexaLogin(username, password, alexaOptions, webapp, callback) {
    let devicesArray = [];
    let config = {};
    config.devicesArray = devicesArray;
    config.alexaURL = alexaOptions.amazonDomain;
    if (!config.userAgent) {
        let platform = os.platform();
        if (platform === 'win32') {
            config.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:99.0) Gecko/20100101 Firefox/99.0';
        }
        /*else if (platform === 'darwin') {
            config.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2987.133 Safari/537.36';
        }*/
        else {
            config.userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';
        }
    }

    getRemoteCookie(alexaOptions)
        .then(function(remoteCookies) {
            // console.log('remoteCookies: ', remoteCookies, 'keys: ', Object.keys(remoteCookies));
            if (remoteCookies !== undefined && Object.keys(remoteCookies).length > 0 && remoteCookies.cookies && remoteCookies.csrf) {
                config.cookies = remoteCookies.cookies;
                config.csrf = remoteCookies.csrf;
                callback(null, 'Login Successful (Retreived from ST)', config);
            } else if (sessionData.csrf && sessionData.cookie) {
                config.cookies = sessionData.cookie;
                config.csrf = sessionData.csrf;
                callback(null, 'Login Successful (Stored Session)', config);
            } else {
                alexaCookie.generateAlexaCookie(username, password, alexaOptions, webapp, function(err, result) {
                    // console.log('generateAlexaCookie error: ', err);
                    // console.log('generateAlexaCookie result: ', result);
                    if (err && (err.message.startsWith('Login unsuccessful') || err.message.startsWith('Amazon-Login-Error:'))) {
                        logger.debug('Please complete Amazon login by going here: (http://' + alexaOptions.proxyHost + ':' + alexaOptions.serverPort + '/config)');
                    } else if (err && !result) {
                        logger.error('generateAlexaCookie: ' + err.message);
                        callback(err, 'There was an error', null);
                    } else if (result) {
                        alexaUrl = 'https://alexa.' + alexaOptions.amazonDomain;
                        // IMPORTANT: can be called multiple times!! As soon as a new cookie is fetched or an error happened. Consider that!
                        logger.debug('cookie: ' + result.cookie || undefined);
                        logger.debug('csrf: ' + result.csrf || undefined);
                        if (result && result.csrf && result.cookie) {
                            // alexaCookie.stopProxyServer();
                            if (sessionData['csrf'] === undefined || sessionData['csrf'] !== result.csrf) {
                                sessionFile.set('csrf', result.csrf);
                                sessionData['csrf'] = result.csrf;
                            }
                            if (sessionData['cookie'] === undefined || sessionData['cookie'] !== result.cookie) {
                                sessionFile.set('cookie', result.cookie);
                                sessionData['cookie'] = result.cookie;
                            }
                            sessionFile.save();
                            config.cookies = sessionData.cookie;
                            config.csrf = sessionData.csrf;
                            sendCookiesToST(alexaOptions.stEndpoint, config.cookies, config.csrf);
                            callback(null, 'Login Successful', config);
                        } else {
                            callback(true, 'There was an error getting authentication', null);
                            clearSession(alexaOptions.stEndpoint, alexaOptions.useHeroku);
                        }
                    }
                });
            }
        });
};

var sendCookiesToST = function(url, cookie, csrf) {
    if (url && cookie && csrf) {
        let options = {
            method: 'POST',
            uri: url,
            body: {
                cookie: cookie,
                csrf: csrf
            },
            json: true
        };
        reqPromise(options)
            .then(function(resp) {
                // console.log('resp:', resp);
                if (resp) {
                    logger.info(`** Alexa Cookie sent to SmartThings Cloud Endpoint Successfully! **`);
                }
            })
            .catch(function(err) {
                logger.error("ERROR: Unable to send Alexa Cookie to SmartThings: " + err.message);
            });
    }
};

function getCookiesFromST(url) {
    return new Promise(resolve => {
        reqPromise({ method: 'GET', uri: url, json: true })
            .then(function(resp) {
                // console.log('getCookiesFromST resp: ', resp);
                if (resp && resp.length > 0)
                    logger.info(`** Retrieved Alexa Cookie from SmartThings Cloud Endpoint Successfully! **`);
                resolve(resp);
            })
            .catch(function(err) {
                logger.error("ERROR: Unable to retrieve Alexa Cookie from SmartThings: " + err.message);
                resolve({});
            });
    });
};

let checkAuthentication = function(config, callback) {
    request({
        method: 'GET',
        url: `${alexaUrl}/api/bootstrap?version=0`,
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        },
        json: true
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            let data = body;
            callback(null, body);
        } else {
            callback(null, {
                result: false
            });
        }
    });
};

let getDevicePreferences = function(cached = true, config, callback) {
    request({
        method: 'GET',
        url: `${alexaUrl}/api/device-preferences?cached=${cached === true}`,
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            callback(null, JSON.parse(body));
        } else {
            callback(error, response);
        }
    });
};

let getAutomationRoutines = function(limit, config, callback) {
    limit = limit || 2000;
    request({
        method: 'GET',
        uri: `${alexaUrl}/api/behaviors/automations?limit=${limit}`,
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        },
        json: true
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            callback(null, JSON.parse(JSON.stringify(body)));
        } else {
            callback(error, response);
        }
    });
};


let executeAutomationRoutine = function(serialOrName, routine, callback) {
    return this.sendSequenceCommand(serialOrName, routine, callback);
};




let setReminder = function(message, datetime, device, config, callback) {
    let now = new Date();
    let createdDate = now.getTime();
    let addSeconds = new Date(createdDate + 1 * 60000); // one minute afer the current time
    let alarmTime = addSeconds.getTime();
    if (datetime) {
        let datetimeDate = new Date(dateFormat(datetime));
        alarmTime = datetimeDate.getTime();
    }
    let originalTime = dateFormat(alarmTime, 'HH:MM:00.000');
    let originalDate = dateFormat(alarmTime, 'yyyy-mm-dd');
    request({
        method: 'PUT',
        url: alexaUrl + '/api/notifications/createReminder',
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        },
        json: {
            type: 'Reminder',
            status: 'ON',
            alarmTime: alarmTime,
            originalTime: originalTime,
            originalDate: originalDate,
            timeZoneId: null,
            reminderIndex: null,
            sound: null,
            deviceSerialNumber: device.deviceSerialNumber,
            deviceType: device.deviceType,
            recurringPattern: '',
            reminderLabel: message,
            isSaveInFlight: true,
            id: 'createReminder',
            isRecurring: false,
            createdDate: createdDate
        }
    }, function(error, response) {
        if (!error && response.statusCode === 200) {
            callback(null, {
                "status": "success"
            });
        } else {
            callback(error, {
                "status": "failure"
            });
        }
    });
};

let executeCommand = function(_cmdOpts, callback) {
    // console.log('Method: ' + _cmdOpts.method);
    // console.log('URL:' + _cmdOpts.url);
    // console.log('Query: ', _cmdOpts.qs);
    // console.log('Body: ', _cmdOpts.json);
    request(_cmdOpts, function(error, response, body) {
        // console.log('body:', body);
        console.log('executeCommand Status: (' + response.statusCode + ')');
        if (!error && response.statusCode === 200) {
            callback(null, {
                "statusCode": response.statusCode,
                "deviceId": _cmdOpts.deviceId,
                "message": "success",
                "queueKey": _cmdOpts.queueKey,
                "msgDelay": _cmdOpts.msgDelay
            });
        } else {
            // console.log('error: ', error.message);
            callback(error, {
                "statusCode": response.statusCode,
                "deviceId": _cmdOpts.deviceId,
                "message": body.message || null,
                "queueKey": _cmdOpts.queueKey,
                "msgDelay": _cmdOpts.msgDelay
            });
        }
    });
};

let setMedia = function(command, device, config, callback) {
    request({
        method: 'POST',
        url: alexaUrl + '/api/np/command?deviceSerialNumber=' +
            device.deviceSerialNumber + '&deviceType=' + device.deviceType,
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        },
        json: command
    }, function(error, response) {
        if (!error && response.statusCode === 200) {
            callback(null, {
                "status": "success"
            });
        } else {
            callback(error, response);
        }
    });
};

let getDevices = function(config, callback) {
    // console.log('config: ', JSON.stringify(config));
    request({
        method: 'GET',
        url: alexaUrl + '/api/devices-v2/device',
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            try {
                // console.log('getDevices Body: ', body);
                config.devicesArray = JSON.parse(body);
            } catch (e) {
                logger.error('getDevices Error: ' + e.message);
                config.devicesArray = [];
            }
            callback(null, config.devicesArray);
        } else {
            if (response && response.statusCode !== undefined) {
                // console.log('getDevices status: ', response || "", 'Code: (' + response.statusCode || 'error' + ')');
            }
            callback(error, response);
        }
    });
};

let getState = function(device, _config, callback) {
    request({
        method: 'GET',
        url: alexaUrl + '/api/np/player?deviceSerialNumber=' + device.serialNumber + '&deviceType=' + device.deviceType + '&screenWidth=2560',
        headers: {
            'Cookie': _config.cookies,
            'csrf': _config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            callback(null, JSON.parse(body));
        } else {
            callback(error, response);
        }
    });
};

let getDndStatus = function(_config, callback) {
    request({
        method: 'GET',
        url: alexaUrl + '/api/dnd/device-status-list',
        headers: {
            'Cookie': _config.cookies,
            'csrf': _config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            let items = [];
            try {
                let res = JSON.parse(body);
                if (Object.keys(res).length) {
                    if (res.doNotDisturbDeviceStatusList.length) {
                        items = res.doNotDisturbDeviceStatusList;
                    }
                }
            } catch (e) {
                logger.error('getDevices Error: ' + e.message);
            }
            callback(null, items);
        } else {
            callback(error, response);
        }
    });
};

let getNotifications = function(_config, callback) {
    request({
        method: 'GET',
        url: alexaUrl + '/api/notifications',
        headers: {
            'Cookie': _config.cookies,
            'csrf': _config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            let items = [];
            try {
                let res = JSON.parse(body);
                if (Object.keys(res).length) {
                    if (res.notifications.length) {
                        items = res.notifications;
                    }
                }
            } catch (e) {
                logger.error('getNotifications Error: ' + e.message);
            }
            callback(null, items);
        } else {
            callback(error, response);
        }
    });
};

let getPlaylists = function(device, _config, callback) {
    request({
        method: 'GET',
        url: alexaUrl + '/api/cloudplayer/playlists?deviceSerialNumber=' + device.serialNumber + '&deviceType=' + device.deviceType + '&mediaOwnerCustomerId=' + device.deviceOwnerCustomerId + '&screenWidth=2560',
        headers: {
            'Cookie': _config.cookies,
            'csrf': _config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            callback(null, JSON.parse(body));
        } else {
            callback(error, response);
        }
    });
};

let getWakeWords = function(_config, callback) {
    request({
        method: 'GET',
        url: alexaUrl + '/api/wake-word',
        headers: {
            'Cookie': _config.cookies,
            'csrf': _config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            callback(null, JSON.parse(body));
        } else {
            callback(error, response);
        }
    });
};

function getList(device, listType, options, config, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    request({
        method: 'GET',
        url: `${alexaUrl}/api/todos?size=${options.size || 100}
            &startTime=${options.startTime || ''}
            &endTime=${options.endTime || ''}
            &completed=${options.completed || false}
            &type=${listType}
            &deviceSerialNumber=${device.deviceSerialNumber}
            &deviceType=${device.deviceType}
            &_=%t`,
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            callback(null, JSON.parse(body));
        } else {
            callback(error, response);
        }
    });
}

let getLists = function(device, options, config, callback) {
    getList(device, 'TASK', options, config, function(err, res) {
        let ret = {};
        if (!err && res) {
            ret.tasks = res;
        }
        getList(device, 'SHOPPING_ITEM', options, config, function(err, res) {
            ret.shoppingItems = res;
            callback && callback(null, ret);
        });
    });
};

let getAccount = function(config, callback) {
    request({
        method: 'GET',
        url: `https://alexa-comms-mobile-service.${config.amazonDomain}/accounts`,
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            callback(null, JSON.parse(body));
        } else {
            callback(error, response);
        }
    });
};

let getBluetoothDevices = function(config, callback) {
    request({
        method: 'GET',
        url: alexaUrl + '/api/bluetooth?cached=false',
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        }
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            callback(null, JSON.parse(body));
        } else {
            callback(error, response);
        }
    });
};

let setBluetoothDevice = function(mac, device, config, callback) {
    request({
        method: 'POST',
        url: alexaUrl + '/api/bluetooth/pair-sink/' + device.deviceType + '/' + device.deviceSerialNumber,
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        },
        json: {
            bluetoothDeviceAddress: mac
        }
    }, function(error, response) {
        if (!error && response.statusCode === 200) {
            callback(null, {
                "message": "success"
            });
        } else {
            callback(error, response);
        }
    });
};

let disconnectBluetoothDevice = function(device, config, callback) {
    request({
        method: 'POST',
        url: alexaUrl + '/api/bluetooth/disconnect-sink/' + device.deviceType + '/' + device.deviceSerialNumber,
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        },
    }, function(error, response) {
        if (!error && response.statusCode === 200) {
            callback(null, {
                "message": "success"
            });
        } else {
            callback(error, response);
        }
    });
};

let getMusicProviders = function(config, callback) {
    request({
        method: 'GET',
        url: `${alexaUrl}/api/behaviors/entities?skillId=amzn1.ask.1p.music`,
        headers: {
            'Routines-Version': '1.1.210292',
            'Cookie': config.cookies,
            'csrf': config.csrf
        },
        json: true
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            callback(null, JSON.parse(JSON.stringify(body)));
        } else {
            callback(error, response);
        }
    });
};

let playMusicProvider = function(options, config, callback) {
    if (options.searchPhrase === '') return callback && callback(new Error('Searchphrase empty', null));
    const validateObj = {
        'type': 'Alexa.Music.PlaySearchPhrase',
        'operationPayload': JSON.stringify({
            'deviceType': options.deviceType,
            'deviceSerialNumber': options.deviceSerialNumber,
            'locale': options.locale,
            'customerId': options.deviceOwnerCustomerId,
            'musicProviderId': options.providerId,
            'searchPhrase': options.searchPhrase
        })
    };
    request({
        method: 'POST',
        url: `${alexaUrl}/api/behaviors/operation/validate`,
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        },
        json: validateObj
    }, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            if (body.result !== 'VALID') {
                callback(new Error('Request invalid'), response);
            }
            validateObj.operationPayload = body.operationPayload;

            const seqCommandObj = {
                '@type': 'com.amazon.alexa.behaviors.model.Sequence',
                'startNode': validateObj
            };
            seqCommandObj.startNode['@type'] = 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode';

            sendSequenceCommand(options, seqCommandObj, undefined, config, function(error, response) {
                callback(null, response);
            });
        } else {
            callback(error, response);
        }
    });
};

let sendSequenceCommand = function(device, command, value, config, callback) {
    let seqCommandObj;
    if (typeof command === 'object') {
        seqCommandObj = command.sequence || command;
    } else {
        seqCommandObj = {
            '@type': 'com.amazon.alexa.behaviors.model.Sequence',
            'startNode': createSequenceNode(device, command, value)
        };
    }

    const reqObj = {
        'behaviorId': seqCommandObj.sequenceId ? command.automationId : 'PREVIEW',
        'sequenceJson': JSON.stringify(seqCommandObj),
        'status': 'ENABLED'
    };
    request({
        method: 'POST',
        url: alexaUrl + '/api/behaviors/preview',
        headers: {
            'Cookie': config.cookies,
            'csrf': config.csrf
        },
        json: reqObj
    }, function(error, response) {
        if (!error && response.statusCode === 200) {
            callback(null, {
                "message": response
            });
        } else {
            callback(error, response);
        }
    });
};

let sequenceJsonBuilder = function(serial, devType, custId, cmdKey, cmdVal) {
    let device = {
        deviceSerialNumber: serial,
        deviceType: devType,
        deviceOwnerCustomerId: custId,
        locale: 'en-US'
    };
    const reqObj = {
        'behaviorId': 'PREVIEW',
        'sequenceJson': JSON.stringify({
            '@type': 'com.amazon.alexa.behaviors.model.Sequence',
            'startNode': createSequenceNode(device, cmdKey, cmdVal)
        }),
        'status': 'ENABLED'
    };
    return reqObj;
};


let createSequenceNode = function(device, command, value, callback) {
    const seqNode = {
        '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
        'operationPayload': {
            'deviceType': device.deviceType,
            'deviceSerialNumber': device.deviceSerialNumber,
            'locale': device.locale,
            'customerId': device.deviceOwnerCustomerId
        }
    };
    switch (command) {
        case 'weather':
            seqNode.type = 'Alexa.Weather.Play';
            break;
        case 'traffic':
            seqNode.type = 'Alexa.Traffic.Play';
            break;
        case 'flashbriefing':
            seqNode.type = 'Alexa.FlashBriefing.Play';
            break;
        case 'goodmorning':
            seqNode.type = 'Alexa.GoodMorning.Play';
            break;
        case 'singasong':
            seqNode.type = 'Alexa.SingASong.Play';
            break;
        case 'tellstory':
            seqNode.type = 'Alexa.TellStory.Play';
            break;
        case 'playsearch':
            seqNode.type = 'Alexa.Music.PlaySearchPhrase';
            break;
        case 'volume':
            seqNode.type = 'Alexa.DeviceControls.Volume';
            value = ~~value;
            if (value < 0 || value > 100) {
                return callback(new Error('Volume needs to be between 0 and 100'));
            }
            seqNode.operationPayload.value = value;
            break;
        case 'speak':
            seqNode.type = 'Alexa.Speak';
            if (typeof value !== 'string') value = String(value);
            // if (!this._options.amazonPage || !this._options.amazonPage.endsWith('.com')) {
            //     value = value.replace(/([^0-9]?[0-9]+)\.([0-9]+[^0-9])?/g, '$1,$2');
            // }
            value = value
                .replace(/Â|À|Å|Ã/g, 'A')
                .replace(/á|â|à|å|ã/g, 'a')
                .replace(/Ä/g, 'Ae')
                .replace(/ä/g, 'ae')
                .replace(/Ç/g, 'C')
                .replace(/ç/g, 'c')
                .replace(/É|Ê|È|Ë/g, 'E')
                .replace(/é|ê|è|ë/g, 'e')
                .replace(/Ó|Ô|Ò|Õ|Ø/g, 'O')
                .replace(/ó|ô|ò|õ/g, 'o')
                .replace(/Ö/g, 'Oe')
                .replace(/ö/g, 'oe')
                .replace(/Š/g, 'S')
                .replace(/š/g, 's')
                .replace(/ß/g, 'ss')
                .replace(/Ú|Û|Ù/g, 'U')
                .replace(/ú|û|ù/g, 'u')
                .replace(/Ü/g, 'Ue')
                .replace(/ü/g, 'ue')
                .replace(/Ý|Ÿ/g, 'Y')
                .replace(/ý|ÿ/g, 'y')
                .replace(/Ž/g, 'Z')
                .replace(/ž/, 'z')
                .replace(/&/, 'und')
                .replace(/[^-a-zA-Z0-9_,.?! ]/g, '')
                .replace(/ /g, '_');
            if (value.length === 0) {
                return callback && callback(new Error('Can not speak empty string', null));
            }
            if (value.length > 250) {
                return callback && callback(new Error('text too long, limit are 250 characters', null));
            }
            seqNode.operationPayload.textToSpeak = value;
            break;
        default:
            return;
    }
    return seqNode;
};

// let sendMultiSequenceCommand = function(serialOrName, commands, sequenceType, callback) {
//     if (!sequenceType) sequenceType = 'SerialNode'; // or ParallelNode
//     let nodes = [];
//     for (let command of commands) {
//         const commandNode = this.createSequenceNode(command.command, command.value, callback);
//         if (commandNode) nodes.push(commandNode);
//     }

//     const sequenceObj = {
//         'sequence': {
//             '@type': 'com.amazon.alexa.behaviors.model.Sequence',
//             'startNode': {
//                 '@type': 'com.amazon.alexa.behaviors.model.' + sequenceType,
//                 'name': null,
//                 'nodesToExecute': nodes
//             }
//         }
//     };

//     sendSequenceCommand(serialOrName, sequenceObj, callback);
// };

exports.alexaLogin = alexaLogin;
exports.clearSession = clearSession;
exports.setReminder = setReminder;
exports.setMedia = setMedia;
exports.getDevices = getDevices;
exports.getWakeWords = getWakeWords;
exports.getState = getState;
exports.getDndStatus = getDndStatus;
exports.getPlaylists = getPlaylists;
exports.getLists = getLists;
exports.getNotifications = getNotifications;
exports.executeCommand = executeCommand;
exports.getDevicePreferences = getDevicePreferences;
exports.getBluetoothDevices = getBluetoothDevices;
exports.setBluetoothDevice = setBluetoothDevice;
exports.disconnectBluetoothDevice = disconnectBluetoothDevice;
exports.checkAuthentication = checkAuthentication;
exports.getAccount = getAccount;
exports.sequenceJsonBuilder = sequenceJsonBuilder;
exports.createSequenceNode = createSequenceNode;
// exports.sendSequenceCommand = sendSequenceCommand;
// exports.sendMultiSequenceCommand = sendMultiSequenceCommand;
exports.getAutomationRoutines = getAutomationRoutines;
exports.executeAutomationRoutine = executeAutomationRoutine;
exports.playMusicProvider = playMusicProvider;
exports.getMusicProviders = getMusicProviders;