// side-effects: true
// DEVELOPMENT ONLY

// This is used for live-reloading (informing client that the code powering the client is obsolete, so refresh the URL to 
// update the client app).

const chokidar = require('chokidar')
const express = require('express')
// const Koa = require('koa')
const fs = require('fs')
const path = require('path')
const util = require('util')
const readFile = util.promisify(fs.readFile)

const devNamespace = '/dev/'
const browserScriptFilename = 'live-reload-browser.js'
const pollingRoute = '/api/client-code-last-modified'

export let getScriptInjectMiddleware = (publicRoot, sendFromHere)=>{
	return function scriptInjectMiddleware(req, res, next){
		let pathSplit = req.path.split('/')
		let file = pathSplit[pathSplit.length - 1]
		if (!file.match(/\./)){ // It's a clean url, not looking for a file but an abstract page
			readFile(path.join(publicRoot, req.url, 'index.html'), 'utf-8').then(originalBody => {
				let endOfBodyMatcher = '</body>'
				let replacement = `<script type="module" src="${path.join(devNamespace, browserScriptFilename)}"></script>\n${endOfBodyMatcher}`
				let injectedBody = originalBody.replace(new RegExp(endOfBodyMatcher), replacement)

				req.injectedBody = injectedBody

				if (sendFromHere){
					res.status(200)
					res.send(injectedBody)	
				} else {
					next()
				}
			}).catch(err => {
				console.error('errored looking for file:', err)
				res.status(404)
				res.send('Sorry, 404')
			})
		} else {
			next()
		}
	}	
}

let getLiveReloadMiddleware = (getLastModified)=>{
	return function liveReloadMiddleware(req, res, next){ // Use trad functionn form to give a name to generated middleware
		let lastModifiedDate = getLastModified()
		let bodyToRespond = null
		if (lastModifiedDate instanceof Date) bodyToRespond = lastModifiedDate[Symbol.toPrimitive]('number')
		let statusCode = bodyToRespond ? 200 : 204 // OK : No content
		res.status(200)
		// res.header("Access-Control-Allow-Origin", "*")
		// res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
		res.send(bodyToRespond.toString())
	}	
}

let liveReloadFileWatcherStart = (callback, publicRoot, watchList = ['**/*'])=>{
	// Watch browser client code for changes, upon which we can send a notification to the client so it can restart
	let fileWatcher = chokidar.watch(
		// watchList,
		'.', // Current directory
		{
			cwd: publicRoot,
			
			// Ignore .dotfiles
			// ignored: /(^|[\/\\])\../, // eslint-disable-line
			persistent: true,
			followSymlinks: false,
			depth: 5
		}
	)

	let onBrowserFileModified = (path, noLog) => {
		if (!noLog) console.info('Browser client will refresh due to change in: ' + path)
		callback(new Date())
	}

	// Don't print to console for new added files or we get a surge of them on app launch
	fileWatcher
		.on('add', path => { onBrowserFileModified(path, true) })
		.on('change', onBrowserFileModified)
		.on('unlink', onBrowserFileModified)	
}

// Defining an activeLocalIP will broadcast across local network
export let liveReloadServer = ({
	publicRoot,
	appRoot = process.cwd(),
	/*Date*/clientCodeLastModified = new Date(), 
	lastModifiedPollingRoute = pollingRoute,
	hostname = '127.0.0.1',
	port = 2020,
	portToAvoid,
	liveReloadUrlNamespace = devNamespace
}={})=>{
	let lastModified = clientCodeLastModified
	
	liveReloadFileWatcherStart(time => {
		lastModified = time
	}, publicRoot)

	let getLastModified = () => lastModified

	if (portToAvoid) portToAvoid = Number(portToAvoid) // Ensure it's a number
	if (portToAvoid === port){
		port = portToAvoid + 1
	}
	
	let expressServer = express()

	/*
		Static data routes for 
	*/
	expressServer.use(path.join(liveReloadUrlNamespace, browserScriptFilename), (req, res, next) => {
		readFile(path.join(__dirname, browserScriptFilename), 'utf-8').then(body => {
			res
				.type('text/javascript')
				.send(body)
		})
	})
	expressServer.use(path.join(liveReloadUrlNamespace, 'throttle.js'), (req, res, next) => {
		readFile(path.join(__dirname, 'throttle.js'), 'utf-8').then(body => {
			res
				.type('text/javascript')
				.send(body)
		})
	})

	let pollPath = path.join(devNamespace, lastModifiedPollingRoute)
	// TODO: go back to using ports as namespace, rather than a path?
	expressServer.get(pollPath, getLiveReloadMiddleware(getLastModified)) // Development-only route

	expressServer.use('/', getScriptInjectMiddleware(publicRoot, true))

	return expressServer
}