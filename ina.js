var ina219 = require('ina219');

//TODO:
//settable address and update rate 
//multiple sensors with different addresses

module.exports = function(RED)
{
	class Mutex 
	{
		constructor() 
		{
			this._lock = Promise.resolve();
		}

		_acquire() 
		{
			var release;
			const lock = this._lock = new Promise(resolve => {
				release = resolve;
			});
			return release;
		}

		acquireQueued() 
		{
			const q = this._lock.then(() => release);
			const release = this._acquire();
			return q;
		}
	}

	const mq = new Mutex();

	function Handle (config)
	{
		RED.nodes.createNode(this, config)
		
		const node = this 
		const address = config.address

		node.address = "auto" 
		node.ending = false
		node.vRegister = new Set()
		node.aRegister = new Set()
		node.lock = undefined
		init()
		
		async function lock ()
		{
			node.lock = await mq.acquireQueued()
			ina219.init(node.address, 1)
			ina219.calibrate32V1A(loop)
		}

		function unlock ()
		{
			node.lock()
		}

		function init ()
		{
			lock()
		}

		function close ()
		{
			node.ending = true;
		}

		node.on('close', close);

		function loop ()
		{
			if(node.ending) return;
			ina219.getBusVoltage_V(sendV);
		}

		function sendV (voltage)
		{
			for(const n of node.vRegister)
				n.vOutput(voltage)

			ina219.getCurrent_mA(sendMa)
		}

		function sendMa (amps)
		{
			for(const n of node.aRegister)
				n.aOutput(amps)

			unlock()
			setTimeout(loop, 250)
		}

	}

function inaSensor (config)
{
	RED.nodes.createNode(this, config)
	const node = this

	v = undefined
	a = undefined

	node.handle = RED.nodes.getNode(config.handle)
	node.handle.aRegister.add(node)
	node.handle.vRegister.add(node)

	node.vOutput = function (voltage)
	{
		v = voltage;
		if(v == undefined || a == undefined) return;

		const msg0 = {payload: v, topic: "voltage"}
		const msg1 = {payload: a, topic: "miliamps"}
		node.send([msg0, msg1])
	}


	node.aOutput = function (amps)
	{
		a = amps;
		if(v == undefined || a == undefined) return;

		const msg0 = {payload: v, topic: "voltage"}
		const msg1 = {payload: a, topic: "miliamps"}
		node.send([msg0, msg1])
	}
}

	RED.nodes.registerType('ina-sensor-manager', Handle)
	RED.nodes.registerType('ina-sensor', inaSensor)
}



		 
