# kfs

[![Latest Release](https://img.shields.io/github/v/tag/kalisio/kfs?sort=semver&label=latest)](https://github.com/kalisio/kfs/releases)
[![CI](https://github.com/kalisio/kfs/actions/workflows/main.yaml/badge.svg)](https://github.com/kalisio/kfs/actions/workflows/main.yaml)
[![Code Climate](https://codeclimate.com/github/kalisio/kfs/badges/gpa.svg)](https://codeclimate.com/github/kalisio/kfs)
[![Test Coverage](https://codeclimate.com/github/kalisio/kfs/badges/coverage.svg)](https://codeclimate.com/github/kalisio/kfs/coverage)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Kalisio Features Service**

**kfs** is a lightweight service that let you distribute geospatial data from applications developed using the [Kalisio Development Kit](KDK) like [Kano](https://kalisio.github.io/kano/) using the [OGC API Features](https://ogcapi.ogc.org/features/) standard (a.k.a. WFS v3). 

Each service-based layer from Kano will generate two or one feature collection(s) depending if probes are used or not.

> Note:
> 
> Under-the-hood [feathers-distributed](https://github.com/kalisio/feathers-distributed) is used to access exposed services.

## API

Please refer to the [OGC API Features](https://ogcapi.ogc.org/features/) standard for details. Here are the current limitations:
* only the Part 1 of the standard is implemented
* only the [GeoJson encoding](https://docs.opengeospatial.org/is/17-069r4/17-069r4.html#_requirements_class_geojson) is supported
* only a [bbox in WGS 84 CRS](https://docs.ogc.org/is/17-069r4/17-069r4.html#_parameter_bbox) is supported
* the following CQL filtering operators are supported
  * logical operators `and`, `or`, `not`
  * comparison operators `eq`, `lt`, `gt`, `lte`, `gte`
  * spatial operators `intersects`, `within`
  * temporal operators `before`, `after`, `during` (targetting instant property not interval)

> Note:
> 
> Only CQL JSON encoding is fully supported, only spatial filters are supported for CQL in text encoding.

### /healthcheck (GET)

Check for the health of the service

## Configuring

Here are the environment variables you can use to customize the service:

| Variable  | Description | Defaults |
|-----------| ------------| ------------|
| `HOSTNAME` | Hostname | `localhost` |
| `PORT` | Port the API will respond on | `8081` |
| `BASE_URL` | Base service URL to be used to fill links | `http://${hostname}:${port}` |
| `API_PREFIX` | Prefix used on API routes | `/api`  |
| `DEBUG` | The namespaces to enable debug output. Set it to `kfs:*` to enable full debug output. |  - |

### local.cjs

By default, **kfs** only exposes [features services](https://kalisio.github.io/kdk/api/map/services.html#features-service) provided by [Kano](https://kalisio.github.io/kano/). You can write a `local.cjs` file to alter the default configuration.

Here is an example file that exposes services from another application:

```js
module.exports = {
  distribution: {
  	// Application key in feathers-distributed
    remoteServices: (service) => (service.key === 'myapp')
  },
  // Declare here any additional service that is not a features service but complies its GeoJson interface
  services: (serviceName, service) => {
  	// This specific service complies a GeoJson interface using a specific query parameters
    if (serviceName === 'myservice') return {
      query: { geoJson: true }
    }
  }
}
```

## Building

### Manual build 

You can build the image with the following command:

```bash
docker build -t <your-image-name> .
```

### Automatic build using Travis CI

This project is configured to use **Travis** to build and push the image on the [Kalisio's Docker Hub](https://hub.docker.com/u/kalisio/).
The built image is tagged using the `version` property in the `package.json` file.

To enable Travis to do the job, you must define the following variable in the corresponding Travis project:

| Variable  | Description |
|-----------| ------------|
| `DOCKER_USER` | your username |
| `DOCKER_PASSWORD` | your password |

## Deploying

This image is designed to be deployed using the [Kargo](https://kalisio.github.io/kargo/) project.

## Testing

To run the internal tests, use the subcommand `test`: 

```bash
yarn test
```

To run the OGC API - Features Conformance Test Suite - available at https://github.com/opengeospatial/ets-ogcapi-features10:
1) use the JAR file provided in `test` or download the "all-in-one" JAR file that includes the test suite and all of its dependencies (e.g. `1.7` version) on the Maven central repository,
2) update the target URL in the `test/test-run-props.xml` file if required
3) run the following command `java -jar ets-ogcapi-features10-1.7-aio.jar -o /path/to/output -h /path/to/test-run-props.xml`

A useful tool to check your OpenAPI specification conformance is [redocly-cli](https://github.com/Redocly/redocly-cli).

## Contributing

Please read the [Contributing file](./.github/CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Authors

This project is sponsored by 

![Kalisio](https://s3.eu-central-1.amazonaws.com/kalisioscope/kalisio/kalisio-logo-black-256x84.png)

## License

This project is licensed under the MIT License - see the [license file](./LICENSE.md) for details
