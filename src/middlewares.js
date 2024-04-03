import express from '@feathersjs/express'

export default function () {
  // Add your custom middleware here. Remember, that
  // in Express the order matters, `notFound` and
  // the error handler have to go last.
  const app = this

  // https://github.com/kalisio/feathers-distributed#remote-services
  // We don't want to expose distributed services by Kano, simply consume it internally
  app.use(express.notFound())
  app.use(express.errorHandler())
}
