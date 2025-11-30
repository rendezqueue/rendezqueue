# Contributing

## Environment Setup
### Bazel
Bazel is not required to run the most important tests.
However if you do need it, `npm` provides a quick way to install `bazel` for your user.
```shell
npm install -g @bazel/bazelisk
```

## Test
To run the test suite:
```bash
npm test
bazel test //...
```

## Style
### Lint
Linting for JavaScript and Bazel files is run through `npm`.
```shell
npm install
npm run lint
```
