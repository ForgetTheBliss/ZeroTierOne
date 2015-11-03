// ZeroTier distributed HTTP test agent

// ---------------------------------------------------------------------------
// Customizable parameters:

// Maximum interval between test attempts
var TEST_INTERVAL_MAX = 60000;

// Test timeout in ms
var TEST_TIMEOUT = 30000;

// Where should I contact to register and query a list of other test agents?
var SERVER_HOST = '104.238.141.145';
var SERVER_PORT = 18080;

// Which port should agents use for their HTTP?
var AGENT_PORT = 18888;

// Payload size in bytes
var PAYLOAD_SIZE = 10000;

// ---------------------------------------------------------------------------

var ipaddr = require('ipaddr.js');
var os = require('os');
var http = require('http');
var async = require('async');

var express = require('express');
var app = express();

// Find our ZeroTier-assigned RFC4193 IPv6 address
var thisAgentId = null;
var interfaces = os.networkInterfaces();
if (!interfaces) {
	console.error('FATAL: os.networkInterfaces() failed.');
	process.exit(1);
}
for(var ifname in interfaces) {
	var ifaddrs = interfaces[ifname];
	if (Array.isArray(ifaddrs)) {
		for(var i=0;i<ifaddrs.length;++i) {
			if (ifaddrs[i].family == 'IPv6') {
				try {
					var ipbytes = ipaddr.parse(ifaddrs[i].address).toByteArray();
					if ((ipbytes.length === 16)&&(ipbytes[0] == 0xfd)&&(ipbytes[9] == 0x99)&&(ipbytes[10] == 0x93)) {
						thisAgentId = '';
						for(var j=0;j<16;++j) {
							var tmp = ipbytes[j].toString(16);
							if (tmp.length === 1)
								thisAgentId += '0';
							thisAgentId += tmp;
						}
					}
				} catch (e) {
					console.error(e);
				}
			}
		}
	}
}
if (thisAgentId === null) {
	console.error('FATAL: no ZeroTier-assigned RFC4193 IPv6 addresses found on any local interface!');
	process.exit(1);
}

//console.log(thisAgentId);

// Create a random (and therefore not very compressable) payload
var payload = new Buffer(PAYLOAD_SIZE);
for(var xx=0;xx<PAYLOAD_SIZE;++xx) {
	payload.writeUInt8(Math.round(Math.random() * 255.0),xx);
}

function agentIdToIp(agentId)
{
	var ip = '';
	ip += agentId.substr(0,4);
	ip += ':';
	ip += agentId.substr(4,4);
	ip += ':';
	ip += agentId.substr(8,4);
	ip += ':';
	ip += agentId.substr(12,4);
	ip += ':';
	ip += agentId.substr(16,4);
	ip += ':';
	ip += agentId.substr(20,4);
	ip += ':';
	ip += agentId.substr(24,4);
	ip += ':';
	ip += agentId.substr(28,4);
	return ip;
};

var lastTestResult = null;
var allOtherAgents = [];

function doTest()
{
	var submit = http.request({
		host: SERVER_HOST,
		port: SERVER_PORT,
		path: '/'+thisAgentId,
		method: 'POST'
	},function(res) {
		var body = '';
		res.on('data',function(chunk) { body += chunk.toString(); });
		res.on('end',function() {

			if (body) {
				try {
					var peers = JSON.parse(body);
					if (Array.isArray(peers))
						allOtherAgents = peers;
				} catch (e) {}
			}

			if (allOtherAgents.length > 1) {

				var target = allOtherAgents[Math.floor(Math.random() * allOtherAgents.length)];
				while (target === thisAgentId)
					target = allOtherAgents[Math.floor(Math.random() * allOtherAgents.length)];

				var testRequest = null;
				var timeoutId = null;
				timeoutId = setTimeout(function() {
					if (testRequest !== null)
						testRequest.abort();
					timeoutId = null;
				},TEST_TIMEOUT);
				var startTime = Date.now();

				testRequest = http.get({
					host: agentIdToIp(target),
					port: AGENT_PORT,
					path: '/'
				},function(res) {
					var bytes = 0;
					res.on('data',function(chunk) { bytes += chunk.length; });
					res.on('end',function() {
						lastTestResult = {
							source: thisAgentId,
							target: target,
							time: (Date.now() - startTime),
							bytes: bytes,
							timedOut: (timeoutId === null),
							error: null
						};
						if (timeoutId !== null)
							clearTimeout(timeoutId);
						return setTimeout(doTest,Math.round(Math.random() * TEST_INTERVAL_MAX) + 1);
					});
				}).on('error',function(e) {
					lastTestResult = {
						source: thisAgentId,
						target: target,
						time: (Date.now() - startTime),
						bytes: 0,
						timedOut: (timeoutId === null),
						error: e.toString()
					};
					if (timeoutId !== null)
						clearTimeout(timeoutId);
					return setTimeout(doTest,Math.round(Math.random() * TEST_INTERVAL_MAX) + 1);
				});

			} else {
				return setTimeout(doTest,1000);
			}

		});
	}).on('error',function(e) {
		console.log('POST failed: '+e.toString());
		return setTimeout(doTest,1000);
	});
	if (lastTestResult !== null) {
		submit.write(JSON.stringify(lastTestResult));
		lastTestResult = null;
	}
	submit.end();
};

/*
function performTestOnAllPeers(peers,callback)
{
	var allResults = {};
	var allRequests = [];
	var timedOut = false;
	var endOfTestTimer = setTimeout(function() {
		timedOut = true;
		for(var x=0;x<allRequests.length;++x)
			allRequests[x].abort();
	},TEST_DURATION);

	async.each(peers,function(peer,next) {
		if (timedOut)
			return next(null);
		if (peer.length !== 32)
			return next(null);

		var connectionStartTime = Date.now();
		allResults[peer] = {
			start: connectionStartTime,
			end: 0,
			error: null,
			timedOut: false,
			bytes: 0
		};

		allRequests.push(http.get({
			host: agentIdToIp(peer),
			port: AGENT_PORT,
			path: '/'
		},function(res) {
			var bytes = 0;
			res.on('data',function(chunk) {
				bytes += chunk.length;
			});
			res.on('end',function() {
				allResults[peer] = {
					start: connectionStartTime,
					end: Date.now(),
					error: null,
					timedOut: timedOut,
					bytes: bytes
				};
				return next(null);
			});
		}).on('error',function(e) {
			allResults[peer] = {
				start: connectionStartTime,
				end: Date.now(),
				error: e.toString(),
				timedOut: timedOut,
				bytes: 0
			};
			return next(null);
		}));
	},function(err) {
		if (!timedOut)
			clearTimeout(endOfTestTimer);
		return callback(allResults);
	});
};

function doTestsAndReport()
{
	registerAndGetPeers(function(err,peers) {
		if (err) {
			console.error('WARNING: skipping test: unable to contact or query server: '+err.toString());
		} else {
			performTestOnAllPeers(peers,function(results) {
				var submit = http.request({
					host: SERVER_HOST,
					port: SERVER_PORT,
					path: '/'+thisAgentId,
					method: 'POST'
				},function(res) {
				}).on('error',function(e) {
					console.error('WARNING: unable to submit results to server: '+err.toString());
				});
				submit.write(JSON.stringify(results));
				submit.end();
			});
		}
	});
};
*/

// Agents just serve up a test payload
app.get('/',function(req,res) { return res.status(200).send(payload); });

var expressServer = app.listen(AGENT_PORT,function () {
	// Start timeout-based loop
	doTest();
});