load("@aspect_rules_js//js:defs.bzl", "js_test")
load("@fildesh//tool/bazel:fildesh_run.bzl", "fildesh_run")
load("@fildesh//tool/bazel:sxpb2json.bzl", "sxpb2json")
load("@rules_sxproto//sxproto:defs.bzl", "sxproto_data")

def rendezqueue_scenario_test(name):
    sxpb2json(
        name = name,
        src = name + ".sxpb",
        out = name + ".json",
        testonly = True,
        visibility = ["//test:__subpackages__"],
    )
    fildesh_run(
        name = name + "_message_sxpb",
        testonly = True,
        input_by_xof = {"x": name + ".sxpb"},
        output_by_xof = {"o": name + "_message.sxpb"},
        src_content = """
|< splice -- / "(expectations " / $(XOF x)
|> splice -o $(XOF o) -- - / ")\\n" /
      """,
    )
    sxproto_data(
        name = name + "_message_json",
        src = name + "_message.sxpb",
        out_json = name + "_message.json",
        proto_message = "rendezqueue.TrySwapScenario",
        proto_deps = [":scenario_proto"],
        testonly = True,
        visibility = ["//test/nodejson:__pkg__"],
    )
    js_test(
        name = name + "_nodejson_expect_test",
        data = [
            "//src/nodejson:rendezqueue_json_impl_js",
            "//test/scenario:nodejson_expect.js",
            ":" + name + "_message.json",
        ],
        entry_point = "//test/scenario:nodejson_expect.js",
        args = ["$(location :" + name + "_message.json)"],
        size = "small",
    )
