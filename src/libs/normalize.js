const moment = require('moment')

// Promise
Promise = require('bluebird')

// moment
moment.updateLocale('en', {
  relativeTime : {
    future: "in next %s"
  }
})
