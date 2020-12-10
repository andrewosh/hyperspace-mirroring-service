# hyperspace-mirroring-service
A Hyperspace service with a RPC API for mirroring.

## Installation
```
npm i hyperspace-mirroring-service
```

## Usage
This service is meant to run alongside a running Hyperspace server.

With Hyperspace running in a separate terminal:
```sh
❯ ./bin/index.js
Running hyperspace-mirror/1.0.6 linux-x64 node-v14.15.0
Listening on /tmp/hyperspace-mirroring.sock
```

Then you can import `hyperspace-mirroring-service/client` inside a script, and it will auto-connect to the running server.

The mirror service provides an [HRPC](https://github.com/mafintosh/hrpc) endpoint with methods for mirroring, unmirror, and listing mirroed Hypercore-based data structures.

Currently it supports mirroring Hyperdrives and individual Hypercores. It doesn't do data-structure detection by looking at Hypercore headers -- you gotta explicitly provide the type.

As of now, Hyperdrive mirroring doesn't handle mounts. Maybe one day

## API

#### `await client.mirror(key, type)`
Start mirroring a Hypercore-based data structure.

This command will currently special-case the `hyperdrive` type, mirroring both metadata and content feeds.

#### `await client.unmirror(key, type)`
Stop mirroring a Hypercore-based data structure.

This command will currently special-case the `hyperdrive` type, unmirroring both metadata and content feeds.

#### `await client.status(key, type)`
Check if a data structure is being mirrored;

Returns an object of the form:
```js
{
  key, // Buffer
  type, // string
  mirroring // bool
}
```

#### `await client.list()`
List all data structures being mirrored.

Returns an Array of status objects with the same shape as the `status` return value.

#### `await client.stop()`
Shut down the server.

## License
MIT
