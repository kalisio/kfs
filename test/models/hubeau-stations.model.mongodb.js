export default function (app, options) {
  const db = options.db || app.db
  options.Model = db.collection('hubeau-stations')
  options.Model.createIndex({ geometry: '2dsphere' })
}
