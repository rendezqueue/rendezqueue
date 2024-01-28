load("@aspect_rules_js//js:defs.bzl", "js_test")
load("@fildesh//tool/bazel:fildesh_test.bzl", "fildesh_test")
load("@rules_sxproto//sxproto:defs.bzl", "sxproto_data")

def rendezqueue_scenario_test(name):
  sxproto_data(
      name = name,
      src = name + ".sxpb",
      out_json = name + ".json",
      proto_message = "rendezqueue.TrySwapScenario",
      proto_deps = [":scenario_proto"],
      testonly = 1,
      visibility = ["//test/nodejson:__pkg__"],
  )
  js_test(
      name = name + "_nodejson_expect_test",
      data = [
          "//src/nodejson:rendezqueue_json_impl_js",
          "//src/nodejson:swapstore_js",
          "//test/scenario:nodejson_expect.js",
          ":" + name + ".json",
      ],
      entry_point = "//test/scenario:nodejson_expect.js",
      args = ["$(location :" + name + ".json)"],
      size = "small",
  )
  fildesh_test(
      name = name + "_ccgrpc_expect_test",
      srcs = ["//test/scenario:ccgrpc_expect.fildesh"],
      tool_by_alias = {
         "expect_test": "//test/scenario:ccgrpc_expect",
      },
      input_by_option = {
          "scenario_data": ":" + name,
      }
  )
