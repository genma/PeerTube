'use strict'

// ----------- Node modules -----------
const bodyParser = require('body-parser')
const cors = require('cors')
const express = require('express')
const expressValidator = require('express-validator')
const http = require('http')
const morgan = require('morgan')
const path = require('path')
const TrackerServer = require('bittorrent-tracker').Server
const WebSocketServer = require('ws').Server

process.title = 'peertube'

// Create our main app
const app = express()

// ----------- Database -----------
const constants = require('./server/initializers/constants')
const database = require('./server/initializers/database')
const logger = require('./server/helpers/logger')

database.connect()

// ----------- Checker -----------
const checker = require('./server/initializers/checker')

const missed = checker.checkMissedConfig()
if (missed.length !== 0) {
  throw new Error('Miss some configurations keys : ' + missed)
}

const errorMessage = checker.checkConfig()
if (errorMessage !== null) {
  throw new Error(errorMessage)
}

// ----------- PeerTube modules -----------
const customValidators = require('./server/helpers/custom-validators')
const installer = require('./server/initializers/installer')
const migrator = require('./server/initializers/migrator')
const mongoose = require('mongoose')
const routes = require('./server/controllers')
const Request = mongoose.model('Request')

// ----------- Command line -----------

// ----------- App -----------

// For the logger
app.use(morgan('combined', { stream: logger.stream }))
// For body requests
app.use(bodyParser.json({ limit: '500kb' }))
app.use(bodyParser.urlencoded({ extended: false }))
// Validate some params for the API
app.use(expressValidator({
  customValidators: Object.assign(
    {},
    customValidators.misc,
    customValidators.pods,
    customValidators.users,
    customValidators.videos
  )
}))

// ----------- Views, routes and static files -----------

// API routes
const apiRoute = '/api/' + constants.API_VERSION
app.use(apiRoute, routes.api)
app.use('/', routes.client)

// Static client files
// TODO: move in client
app.use('/client', express.static(path.join(__dirname, '/client/dist'), { maxAge: constants.STATIC_MAX_AGE }))
// 404 for static files not found
app.use('/client/*', function (req, res, next) {
  res.sendStatus(404)
})

const torrentsPhysicalPath = constants.CONFIG.STORAGE.TORRENTS_DIR
app.use(constants.STATIC_PATHS.TORRENTS, cors(), express.static(torrentsPhysicalPath, { maxAge: constants.STATIC_MAX_AGE }))

// Videos path for webseeding
const videosPhysicalPath = constants.CONFIG.STORAGE.VIDEOS_DIR
app.use(constants.STATIC_PATHS.WEBSEED, cors(), express.static(videosPhysicalPath, { maxAge: constants.STATIC_MAX_AGE }))

// Thumbnails path for express
const thumbnailsPhysicalPath = constants.CONFIG.STORAGE.THUMBNAILS_DIR
app.use(constants.STATIC_PATHS.THUMBNAILS, express.static(thumbnailsPhysicalPath, { maxAge: constants.STATIC_MAX_AGE }))

// Video previews path for express
const previewsPhysicalPath = constants.CONFIG.STORAGE.PREVIEWS_DIR
app.use(constants.STATIC_PATHS.PREVIEWS, express.static(previewsPhysicalPath, { maxAge: constants.STATIC_MAX_AGE }))

// Always serve index client page
app.use('/*', function (req, res, next) {
  res.sendFile(path.join(__dirname, './client/dist/index.html'))
})

// ----------- Tracker -----------

const trackerServer = new TrackerServer({
  http: false,
  udp: false,
  ws: false,
  dht: false
})

trackerServer.on('error', function (err) {
  logger.error(err)
})

trackerServer.on('warning', function (err) {
  logger.error(err)
})

const server = http.createServer(app)
const wss = new WebSocketServer({server: server, path: '/tracker/socket'})
wss.on('connection', function (ws) {
  trackerServer.onWebSocketConnection(ws)
})

// ----------- Errors -----------

// Catch 404 and forward to error handler
app.use(function (req, res, next) {
  const err = new Error('Not Found')
  err.status = 404
  next(err)
})

app.use(function (err, req, res, next) {
  logger.error(err)
  res.sendStatus(err.status || 500)
})

const port = constants.CONFIG.LISTEN.PORT
installer.installApplication(function (err) {
  if (err) throw err

  // Run the migration scripts if needed
  migrator.migrate(function (err) {
    if (err) throw err

    // ----------- Make the server listening -----------
    server.listen(port, function () {
      // Activate the pool requests
      Request.activate()

      logger.info('Server listening on port %d', port)
      logger.info('Webserver: %s', constants.CONFIG.WEBSERVER.URL)

      app.emit('ready')
    })
  })
})

module.exports = app
