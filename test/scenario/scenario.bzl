load("@aspect_rules_js//js:defs.bzl", "js_test")
load("@fildesh//tool/bazel:sxpb2json.bzl", "sxpb2json")

def rendezqueue_scenario_test(name):
    sxpb2json(
        name = name,
        src = name + ".sxpb",
        out = name + ".json",
        testonly = True,
        visibility = ["//test:__subpackages__"],
    )
    js_test(
        name = name + "_nodejson_expect_test",
        data = [
            ":package_json",
            "//src/nodejson:rendezqueue_json_impl_js",
            "//test/scenario:nodejson_expect.js",
            ":" + name + ".json",
        ],
        entry_point = "//test/scenario:nodejson_expect.js",
        args = ["$(location :" + name + ".json)"],
        size = "small",
    )
