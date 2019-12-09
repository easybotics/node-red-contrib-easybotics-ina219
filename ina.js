var ina219 = require('easybotics-ina219')

//TODO:
//settable address and update rate 
//multiple sensors with different addresses

//smash js floats down to a fixed 
function smashNum (num) 
{
	return parseFloat(parseFloat(Math.round(num * 100) / 100).toFixed(2));
}


module.exports = function(RED)
{
	class Mutex 
	{
		constructor() 
		{
			this._lock = Promise.resolve()
		}

		_acquire() 
		{
			var release
			const lock = this._lock = new Promise(resolve => {
				release = resolve
			})
			return release
		}

		acquireQueued() 
		{
			const q = this._lock.then(() => release)
			const release = this._acquire()
			return q
		}
	}

	const mq = new Mutex()

	function Handle (config)
	{
		RED.nodes.createNode(this, config)
		
		const node = this 
		node.address = parseInt(config.address)
		node.delay   = parseInt(config.delay)
		node.ohms	 = parseFloat(config.ohms)
		node.customResistor = config.customResistor

	
		node.ending = false
		node.mvRegister = new Set()
		node.maRegister = new Set()
		node.lock = undefined
		init()
		
		async function lock ()
		{
			node.lock = await mq.acquireQueued()
			//lets try and close the file descriptor first
			try 
			{
				if(ina219.wire) 
				{
					ina219.wire.closeSync()
				}
			}
			catch (e)
			{
				node.error(e)
			}


			ina219.init(node.address, 1)
			try 
			{
				console.log(node.ohms)
				console.log(node.customResistor)

				console.log("initing!")
				if(node.customResistor) ina219.calibrate32V2AResistor(node.ohms, loop)
				else ina219.calibrate32V2A(loop)
			}
			catch (e)
			{
				node.error(e)
				node.log('no device on this address?')
				unlock()
			}
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
			unlock()
			node.ending = true
		}

		node.on('close', close)

		function loop ()
		{
			if(node.ending)
			{
				unlock()
				return
			}
			ina219.getBusVoltage_V(sendV)
		}

		function sendV (voltage)
		{
			for(const n of node.mvRegister)
				n.vOutput(voltage)

			ina219.getCurrent_mA(sendMa)
		}

		function sendMa (amps)
		{
			for(const n of node.maRegister)
				n.aOutput(amps)

			unlock()
			setTimeout(lock, node.delay)
		}

	}

	function inaSensor (config)
	{
		RED.nodes.createNode(this, config)
		const node = this

		var v = undefined
		var a = undefined

		node.handle = RED.nodes.getNode(config.handle)
		node.handle.maRegister.add(node)
		node.handle.mvRegister.add(node)

		node.vOutput = function (voltage)
		{
			v = smashNum(voltage)
			if(v == undefined || a == undefined) return

			const msg0 = {payload: v, topic: 'voltage'}
			//const msg1 = {payload: a, topic: 'miliamps'}
			//don't send unwated messages from other output
			const msg1 = null
			node.send([msg0, msg1])
		}


		node.aOutput = function (amps)
		{
			a = smashNum(amps)
			if(v == undefined || a == undefined) return

			//const msg0 = {payload: v, topic: 'voltage'}
			const msg0 = null
			const msg1 = {payload: a, topic: 'miliamps'}
			node.send([msg0, msg1])
		}

		node.on('close', function()
		{
			node.handle.maRegister.delete(node)
			node.handle.mvRegister.delete(node)
		})
	}


	RED.nodes.registerType('ina-sensor-manager', Handle)
	RED.nodes.registerType('ina-sensor', inaSensor)
}



		 
