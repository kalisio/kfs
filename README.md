# kfs

[![Latest Release](https://img.shields.io/github/v/tag/kalisio/kfs?sort=semver&label=latest)](https://github.com/kalisio/kfs/releases)
[![Build Status](https://app.travis-ci.com/kalisio/kfs.svg?branch=master)](https://app.travis-ci.com/kalisio/kfs)
[![Code Climate](https://codeclimate.com/github/kalisio/kfs/badges/gpa.svg)](https://codeclimate.com/github/kalisio/kfs)
[![Test Coverage](https://codeclimate.com/github/kalisio/kfs/badges/coverage.svg)](https://codeclimate.com/github/kalisio/kfs/coverage)
[![Dependency Status](https://img.shields.io/david/kalisio/kfs.svg?style=flat-square)](https://david-dm.org/kalisio/kfs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Kalisio Features Service**

**kfs** is a lightweight service that let you distribute geospatial data from [Kano](https://kalisio.github.io/kano/) using the [OGC API Features](https://ogcapi.ogc.org/features/) standard. 

## API

Please refer to the [OGC API Features](https://ogcapi.ogc.org/features/) standard for details. Here are the current limitations:
* only the [GeoJson encoding](https://docs.opengeospatial.org/is/17-069r4/17-069r4.html#_requirements_class_geojson) is supported

### healthcheck (GET)

Check for the health of the service

## Configuring

Here are the environment variables you can use to customize the service:

| Variable  | Description | Defaults |
|-----------| ------------| ------------|
| `HOSTNAME` | Hostname | `localhost` |
| `PORT` | Port the API will respond on | `8081` |
| `BASE_URL` | Base service URL to be used to fill links | `http://${hostname}:${port}` |
| `API_PREFIX` | Prefix used on API routes | `/api` |
| `DEBUG` | The namespaces to enable debug output. Set it to `kfs:*` to enable full debug output. |  - |

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

To run the tests, use the subcommand `test`: 

```bash
yarn test
```

## Contributing

Please read the [Contributing file](./.github/CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Authors

This project is sponsored by 

![Kalisio](https://s3.eu-central-1.amazonaws.com/kalisioscope/kalisio/kalisio-logo-black-256x84.png)

## License

This project is licensed under the MIT License - see the [license file](./LICENSE.md) for details