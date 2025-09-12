# Contributing

## Environment Setup
### Bazel
In a temporary environment like a VM, just use `npm` to install `bazel` for your user.
```shell
npm install -g @bazel/bazelisk
```

Now the following should work:
```shell
bazel test //...
```

## Style
### Lint
Linting for JavaScript and Bazel files is run through `npm`.
```shell
npm install
npm run lint
```
