# Rendezqueue

A rendezvous service to exchange queued values.

The service acts as a data broker, but has fairly tight limits on how much data can be held.
It's enough to exchange a WebRTC offer and answer!

## Dependency Management

This project uses `pnpm` to manage npm dependencies. The dependencies are defined in `package.json` and the exact versions are pinned in `pnpm-lock.yaml`.

To add, remove, or update dependencies, use the `pnpm` command line tool. For example:

- To add a new development dependency: `pnpm add -D <package-name>`
- To remove a dependency: `pnpm remove <package-name>`
- To update all dependencies: `pnpm up`

After modifying the dependencies, the `pnpm-lock.yaml` file will be updated. This file is then used by Bazel to create the necessary targets for the npm packages.
