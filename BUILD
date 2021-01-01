
load("@build_bazel_rules_nodejs//:index.bzl", "nodejs_binary", "nodejs_test")


nodejs_binary(
    name = "swapserve",
    data = [
        ":main.js",
        ":swapstore.js",
    ],
    entry_point = ":main.js",
)

nodejs_test(
    name = "swapstore_test",
    data = [
        ":swapstore_test.js",
        ":swapstore.js",
    ],
    entry_point = ":swapstore_test.js",
)

