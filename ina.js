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
	//a mutex is a syncronization primitive that allows only one user to lock it at a time
	//everyone else will have to wait in line
	//this isnt a true mutex, because js isn't actually multithreaded but simply out of order execution
	//it isnt possible to have a race condition in js, but you can still have a need for a mutex which is why we have one here :) 
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

	//here is the mutex we'll be using
	const mq = new Mutex()

	//this is a config node t
	function Handle (config)
	{
		RED.nodes.createNode(this, config)
		
		const node = this 
		//the config state for this sensor 
		node.address = parseInt(config.address)
		node.delay   = parseInt(config.delay)
		node.ohms	 = parseFloat(config.ohms)
		node.customResistor = config.customResistor

	
		//the state for running the node
		//the two sets are where nodes will register themselves if they want to be pinged for data
		//the ending flag is true when the node wants to shut down 
		node.ending = false
		node.mvRegister = new Set()
		node.maRegister = new Set()
		node.lock = undefined
		init()
		
		//we only want one function accessing the sensor at a time
		//which is why we use a 'mutex'
		//this function tries to create a connection to the ina sensor
		//we constantly reconnect in our loop
		//todo:: try and remember why we use the INA node in this way...
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

		//here's our loop
		function loop ()
		{
			if(node.ending)
			{
				unlock()
				return
			}
			ina219.getBusVoltage_V(sendV)
		}

		//here we send data to the nodes that registered for it 
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

	//here is the node that registers itself with the config node 
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



		 
