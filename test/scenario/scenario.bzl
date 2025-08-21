load("@aspect_rules_js//js:defs.bzl", "js_test")
load("@fildesh//tool/bazel:fildesh_run.bzl", "fildesh_run")
load("@rules_sxproto//sxproto:defs.bzl", "sxproto_data")

def rendezqueue_scenario_test(name):
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
        name = name,
        src = name + "_message.sxpb",
        out_json = name + ".json",
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
            ":" + name + ".json",
        ],
        entry_point = "//test/scenario:nodejson_expect.js",
        args = ["$(location :" + name + ".json)"],
        size = "small",
    )
