# Development

## Setup

### Node.js
Install dependencies and a playwright browser for testing.

```shell
npm install
npx playwright install
```

### Bazel
Bazel is not required to run the most important tests.
However if you do need it, `npm` provides a quick way to install `bazel` for your user.
```shell
npm install -g @bazel/bazelisk
```

## Test
To run the test suite:
```shell
npm test
bazel test //...
```

## Style
### Lint
Linting for JavaScript and Bazel files is run through `npm`.
```shell
npm run lint
```
